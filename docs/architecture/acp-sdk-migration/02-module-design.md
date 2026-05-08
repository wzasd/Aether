# ACP SDK 迁移 — 模块设计

> **版本**: v1.0 | **日期**: 2026-05-06 | **依赖文档**: [01-architecture-design.md](01-architecture-design.md)

---

## 1. 模块总览

```
src/main/ai/acp/
├── acp-client.ts          ← 新建：SDK 薄包装
├── acp-types.ts           ← 简化：移除 wire 类型
├── acp-provider.ts        ← 重构：内部替换 AcpTransport → AcpClient
├── acp-event-mapper.ts    ← 微调：适配 SDK 类型
├── acp-backends.ts        ← 微调：添加 SDK 兼容字段
├── acp-transport.ts       ← Phase 0-3 保留 legacy；后续 Phase 4 删除
└── __tests__/
    ├── acp-client.test.ts       ← 新建
    └── acp-event-mapper.test.ts ← 保持
```

---

## 2. acp-client.ts（新建）

### 2.1 职责

将 SDK `ClientSideConnection` + 子进程管理封装为一个 `AcpClient` 类。

**单一所有者**：进程管理 + 协议通信 + 断线检测，三位一体。

### 2.2 接口

```typescript
import type {
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionResponse,
  PromptResponse,
  SetSessionConfigOptionResponse,
  McpServer,
} from '@agentclientprotocol/sdk'

// ─── 断线信息 ──────────────────────────────────────────────

export interface DisconnectInfo {
  reason: 'process_exit' | 'process_close' | 'connection_close'
  exitCode: number | null
  signal: string | null
  stderr: string
}

// ─── 协议回调 ──────────────────────────────────────────────

export interface AcpClientCallbacks {
  /** ACP session/update 流式通知 */
  onSessionUpdate: (params: Record<string, unknown>) => void
  /** ACP session/request_permission */
  onRequestPermission: (params: Record<string, unknown>) => Promise<
    | { outcome: { outcome: 'selected'; optionId: string } }
    | { outcome: { outcome: 'cancelled' } }
  >
  /** 文件读取回调 */
  onReadTextFile: (path: string, sessionId?: string) => Promise<string>
  /** 文件写入回调 */
  onWriteTextFile: (path: string, content: string, sessionId?: string) => Promise<void>
}

export interface AcpClientOptions {
  /** 启动超时 ms (默认 60000) */
  startupTimeoutMs?: number
  /** 优雅关闭等待 ms (默认 2000) */
  gracePeriodMs?: number
}

export class AcpClient {
  constructor(
    callbacks: AcpClientCallbacks,
    options?: AcpClientOptions
  )

  // ─── 生命周期 ──────────────────────────────────────────

  /** spawn + SDK initialize，返回 initialize 结果 */
  async start(
    command: string,
    args: string[],
    env: Record<string, string | undefined>,
    cwd: string
  ): Promise<InitializeResponse>

  /** 优雅关闭: closeSession → stdin.end → SIGTERM → SIGKILL */
  async close(): Promise<void>

  /** 子进程是否在运行 */
  get isRunning(): boolean

  /** 注册断线回调（单 handler，last-write-wins） */
  onDisconnect(handler: (info: DisconnectInfo) => void): void

  // ─── 协议方法 ──────────────────────────────────────────

  async newSession(
    cwd: string,
    mcpServers?: McpServer[],
    resumeSessionId?: string,
  ): Promise<NewSessionResponse>

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers?: McpServer[],
  ): Promise<LoadSessionResponse>

  async prompt(
    sessionId: string,
    content: Array<{ type: 'text'; text: string }>
  ): Promise<PromptResponse>

  async cancel(sessionId: string): Promise<void>

  async setModel(sessionId: string, modelId: string): Promise<void>
  async setMode(sessionId: string, modeId: string): Promise<void>
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void>

  async closeSession(sessionId: string): Promise<void>

  /** 扩展方法：透传 SDK extMethod，用于非标准方法 */
  async extMethod(method: string, params: Record<string, unknown>): Promise<unknown>

  // ─── 访问器 ────────────────────────────────────────────

  get currentSessionId(): string | null
  get initializeResult(): InitializeResponse | null
}
```

