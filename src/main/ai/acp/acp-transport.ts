import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import type {
  AcpInitializeResult,
  AcpMessage,
  AcpNotification,
  AcpPermissionRequest,
  AcpRequest,
  AcpResponse,
  AcpSessionConfigOption,
  AcpSessionModels,
  AcpSessionModes,
} from './acp-types'
import { ACP_METHODS, JSONRPC_VERSION } from './acp-types'

const INIT_TIMEOUT_MS = 60_000
const PROMPT_TIMEOUT_MS = 300_000
const REQUEST_TIMEOUT_MS = 60_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout> | undefined
  method: string
  isPaused: boolean
}

function parseInitializeResult(raw: unknown): AcpInitializeResult {
  const r = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    ? (raw as Record<string, unknown>)
    : null

  const caps = (r?.agentCapabilities !== null && typeof r?.agentCapabilities === 'object')
    ? (r.agentCapabilities as Record<string, unknown>)
    : null
  const sc = (caps?.sessionCapabilities !== null && typeof caps?.sessionCapabilities === 'object')
    ? (caps.sessionCapabilities as Record<string, unknown>)
    : null
  const meta = (caps?._meta !== null && typeof caps?._meta === 'object')
    ? (caps._meta as Record<string, unknown>)
    : {}

  const agentInfoRaw = r?.agentInfo
  const agentInfo = (agentInfoRaw !== null && typeof agentInfoRaw === 'object' && !Array.isArray(agentInfoRaw))
    ? (agentInfoRaw as Record<string, unknown>)
    : null

  const authMethodsRaw = r?.authMethods
  const authMethods = Array.isArray(authMethodsRaw)
    ? authMethodsRaw.filter((m) => typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).id === 'string')
    : []

  const modesRaw = r?.modes as Record<string, unknown> | null | undefined
  let modes: AcpInitializeResult['modes'] = null
  if (modesRaw && Array.isArray(modesRaw.availableModes) && modesRaw.availableModes.length > 0) {
    modes = {
      currentModeId: typeof modesRaw.currentModeId === 'string' ? modesRaw.currentModeId : undefined,
      availableModes: (modesRaw.availableModes as unknown[]).flatMap((m) => {
        if (typeof m !== 'object' || m === null) return []
        const mode = m as Record<string, unknown>
        if (typeof mode.id !== 'string') return []
        return [{ id: mode.id, name: typeof mode.name === 'string' ? mode.name : undefined }]
      })
    }
  }

  return {
    protocolVersion: typeof r?.protocolVersion === 'number' ? r.protocolVersion : 0,
    agentInfo: agentInfo
      ? { name: String(agentInfo.name ?? ''), version: String(agentInfo.version ?? '') }
      : null,
    authMethods: authMethods as AcpInitializeResult['authMethods'],
    capabilities: {
      loadSession: caps?.loadSession === true,
      sessionCapabilities: {
        resume: (sc?.resume !== null && typeof sc?.resume === 'object') ? sc.resume as Record<string, unknown> : null,
        close: (sc?.close !== null && typeof sc?.close === 'object') ? sc.close as Record<string, unknown> : null,
        fork: (sc?.fork !== null && typeof sc?.fork === 'object') ? sc.fork as Record<string, unknown> : null,
        list: (sc?.list !== null && typeof sc?.list === 'object') ? sc.list as Record<string, unknown> : null,
      },
      _meta: meta,
    },
    modes,
  }
}

export interface AcpTransportCallbacks {
  onSessionUpdate: (params: Record<string, unknown>) => void
  onPermissionRequest: (params: AcpPermissionRequest) => Promise<string>
  onFileRead: (path: string, sessionId: string) => Promise<string>
  onFileWrite: (path: string, content: string, sessionId: string) => Promise<void>
  onDisconnect: (code: number | null, signal: NodeJS.Signals | null) => void
}

export class AcpTransport extends EventEmitter {
  private child: ChildProcess | null = null
  private buffer = ''
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private isSetupDone = false
  private isDetached = false

  private initResult: AcpInitializeResult | null = null
  private sessionId: string | null = null
  private configOptions: AcpSessionConfigOption[] | null = null
  private models: AcpSessionModels | null = null
  private modes: AcpSessionModes | null = null

  constructor(private readonly callbacks: AcpTransportCallbacks) {
    super()
  }

  // ─── Spawn ───────────────────────────────────────────────────────────────

