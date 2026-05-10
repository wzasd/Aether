import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type { SessionConfig, Session, ProviderMeta } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { ClaudeOutputParser } from './parsers/claude-output-parser'
import { Secrets } from '../../core/secrets'
import { writeObservabilityEvent } from '../../core/logging'

const CURSOR_META: ProviderMeta = {
  id: 'cursor',
  name: 'Cursor',
  binary: 'cursor-agent',
  vendor: 'Cursor',
  models: [
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 200000 },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000 },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000 }
  ],
  permissionFlags: {
    manual: [],
    autoEdit: [],
    plan: [],
    fullAuto: ['--yolo'],
    trusted: ['--yolo']
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

interface CursorSessionEntry {
  session: Session
  config: SessionConfig
  parser: ClaudeOutputParser
  activeChild: ChildProcess | null
  doneEmitted: boolean
  buffer: string
  stderr: string
}

export class CursorProvider extends BaseCLIProvider {
  readonly meta = CURSOR_META

  private cursorSessions = new Map<string, CursorSessionEntry>()

  protected buildStreamJsonArgs(_config: SessionConfig, _resume: boolean): string[] {
    // Cursor uses per-turn spawn, not persistent stream-json stdin.
    // This method is not used; sendMessage builds args directly.
    return []
  }

  protected buildManualArgs(config: SessionConfig, _resume: boolean): string[] {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--yolo',
      '--approve-mcps',
      '--trust',
      '--model', config.model
    ]

    if (config.sessionId) {
      args.push('--resume', config.sessionId)
    }

    return args
  }

  protected buildEnv(): Record<string, string> {
    const apiKey = Secrets.get('claude-cli')
    return {
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    }
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new ClaudeOutputParser('stream-json', '')
  }

  /** Cursor uses UUID-format session IDs. Reject OpenCode-style `oc-` IDs. */
  protected isValidSessionId(sessionId: string): boolean {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return UUID_RE.test(sessionId)
  }

  // ─── Session lifecycle (per-turn, like OpenCode) ────────────────

  override async startSession(config: SessionConfig): Promise<Session> {
    let effectiveConfig = config
    if (config.permissionMode === 'manual' && !this.meta.supportsInteractive) {
      effectiveConfig = { ...config, permissionMode: 'plan' }
    }

    // Validate config.sessionId — reject IDs from other providers (defense-in-depth)
    const validProvidedSessionId = effectiveConfig.sessionId && this.isValidSessionId(effectiveConfig.sessionId)
      ? effectiveConfig.sessionId
      : null

    if (effectiveConfig.sessionId && !validProvidedSessionId) {
      writeObservabilityEvent('runtime:session_id_rejected', {
        providerType: this.meta.id,
        sessionId: effectiveConfig.sessionId,
      })
    }

    const sessionId = validProvidedSessionId || randomUUID()
    const sessionConfig = { ...effectiveConfig, sessionId }
    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now()
    }

    this.cursorSessions.set(sessionId, {
      session,
      config: sessionConfig,
      parser: new ClaudeOutputParser('stream-json', sessionId),
      activeChild: null,
      doneEmitted: false,
      buffer: '',
      stderr: ''
    })

    return session
  }

  override async endSession(sessionId: string): Promise<void> {
    const entry = this.cursorSessions.get(sessionId)
    if (entry) {
      entry.activeChild?.kill('SIGTERM')
      this.cursorSessions.delete(sessionId)
    }
  }

  // ─── Messaging (per-turn spawn, aligned with Slock) ─────────────

  override sendMessage(sessionId: string, content: string): void {
    const entry = this.cursorSessions.get(sessionId)
    if (!entry) return

    // Kill any previous in-flight process
    entry.activeChild?.kill('SIGTERM')
    entry.activeChild = null
    entry.session.status = 'running'
    entry.parser.beginTurn()
    entry.doneEmitted = false

    // Aligned with Slock: cursor-agent --print --output-format stream-json --yolo --approve-mcps --trust --model <model> --resume <id> <prompt>
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--yolo',
      '--approve-mcps',
      '--trust'
    ]

    if (this.shouldPassModelFlag(entry.config.model)) {
      args.push('--model', entry.config.model)
    }

    if (entry.config.sessionId) {
      args.push('--resume', entry.config.sessionId)
    }

    // Prompt goes as positional argument (Slock pattern)
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
      this.handleTerminalFailure(sessionId, entry, error.message || 'Cursor process failed to start')
      this.cursorSessions.delete(sessionId)
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
          const reason = entry.stderr.trim() || `Cursor process exited unexpectedly (${signal || code || 'unknown'})`
          this.handleTerminalFailure(sessionId, entry, reason)
        }
      }
    })
  }

  override abort(sessionId: string): void {
    const entry = this.cursorSessions.get(sessionId)
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

  private handleEvent(sessionId: string, entry: CursorSessionEntry, event: any): void {
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

  private handleTerminalFailure(sessionId: string, entry: CursorSessionEntry, message: string): void {
    if (entry.doneEmitted) return
    console.error(`[${this.meta.id}] terminal failure:`, message)
    entry.session.status = 'error'
    this.emit(`event:${sessionId}`, { type: 'error', error: message })
    this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
    entry.doneEmitted = true
  }
}