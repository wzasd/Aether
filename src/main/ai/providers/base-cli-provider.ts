import { randomUUID } from 'crypto'
import { spawn, ChildProcess, execFile } from 'child_process'
import { EventEmitter } from 'events'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { existsSync } from 'fs'
import type { CLIProvider, SessionConfig, Session, ProviderMeta, ProviderConfig, ModelInfo } from '../provider'
import type { BridgeConfig } from '../../chat-bridge/types'
import type { AIEvent } from '../types'
import type { OutputParser } from './parsers/output-parser'
import { recordProviderUsage } from '../provider-token-tracker'
import { writeObservabilityEvent } from '../../core/logging'
import { diagnoseProviderError } from '../provider-error-diagnostics'

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

  // Cached resolved binary path — probed once in initialize() to avoid
  // repeated fs.existsSync calls on every sendMessage/startSession.
  private resolvedBinaryPath: string | null = null

  // ─── Abstract (subclass must implement) ──────────────────────

  protected abstract buildStreamJsonArgs(config: SessionConfig, resume: boolean): string[]
  protected abstract buildManualArgs(config: SessionConfig, resume: boolean): string[]
  protected abstract buildEnv(): Record<string, string>
  protected abstract createParser(transport: 'stream-json' | 'pty', sessionId: string): OutputParser

  /** Override to inject MCP server config args (e.g. --mcp-config-file).
   *  When bridgeConfig is present, use the bridge config file path instead
   *  of generating a separate MCP config. The bridge config already includes
   *  the "chat" server definition + any existing MCP servers.
   *  ADR-015: Chat Bridge MCP Sidecar */
  protected buildMcpArgs(_workingDir?: string, _bridgeConfig?: BridgeConfig): string[] {
    return []
  }

  /** Validate whether a session ID is compatible with this provider.
   *  Prevents cross-provider session ID pollution (e.g. OpenCode's `oc-xxx`
   *  format being passed to Claude's `--resume` which requires UUID).
   *  Subclasses override to enforce provider-specific formats. */
  protected isValidSessionId(sessionId: string): boolean {
    // Default: accept any non-empty string (backward compatible)
    return Boolean(sessionId)
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
    // Probe and cache the binary path once at initialization time.
    this.resolvedBinaryPath = this.probeBinaryPath()
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

    // Validate session ID format — prevent cross-provider pollution
    // (e.g. OpenCode's `oc-xxx` ID passed to Claude's `--resume` which requires UUID)
    const providedSessionId = config.sessionId
    const isValid = Boolean(providedSessionId) && this.isValidSessionId(providedSessionId!)
    if (providedSessionId && !isValid) {
      // FR-5: Log structured event when session ID is rejected
      writeObservabilityEvent('runtime:session_id_rejected', {
        providerType: this.meta.id,
        sessionId: providedSessionId,
      })
    }
    const resumeExistingSession = isValid
    const sessionId = resumeExistingSession ? providedSessionId! : randomUUID()
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

  sendMessage(sessionId: string, content: string, opts?: { parentToolUseId?: string }): void {
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

    const parentToolUseId = opts?.parentToolUseId ?? null

    const contentBlock = parentToolUseId
      ? { type: 'tool_result', tool_use_id: parentToolUseId, content }
      : { type: 'text', text: content }

    const msg = JSON.stringify({
      type: 'user',
      session_id: sessionId,
      message: {
        role: 'user',
        content: [contentBlock]
      },
      parent_tool_use_id: parentToolUseId
    }) + '\n'

    entry.process.stdin.write(msg)
    writeObservabilityEvent('runtime:process_stdin', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      sessionId,
      contentLength: content.length
    })
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

  /** List available models for this provider.
   *  Default: return static meta.models (aligned with Multica — most providers
   *  don't support dynamic model discovery).
   *  Subclasses override this for dynamic discovery (e.g. opencode → `opencode models`). */
  async listModels(): Promise<ModelInfo[]> {
    const models = this.meta.models
    writeObservabilityEvent('runtime:models_listed', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      modelCount: models.length,
      source: 'static-meta'
    })
    return models
  }

  /** Resolve the binary path for spawning CLI processes.
   *  Uses cached path from initialize() — avoids repeated fs.existsSync on every spawn.
   *  Falls back to live probing if cache is empty (e.g. before initialize). */
  protected resolveBinary(): string {
    if (this.resolvedBinaryPath) return this.resolvedBinaryPath
    // Fallback: probe live (before initialize was called)
    return this.probeBinaryPath()
  }

  /** Probe common binary installation paths. Called once in initialize() and cached.
   *  Priority: user-configured binaryPath > candidate path > bare name.
   *  Electron apps on macOS have restricted PATH (often missing Homebrew),
   *  so we probe common installation directories before falling back. */
  private probeBinaryPath(): string {
    if (this.config?.binaryPath) return this.config.binaryPath

    const candidates = this.getBinaryCandidates()
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        writeObservabilityEvent('runtime:binary_resolved', {
          profileId: this.config?.profileId,
          runtimeKey: this.meta.id,
          binaryPath: candidate
        })
        return candidate
      }
    }
    writeObservabilityEvent('runtime:binary_not_found', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      binaryPath: this.meta.binary
    })
    return this.meta.binary
  }

  /** Candidate binary paths for PATH probing. Subclasses override to add
   *  provider-specific common locations (e.g. ~/.local/bin for Kimi). */
  protected getBinaryCandidates(): string[] {
    return [
      `/opt/homebrew/bin/${this.meta.binary}`,
      `/usr/local/bin/${this.meta.binary}`,
    ]
  }

  /** Whether the model flag should be passed to the CLI.
   *  Returns true only when model is explicitly set and not 'default'.
   *  'default' means "let the CLI use its own configured model".
   *  Subclasses can override for provider-specific matching (e.g. Copilot/Cursor
   *  sub-model lists), but the base behavior covers the common case. */
  protected shouldPassModelFlag(model?: string): boolean {
    const shouldPass = Boolean(model && model !== 'default')
    if (model) {
      writeObservabilityEvent('runtime:model_resolved', {
        profileId: this.config?.profileId,
        runtimeKey: this.meta.id,
        modelId: shouldPass ? model : 'default (CLI default)',
        passModelFlag: shouldPass
      })
    }
    return shouldPass
  }

  private resolveEnv(): Record<string, string> {
    return { ...this.config?.extraEnv, ...this.buildEnv() }
  }

  // ─── Transport starters ──────────────────────────────────────

  private startStreamJsonSession(session: Session, resumeExistingSession: boolean): Session {
    const args = [...this.buildStreamJsonArgs(session.config, resumeExistingSession), ...this.buildMcpArgs(session.config.workingDir, session.config.bridgeConfig)]
    const env = { ...process.env, ...this.resolveEnv() }
    const binary = this.resolveBinary()

    const child = spawn(binary, args, {
      cwd: session.config.workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    writeObservabilityEvent('runtime:process_spawned', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      sessionId: session.id,
      binaryPath: binary
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
      const stderrText = data.toString()
      entry.stderr += stderrText
      writeObservabilityEvent('runtime:process_stderr', {
        profileId: this.config?.profileId,
        runtimeKey: this.meta.id,
        sessionId: session.id,
        stderr: stderrText.slice(0, 500), // Limit to prevent log flood
        totalStderrLength: entry.stderr.length
      })
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
          const reason = stderr || `${this.meta.name} process exited unexpectedly (${signal || code || 'unknown'})`
          this.emitTerminalFailure(session.id, entry, reason)
        }
      }
      this.sessions.delete(session.id)
    })

    return session
  }

  private startManualSession(session: Session, resumeExistingSession: boolean): Session {
    const args = [...this.buildManualArgs(session.config, resumeExistingSession), ...this.buildMcpArgs(session.config.workingDir, session.config.bridgeConfig)]
    const env = { ...process.env, ...this.resolveEnv() }
    const binary = this.resolveBinary()

    const ptyProcess = spawnPty(binary, args, {
      cwd: session.config.workingDir || process.cwd(),
      cols: 120,
      rows: 40,
      env,
      name: 'xterm-color'
    })

    writeObservabilityEvent('runtime:process_spawned', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      sessionId: session.id,
      binaryPath: binary,
      transport: 'pty'
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

    // Track token usage on complete events
    if (event.type === 'complete' && event.usage) {
      recordProviderUsage(
        this.meta.id,
        event.usage.inputTokens ?? 0,
        event.usage.outputTokens ?? 0
      )
    }

    this.emit(`event:${sessionId}`, event)
  }

  protected emitTerminalFailure(sessionId: string, entry: SessionEntry, message: string): void {
    if (entry.doneEmitted) return

    // PR-1: Run structured error diagnostics before emitting
    const diagnostic = diagnoseProviderError(message, this.meta.id)

    writeObservabilityEvent('runtime:terminated', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      sessionId,
      reason: 'crashed',
      error: diagnostic.scrubbedMessage,
      errorCategory: diagnostic.category,
      errorSeverity: diagnostic.severity,
      errorFingerprint: diagnostic.fingerprint,
      errorRetryable: diagnostic.retryable,
    })

    // PR-1: Emit a dedicated provider_error observability event for structured alerting
    writeObservabilityEvent('provider:error', {
      profileId: this.config?.profileId,
      runtimeKey: this.meta.id,
      sessionId,
      category: diagnostic.category,
      severity: diagnostic.severity,
      fingerprint: diagnostic.fingerprint,
      scrubbedMessage: diagnostic.scrubbedMessage,
      retryable: diagnostic.retryable,
      userAction: diagnostic.userAction,
    })

    console.error(`[${this.meta.id}] terminal failure (${diagnostic.category}/${diagnostic.severity}):`, diagnostic.scrubbedMessage)
    entry.status = 'error'
    entry.session.status = 'error'
    this.emit(`event:${sessionId}`, {
      type: 'error',
      error: diagnostic.scrubbedMessage
    } as AIEvent)
    this.emit(`event:${sessionId}`, {
      type: 'done',
      id: sessionId
    } as AIEvent)
    entry.doneEmitted = true
  }
}