### 2.3 实现细节

#### spawn + initialize（参照 AionUi ProcessAcpClient.start）

```
start(command, args, env, cwd):
  1. spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env })
  2. 捕获 stderr → 8KB 环形缓冲
  3. 创建 NdjsonTransport → Stream { readable, writable }
  4. new ClientSideConnection(agentProxy, stream)
  5. 监听 connection.signal (abort → 记录断线)
  6. Promise.race([
       sdk.initialize({ clientInfo, protocolVersion, clientCapabilities }),
       子进程 exit → AgentStartupError(stderr),
       startupTimeoutMs 超时
     ])
  7. 返回 InitializeResponse
```

#### NdjsonTransport

SDK 的 `ndJsonStream` 需要 Web Streams API。Node.js 子进程的 stdio 是 Node.js Streams，需要适配：

```typescript
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

function createStdioStream(
  stdin: Writable,
  stdout: Readable,
) {
  // Node.js Readable → Web ReadableStream
  const webReadable = Readable.toWeb(
    stdout
  ) as ReadableStream<Uint8Array>
  
  // Node.js Writable → Web WritableStream  
  const webWritable = Writable.toWeb(
    stdin
  ) as WritableStream<Uint8Array>

  return ndJsonStream(webWritable, webReadable)
}
```

注意：`Readable.toWeb()` / `Writable.toWeb()` 是 Node.js 17+ 的 API。Bytro 运行在 Electron 环境，支持此 API。

#### newSession 的 resume 逻辑

```typescript
async newSession(cwd: string, mcpServers: McpServer[], resumeSessionId?: string) {
  // 1. 优先尝试 session/load（如果 initialize result 显示支持）
  if (resumeSessionId && this._initResult?.agentCapabilities?.loadSession) {
    try {
      const response = await this.conn.loadSession({
        sessionId: resumeSessionId,
        cwd,
        mcpServers,
      })
      this.cacheSessionState(response)
      this._sessionId = resumeSessionId
      return response
    } catch {
      // 降级到 new
    }
  }

  // 2. session/new with resume params
  const params: Record<string, unknown> = { cwd, mcpServers }
  if (resumeSessionId) {
    // Claude-specific resume via _meta
    if (this._initResult?.agentCapabilities?._meta?.claudeCode) {
      params._meta = { claudeCode: { options: { resume: resumeSessionId } } }
    } else {
      params.resumeSessionId = resumeSessionId
    }
  }
  const response = await this.conn.newSession(params as NewSessionRequest)
  this.cacheSessionState(response)
  this._sessionId = response.sessionId
  return response
}
```

#### SDK 方法名映射

`AcpClient` 对外保留 Bytro 语义化 wrapper 名称，但内部必须调用 SDK v0.21.0 的真实方法名和参数字段：

| Wrapper | SDK 调用 |
|---------|----------|
| `setModel(sessionId, modelId)` | `conn.unstable_setSessionModel({ sessionId, modelId })` |
| `setMode(sessionId, modeId)` | `conn.setSessionMode({ sessionId, modeId })` |
| `setConfigOption(sessionId, configId, value)` | `conn.setSessionConfigOption({ sessionId, configId, value })` |
| `cancel(sessionId)` | `conn.cancel({ sessionId })` |
| `closeSession(sessionId)` | `conn.closeSession({ sessionId })`，仅当 `agentCapabilities.sessionCapabilities.close` 存在时调用 |

注意：SDK 的 `session/set_config_option` 参数字段叫 `configId`，不是旧 transport 中的 `optionId`。

#### 断线检测

```typescript
// 在 start() 中注册：
this._connection.signal.addEventListener('abort', () => {
  this._disconnectInfo = {
    reason: 'connection_close',
    exitCode: this._child?.exitCode ?? null,
    signal: this._child?.signalCode ?? null,
    stderr: this._stderrBuffer,
  }
  this._disconnectHandler?.(this._disconnectInfo)
}, { once: true })
```

#### 优雅关闭（3 阶段）