  async spawn(
    command: string,
    args: string[],
    env: Record<string, string | undefined>,
    cwd: string
  ): Promise<void> {
    const isWindows = process.platform === 'win32'
    const detached = !isWindows

    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: isWindows,
      detached,
    })

    if (detached) child.unref()

    this.child = child
    this.isDetached = detached
    this.isSetupDone = false

    await this.setupHandlers()
    await this.initialize()
    this.isSetupDone = true
  }

  private async setupHandlers(): Promise<void> {
    const child = this.child!
    let stderrBuf = ''
    let spawnErr: Error | null = null

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString()
      if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048)
    })

    child.on('error', (err) => { spawnErr = err })

    child.on('exit', (code, signal) => {
      if (!this.isSetupDone) {
        const err = this.buildStartupError(code, signal, stderrBuf, spawnErr?.message)
        this.clearPending(err.message)
        throw err
      } else {
        this.handleRuntimeExit(code, signal)
      }
    })

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[ACP transport] stdout:', text.slice(0, 200))
      this.buffer += text
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          this.handleMessage(JSON.parse(line) as AcpMessage)
        } catch {
          console.log('[ACP transport] non-JSON line:', line.slice(0, 100))
        }
      }
    })
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      console.log('[ACP transport] stderr:', text.slice(0, 200))
      stderrBuf += text
      if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048)
    })

    // Yield to event loop so spawn errors can fire
    await new Promise((r) => setImmediate(r))

    if (spawnErr) throw spawnErr
    if (child.killed) throw new Error('ACP process exited immediately after spawn')

  }

  // ─── Message handling ────────────────────────────────────────────────────

  private handleMessage(msg: AcpMessage): void {
    if ('method' in msg) {
      this.handleIncoming(msg as AcpNotification | AcpRequest).catch(() => {})
      return
    }

    const resp = msg as AcpResponse
    if ('id' in resp && typeof resp.id === 'number') {
      const p = this.pending.get(resp.id)
      if (!p) return
      this.pending.delete(resp.id)
      clearPendingTimeout(p)
      if ('result' in resp) {
        p.resolve(resp.result)
      } else if ('error' in resp) {
        p.reject(new Error(resp.error?.message ?? 'ACP error'))
      }
    }
  }

  private async handleIncoming(msg: AcpNotification | AcpRequest): Promise<void> {
    let result: unknown = null
    const isRequest = 'id' in msg && typeof (msg as AcpRequest).id === 'number'

    try {
      switch (msg.method) {
        case ACP_METHODS.SESSION_UPDATE: {
          const params = (msg.params ?? {}) as Record<string, unknown>
          // Reset prompt timeouts on streaming activity
          this.resetPromptTimeouts()
          // Cache config_option_update inline
          if ((params.update as Record<string, unknown>)?.sessionUpdate === 'config_option_update') {
            const upd = (params.update as Record<string, unknown>)
            if (Array.isArray(upd.configOptions)) {
              this.configOptions = upd.configOptions as AcpSessionConfigOption[]
            }
          }
          this.callbacks.onSessionUpdate(params)
          break
        }

        case ACP_METHODS.REQUEST_PERMISSION: {
          this.pausePromptTimeouts()
          const params = (msg.params ?? {}) as unknown as AcpPermissionRequest
          try {
            const optionId = await this.callbacks.onPermissionRequest(params)
            if (isRequest) {
              result = { outcome: { outcome: optionId.includes('reject') ? 'rejected' : 'selected', optionId } }
            } else {
              // Notification form — reply via a new request so the agent
              // receives the outcome instead of having it silently dropped.
              this.request(ACP_METHODS.REQUEST_PERMISSION, { sessionId: this.sessionId!, optionId }).catch(() => {})
            }
          } finally {
            this.resumePromptTimeouts()
          }
          break
        }

        case ACP_METHODS.READ_TEXT_FILE: {
          const p = (msg.params ?? {}) as { path: string; sessionId?: string }
          const content = await this.callbacks.onFileRead(p.path, p.sessionId ?? '')
          result = { content }
          break
        }

        case ACP_METHODS.WRITE_TEXT_FILE: {
          const p = (msg.params ?? {}) as { path: string; content: string; sessionId?: string }
          await this.callbacks.onFileWrite(p.path, p.content, p.sessionId ?? '')
          result = null
          break
        }
      }
    } catch (err) {
      if (isRequest) {
        this.write({ jsonrpc: JSONRPC_VERSION, id: (msg as AcpRequest).id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } })
        return
      }
    }

    if (isRequest) {
      this.write({ jsonrpc: JSONRPC_VERSION, id: (msg as AcpRequest).id, result })
    }
  }

  // ─── Protocol requests ───────────────────────────────────────────────────

  private request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++
    const timeoutMs = method === 'session/prompt' ? PROMPT_TIMEOUT_MS : REQUEST_TIMEOUT_MS

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: (v) => { clearPendingTimeout(pending); resolve(v as T) },
        reject: (e) => { clearPendingTimeout(pending); reject(e) },
        method,
        isPaused: false,
        timeoutId: setTimeout(() => {
          this.pending.delete(id)
          if (method === 'session/prompt') this.cancelPrompt()
          reject(new Error(`ACP ${method} timed out after ${timeoutMs / 1000}s`))
        }, timeoutMs),
      }
      this.pending.set(id, pending)
      this.write({ jsonrpc: JSONRPC_VERSION, id, method, ...(params ? { params } : {}) })
    })
  }

  private write(msg: AcpRequest | AcpResponse | AcpNotification): void {
    if (this.child?.stdin?.writable) {
      const raw = JSON.stringify(msg)
      console.log('[ACP transport] write:', raw.slice(0, 150))
      this.child.stdin.write(raw + '\n')
    } else {
      console.log('[ACP transport] write FAILED: stdin not writable')
    }
  }

  // ─── Initialize ──────────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    const result = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    })
    this.initResult = parseInitializeResult(result)
    // Seed modes advertised in initialize (qwen-code pattern)
    const raw = result as Record<string, unknown>
    const modesRaw = raw?.modes as Record<string, unknown> | undefined
    if (modesRaw?.availableModes && Array.isArray(modesRaw.availableModes) && modesRaw.availableModes.length > 0) {
      this.modes = modesRaw as AcpSessionModes
    }
    this.emit('initialized')
  }

  // ─── Session lifecycle ────────────────────────────────────────────────────

  async newSession(cwd: string, resumeSessionId?: string): Promise<string> {
    // Prefer session/load when the agent supports it and we have a session to resume
    if (resumeSessionId && this.initResult?.capabilities.loadSession) {
      try {
        const response = await this.request<Record<string, unknown>>('session/load', {
          sessionId: resumeSessionId,
          cwd: this.normalizeCwd(cwd),
          mcpServers: [],
        })
        this.sessionId = typeof response.sessionId === 'string' ? response.sessionId : null
        this.parseSessionCapabilities(response)
        return this.sessionId ?? ''
      } catch {
        // Fall through to session/new with resumeSessionId
      }
    }

    const caps = this.initResult?.capabilities
    const isClaudeMeta = !!(caps?._meta?.claudeCode)
    const metaResume = isClaudeMeta && resumeSessionId
      ? { _meta: { claudeCode: { options: { resume: resumeSessionId } } } }
      : {}
    const genericResume = (!isClaudeMeta && resumeSessionId)
      ? { resumeSessionId }
      : {}

    const response = await this.request<Record<string, unknown>>('session/new', {
      cwd: this.normalizeCwd(cwd),
      mcpServers: [],
      ...metaResume,
      ...genericResume,
    })

    this.sessionId = typeof response.sessionId === 'string' ? response.sessionId : null
    this.parseSessionCapabilities(response)
    return this.sessionId ?? ''
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.sessionId) throw new Error('No active ACP session')
    await this.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    })
  }

  cancelPrompt(): void {
    if (!this.sessionId) return
    this.write({ jsonrpc: JSONRPC_VERSION, method: 'session/cancel', params: { sessionId: this.sessionId } })
    for (const [id, p] of Array.from(this.pending)) {
      if (p.method === 'session/prompt') {
        clearPendingTimeout(p)
        this.pending.delete(id)
        p.resolve(null)
      }
    }
  }

  async respondPermissionByOptionId(optionId: string): Promise<void> {
    if (!this.sessionId) return
    await this.request(ACP_METHODS.REQUEST_PERMISSION, { sessionId: this.sessionId, optionId })
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId) return
    await this.request('session/set_model', { sessionId: this.sessionId, modelId })
    if (this.models) this.models = { ...this.models, currentModelId: modelId }
    if (this.configOptions) {
      this.configOptions = this.configOptions.map((o) =>
        o.category === 'model' ? { ...o, currentValue: modelId, selectedValue: modelId } : o
      )
    }
  }

  async setConfigOption(optionId: string, value: string): Promise<void> {
    if (!this.sessionId) return
    await this.request('session/set_config_option', { sessionId: this.sessionId, optionId, value })
    if (this.configOptions) {
      this.configOptions = this.configOptions.map((o) =>
        o.id === optionId ? { ...o, currentValue: value, selectedValue: value } : o
      )
    }
  }

  async closeSession(): Promise<void> {
    if (!this.sessionId || !this.child || this.child.killed) return
    if (!this.initResult?.capabilities.sessionCapabilities.close) return
    try {
      await Promise.race([
        this.request('session/close', { sessionId: this.sessionId }),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('session/close timeout')), 2000)),
      ])
    } catch {
      // best-effort
    }
  }

  async destroy(): Promise<void> {
    this.isSetupDone = false
    await this.closeSession()
    this.killChild()
    this.clearPending()
    this.resetState()
  }

  // ─── Timeout management ───────────────────────────────────────────────────

  private pausePromptTimeouts(): void {
    for (const p of Array.from(this.pending.values())) {
      if (p.method === 'session/prompt' && !p.isPaused && p.timeoutId) {
        clearTimeout(p.timeoutId)
        p.timeoutId = undefined
        p.isPaused = true
      }
    }
  }

  private resumePromptTimeouts(): void {
    for (const [, p] of Array.from(this.pending)) {
      if (p.method === 'session/prompt' && p.isPaused) {
        p.isPaused = false
        p.timeoutId = setTimeout(() => {
          this.cancelPrompt()
          p.reject(new Error(`ACP session/prompt timed out after ${PROMPT_TIMEOUT_MS / 1000}s`))
        }, PROMPT_TIMEOUT_MS)
      }
    }
  }

  private resetPromptTimeouts(): void {
    for (const [, p] of Array.from(this.pending)) {
      if (p.method === 'session/prompt' && !p.isPaused && p.timeoutId) {
        clearTimeout(p.timeoutId)
        p.timeoutId = setTimeout(() => {
          this.cancelPrompt()
          p.reject(new Error(`ACP session/prompt timed out after ${PROMPT_TIMEOUT_MS / 1000}s`))
        }, PROMPT_TIMEOUT_MS)
      }
    }
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  get currentSessionId(): string | null { return this.sessionId }
  get initializeResult(): AcpInitializeResult | null { return this.initResult }
  get currentModels(): AcpSessionModels | null { return this.models }
  get currentModes(): AcpSessionModes | null { return this.modes }
  get currentConfigOptions(): AcpSessionConfigOption[] | null { return this.configOptions }
  get isConnected(): boolean { return this.child !== null && !this.child.killed }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private parseSessionCapabilities(response: Record<string, unknown>): void {
    if (Array.isArray(response.configOptions)) {
      this.configOptions = response.configOptions as AcpSessionConfigOption[]
    }
    const modesRaw = response.modes as AcpSessionModes | undefined
    if (modesRaw?.availableModes && modesRaw.availableModes.length > 0) {
      this.modes = modesRaw
    }
    const modelsRaw = response.models ?? (response._meta as Record<string, unknown> | undefined)?.models
    if (modelsRaw && typeof modelsRaw === 'object') {
      this.models = modelsRaw as AcpSessionModels
    }
  }

  private normalizeCwd(cwd: string): string {
    // Backends like copilot and codex require absolute paths
    return cwd || '.'
  }

  private buildStartupError(
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string,
    spawnMsg?: string
  ): Error {
    if (/not recognized|not found|No such file|command not found|ENOENT/i.test(stderr + (spawnMsg ?? ''))) {
      return new Error(`ACP CLI not found. Please install it or update the path in Settings.\n${stderr}`)
    }
    if (code === 0) {
      return new Error('ACP process exited during startup (code 0). The installed CLI version may not support ACP mode.')
    }
    return new Error(`ACP process exited during startup (code: ${code}, signal: ${signal})${stderr ? '\n' + stderr : ''}`)
  }

  private handleRuntimeExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearPending(`ACP process exited unexpectedly (code: ${code}, signal: ${signal})`)
    this.resetState()
    this.child = null
    this.callbacks.onDisconnect(code, signal)
  }

  private killChild(): void {
    if (!this.child) return
    try {
      if (this.isDetached && process.platform !== 'win32') {
        process.kill(-this.child.pid!, 'SIGTERM')
      } else {
        this.child.kill('SIGTERM')
      }
    } catch {
      // process may already be gone
    }
    this.child = null
    this.isDetached = false
  }

  private clearPending(errorMsg?: string): void {
    for (const p of Array.from(this.pending.values())) {
      clearPendingTimeout(p)
      p.reject(new Error(errorMsg ?? 'ACP transport destroyed'))
    }
    this.pending.clear()
  }

  private resetState(): void {
    this.sessionId = null
    this.initResult = null
    this.configOptions = null
    this.models = null
    this.modes = null
  }
}

function clearPendingTimeout(p: PendingRequest): void {
  if (p.timeoutId) {
    clearTimeout(p.timeoutId)
    p.timeoutId = undefined
  }
}
