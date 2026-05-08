import { randomUUID } from 'crypto'
import { spawn, ChildProcess, execFile } from 'child_process'
import { EventEmitter } from 'events'
import { spawn as spawnPty, type IPty } from 'node-pty'
import type { CLIProvider, SessionConfig, Session, ProviderMeta, ProviderConfig } from '../provider'
import type { AIEvent } from '../types'
import type { OutputParser } from './parsers/output-parser'

type SessionEntry = {
  session: Session
  config: SessionConfig
  status: Session['status']
  transport: 'stream-json' | 'pty'
  process?: ChildProcess
  ptyProcess?: IPty
  parser: OutputParser
  buffer: string
  stderr: string
  doneEmitted: boolean
}

export abstract class BaseCLIProvider extends EventEmitter implements CLIProvider {
  abstract readonly meta: ProviderMeta

  protected sessions = new Map<string, SessionEntry>()
  protected config: ProviderConfig | null = null

  // ─── Abstract (subclass must implement) ──────────────────────

  protected abstract buildStreamJsonArgs(config: SessionConfig, resume: boolean): string[]
  protected abstract buildManualArgs(config: SessionConfig, resume: boolean): string[]
  protected abstract buildEnv(): Record<string, string>
  protected abstract createParser(transport: 'stream-json' | 'pty', sessionId: string): OutputParser

  /** Override to inject MCP server config args (e.g. --mcp-config-file) */
  protected buildMcpArgs(_workingDir?: string): string[] {
    return []
  }

  // ─── Public ──────────────────────────────────────────────────

  async detect(): Promise<string | null> {
    const binary = this.resolveBinary()
    return new Promise((resolve) => {
      execFile(binary, ['--version'], (err, stdout) => {
        if (err) { resolve(null); return }
        resolve(stdout.trim() || null)
      })
    })
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config
  }

  async startSession(config: SessionConfig): Promise<Session> {
    // PTY fallback: manual mode downgrades to plan for providers without interactive support
    if (config.permissionMode === 'manual' && !this.meta.supportsInteractive) {
      config = { ...config, permissionMode: 'plan' }
    }

    if (config.permissionMode === 'manual' && config.sessionId) {
      const existing = this.sessions.get(config.sessionId)
      if (existing && existing.transport === 'pty') {
        return existing.session
      }
    }

    const resumeExistingSession = Boolean(config.sessionId)
    const sessionId = config.sessionId || randomUUID()
    const sessionConfig = { ...config, sessionId }
    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now()
    }

    if (sessionConfig.permissionMode === 'manual') {
      return this.startManualSession(session, resumeExistingSession)
    }