```
close():
  1. stdin.end()                   // 优雅信号
  2. setTimeout → SIGTERM          // 2s 后强制
  3. setTimeout → SIGKILL          // 5s 后暴力
  4. this._connection = null
```

参照 AionUi 的 `gracefulShutdown` 和 `waitForExit`。

---

## 3. acp-types.ts（简化）

### 3.1 删除（Phase 4）

```diff
- export const JSONRPC_VERSION = '2.0' as const
- 
- export interface AcpRequest { ... }
- export interface AcpResponse { ... }
- export interface AcpNotification { ... }
- export type AcpMessage = ...
- export interface AcpInitializeResult { ... }
```

这些类型由 SDK 内部处理。SDK 通过 `InitializeResponse`、`NewSessionResponse`、`PromptResponse` 等类型提供类型安全。

注意：Phase 0-3 为了保留 `BYTRO_ACP_LEGACY=1` 降级路径，旧 wire 类型仍需保留；只有 Phase 4 删除旧 `acp-transport.ts` 时才同步删除这些类型。

### 3.2 保留

```typescript
// ─── Session 信息 (业务层需要) ──────────────────────────

export interface AcpSessionModels {
  currentModelId?: string
  availableModels?: Array<{ id?: string; modelId?: string; name?: string }>
}

export interface AcpSessionModes {
  currentModeId?: string
  availableModes?: Array<{ id: string; name?: string; description?: string }>
}

export interface AcpSessionConfigOption {
  id: string
  name?: string
  label?: string
  description?: string
  category?: string
  type: 'select' | 'boolean' | 'string'
  currentValue?: string
  selectedValue?: string
  options?: Array<{ value: string; name?: string; label?: string }>
}

// ─── Session update 类型 (event-mapper 需要) ──────────

export const ACP_METHODS = {
  SESSION_UPDATE: 'session/update',
  REQUEST_PERMISSION: 'session/request_permission',
  READ_TEXT_FILE: 'fs/read_text_file',
  WRITE_TEXT_FILE: 'fs/write_text_file',
  SET_CONFIG_OPTION: 'session/set_config_option',
} as const

export interface AcpToolCallContentItem {
  type: 'content' | 'diff'
  content?: { type: 'text'; text: string }
  path?: string
  oldText?: string | null
  newText?: string
}

export interface AcpPermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface AcpPermissionRequest {
  sessionId: string
  options: AcpPermissionOption[]
  toolCall: {
    toolCallId: string
    rawInput?: { command?: string; description?: string; [key: string]: unknown }
    status?: string
    title?: string
    kind?: string
    content?: AcpToolCallContentItem[]
  }
}

// ─── Session update 歧视联合 (event-mapper 输入) ──────

export type AcpSessionUpdateKind =
  | { sessionUpdate: 'agent_message_chunk'; content: { type: 'text' | 'image'; text?: string } }
  | { sessionUpdate: 'agent_thought_chunk'; content: { type: 'text'; text: string } }
  | { sessionUpdate: 'tool_call'; toolCallId: string; status: string; title: string; kind: string; rawInput?: Record<string, unknown>; content?: AcpToolCallContentItem[] }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status: 'completed' | 'failed'; rawInput?: Record<string, unknown>; content?: Array<{ type: 'content'; content: { type: 'text'; text: string } }> }
  | { sessionUpdate: 'plan'; entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }
  | { sessionUpdate: 'config_option_update'; configOptions: AcpSessionConfigOption[] }
  | { sessionUpdate: 'usage_update'; used: number; size: number; cost?: { amount: number; currency: string } }
  | { sessionUpdate: 'available_commands_update'; availableCommands: Array<{ name: string; description: string }> }
  | { sessionUpdate: 'user_message_chunk'; content: { type: 'text'; text?: string } }
```

### 3.3 新增导入

```typescript
// 从 SDK 重导出业务层需要的类型
export type {
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionResponse,
  PromptResponse,
  SetSessionConfigOptionResponse,
  McpServer,
} from '@agentclientprotocol/sdk'
```

---

## 4. acp-provider.ts（重构）

### 4.1 改动点

核心改动：用 `AcpClient` 替换 `AcpTransport`。

