import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import type {
  Client,
  InitializeResponse,
  NewSessionResponse,
  LoadSessionResponse,
  PromptResponse,
  McpServer,
  Stream,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk'
import { spawn, type ChildProcess } from 'child_process'
import { Readable, Writable } from 'node:stream'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DisconnectInfo {
  reason: 'process_exit' | 'process_close' | 'connection_close'
  exitCode: number | null
  signal: string | null
  stderr: string
}

export interface AcpClientCallbacks {
  onSessionUpdate: (params: SessionNotification) => void
  onRequestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  onReadTextFile: (params: ReadTextFileRequest) => Promise<ReadTextFileResponse>
  onWriteTextFile: (params: WriteTextFileRequest) => Promise<WriteTextFileResponse>
}

export interface AcpClientOptions {
  startupTimeoutMs?: number
  gracePeriodMs?: number
}

interface CachedModel {
  id?: string
  modelId?: string
  name?: string
}

interface CachedModelState {
  currentModelId?: string
  availableModels?: CachedModel[]
}

interface CachedConfigOption {
  id: string
  name: string
  type: string
  currentValue?: string
  selectedValue?: string
  category?: string
  description?: string
  options?: Array<{ value: string; name?: string }>
}

interface CachedMode {
  id: string
  name?: string
}

interface CachedModeState {
  currentModeId?: string
  availableModes?: CachedMode[]
}

interface SessionState {
  sessionId: string
  models?: CachedModelState | null
  configOptions?: CachedConfigOption[] | null
  modes?: CachedModeState | null
}

const STARTUP_TIMEOUT_MS = 60_000
const GRACE_PERIOD_MS = 2_000

// ─── AcpClient ──────────────────────────────────────────────────────────────

export class AcpClient {
  private _child: ChildProcess | null = null
  private _conn: ClientSideConnection | null = null
  private _initResult: InitializeResponse | null = null
  private _session: SessionState | null = null
  private _stderrBuf = ''
  private _disconnectHandler: ((info: DisconnectInfo) => void) | null = null
  private _reason: DisconnectInfo['reason'] | null = null
  private _closing = false

  private readonly _startupTimeoutMs: number
  private readonly _gracePeriodMs: number

  constructor(
    private readonly _callbacks: AcpClientCallbacks,
    options?: AcpClientOptions,
  ) {
    this._startupTimeoutMs = options?.startupTimeoutMs ?? STARTUP_TIMEOUT_MS
    this._gracePeriodMs = options?.gracePeriodMs ?? GRACE_PERIOD_MS
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  get isRunning(): boolean {
    return this._child !== null && !this._child.killed
  }

  get initializeResult(): InitializeResponse | null {
    return this._initResult
  }

  get currentSessionId(): string | null {
    return this._session?.sessionId ?? null
  }

  get currentModels(): CachedModelState | null {
    return this._session?.models ?? null
  }

  get currentModes(): CachedModeState | null {
    return this._session?.modes ?? null
  }

  get currentConfigOptions(): CachedConfigOption[] | null {
    return this._session?.configOptions ?? null
  }

  onDisconnect(handler: (info: DisconnectInfo) => void): void {
    this._disconnectHandler = handler
  }

  async start(
    command: string,
    args: string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ): Promise<InitializeResponse> {
    // 1. Spawn child process
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: process.platform === 'win32',
    })
    this._child = child

    // 2. Capture stderr (8KB ring buffer)
    child.stderr?.on('data', (data: Buffer) => {
      this._stderrBuf += data.toString()
      if (this._stderrBuf.length > 8192) {
        this._stderrBuf = this._stderrBuf.slice(-8192)
      }
    })

    // 3. Create NdjsonTransport from stdio
    const webReadable = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
    const webWritable = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>
    const stream: Stream = ndJsonStream(webWritable, webReadable)

    // 4. Create SDK ClientSideConnection
    const agentProxy = (_agent: ClientSideConnection): Client => ({
      sessionUpdate: async (params) => {
        this._callbacks.onSessionUpdate(params)
      },
      requestPermission: async (params) => {
        return this._callbacks.onRequestPermission(params as unknown as RequestPermissionRequest)
      },
      readTextFile: async (params) => {
        return this._callbacks.onReadTextFile(params as unknown as ReadTextFileRequest)
      },
      writeTextFile: async (params) => {
        return this._callbacks.onWriteTextFile(params as unknown as WriteTextFileRequest)
      },
    })

    const conn = new ClientSideConnection(agentProxy, stream)
    this._conn = conn

    // Listen for connection abort
    conn.signal.addEventListener('abort', () => {
      if (this._closing) return
      this._reason = 'connection_close'
    }, { once: true })

    // 5. Startup failure watcher: Promise.race(initialize vs process exit vs timeout)
    const startupFailure = new Promise<never>((_resolve, reject) => {
      const onExit = (code: number | null, signal: string | null) => {
        clearTimeout(timeoutId)
        reject(new Error(
          `ACP process exited during startup (code: ${code}, signal: ${signal})${this._stderrBuf ? '\n' + this._stderrBuf.slice(-500) : ''}`
        ))
      }
      const timeoutId = setTimeout(() => {
        child.off('exit', onExit)
        reject(new Error(`ACP initialize timed out after ${this._startupTimeoutMs / 1000}s`))
      }, this._startupTimeoutMs)
      child.once('exit', onExit)
    })

    try {
      this._initResult = await Promise.race([
        conn.initialize({
          clientInfo: { name: 'Bytro', version: '2.0.0' },
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        }),
        startupFailure,
      ])
    } catch (err) {
      // Clean up on startup failure
      await this._destroyProcess()
      throw err
    }

    // Listen for runtime process exit
    child.on('exit', (code, signal) => {
      if (this._closing) return
      this._reason = this._reason ?? 'process_exit'
      const info: DisconnectInfo = {
        reason: this._reason ?? 'process_exit',
        exitCode: code,
        signal,
        stderr: this._stderrBuf.slice(-500),
      }
      this._disconnectHandler?.(info)
    })

    return this._initResult
  }

  async close(): Promise<void> {
    this._closing = true
    if (this._conn) {
      try {
        await this.closeSession()
      } catch {
        // best-effort
      }
    }
    await this._destroyProcess()
  }

  // ─── Protocol Methods ────────────────────────────────────────────────────

  async newSession(
    cwd: string,
    mcpServers: McpServer[] = [],
    resumeSessionId?: string,
  ): Promise<NewSessionResponse> {
    this._assertConn()

    // Prefer session/load when agent supports it
    if (resumeSessionId && this._initResult?.agentCapabilities?.loadSession) {
      try {
        const response = await this._conn!.loadSession({
          sessionId: resumeSessionId,
          cwd,
          mcpServers,
        })
        this._cacheSession(response, resumeSessionId)
        return response as unknown as NewSessionResponse
      } catch {
        // Fall through to session/new
      }
    }

    const params: Record<string, unknown> = { cwd, mcpServers }
    if (resumeSessionId) {
      if (this._initResult?.agentCapabilities?._meta?.claudeCode) {
        params._meta = { claudeCode: { options: { resume: resumeSessionId } } }
      } else {
        params.resumeSessionId = resumeSessionId
      }
    }

    const response = await this._conn!.newSession(params as unknown as Parameters<ClientSideConnection['newSession']>[0])
    this._cacheSession(response, response.sessionId)
    return response
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[] = [],
  ): Promise<LoadSessionResponse> {
    this._assertConn()
    const response = await this._conn!.loadSession({ sessionId, cwd, mcpServers })
    this._cacheSession(response, sessionId)
    return response
  }

  async prompt(
    prompt: Array<{ type: 'text'; text: string }>,
  ): Promise<PromptResponse> {
    this._assertConn()
    this._assertSession()
    return this._conn!.prompt({
      sessionId: this._session!.sessionId,
      prompt: prompt as unknown as Parameters<ClientSideConnection['prompt']>[0]['prompt'],
    })
  }

  async cancel(): Promise<void> {
    this._assertSession()
    await this._conn!.cancel({ sessionId: this._session!.sessionId })
  }

  async setModel(modelId: string): Promise<void> {
    this._assertSession()
    await this._conn!.unstable_setSessionModel({
      sessionId: this._session!.sessionId,
      modelId,
    })
    // Sync local cache so persisted config picks up the new model
    if (this._session) {
      this._session.models = {
        ...(this._session.models ?? {}),
        currentModelId: modelId,
      }
    }
  }

  async setMode(modeId: string): Promise<void> {
    this._assertSession()
    await this._conn!.setSessionMode({
      sessionId: this._session!.sessionId,
      modeId,
    })
  }

  async setConfigOption(configId: string, value: string | boolean): Promise<void> {
    this._assertSession()
    const strValue = String(value)
    const params: Record<string, unknown> = {
      sessionId: this._session!.sessionId,
      configId,
    }
    if (typeof value === 'boolean') {
      params.type = 'boolean'
      params.value = value
    } else {
      params.value = strValue
    }
    await this._conn!.setSessionConfigOption(
      params as unknown as Parameters<ClientSideConnection['setSessionConfigOption']>[0]
    )
    // Update local cache
    if (this._session?.configOptions) {
      this._session.configOptions = this._session.configOptions.map((o) =>
        o.id === configId ? { ...o, currentValue: strValue, selectedValue: strValue } : o
      )
    }
  }

  async closeSession(): Promise<void> {
    if (!this._session) return
    if (!this._initResult?.agentCapabilities?.sessionCapabilities?.close) return
    try {
      await this._conn!.closeSession({ sessionId: this._session.sessionId })
    } catch {
      // best-effort
    }
  }

  async extMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
    this._assertConn()
    return this._conn!.extMethod(method, params)
  }

  // ─── Session State Cache ─────────────────────────────────────────────────

  /** Update cache from session/update config_option_update notifications */
  onConfigOptionUpdate(raw: NewSessionResponse['configOptions']): void {
    if (raw && this._session) {
      this._session.configOptions = this._normalizeConfigOptions(raw)
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private _cacheSession(
    response: NewSessionResponse | LoadSessionResponse,
    sessionId: string,
  ): void {
    const modesRaw = response.modes as Record<string, unknown> | null | undefined
    this._session = {
      sessionId,
      models: this._normalizeModels(response.models),
      configOptions: this._normalizeConfigOptions(response.configOptions),
      modes: modesRaw
        ? {
            currentModeId: typeof modesRaw.currentModeId === 'string' ? modesRaw.currentModeId : undefined,
            availableModes: Array.isArray(modesRaw.availableModes)
              ? (modesRaw.availableModes as Array<Record<string, unknown>>).map((m) => ({
                  id: String(m.id ?? ''),
                  name: typeof m.name === 'string' ? m.name : undefined,
                }))
              : undefined,
          }
        : null,
    }
  }

  private _normalizeModels(models: NewSessionResponse['models']): CachedModelState | null {
    if (!models) return null
    return {
      currentModelId: models.currentModelId,
      availableModels: (models.availableModels ?? []).map((m) => {
        const raw = m as Record<string, unknown>
        return {
          id: typeof raw.id === 'string' ? raw.id : undefined,
          modelId: typeof raw.modelId === 'string' ? raw.modelId : undefined,
          name: typeof raw.name === 'string' ? raw.name : undefined,
        }
      }),
    }
  }

  private _normalizeConfigOptions(
    raw: NewSessionResponse['configOptions'],
  ): CachedConfigOption[] | null {
    if (!raw || raw.length === 0) return null
    return raw.map((o) => {
      const opt = o as Record<string, unknown>
      const value = typeof opt.value === 'string' ? opt.value : String(opt.value ?? '')
      return {
        id: String(opt.id ?? ''),
        name: String(opt.name ?? ''),
        type: String(opt.type ?? 'select'),
        currentValue: value,
        selectedValue: value,
        category: typeof opt.category === 'string' ? opt.category : undefined,
        description: typeof opt.description === 'string' ? opt.description : undefined,
        options: Array.isArray(opt.options)
          ? (opt.options as Array<Record<string, unknown>>).map((v) => ({
              value: String(v.value ?? ''),
              name: typeof v.name === 'string' ? v.name : undefined,
            }))
          : undefined,
      }
    })
  }

  private _assertConn(): void {
    if (!this._conn) throw new Error('AcpClient not started')
  }

  private _assertSession(): void {
    if (!this._session) throw new Error('No active ACP session')
  }

  private async _destroyProcess(): Promise<void> {
    const child = this._child
    if (!child) return
    this._child = null

    // Phase 1: stdin.end() (graceful signal)
    try { child.stdin?.end() } catch { /* ignore */ }

    // Phase 2: SIGTERM after grace period
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try { child.kill('SIGTERM') } catch { /* ignore */ }
        // Phase 3: SIGKILL after 2x grace period
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* ignore */ }
          resolve()
        }, this._gracePeriodMs)
      }, this._gracePeriodMs)

      child.on('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
    })
  }
}