    return this.startStreamJsonSession(session, resumeExistingSession)
  }

  async endSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty' && entry.ptyProcess) {
      entry.ptyProcess.kill()
    } else {
      entry.process?.kill()
    }
    this.sessions.delete(sessionId)
  }

  sendMessage(sessionId: string, content: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    entry.doneEmitted = false
    entry.status = 'running'
    entry.session.status = 'running'

    if (entry.transport === 'pty' && entry.ptyProcess) {
      entry.parser.beginTurn()
      this.writePastedInput(entry.ptyProcess, content)
      return
    }

    if (!entry.process?.stdin?.writable) return

    const msg = JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: {
        role: 'user',
        content: [{ type: 'text', text: content }]
      },
      parent_tool_use_id: null
    }) + '\n'

    entry.process.stdin.write(msg)
  }

  respondPermission(sessionId: string, approved: boolean): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty' && entry.ptyProcess) {
      entry.parser.resolveInteraction()
      entry.status = 'running'
      entry.session.status = 'running'
      entry.ptyProcess.write(approved ? 'y\r' : 'n\r')
      return
    }

    if (!approved) {
      this.abort(sessionId)
    }
  }

  respondQuestion(sessionId: string, answer: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty' && entry.ptyProcess) {
      entry.parser.resolveInteraction()
      entry.status = 'running'
      entry.session.status = 'running'
      this.writePastedInput(entry.ptyProcess, answer)
      return
    }

    if (!entry.process?.stdin?.writable) return
    const msg = JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: {
        role: 'user',
        content: [{ type: 'text', text: answer }]
      },
      parent_tool_use_id: null
    }) + '\n'
    entry.process.stdin.write(msg)
    entry.status = 'running'
    entry.session.status = 'running'
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty' && entry.ptyProcess) {
      entry.parser.cancelTurn()
      entry.ptyProcess.write('')
      entry.status = 'idle'
      entry.session.status = 'idle'
      return
    }

    entry.process?.kill('SIGTERM')
    entry.status = 'idle'
    entry.session.status = 'idle'
  }

  onEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.on(`event:${sessionId}`, handler)
  }

  offEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.off(`event:${sessionId}`, handler)
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private resolveBinary(): string {
    return this.config?.binaryPath || this.meta.binary
  }

  private resolveEnv(): Record<string, string> {
    return { ...this.config?.extraEnv, ...this.buildEnv() }
  }

  // ─── Transport starters ──────────────────────────────────────

  private startStreamJsonSession(session: Session, resumeExistingSession: boolean): Session {
    const args = [...this.buildStreamJsonArgs(session.config, resumeExistingSession), ...this.buildMcpArgs(session.config.workingDir)]
    const env = { ...process.env, ...this.resolveEnv() }
    const binary = this.resolveBinary()

    const child = spawn(binary, args, {
      cwd: session.config.workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    const entry: SessionEntry = {
      session,
      process: child,
      config: session.config,
      status: session.status,
      transport: 'stream-json',
      parser: this.createParser('stream-json', session.id),
      buffer: '',
      stderr: '',
      doneEmitted: false
    }
    this.sessions.set(session.id, entry)

    child.stdout.on('data', (data: Buffer) => {
      entry.buffer += data.toString()
      const lines = entry.buffer.split('\n')
      entry.buffer = lines.pop() || ''

      for (const line of lines) {
        const events = entry.parser.parseLine(line)
        for (const event of events) {
          this.emitSessionEvent(session.id, entry, event)
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      entry.stderr += data.toString()
    })

    child.on('error', (error) => {
      this.emitTerminalFailure(session.id, entry, error.message || `${this.meta.name} process failed to start`)
      this.sessions.delete(session.id)
    })

    child.on('exit', (code, signal) => {
      if (!entry.doneEmitted) {
        const stderr = entry.stderr.trim()
        const cleanExit = code === 0 && !signal && !stderr
        if (cleanExit) {
          const flushEvents = entry.parser.flush()
          for (const event of flushEvents) {
            this.emitSessionEvent(session.id, entry, event)
          }
          if (!entry.doneEmitted) {
            this.emitSessionEvent(session.id, entry, { type: 'done', id: session.id })
          }
        } else {
          console.error(`[${this.meta.id}] exit code=${code} signal=${signal} stderr=`, stderr)
          const reason = stderr || `${this.meta.name} process exited unexpectedly (${signal || code || 'unknown'})`
          this.emitTerminalFailure(session.id, entry, reason)
        }
      }
      this.sessions.delete(session.id)
    })

    return session
  }

  private startManualSession(session: Session, resumeExistingSession: boolean): Session {
    const args = [...this.buildManualArgs(session.config, resumeExistingSession), ...this.buildMcpArgs(session.config.workingDir)]
    const env = { ...process.env, ...this.resolveEnv() }
    const binary = this.resolveBinary()

    const ptyProcess = spawnPty(binary, args, {
      cwd: session.config.workingDir || process.cwd(),
      cols: 120,
      rows: 40,
      env,
      name: 'xterm-color'
    })

    const entry: SessionEntry = {
      session,
      config: session.config,
      status: session.status,
      transport: 'pty',
      ptyProcess,
      parser: this.createParser('pty', session.id),
      buffer: '',
      stderr: '',
      doneEmitted: false
    }
    this.sessions.set(session.id, entry)

    // Keep transcript mode open so tool activity is rendered into the TTY stream.
    setTimeout(() => {
      const current = this.sessions.get(session.id)
      if (current?.transport === 'pty' && current.ptyProcess) {
        current.ptyProcess.write('')
      }
    }, 150)

    ptyProcess.onData((data) => {
      const events = entry.parser.consume(data)
      for (const event of events) {
        this.emitSessionEvent(session.id, entry, event)
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (entry.status !== 'idle' && !entry.doneEmitted) {
        this.emitTerminalFailure(
          session.id,
          entry,
          `${this.meta.name} interactive session exited unexpectedly (${signal || exitCode || 'unknown'})`
        )
      }
      this.sessions.delete(session.id)
    })

    return session
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private writePastedInput(ptyProcess: IPty, content: string): void {
    const normalizedContent = content.replace(/\r\n?/g, '\n')
    ptyProcess.write(`[200~${normalizedContent}[201~\r`)
  }

  protected emitSessionEvent(sessionId: string, entry: SessionEntry, event: AIEvent): void {
    if (event.type === 'permission_request') {
      entry.status = 'waiting_permission'
      entry.session.status = 'waiting_permission'
    } else if (event.type === 'ask_user_question') {
      entry.status = 'waiting_question'
      entry.session.status = 'waiting_question'
    } else if (event.type === 'done') {
      entry.status = 'idle'
      entry.session.status = 'idle'
      entry.doneEmitted = true
    } else if (event.type === 'error') {
      entry.status = 'error'
      entry.session.status = 'error'
    } else if (
      event.type === 'text_delta' ||
      event.type === 'thinking_delta' ||
      event.type === 'tool_start' ||
      event.type === 'tool_result' ||
      event.type === 'complete'
    ) {
      entry.status = 'running'
      entry.session.status = 'running'
    }

    this.emit(`event:${sessionId}`, event)
  }

  protected emitTerminalFailure(sessionId: string, entry: SessionEntry, message: string): void {
    if (entry.doneEmitted) return

    console.error(`[${this.meta.id}] terminal failure:`, message)
    entry.status = 'error'
    entry.session.status = 'error'
    this.emit(`event:${sessionId}`, {
      type: 'error',
      error: message
    } as AIEvent)
    this.emit(`event:${sessionId}`, {
      type: 'done',
      id: sessionId
    } as AIEvent)
    entry.doneEmitted = true
  }
}