```typescript
// 旧
import { AcpTransport } from './acp-transport'
// ...
interface SessionEntry {
  session: Session
  transport: AcpTransport    // ← 旧
  fullText: string
  doneEmitted: boolean
}

// 新
import { AcpClient, type DisconnectInfo } from './acp-client'
// ...
interface SessionEntry {
  session: Session
  client: AcpClient           // ← 新
  fullText: string
  doneEmitted: boolean
  lastConfigSnapshot: {       // ← 新增：用于持久化
    models?: Record<string, unknown>
    configOptions?: Record<string, unknown>[]
  }
}
```

### 4.2 createClient 方法（替换 createTransport）

```typescript
private createClient(sessionId: string, session: Session): AcpClient {
  const self = this

  const client = new AcpClient({
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

    onRequestPermission: async (params) => {
      const entry = self.sessions.get(sessionId)
      if (!entry) return { outcome: { outcome: 'cancelled' } }

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
          resolve({ outcome: { outcome: 'selected', optionId } })
        })
      })
    },

    onReadTextFile: async (filePath, sid) => {
      const { promises: fs } = await import('fs')
      const resolved = resolvePathInWorkspace(filePath, session.config.workingDir)
      return fs.readFile(resolved, 'utf-8')
    },

    onWriteTextFile: async (filePath, content, sid) => {
      const { promises: fs } = await import('fs')
      const resolved = resolvePathInWorkspace(filePath, session.config.workingDir)
      await fs.writeFile(resolved, content, 'utf-8')
    },
  })

  client.onDisconnect((info: DisconnectInfo) => {
    const entry = self.sessions.get(sessionId)
    if (!entry) return
    self.clearIdleTimer(sessionId)
    if (!entry.doneEmitted) {
      self.emitEvent(sessionId, entry, makeErrorEvent(
        `ACP process disconnected (${info.reason}, code: ${info.exitCode})`
      ))
      self.emitEvent(sessionId, entry, makeDoneEvent(sessionId))
    }
    self.sessions.delete(sessionId)
  })

  return client
}
```

### 4.3 startSession 方法变化

```typescript
async startSession(config: SessionConfig): Promise<Session> {
  const sessionId = config.sessionId ?? randomUUID()
  const sessionConfig = { ...config, sessionId }

  const existing = this.sessions.get(sessionId)
  if (existing?.client.isRunning) return existing.session

  const session: Session = { /* ... 不变 ... */ }
  const { command, args } = resolveSpawnCommand(this.backendConfig, this.providerConfig, true)
  const env = buildEnv(this.backendConfig, this.providerConfig)
  const cwd = config.workingDir || process.cwd()

  let client = this.createClient(sessionId, session)
  try {
    // 两阶段 spawn（npx: prefer-offline → 重试无 offline）
    await client.start(command, args, env, cwd)
    await client.newSession(cwd, [], config.sessionId)
  } catch (err) {
    await client.close()
    if (this.backendConfig.strategy === 'npx') {
      // Phase 2 retry
      client = this.createClient(sessionId, session)
      const retry = resolveSpawnCommand(this.backendConfig, this.providerConfig, false)
      await client.start(retry.command, retry.args, env, cwd)
      await client.newSession(cwd, [], config.sessionId)
    } else {
      throw err
    }
  }

  this.updateMetaFromClient(client)     // ← 从 client 缓存的 session state 提取 models/modes

  // 配置持久化（不变）
  this.reapplyPersistedConfig(client, cwd)
  this.saveCurrentConfig(client, cwd)

  const entry: SessionEntry = {
    session,
    client,
    fullText: '',
    doneEmitted: false,
    lastConfigSnapshot: {},
  }
  this.sessions.set(sessionId, entry)
  this.resetIdleTimer(entry)

  return session
}
```

### 4.4 Session state 缓存与 updateMetaFromClient

