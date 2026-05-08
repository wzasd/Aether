import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { resolve as resolvePath, isAbsolute, join } from 'path'
import { EventEmitter } from 'events'
import type { CLIProvider, ConfigOption, ModelInfo, ProviderConfig, ProviderMeta, Session, SessionConfig } from '../provider'
import type { AIEvent } from '../types'
import type { AcpPermissionRequest } from './acp-types'
import type { AcpBackendConfig } from './acp-backends'
import { AcpTransport } from './acp-transport'
import { AcpClient } from './acp-client'
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk'
import {
  acpSessionUpdateToEvents,
  makeCompleteEvent,
  makeDoneEvent,
  makeErrorEvent,
  makePermissionRequestEvent,
} from './acp-event-mapper'
import { Secrets } from '../../core/secrets'

// ─── Environment-based feature flag ──────────────────────────────────────────

// SDK is the default. Set BYTRO_ACP_SDK=0 to fall back to the legacy AcpTransport.
const USE_SDK = process.env.BYTRO_ACP_SDK !== '0'

// ─── Session state ───────────────────────────────────────────────────────────

interface SessionEntry {
  session: Session
  transport: AcpTransport
  client?: AcpClient       // only set when USE_SDK is active
  fullText: string
  doneEmitted: boolean
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFallbackMeta(cfg: AcpBackendConfig): ProviderMeta {
  return {
    id: cfg.id,
    name: cfg.name,
    binary: cfg.cliCommand ?? cfg.npxPackage ?? cfg.id,
    vendor: cfg.vendor,
    models: cfg.fallbackModels?.length
      ? (cfg.fallbackModels as ModelInfo[])
      : [{ id: cfg.id, name: cfg.name, contextWindow: 200_000 }],
    permissionFlags: { manual: [], autoEdit: [], plan: [], fullAuto: [] },
    supportsStreamJson: false,
    supportsInteractive: false,
  }
}

function resolveSpawnCommand(cfg: AcpBackendConfig, providerConfig: ProviderConfig | null): { command: string; args: string[] } {
  const binaryOverride = providerConfig?.binaryPath?.trim()

  if (cfg.strategy === 'npx') {
    const localBin = resolveLocalPackageBin(cfg)
    if (localBin && !binaryOverride) {
      return { command: 'node', args: [localBin, ...(cfg.acpArgs ?? [])] }
    }
    const command = binaryOverride || 'npx'
    const pkg = selectNpxPackage(cfg)
    return { command, args: ['--yes', pkg, ...(cfg.acpArgs ?? [])] }
  }

  const defaultCmd = cfg.cliCommand ?? cfg.id
  const parts = (binaryOverride ?? defaultCmd).split(/\s+/)
  return { command: parts[0], args: [...parts.slice(1), ...(cfg.acpArgs ?? ['--experimental-acp'])] }
}

function resolveLocalPackageBin(cfg: AcpBackendConfig): string | null {
  try {
    const rawPkg = cfg.npxPackage ?? ''
    const parts = rawPkg.split('@')
    const pkgName = rawPkg.startsWith('@')
      ? parts.slice(0, 2).join('@')
      : parts[0]
    const appRoot = join(__dirname, '..', '..')
    const resolvePaths = [appRoot, join(appRoot, 'node_modules')]
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`, { paths: resolvePaths })
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>
    const bin = pkgJson?.bin
    const binPath = typeof bin === 'string' ? bin : (typeof bin === 'object' && bin !== null ? Object.values(bin as Record<string, string>)[0] : null)
    if (!binPath) return null
    return join(pkgJsonPath, '..', binPath)
  } catch {
    return null
  }
}

function selectNpxPackage(cfg: AcpBackendConfig): string {
  if (!cfg.npxPlatformPackages) return cfg.npxPackage ?? cfg.id
  const platMap = cfg.npxPlatformPackages[process.platform as NodeJS.Platform]
  if (platMap) {
    const archPkg = platMap[process.arch]
    if (archPkg) return archPkg
  }
  return cfg.npxPackage ?? cfg.id
}

function mergeSettingsJsonEnv(env: Record<string, string | undefined>, relativePath: string): void {
  try {
    const settingsPath = join(homedir(), relativePath)
    if (!existsSync(settingsPath)) return
    const raw = readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw) as Record<string, unknown>
    const settingsEnv = settings?.env
    if (settingsEnv && typeof settingsEnv === 'object' && !Array.isArray(settingsEnv)) {
      for (const [key, value] of Object.entries(settingsEnv)) {
        if (!(key in env) && typeof value === 'string') {
          env[key] = value
        }
      }
    }
  } catch { /* best-effort */ }
}

function buildEnv(cfg: AcpBackendConfig, providerConfig: ProviderConfig | null): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  if (cfg.settingsJsonPath) mergeSettingsJsonEnv(env, cfg.settingsJsonPath)

  if (cfg.authEnvKey) {
    const secret = (cfg.secretsKey ? Secrets.get(cfg.secretsKey) : undefined) ?? Secrets.get(cfg.id)
    if (secret) env[cfg.authEnvKey] = secret
  }

  delete env.NODE_OPTIONS
  delete env.CLAUDECODE

  if (providerConfig?.extraEnv) {
    Object.assign(env, providerConfig.extraEnv)
  }

  return env
}

function resolvePathInWorkspace(filePath: string, workingDir: string | undefined): string {
  const root = resolvePath(workingDir ?? process.cwd())
  const resolved = isAbsolute(filePath) ? filePath : resolvePath(root, filePath)
  const normalized = resolvePath(resolved)
  if (!normalized.startsWith(root + '/') && normalized !== root) {
    throw new Error(`Path outside workspace: ${filePath}`)
  }
  return normalized
}

// ─── ACPProvider ─────────────────────────────────────────────────────────────

export class ACPProvider extends EventEmitter implements CLIProvider {
  meta: ProviderMeta
  private providerConfig: ProviderConfig | null = null
  private sessions = new Map<string, SessionEntry>()
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private persistedConfig = new Map<string, Map<string, string>>()

  constructor(private readonly backendConfig: AcpBackendConfig) {
    super()
    this.meta = buildFallbackMeta(backendConfig)
  }

  // ─── CLIProvider: detect ─────────────────────────────────────────────────

  async detect(): Promise<string | null> {
    if (this.backendConfig.strategy === 'npx') {
      return new Promise((resolve) => {
        execFile('npx', ['--version'], { timeout: 5000 }, (err, stdout) => {
          resolve(err ? null : (stdout.trim() || 'npx available'))
        })
      })
    }

    const cmd = this.backendConfig.cliCommand
    if (!cmd) return null

    return new Promise((resolve) => {
      execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? null : (stdout.trim() || 'installed'))
      })
    })
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.providerConfig = config
  }

  // ─── CLIProvider: session lifecycle ──────────────────────────────────────

  async startSession(config: SessionConfig): Promise<Session> {
    if (USE_SDK) return this._startSessionWithSdk(config)
    return this._startSessionWithTransport(config)
  }

  async endSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    this.clearIdleTimer(sessionId)
    if (entry.client) {
      await entry.client.close()
    } else {
      await entry.transport.destroy()
    }
    this.sessions.delete(sessionId)
  }

  // ─── CLIProvider: messaging ───────────────────────────────────────────────

  sendMessage(sessionId: string, content: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    entry.doneEmitted = false
    entry.fullText = ''
    entry.session.status = 'running'
    this.resetIdleTimer(entry)

    if (entry.client) {
      this._sendWithClient(entry, content)
    } else {
      this._sendWithTransport(entry, content)
    }
  }

  respondPermission(sessionId: string, approved: boolean): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.session.status = 'running'
    this.resetIdleTimer(entry)
    this.emit(`permission:${sessionId}`, approved)
  }

  respondQuestion(sessionId: string, answer: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.session.status = 'running'
    this.resetIdleTimer(entry)
    this.emit(`question:${sessionId}`, answer)
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    if (entry.client) {
      entry.client.cancel().catch(() => {})
    } else {
      entry.transport.cancelPrompt()
    }
    entry.session.status = 'idle'
  }

  onEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.on(`event:${sessionId}`, handler)
  }

  offEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.off(`event:${sessionId}`, handler)
  }

  // ─── CLIProvider: model discovery & switching ────────────────────────────

  getAvailableModels(sessionId: string): ModelInfo[] {
    const entry = this.sessions.get(sessionId)
    if (!entry) return this.meta.models

    if (entry.client) {
      const models = entry.client.currentModels
      if (!models?.availableModels?.length) return this.meta.models
      return models.availableModels
        .filter((m) => m.id || m.modelId)
        .map((m) => ({
          id: (m.id || m.modelId)!,
          name: m.name ?? (m.id || m.modelId)!,
          contextWindow: 200_000,
        }))
    }

    const models = entry.transport.currentModels
    if (!models?.availableModels?.length) return this.meta.models
    return models.availableModels.map((m) => ({
      id: m.id ?? m.modelId ?? 'unknown',
      name: m.name ?? m.id ?? m.modelId ?? 'unknown',
      contextWindow: 200_000,
    })).filter((m) => m.id !== 'unknown')
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    if (entry.client) {
      await entry.client.setModel(modelId)
    } else {
      await entry.transport.setModel(modelId)
    }
    this.resetIdleTimer(entry)
    this.persistConfigForEntry(entry)
  }

  getConfigOptions(sessionId: string): ConfigOption[] | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null
    if (entry.client) {
      return entry.client.currentConfigOptions as ConfigOption[] | null
    }
    return entry.transport.currentConfigOptions as ConfigOption[] | null
  }

  async setConfigOption(sessionId: string, optionId: string, value: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    if (entry.client) {
      await entry.client.setConfigOption(optionId, value)
    } else {
      await entry.transport.setConfigOption(optionId, value)
    }
    this.resetIdleTimer(entry)
    this.persistConfigForEntry(entry)
  }

  // ─── SDK path: session create ────────────────────────────────────────────

  private async _startSessionWithSdk(config: SessionConfig): Promise<Session> {
    const sessionId = config.sessionId ?? randomUUID()
    const sessionConfig = { ...config, sessionId }

    const existing = this.sessions.get(sessionId)
    if (existing?.client?.isRunning) return existing.session

    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now(),
    }

    const env = buildEnv(this.backendConfig, this.providerConfig)
    const cwd = config.workingDir || process.cwd()

    let client = this._createClient(sessionId, session)
    try {
      const { command, args } = resolveSpawnCommand(this.backendConfig, this.providerConfig)
      console.log(`[ACP:SDK ${this.backendConfig.id}] spawning: ${command} ${args.join(' ')}`)
      await client.start(command, args, env, cwd)
      const response = await client.newSession(cwd, [], config.sessionId)
      if (!sessionConfig.sessionId) sessionConfig.sessionId = response.sessionId
    } catch (err) {
      await client.close().catch(() => {})
      throw err
    }

    this._updateMetaFromClient(client)

    // Re-apply persisted config
    const configKey = `${this.backendConfig.id}::${cwd}`
    const savedConfig = this.persistedConfig.get(configKey)
    if (savedConfig && savedConfig.size > 0) {
      savedConfig.forEach((value, optionId) => {
        if (optionId === '_model') {
          client.setModel(value).catch(() => {})
        } else {
          client.setConfigOption(optionId, value).catch(() => {})
        }
      })
    }

    // Save current config for next session
    this._saveClientConfig(client, configKey)

    const entry: SessionEntry = {
      session,
      transport: null as unknown as AcpTransport, // unused in SDK path
      client,
      fullText: '',
      doneEmitted: false,
    }
    this.sessions.set(sessionId, entry)
    this.resetIdleTimer(entry)

    return session
  }

  // ─── Transport path: session create (existing code, renamed) ─────────────

  private async _startSessionWithTransport(config: SessionConfig): Promise<Session> {
    const sessionId = config.sessionId ?? randomUUID()
    const sessionConfig = { ...config, sessionId }

    const existing = this.sessions.get(sessionId)
    if (existing?.transport.isConnected) return existing.session

    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now(),
    }

    const env = buildEnv(this.backendConfig, this.providerConfig)
    const envKeys = Object.keys(env).filter(k => k.startsWith('ANTHROPIC_') || k.startsWith('OPENAI_') || k.startsWith('CLAUDE_'))
    console.log(`[ACP ${this.backendConfig.id}] env keys:`, envKeys)
    const cwd = config.workingDir || process.cwd()

    let transport = this._createTransport(sessionId, session)
    try {
      const { command, args } = resolveSpawnCommand(this.backendConfig, this.providerConfig)
      console.log(`[ACP ${this.backendConfig.id}] spawning: ${command} ${args.join(' ')}`)
      await transport.spawn(command, args, env, cwd)
    } catch (err) {
      console.error(`[ACP ${this.backendConfig.id}] Phase 1 failed:`, err instanceof Error ? err.message : err)
      await transport.destroy().catch(() => {})
      if (this.backendConfig.strategy === 'npx') {
        transport = this._createTransport(sessionId, session)
        const { command, args } = resolveSpawnCommand(this.backendConfig, this.providerConfig)
        console.log(`[ACP ${this.backendConfig.id}] Phase 2 retry: ${command} ${args.join(' ')}`)
        await transport.spawn(command, args, env, cwd)
      } else {
        throw err
      }
    }

    const acpSessionId = await transport.newSession(cwd, config.sessionId)
    if (!sessionConfig.sessionId) sessionConfig.sessionId = acpSessionId

    this._updateMetaFromTransport(transport)

    const configKey = `${this.backendConfig.id}::${cwd}`
    const savedConfig = this.persistedConfig.get(configKey)
    if (savedConfig && savedConfig.size > 0) {
      savedConfig.forEach((value, optionId) => {
        transport.setConfigOption(optionId, value).catch(() => {})
      })
    }

    const currentOptions = transport.currentConfigOptions
    if (currentOptions && currentOptions.length > 0) {
      const cfgMap = this.persistedConfig.get(configKey) ?? new Map<string, string>()
      for (const opt of currentOptions) {
        const val = opt.selectedValue ?? opt.currentValue
        if (val !== undefined) cfgMap.set(opt.id, val)
      }
      this.persistedConfig.set(configKey, cfgMap)
    }

    const entry: SessionEntry = { session, transport, fullText: '', doneEmitted: false }
    this.sessions.set(sessionId, entry)
    this.resetIdleTimer(entry)

    return session
  }

  // ─── Messaging helpers ───────────────────────────────────────────────────

  private _sendWithClient(entry: SessionEntry, content: string): void {
    const sessionId = entry.session.id
    const client = entry.client!

    client.prompt([{ type: 'text', text: content }]).then(() => {
      if (!entry.doneEmitted) {
        this.emitEvent(sessionId, entry, makeCompleteEvent(sessionId, entry.fullText))
        this.emitEvent(sessionId, entry, makeDoneEvent(sessionId))
      }
    }).catch((err: unknown) => {
      if (!entry.doneEmitted) {
        this.emitEvent(sessionId, entry, makeErrorEvent(err instanceof Error ? err.message : String(err)))
        this.emitEvent(sessionId, entry, makeDoneEvent(sessionId))
      }
    })
  }

  private _sendWithTransport(entry: SessionEntry, content: string): void {
    const sessionId = entry.session.id

    entry.transport.sendPrompt(content).then(() => {
      if (!entry.doneEmitted) {
        this.emitEvent(sessionId, entry, makeCompleteEvent(sessionId, entry.fullText))
        this.emitEvent(sessionId, entry, makeDoneEvent(sessionId))
      }
    }).catch((err: unknown) => {
      if (!entry.doneEmitted) {
        this.emitEvent(sessionId, entry, makeErrorEvent(err instanceof Error ? err.message : String(err)))
        this.emitEvent(sessionId, entry, makeDoneEvent(sessionId))
      }
    })
  }

  // ─── Client factory (SDK path) ───────────────────────────────────────────

  private _createClient(sessionId: string, session: Session): AcpClient {
    const self = this

    return new AcpClient({
      onSessionUpdate: (params: SessionNotification) => {
        const entry = self.sessions.get(sessionId)
        if (!entry) return

        self.resetIdleTimer(entry)

        const raw = params as unknown as Record<string, unknown>
        const update = raw.update as Record<string, unknown> | undefined
        if (update?.sessionUpdate === 'agent_message_chunk') {
          const content = update.content as Record<string, unknown> | undefined
          if (content?.type === 'text' && typeof content.text === 'string') {
            entry.fullText += content.text
          }
        }

        // Sync config option updates into client cache
        if (update?.sessionUpdate === 'config_option_update') {
          const configOptions = (update as Record<string, unknown>).configOptions
          entry.client?.onConfigOptionUpdate(configOptions as never)
        }

        const events = acpSessionUpdateToEvents(raw, sessionId)
        for (const event of events) {
          self.emitEvent(sessionId, entry, event)
        }
      },

      onRequestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        const entry = self.sessions.get(sessionId)
        if (!entry) return { outcome: { outcome: 'cancelled' } } as RequestPermissionResponse

        const permReq = params as unknown as AcpPermissionRequest
        const aiEvent = makePermissionRequestEvent(params as unknown as Record<string, unknown>, sessionId)
        self.emitEvent(sessionId, entry, aiEvent)

        return new Promise((resolve) => {
          self.once(`permission:${sessionId}`, (approved: boolean) => {
            const options = permReq.options ?? []
            const chosen = approved
              ? options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
              : options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always')
            const optionId = chosen?.optionId ?? (approved ? 'allow_once' : 'reject_once')
            resolve({
              outcome: {
                outcome: optionId.includes('reject') ? 'rejected' : 'selected',
                optionId,
              },
            } as RequestPermissionResponse)
          })
        })
      },

      onReadTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        const { promises: fs } = await import('fs')
        const resolved = resolvePathInWorkspace(params.path, session.config.workingDir)
        const content = await fs.readFile(resolved, 'utf-8')
        return { content } as ReadTextFileResponse
      },

      onWriteTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        const { promises: fs } = await import('fs')
        const resolved = resolvePathInWorkspace(params.path, session.config.workingDir)
        await fs.writeFile(resolved, params.content, 'utf-8')
        return {} as WriteTextFileResponse
      },
    })
  }

  // ─── Transport factory (legacy path) ─────────────────────────────────────

  private _createTransport(sessionId: string, session: Session): AcpTransport {
    const self = this

    return new AcpTransport({
      onSessionUpdate: (params) => {
        const entry = self.sessions.get(sessionId)
        if (!entry) return
        self.resetIdleTimer(entry)

        const update = params.update as Record<string, unknown> | undefined
        if (update?.sessionUpdate === 'agent_message_chunk') {
          const content = update.content as Record<string, unknown> | undefined
          if (content?.type === 'text' && typeof content.text === 'string') {
            entry.fullText += content.text
          }
        }

        const events = acpSessionUpdateToEvents(params, sessionId)
        for (const event of events) {
          self.emitEvent(sessionId, entry, event)
        }
      },

      onPermissionRequest: (permReq: AcpPermissionRequest) => {
        const entry = self.sessions.get(sessionId)
        if (!entry) return Promise.resolve('reject_once')

        const aiEvent = makePermissionRequestEvent(permReq as unknown as Record<string, unknown>, sessionId)
        self.emitEvent(sessionId, entry, aiEvent)

        return new Promise<string>((resolve) => {
          self.once(`permission:${sessionId}`, (approved: boolean) => {
            const options = permReq.options ?? []
            const chosen = approved
              ? options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
              : options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always')
            resolve(chosen?.optionId ?? (approved ? 'allow_once' : 'reject_once'))
          })
        })
      },

      onFileRead: async (filePath: string, _sid: string) => {
        const { promises: fs } = await import('fs')
        const resolved = resolvePathInWorkspace(filePath, session.config.workingDir)
        return fs.readFile(resolved, 'utf-8')
      },

      onFileWrite: async (filePath: string, content: string, _sid: string) => {
        const { promises: fs } = await import('fs')
        const resolved = resolvePathInWorkspace(filePath, session.config.workingDir)
        await fs.writeFile(resolved, content, 'utf-8')
      },

      onDisconnect: (_code, _signal) => {
        const entry = self.sessions.get(sessionId)
        if (!entry) return
        self.clearIdleTimer(sessionId)
        if (!entry.doneEmitted) {
          self.emitEvent(sessionId, entry, makeErrorEvent('ACP process disconnected unexpectedly'))
          self.emitEvent(sessionId, entry, makeDoneEvent(sessionId))
        }
        self.sessions.delete(sessionId)
      },
    })
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  private emitEvent(sessionId: string, entry: SessionEntry, event: AIEvent): void {
    if (event.type === 'permission_request') {
      entry.session.status = 'waiting_permission'
    } else if (event.type === 'ask_user_question') {
      entry.session.status = 'waiting_question'
    } else if (event.type === 'done') {
      entry.session.status = 'idle'
      entry.doneEmitted = true
    } else if (event.type === 'error') {
      entry.session.status = 'error'
    } else if (event.type === 'text_delta' || event.type === 'tool_start' || event.type === 'tool_result') {
      entry.session.status = 'running'
    }
    this.emit(`event:${sessionId}`, event)
  }

  // ─── Meta / models ───────────────────────────────────────────────────────

  private _updateMetaFromClient(client: AcpClient): void {
    const models = client.currentModels
    if (!models?.availableModels?.length) return
    const discovered: ModelInfo[] = models.availableModels
      .filter((m) => m.id || m.modelId)
      .map((m) => ({
        id: (m.id || m.modelId)!,
        name: m.name ?? (m.id || m.modelId)!,
        contextWindow: 200_000,
      }))
    if (discovered.length > 0) {
      this.meta = { ...this.meta, models: discovered }
    }
  }

  private _updateMetaFromTransport(transport: AcpTransport): void {
    const models = transport.currentModels
    if (!models?.availableModels?.length) return

    const discovered: ModelInfo[] = models.availableModels.map((m) => ({
      id: m.id ?? m.modelId ?? 'unknown',
      name: m.name ?? m.id ?? m.modelId ?? 'unknown',
      contextWindow: 200_000,
    })).filter((m) => m.id !== 'unknown')

    if (discovered.length > 0) {
      this.meta = { ...this.meta, models: discovered }
    }
  }

  // ─── Idle timeout ────────────────────────────────────────────────────────

  private resetIdleTimer(entry: SessionEntry): void {
    this.clearIdleTimer(entry.session.id)
    const timer = setTimeout(() => {
      this.endSession(entry.session.id).catch(() => {})
    }, IDLE_TIMEOUT_MS)
    this.idleTimers.set(entry.session.id, timer)
  }

  private clearIdleTimer(sessionId: string): void {
    const existing = this.idleTimers.get(sessionId)
    if (existing) {
      clearTimeout(existing)
      this.idleTimers.delete(sessionId)
    }
  }

  // ─── Config persistence ──────────────────────────────────────────────────

  private _saveClientConfig(client: AcpClient, configKey: string): void {
    const cfgMap = this.persistedConfig.get(configKey) ?? new Map<string, string>()
    const options = client.currentConfigOptions
    if (options) {
      for (const opt of options) {
        const val = opt.selectedValue ?? opt.currentValue
        if (val !== undefined) cfgMap.set(opt.id, val)
      }
    }
    const models = client.currentModels
    if (models?.currentModelId) {
      cfgMap.set('_model', models.currentModelId)
    }
    this.persistedConfig.set(configKey, cfgMap)
  }

  private persistConfigForEntry(entry: SessionEntry): void {
    const cwd = entry.session.config.workingDir ?? process.cwd()
    const configKey = `${this.backendConfig.id}::${cwd}`
    if (entry.client) {
      this._saveClientConfig(entry.client, configKey)
      return
    }
    const cfgMap = this.persistedConfig.get(configKey) ?? new Map<string, string>()
    const options = entry.transport.currentConfigOptions
    if (options) {
      for (const opt of options) {
        const val = opt.selectedValue ?? opt.currentValue
        if (val !== undefined) cfgMap.set(opt.id, val)
      }
    }
    const models = entry.transport.currentModels
    if (models?.currentModelId) {
      cfgMap.set('_model', models.currentModelId)
    }
    this.persistedConfig.set(configKey, cfgMap)
  }
}
