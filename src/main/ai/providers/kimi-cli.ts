import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import type { SessionConfig, Session, ProviderMeta, ModelInfo } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { KimiOutputParser } from './parsers/kimi-output-parser'
import { getMcpConfigArgs } from '../../mcp/config-file'
import { writeObservabilityEvent } from '../../core/logging'

const KIMI_META: ProviderMeta = {
  id: 'kimi',
  name: 'Kimi',
  binary: 'kimi',
  vendor: 'Moonshot',
  models: [
    { id: 'default', name: 'Default (CLI configured)', contextWindow: 131072 }
  ],
  permissionFlags: {
    manual: [],
    autoEdit: ['--afk'],
    plan: ['--plan'],
    fullAuto: ['--yolo'],
    trusted: ['--yolo']
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

interface KimiSessionEntry {
  session: Session
  config: SessionConfig
  parser: KimiOutputParser
  activeChild: ChildProcess | null
  doneEmitted: boolean
  buffer: string
  stderr: string
}

export class KimiProvider extends BaseCLIProvider {
  readonly meta = KIMI_META

  private kimiSessions = new Map<string, KimiSessionEntry>()

  protected buildStreamJsonArgs(_config: SessionConfig, _resume: boolean): string[] {
    return []
  }

  protected buildManualArgs(config: SessionConfig, _resume: boolean): string[] {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--yolo'
    ]

    if (this.shouldPassModelFlag(config.model)) {
      args.push('--model', config.model)
    }

    return args
  }

  protected buildEnv(): Record<string, string> {
    return { FORCE_COLOR: '0', NO_COLOR: '1' }
  }

  protected buildMcpArgs(workingDir?: string): string[] {
    return getMcpConfigArgs(workingDir, '--mcp-config-file')
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new KimiOutputParser()
  }

  /** Kimi uses UUID-format session IDs. Reject OpenCode-style `oc-` IDs. */
  protected isValidSessionId(sessionId: string): boolean {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return UUID_RE.test(sessionId)
  }

  // ─── Dynamic model discovery (aligned with Slock) ──────────────

  async listModels(): Promise<ModelInfo[]> {
    const discovered = this.detectKimiModels()
    if (discovered && discovered.length > 0) {
      writeObservabilityEvent('runtime:models_listed', {
        profileId: this.config?.profileId,
        runtimeKey: this.meta.id,
        modelCount: discovered.length,
        source: 'kimi-config'
      })
      return discovered
    }
    writeObservabilityEvent('runtime:models_listed', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      modelCount: this.meta.models.length,
      source: 'static-meta'
    })
    return this.meta.models
  }

  private detectKimiModels(): ModelInfo[] | null {
    const configPath = path.join(homedir(), '.kimi', 'config.toml')
    let raw: string
    try {
      raw = fs.readFileSync(configPath, 'utf8')
    } catch {
      return null
    }

    const models: ModelInfo[] = []
    const lineRe = /^\s*\[models\.(.+?)\s*\]\s*$/gm
    let match: RegExpExecArray | null
    while ((match = lineRe.exec(raw)) !== null) {
      let key = match[1].trim()
      if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1)
      if (!key) continue
      models.push({ id: key, name: key.split('/').pop() || key, contextWindow: 200000 })
    }

    return models.length > 0 ? models : null
  }

  // ─── Session lifecycle (per-turn spawn) ────────────────────────

  override async startSession(config: SessionConfig): Promise<Session> {
    const sessionId = config.sessionId || randomUUID()
    const sessionConfig = { ...config, sessionId }
    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now()
    }

    this.kimiSessions.set(sessionId, {
      session,
      config: sessionConfig,
      parser: new KimiOutputParser(),
      activeChild: null,
      doneEmitted: false,
      buffer: '',
      stderr: ''
    })

    return session
  }

  override async endSession(sessionId: string): Promise<void> {
    const entry = this.kimiSessions.get(sessionId)
    if (entry) {
      entry.activeChild?.kill('SIGTERM')
      this.kimiSessions.delete(sessionId)
    }
  }

  // ─── Messaging (per-turn spawn, --prompt flag) ─────────────────

  override sendMessage(sessionId: string, content: string): void {
    const entry = this.kimiSessions.get(sessionId)
    if (!entry) return

    entry.activeChild?.kill('SIGTERM')
    entry.activeChild = null
    entry.session.status = 'running'
    entry.parser.beginTurn()
    entry.doneEmitted = false
    entry.buffer = ''
    entry.stderr = ''

    // Build args: kimi --print --output-format stream-json --yolo [--model <m>] --prompt <content> [--session <id>] [--mcp-config-file <path>]
    const args = this.buildManualArgs(entry.config, false)

    if (entry.config.sessionId) {
      args.push('--session', entry.config.sessionId)
    }

    const mcpArgs = this.buildMcpArgs(entry.config.workingDir)
    args.push(...mcpArgs)

    // Prompt goes as --prompt flag (Kimi --print mode expects this, not stdin)
    args.push('--prompt', content)

    const env = { ...process.env, ...this.buildEnv() }
    const binary = this.resolveBinary()

    const child = spawn(binary, args, {
      cwd: entry.config.workingDir || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })

    entry.activeChild = child

    child.stdout.on('data', (data: Buffer) => {
      entry.buffer += data.toString()
      const lines = entry.buffer.split('\n')
      entry.buffer = lines.pop() || ''

      for (const line of lines) {
        const events = entry.parser.parseLine(line)
        for (const event of events) {
          if (event.type === 'done') {
            entry.session.status = 'idle'
            entry.doneEmitted = true
          } else if (event.type === 'error') {
            entry.session.status = 'error'
          } else if (
            event.type === 'text_delta' ||
            event.type === 'tool_start' ||
            event.type === 'tool_result'
          ) {
            entry.session.status = 'running'
          }

          this.emit(`event:${sessionId}`, event)
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      entry.stderr += data.toString()
    })

    child.on('error', (error) => {
      entry.activeChild = null
      entry.doneEmitted = true
      entry.session.status = 'error'
      this.emit(`event:${sessionId}`, { type: 'error', error: error.message })
      this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
    })

    child.on('exit', (code, signal) => {
      entry.activeChild = null

      if (entry.doneEmitted) return

      if (entry.buffer.trim()) {
        const events = entry.parser.parseLine(entry.buffer.trim())
        for (const event of events) {
          if (event.type === 'done') entry.doneEmitted = true
          if (event.type === 'error') entry.session.status = 'error'
          this.emit(`event:${sessionId}`, event)
        }
      }

      if (!entry.doneEmitted) {
        const flushEvents = entry.parser.flush()
        for (const event of flushEvents) {
          if (event.type === 'done') entry.doneEmitted = true
          if (event.type === 'error') entry.session.status = 'error'
          this.emit(`event:${sessionId}`, event)
        }

        if (!entry.doneEmitted) {
          if (code === 0 && !signal) {
            entry.session.status = 'idle'
            this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
          } else {
            entry.session.status = 'error'
            const reason = entry.stderr.trim() || `Kimi CLI exited unexpectedly (${signal || code || 'unknown'})`
            this.emit(`event:${sessionId}`, { type: 'error', error: reason })
            this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
          }
        }
      }
    })
  }

  override abort(sessionId: string): void {
    const entry = this.kimiSessions.get(sessionId)
    if (!entry) return

    entry.doneEmitted = true
    if (entry.activeChild) {
      entry.activeChild.kill('SIGTERM')
      entry.activeChild = null
    }
    entry.session.status = 'error'
    this.emit(`event:${sessionId}`, { type: 'error', error: 'Aborted by user' })
    this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
  }

  override respondPermission(_sessionId: string, _approved: boolean): void {
    // Kimi one-shot: approvals handled via --yolo flag.
  }

  override respondQuestion(_sessionId: string, _answer: string): void {
    // Not supported for one-shot Kimi CLI.
  }
}