```typescript
// AcpClient 内部维护 latest session state:
private _models: AcpSessionModels | null = null
private _modes: AcpSessionModes | null = null
private _configOptions: AcpSessionConfigOption[] | null = null

private cacheSessionState(
  response:
    | NewSessionResponse
    | LoadSessionResponse
    | SetSessionConfigOptionResponse
    | { models?: AcpSessionModels | null; modes?: AcpSessionModes | null; configOptions?: AcpSessionConfigOption[] | null }
): void {
  if (response.models) this._models = response.models
  if (response.modes) this._modes = response.modes
  if (response.configOptions) this._configOptions = response.configOptions
}

private updateMetaFromClient(client: AcpClient): void {
  // SDK v0.21.0 的 InitializeResponse 只有 agentCapabilities；
  // models/modes/configOptions 来自 session/new、session/load、
  // session/set_config_option response，或 session/update 的 config_option_update。
  const models = client.currentModels
  if (models?.availableModels?.length) {
    const discovered: ModelInfo[] = models.availableModels.map((m) => ({
      id: m.id ?? m.modelId ?? 'unknown',
      name: m.name ?? m.id ?? m.modelId ?? 'unknown',
      contextWindow: 200_000,
    })).filter((m) => m.id !== 'unknown')

    if (discovered.length > 0) {
      this.meta = { ...this.meta, models: discovered }
    }
  }
}
```

### 4.5 其他方法改动（最小）

```typescript
// endSession: transport.destroy() → client.close()
async endSession(sessionId: string): Promise<void> {
  const entry = this.sessions.get(sessionId)
  if (!entry) return
  this.clearIdleTimer(sessionId)
  await entry.client.close()    // ← 替换
  this.sessions.delete(sessionId)
}

// sendMessage: transport.sendPrompt() → client.prompt()
sendMessage(sessionId: string, content: string): void {
  const entry = this.sessions.get(sessionId)
  if (!entry) return
  // ...
  entry.client.prompt(sessionId, [{ type: 'text', text: content }])
    .then(() => { /* complete + done */ })
    .catch((err) => { /* error + done */ })
}

// abort: transport.cancelPrompt() → client.cancel()
abort(sessionId: string): void {
  const entry = this.sessions.get(sessionId)
  if (!entry) return
  entry.client.cancel(sessionId)   // ← 替换
  entry.session.status = 'idle'
}

// getAvailableModels: entry.transport.currentModels → client.currentModels
getAvailableModels(sessionId: string): ModelInfo[] {
  const entry = this.sessions.get(sessionId)
  if (!entry) return this.meta.models
  const models = entry.client.currentModels
  if (!models?.availableModels?.length) return this.meta.models
  return models.availableModels.map(/* ... */)
}
```

---

## 5. acp-event-mapper.ts（微调）

### 5.1 改动点

event-mapper 的核心逻辑不变。唯一的改动是 `acpSessionUpdateToEvents` 函数的输入类型：

```typescript
// 旧：接受泛型 Record<string, unknown>
export function acpSessionUpdateToEvents(
  params: Record<string, unknown>,
  bytroSessionId: string
): AIEvent[]

// 新：保持不变 — SDK 的 SessionUpdate 也是泛型的
// 不需要改动签名，只需要确保类型兼容
```

**结论**：event-mapper.ts 几乎不需要改动。SDK 的 `SessionNotification` 也是 `Record<string, unknown>` 形式的，我们的歧视联合 switch 直接兼容。

---

## 6. acp-backends.ts（微调）

### 6.1 改动点

添加 `mcpServers` 支持的字段（如果之前没有）：

```typescript
export interface AcpBackendConfig {
  // ...现有字段...
  
  /** 预设的 MCP server 配置列表（通过 session/new 传给后端） */
  presetMcpServers?: McpServer[]
}
```

这是可选的扩展，不影响现有功能。

---

## 7. ai/types.ts — 新增 AIEvent 类型

### 7.1 新增类型定义

```typescript
// src/main/ai/types.ts — 新增

import type { ModelInfo, ConfigOption } from './provider'

/** ACP 配置选项更新（从 config_option_update 映射） */
export interface ConfigOptionUpdateEvent {
  type: 'config_option_update'
  configOptions: ConfigOption[]
}

/** ACP 模型列表更新（从 session/new 或 session/update 映射） */
export interface ModelsUpdateEvent {
  type: 'models_update'
  models: ModelInfo[]
}
```

