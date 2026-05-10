import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type { SessionConfig, Session, ProviderMeta } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { CodexOutputParser } from './parsers/codex-output-parser'
import { Secrets } from '../../core/secrets'

const CODEX_META: ProviderMeta = {
  id: 'codex',
  name: 'Codex',
  binary: 'codex',
  vendor: 'OpenAI',
  models: [
    { id: 'codex-mini-latest', name: 'Codex Mini', contextWindow: 200000 },
    { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000 },
    { id: 'o3', name: 'o3', contextWindow: 200000 }
  ],
  permissionFlags: {
    manual: [],
    autoEdit: [],
    plan: [],
    fullAuto: [],
    trusted: []
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

interface CodexSessionEntry {
  session: Session
  config: SessionConfig
  parser: CodexOutputParser
  activeChild: ChildProcess | null
  doneEmitted: boolean
  buffer: string
  stderr: string
}

export class CodexProvider extends BaseCLIProvider {
  readonly meta = CODEX_META

  private codexSessions = new Map<string, CodexSessionEntry>()

  protected buildStreamJsonArgs(_config: SessionConfig, _resume: boolean): string[] {
    // Codex uses per-turn spawn, not persistent stream-json stdin.
    // This method is not used; sendMessage builds args directly.
    return []
  }

  protected buildManualArgs(config: SessionConfig, _resume: boolean): string[] {
    const args: string[] = ['--model', config.model]

    if (config.sessionId) {
      args.push('resume', config.sessionId)
    }

    return args
  }

  protected buildEnv(): Record<string, string> {
    const apiKey = Secrets.get('codex-cli')
    return apiKey ? { OPENAI_API_KEY: apiKey } : {}
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new CodexOutputParser()
  }

  // ─── Session lifecycle (per-turn, like OpenCode) ────────────────

  override async startSession(config: SessionConfig): Promise<Session> {
    let effectiveConfig = config
    if (config.permissionMode === 'manual' && !this.meta.supportsInteractive) {
      effectiveConfig = { ...config, permissionMode: 'plan' }
    }

    const sessionId = effectiveConfig.sessionId || randomUUID()
    const sessionConfig = { ...effectiveConfig, sessionId }
    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now()
    }

    this.codexSessions.set(sessionId, {
      session,
      config: sessionConfig,
      parser: new CodexOutputParser(),
      activeChild: null,
      doneEmitted: false,
      buffer: '',
      stderr: ''
    })

    return session
  }

  override async endSession(sessionId: string): Promise<void> {
    const entry = this.codexSessions.get(sessionId)
    if (entry) {
      entry.activeChild?.kill('SIGTERM')
      this.codexSessions.delete(sessionId)
    }
  }

  // ─── Messaging (per-turn spawn) ─────────────────────────────────

  override sendMessage(sessionId: string, content: string): void {
    const entry = this.codexSessions.get(sessionId)
    if (!entry) return

    // Kill any previous in-flight process
    entry.activeChild?.kill('SIGTERM')
    entry.activeChild = null
    entry.session.status = 'running'
    entry.parser.beginTurn()
    entry.doneEmitted = false

    // Build args: codex exec --json --model <model> --skip-git-repo-check <prompt>
    const args = [
      'exec',
      '--json',
      '--model', entry.config.model,
      '--skip-git-repo-check'
    ]

    if (entry.config.sessionId) {
      args.push('--resume', entry.config.sessionId)
    }

    // Prompt goes as positional argument
    args.push(content)

    const env = { ...process.env, ...this.buildEnv() }
    const binary = this.resolveBinary()

    const child = spawn(binary, args, {
      cwd: entry.config.workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
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
          this.handleEvent(sessionId, entry, event)
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      entry.stderr += data.toString()
    })

    child.on('error', (error) => {
      entry.activeChild = null
      this.handleTerminalFailure(sessionId, entry, error.message || 'Codex process failed to start')
      this.codexSessions.delete(sessionId)
    })

    child.on('exit', (code, signal) => {
      entry.activeChild = null

      if (entry.buffer.trim()) {
        const events = entry.parser.parseLine(entry.buffer)
        for (const event of events) {
          this.handleEvent(sessionId, entry, event)
        }
        entry.buffer = ''
      }

      if (!entry.doneEmitted) {
        const cleanExit = code === 0 && !signal && !entry.stderr.trim()
        if (cleanExit) {
          const flushEvents = entry.parser.flush()
          for (const event of flushEvents) {
            this.handleEvent(sessionId, entry, event)
          }
          if (!entry.doneEmitted) {
            this.handleEvent(sessionId, entry, { type: 'done', id: sessionId })
          }
        } else {
          const reason = entry.stderr.trim() || `Codex process exited unexpectedly (${signal || code || 'unknown'})`
          this.handleTerminalFailure(sessionId, entry, reason)
        }
      }
    })
  }

  override abort(sessionId: string): void {
    const entry = this.codexSessions.get(sessionId)
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

  // ─── Helpers ────────────────────────────────────────────────────

  private handleEvent(sessionId: string, entry: CodexSessionEntry, event: any): void {
    if (event.type === 'done') {
      entry.session.status = 'idle'
      entry.doneEmitted = true
    } else if (event.type === 'error') {
      entry.session.status = 'error'
    } else if (event.type === 'text_delta' || event.type === 'tool_start' || event.type === 'tool_result') {
      entry.session.status = 'running'
    }
    this.emit(`event:${sessionId}`, event)
  }

  private handleTerminalFailure(sessionId: string, entry: CodexSessionEntry, message: string): void {
    if (entry.doneEmitted) return
    console.error(`[${this.meta.id}] terminal failure:`, message)
    entry.session.status = 'error'
    this.emit(`event:${sessionId}`, { type: 'error', error: message })
    this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
    entry.doneEmitted = true
  }
}
