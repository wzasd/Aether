import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type { SessionConfig, Session, ProviderMeta } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { GeminiOutputParser } from './parsers/gemini-output-parser'
import { Secrets } from '../../core/secrets'

const GEMINI_META: ProviderMeta = {
  id: 'gemini',
  name: 'Gemini',
  binary: 'gemini',
  vendor: 'Google',
  models: [
    // default MUST be first — resolveModel falls back to models[0] and
    // gemini-2.5-pro returns model_not_found from the CLI.
    { id: 'default', name: 'Default (CLI configured)', contextWindow: 1048576 },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576 },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 }
  ],
  permissionFlags: {
    manual: [],
    autoEdit: ['--approval-mode', 'auto_edit'],
    plan: ['--approval-mode', 'plan'],
    fullAuto: ['--approval-mode', 'yolo'],
    trusted: ['--approval-mode', 'yolo']
  },
  supportsStreamJson: true,
  supportsInteractive: false
}

interface GeminiSessionEntry {
  session: Session
  config: SessionConfig
  parser: GeminiOutputParser
  geminiSessionId: string | null
  activeChild: ChildProcess | null
  doneEmitted: boolean
}

export class GeminiProvider extends BaseCLIProvider {
  readonly meta = GEMINI_META

  private geminiSessions = new Map<string, GeminiSessionEntry>()

  protected buildStreamJsonArgs(config: SessionConfig, _resume: boolean): string[] {
    // Align with Slock: always use --yolo for headless per-turn mode
    const args = ['-p', '', '--output-format', 'stream-json', '--yolo']
    // Only pass --model when it's explicitly set and not 'default';
    // otherwise let the CLI use its configured default model.
    if (this.shouldPassModelFlag(config.model)) {
      args.push('--model', config.model)
    }
    return args
  }

  protected buildManualArgs(_config: SessionConfig, _resume: boolean): string[] {
    return []
  }

  protected buildEnv(): Record<string, string> {
    const apiKey = Secrets.get('gemini-cli')
    return apiKey ? { GEMINI_API_KEY: apiKey } : {}
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new GeminiOutputParser()
  }

  // ─── Session lifecycle ─────────────────────────────────────────

  override async startSession(config: SessionConfig): Promise<Session> {
    let effectiveConfig = config

    if (config.permissionMode === 'manual' && !this.meta.supportsInteractive) {
      effectiveConfig = { ...config, permissionMode: 'plan' }
    }

    const sessionId = effectiveConfig.sessionId || randomUUID()
    const sessionConfig = { ...effectiveConfig, sessionId }

    // Reuse existing entry to preserve Gemini's real session_id across turns
    const existing = this.geminiSessions.get(sessionId)
    if (existing) {
      existing.config = sessionConfig
      existing.session.config = sessionConfig
      existing.session.status = 'idle'
      existing.doneEmitted = false
      return existing.session
    }

    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now()
    }

    this.geminiSessions.set(sessionId, {
      session,
      config: sessionConfig,
      parser: new GeminiOutputParser(),
      geminiSessionId: null,
      activeChild: null,
      doneEmitted: false
    })

    return session
  }

  override async endSession(sessionId: string): Promise<void> {
    const entry = this.geminiSessions.get(sessionId)
    if (entry) {
      entry.activeChild?.kill('SIGTERM')
      this.geminiSessions.delete(sessionId)
    }
  }

  // ─── Messaging ─────────────────────────────────────────────────

  override sendMessage(sessionId: string, content: string): void {
    const entry = this.geminiSessions.get(sessionId)
    if (!entry) return

    // Kill any previous in-flight process for this session
    entry.activeChild?.kill('SIGTERM')
    entry.activeChild = null
    entry.session.status = 'running'
    entry.parser.beginTurn()
    entry.doneEmitted = false

    // Build args: -p enables non-interactive mode, prompt content goes via stdin.
    // -r is only added for subsequent turns using Gemini's real session_id.
    const args = this.buildStreamJsonArgs(entry.config, false)
    if (entry.geminiSessionId) {
      args.push('-r', entry.geminiSessionId)
    }

    const env = { ...process.env, ...this.buildEnv() }
    const binary = this.resolveBinary()

    const child = spawn(binary, args, {
      cwd: entry.config.workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    entry.activeChild = child

    let buffer = ''
    let stderr = ''

    child.stdin.write(content)
    child.stdin.end()

    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const events = entry.parser.parseLine(line)
        for (const event of events) {
          if (event.type === 'system_init') {
            entry.geminiSessionId = event.sessionId
          }

          if (event.type === 'permission_request') {
            entry.session.status = 'waiting_permission'
          } else if (event.type === 'ask_user_question') {
            entry.session.status = 'waiting_question'
          } else if (event.type === 'done') {
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
      stderr += data.toString()
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

      // Gemini CLI writes warnings to stderr even on success
      // ("Ripgrep is not available", "256-color support not detected").
      // Only treat non-zero exit or signal as fatal.
      if (code === 0 && !signal) {
        const flushEvents = entry.parser.flush()
        for (const event of flushEvents) {
          if (event.type === 'done') entry.doneEmitted = true
          if (event.type === 'error') entry.session.status = 'error'
          this.emit(`event:${sessionId}`, event)
        }
        if (!entry.doneEmitted) {
          entry.session.status = 'idle'
          this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
        }
      } else {
        entry.session.status = 'error'
        const reason =
          stderr.trim() || `Gemini CLI exited unexpectedly (${signal || code || 'unknown'})`
        this.emit(`event:${sessionId}`, { type: 'error', error: reason })
        this.emit(`event:${sessionId}`, { type: 'done', id: sessionId })
      }
    })
  }

  override abort(sessionId: string): void {
    const entry = this.geminiSessions.get(sessionId)
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
    // Gemini one-shot: approvals handled via --approval-mode flag.
  }

  override respondQuestion(_sessionId: string, _answer: string): void {
    // Not supported for one-shot Gemini CLI.
  }
}