### 7.2 AIEvent 联合类型更新

```diff
export type AIEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  // ...现有类型...
+ | ConfigOptionUpdateEvent
+ | ModelsUpdateEvent
```

---

## 8. ai/engine.ts — 新增动态方法代理

### 8.1 职责

`AIEngine` 作为 IPC 和 provider 之间的路由层，需要将会话级方法代理到正确的 provider。

### 8.1.1 provider.ts 接口补齐

**文件**: `src/main/ai/provider.ts`

当前 `CLIProvider` 已有 `getAvailableModels?`、`setModel?`、`getConfigOptions?`，但缺少设置配置选项的方法。Phase 3.5 需要先补上可选接口：

```typescript
export interface CLIProvider {
  // ...现有方法...

  /** Config options exposed by the agent backend (ACP config_option_update). */
  getConfigOptions?(sessionId: string): ConfigOption[] | null
  /** Set a dynamic ACP config option. Boolean options must stay boolean end-to-end. */
  setConfigOption?(sessionId: string, optionId: string, value: string | boolean): Promise<void>
}
```

这是可选方法，不影响 legacy CLI providers。

### 8.2 新增方法

```typescript
// src/main/ai/engine.ts

getAvailableModels(sessionId: string): ModelInfo[] {
  const record = this.sessions.get(sessionId)
  if (!record?.provider.getAvailableModels) return []
  return record.provider.getAvailableModels(sessionId)
}

async setModel(sessionId: string, modelId: string): Promise<void> {
  const record = this.sessions.get(sessionId)
  if (!record?.provider.setModel) return
  await record.provider.setModel(sessionId, modelId)
}

getConfigOptions(sessionId: string): ConfigOption[] | null {
  const record = this.sessions.get(sessionId)
  if (!record?.provider.getConfigOptions) return null
  return record.provider.getConfigOptions(sessionId)
}

async setConfigOption(sessionId: string, optionId: string, value: string | boolean): Promise<void> {
  const record = this.sessions.get(sessionId)
  if (!record?.provider.setConfigOption) return
  await record.provider.setConfigOption(sessionId, optionId, value)
}
```

注意：这些方法只对实现了可选 `CLIProvider` 方法的 provider 有效。旧 provider 返回空数组 / null / no-op。

---

## 9. ipc/chat.ts — 新增 IPC 通道

### 9.1 新增 handler

```typescript
// src/main/ipc/chat.ts — 在 registerChatIpc() 中新增

// 获取动态模型列表
ipcMain.handle('chat:getAvailableModels', async (_, sessionId: string) => {
  return aiEngine.getAvailableModels(assertSessionId(sessionId))
})

// 切换模型
ipcMain.handle('chat:setModel', async (_, sessionId: string, modelId: string) => {
  const normalized = typeof modelId === 'string' ? modelId.trim() : ''
  if (!normalized) throw new Error('Invalid model id')
  await aiEngine.setModel(assertSessionId(sessionId), normalized)
})

// 获取配置选项
ipcMain.handle('chat:getConfigOptions', async (_, sessionId: string) => {
  return aiEngine.getConfigOptions(assertSessionId(sessionId)) ?? []
})

// 设置配置选项
ipcMain.handle('chat:setConfigOption', async (_, sessionId: string, optionId: string, value: unknown) => {
  const normalizedId = typeof optionId === 'string' ? optionId.trim() : ''
  if (!normalizedId) throw new Error('Invalid config option id')
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    throw new Error('Invalid config option value')
  }
  await aiEngine.setConfigOption(assertSessionId(sessionId), normalizedId, value)
})
```

---

## 10. preload/index.ts — Preload Bridge 扩展

### 10.1 chat namespace 新增

```typescript
// src/preload/index.ts — chat 对象中新增

chat: {
  // ...现有方法...

  getAvailableModels: (sessionId: string): Promise<Array<{
    id: string; name: string; contextWindow: number
  }>> =>
    ipcRenderer.invoke('chat:getAvailableModels', sessionId),

  setModel: (sessionId: string, modelId: string): Promise<void> =>
    ipcRenderer.invoke('chat:setModel', sessionId, modelId),

  getConfigOptions: (sessionId: string): Promise<Array<{
    id: string; name?: string; label?: string; description?: string
    category?: string; type: string; currentValue?: string
    options?: Array<{ value: string; name?: string }>
  }>> =>
    ipcRenderer.invoke('chat:getConfigOptions', sessionId),

  setConfigOption: (sessionId: string, optionId: string, value: string | boolean): Promise<void> =>
    ipcRenderer.invoke('chat:setConfigOption', sessionId, optionId, value),
}
```

---

## 11. renderer/types/global.d.ts — 类型同步

### 11.1 AIEvent 联合类型更新

```diff
type AIEvent =
  | { type: 'text_delta'; ... }
  // ...现有类型...
+ | { type: 'config_option_update'; configOptions: Array<{ id: string; name?: string; label?: string; description?: string; category?: string; type: string; currentValue?: string | boolean; options?: Array<{ value: string; name?: string }> }>; sessionId?: string }
+ | { type: 'models_update'; models: Array<{ id: string; name: string; contextWindow: number }>; sessionId?: string }
```

### 11.2 ElectronAPI.chat 类型更新

```diff
chat: {
  // ...现有方法...
+ getAvailableModels: (sessionId: string) => Promise<Array<{ id: string; name: string; contextWindow: number }>>
+ setModel: (sessionId: string, modelId: string) => Promise<void>
+ getConfigOptions: (sessionId: string) => Promise<Array<{ id: string; name?: string; label?: string; description?: string; category?: string; type: string; currentValue?: string | boolean; options?: Array<{ value: string; name?: string }> }>>
+ setConfigOption: (sessionId: string, optionId: string, value: string | boolean) => Promise<void>
}
```

---

## 11.5 chatStore — 持久 session id selector

`ModelSelector` 和 `ConfigOptions` 需要的是当前 conversation 对应的持久 ACP session id，而不是 `streamingRequestId`。当前 `streamingRequestId` 在 turn 结束后会清空，不能支撑 turn 间的 mid-session 模型切换。

**文件**: `src/renderer/src/stores/chatStore.ts`

建议把现有闭包里的 `conversationSessionIds` 映射同步到 store state，暴露 selector/action：

```typescript
interface ChatState {
  // conversationId -> provider sessionId
  conversationSessionIds: Record<string, string>
  getActiveSessionId: (conversationId: string) => string | null
}

// startSession 成功后同时更新:
set((state) => ({
  conversationSessionIds: {
    ...state.conversationSessionIds,
    [conversationId]: sessionId,
  },
}))

getActiveSessionId: (conversationId) => get().conversationSessionIds[conversationId] ?? null
```

`ChatInput` 通过 `useChatStore((s) => s.getActiveSessionId(conversationId))` 取值并传给 `ModelSelector` / `ConfigOptions`。这样一轮完成后 UI 仍然知道当前 conversation 的 provider session。

## 12. ModelSelector.tsx（改造）

### 12.1 改动

| 改动 | 说明 |
|------|------|
| 接收 `activeSessionId` prop | 从 ChatInput 传入当前 conversation 的持久 provider session id |
| 双来源模型列表 | session 活跃 → `chat.getAvailableModels(sid)`；无 session → provider.meta.models |
| mid-session 切换 | `handleModelChange` 时除 localStorage 外，还调用 `chat.setModel(sid, modelId)` |
| 监听 `models_update` 推送 | `chat.onEvent` 监听，按 `event.sessionId === activeSessionId` 过滤后刷新下拉列表 |

### 12.2 示例代码

```typescript
export function ModelSelector({ activeSessionId }: { activeSessionId?: string }) {
  // ...现有 providerType, model, setModel, providers...

  const [dynamicModels, setDynamicModels] = useState<Array<{ id: string; name: string; contextWindow: number }>>([])

  // 获取动态模型
  useEffect(() => {
    if (!activeSessionId) { setDynamicModels([]); return }
    window.api.chat.getAvailableModels(activeSessionId).then(setDynamicModels).catch(() => {})
  }, [activeSessionId, providerType])

  // 监听 models_update 推送
  useEffect(() => {
    const unsub = window.api.chat.onEvent((event) => {
      if (event.type === 'models_update' && event.sessionId === activeSessionId) {
        setDynamicModels(event.models)
      }
    })
    return unsub
  }, [activeSessionId])

  const models = dynamicModels.length > 0 ? dynamicModels : selectedProvider?.meta.models ?? []

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    if (activeSessionId) {
      window.api.chat.setModel(activeSessionId, newModel).catch(() => {})
    }
  }

  // ...render (不变)...
}
```

---

## 13. ConfigOptions.tsx（新建）

### 13.1 职责

渲染 ACP 后端返回的配置选项，允许用户在 session 运行时切换模型、模式、权限等。

### 13.2 接口

```typescript
interface ConfigOption {
  id: string
  name?: string
  label?: string
  description?: string
  category?: string
  type: 'select' | 'boolean' | 'string'
  currentValue?: string | boolean
  options?: Array<{ value: string; name?: string }>
}

export function ConfigOptions({ sessionId }: { sessionId: string }) {
  const [options, setOptions] = useState<ConfigOption[]>([])
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    window.api.chat.getConfigOptions(sessionId).then(setOptions).catch(() => {})
  }, [sessionId])

  const handleChange = (optionId: string, value: string | boolean) => {
    window.api.chat.setConfigOption(sessionId, optionId, value).catch(() => {})
  }

  const handleBooleanChange = (optionId: string, checked: boolean) => {
    window.api.chat.setConfigOption(sessionId, optionId, checked).catch(() => {})
  }

  if (options.length === 0) return null

  return (
    <div className="config-options-panel">
      {/* 按 category 分组，每个 option 根据 type 渲染 select/checkbox/input */}
    </div>
  )
}
```

### 13.3 放置位置

建议放在 ChatInput 下方，模型选择器旁边，作为可折叠面板。在 ModelSelector 中加一个齿轮图标按钮来切换显示。

---

## 14. 依赖变更

### 7.2 安装命令

```bash
cd bytro-app
pnpm add @agentclientprotocol/sdk
```

---

## 15. 测试计划

### 15.1 单元测试：acp-client.test.ts

| 测试用例 | 覆盖场景 |
|----------|----------|
| `start()` spawns process and completes initialize | 正常启动 |
| `start()` throws AgentStartupError on process crash | 启动失败 |
| `start()` throws timeout after startupTimeoutMs | 启动超时 |
| `newSession()` returns session response | 正常创建会话 |
| `newSession()` with resumeSessionId tries loadSession first | 会话恢复 |
| `newSession()` falls back to new when loadSession fails | 恢复降级 |
| `prompt()` sends prompt and returns response | 正常发送消息 |
| `cancel()` sends cancel notification | 取消操作 |
| `setModel()` sends model change | 模型切换 |
| `close()` cleans up process and connection | 优雅关闭 |
| `onDisconnect()` fires when process exits | 断线回调 |
| `onDisconnect()` fires on connection abort | 连接中断 |
| stderr buffer is capped at 8KB | stderr 上限 |

### 15.2 集成测试：ACP provider

保持现有 `acp-event-mapper.test.ts` 不变，新增：

| 测试用例 | 覆盖场景 |
|----------|----------|
| `startSession()` with SDK path creates AcpClient | SDK 路径正常 |
| `sendMessage()` emits text_delta events | 消息流映射 |
| `respondPermission()` resolves permission callback | 权限回调 |
| idle timeout fires after 30min | 空闲超时 |
| config persists across sessions | 配置持久化 |

---

## 16. 不变量

1. **`CLIProvider` 既有必需接口签名不变** — 只新增可选 `setConfigOption?`，旧 provider 零改动
2. **`AIEvent` 既有事件不变** — 只新增 `models_update` / `config_option_update`，旧 renderer 逻辑不受影响
3. **`acp-backends.ts` 的 16 个后端配置不变** — 只是 spawn 参数
4. **所有现有测试继续通过** — event-mapper 测试作为回归锚点
5. **空闲超时、配置持久化功能保持不变** — 这些是 ACPProvider 层的逻辑
6. **JSON-RPC 线格式不变** — SDK 和手搓都是同一协议
