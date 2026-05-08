# ACP SDK 迁移 — 架构设计

> **版本**: v1.0 | **日期**: 2026-05-06 | **状态**: Draft
> **摘要**: 将 Bytro 手搓的 ACP JSON-RPC 传输层替换为官方 `@agentclientprotocol/sdk`，参照 AionUi 的三层架构重构

---

## 1. 动机

### 1.1 现状问题

当前 `src/main/ai/acp/acp-transport.ts` 有 **530 行手搓 JSON-RPC 实现**，包括：

| 功能 | 代码量 | 问题 |
|------|--------|------|
| JSON-RPC 消息帧 (换行分隔) | ~60 行 | 手动 buffer 拼接，边界情况多 |
| 请求/响应匹配 (pending map) | ~80 行 | 手动管理 id、超时、pause/resume |
| Initialize 握手 + 超时 | ~50 行 | 硬编码 protocolVersion: 1 |
| 子进程 spawn + stderr 缓冲 | ~80 行 | 启动失败检测不完善 |
| Session 生命周期 (new/prompt/cancel/close) | ~120 行 | 手写 JSON 构造 |
| 消息分发 (method switch) | ~80 行 | 字符串匹配，无类型校验 |
| 错误处理 | ~60 行 | 字符串匹配，无结构化错误 |

**核心问题**：这些代码不是 Bytro 的业务逻辑——它们是协议基础设施。官方 SDK (`@agentclientprotocol/sdk` v0.21.0) 已经提供了类型安全的封装，AionUi 早已迁移到 SDK。

### 1.2 收益

| 维度 | 迁移前 | 迁移后 |
|------|--------|--------|
| `acp-transport.ts` | 530 行手搓 JSON-RPC | **删除**，替换为 ~80 行 SDK 薄包装 |
| 消息帧 | 手动 buffer split + JSON.parse | SDK `ndJsonStream` |
| 请求/响应匹配 | 手动 Map<id, PendingRequest> | SDK 内部处理 |
| 协议版本 | 硬编码 `1` | SDK `PROTOCOL_VERSION` 常量 |
| 类型安全 | 手工定义 `AcpRequest/Response/Notification` | SDK 导出完整类型 |
| 错误码 | 自定义 | ACP 标准错误码 |
| 协议更新 | 手动跟进 | SDK 升级自动获取 |
| fork/list/resume | 手写扩展 | SDK 提供 `unstable_*` 方法 |

---

## 2. 目标架构

### 2.1 三层结构

参照 AionUi 的架构模式，简化适配 Bytro 的 CLIProvider 接口约束：

```
┌──────────────────────────────────────────────────────┐
│  Application Layer                                   │
│                                                      │
│  ACPProvider (重构，~200 行)                          │
│  · 实现 CLIProvider 既有必需接口；新增可选 UI 能力    │
│  · 管理 Map<sessionId, SessionEntry>                  │
│  · 空闲超时 (30min，已有)                             │
│  · 配置持久化 (跨会话，已有)                          │
│  · 事件映射：SessionUpdate → AIEvent                  │
│                                                      │
├──────────────────────────────────────────────────────┤
│  Protocol Layer                        * 新增 *      │
│                                                      │
│  AcpClient (~80 行)                                  │
│  · 封装 SDK ClientSideConnection                     │
│  · 封装 NdjsonTransport (stdio → Stream)             │
│  · 统一的 initialize / newSession / prompt / cancel  │
│  · 断线检测 (AbortSignal)                             │
│                                                      │
├──────────────────────────────────────────────────────┤
│  Infrastructure Layer                                │
│                                                      │
│  @agentclientprotocol/sdk (npm 依赖)                 │
│  · ClientSideConnection                              │
│  · ndJsonStream                                      │
│  · PROTOCOL_VERSION                                  │
│  · 完整类型导出                                       │
└──────────────────────────────────────────────────────┘
```

### 2.2 核心原则

**P1: 只替换协议层，不动业务逻辑**

`CLIProvider` 既有必需方法、`acp-backends.ts`、核心消息流保持不变。UI 集成阶段会新增少量可选能力（例如 `setConfigOption?`、动态模型/config 事件），但不改变现有 provider 的必需实现面。

**P2: SDK 薄包装，不加抽象层**

AionUi 有完整的 `AcpClient` 接口 + `ProcessAcpClient` / `WebSocketAcpClient` 两个实现。Bytro 目前只需要本地子进程，所以直接用一个 `AcpClient` 类封装 SDK，不引入接口抽象。等将来需要远程连接时再提取接口。

**P3: 渐进替换，开关保护**

用 `BYTRO_ACP_SDK=1` 先 opt-in 新 SDK 路径；验证稳定后切到默认 SDK，并保留 `BYTRO_ACP_LEGACY=1` 降级路径至少一个发布周期。只有确认不再需要回滚时，才删除旧 `acp-transport.ts`。

---

## 3. 新旧架构对比

### 3.1 当前：手搓架构

```
ACPProvider
  ├─ AcpTransport (530 行手搓 JSON-RPC)
  │   ├─ spawn() → ChildProcess
  │   ├─ setupHandlers() → stdout buffer split + stderr 缓冲
  │   ├─ initialize() → 手写 JSON-RPC request
  │   ├─ newSession() → 手写参数拼接
  │   ├─ sendPrompt() → 手写 request
  │   ├─ handleMessage() → 手动 dispatch (id→response, method→notification)
  │   ├─ handleIncoming() → switch(method) 手写每种消息
  │   ├─ 超时管理 → 手动 pause/resume/reset
  │   └─ 错误处理 → 字符串匹配
  └─ acp-types.ts (手写 wire 类型)
```

### 3.2 目标：SDK 架构

```
ACPProvider
  ├─ AcpClient (~80 行 SDK 薄包装)
  │   ├─ 封装 ndJsonStream(process.stdout, process.stdin)
  │   ├─ 封装 ClientSideConnection(handlers, stream)
  │   ├─ start() → spawn + initialize (带启动失败检测)
  │   ├─ newSession() / loadSession() → 透传 SDK
  │   ├─ prompt() / cancel() → 透传 SDK
  │   ├─ setModel() / setMode() / setConfigOption() → 透传 SDK
  │   └─ 断线检测: connection.signal + onDisconnect
  └─ acp-types.ts (简化，只保留 Bytro 特有的映射类型)
```

### 3.3 关键差异：prompt 发送

**旧（手搓）**:
```typescript
// acp-transport.ts: sendPrompt()
async sendPrompt(prompt: string): Promise<void> {
  await this.request('session/prompt', {
    sessionId: this.sessionId,
    prompt: [{ type: 'text', text: prompt }],
  })
}
// request() 内部: 手动分配 id, 写 JSON, 等响应
```

**新（SDK）**:
```typescript
// acp-client.ts
async prompt(sessionId: string, content: string): Promise<PromptResponse> {
  return this.conn.prompt({
    sessionId,
    prompt: [{ type: 'text', text: content }],
  })
}
// SDK 内部: 类型安全, 自动 id 管理, Promise 匹配
```

### 3.4 关键差异：消息接收

**旧（手搓）**:
```typescript
// stdout data → buffer split('\n') → JSON.parse → 
//   有 id? → pending.get(id).resolve(result)
//   有 method? → handleIncoming(msg) → switch(method)
```

**新（SDK）**:
```typescript
// SDK 内部处理 JSON-RPC 帧 + dispatch
// 我们只需要提供 handlers:
const handlers = {
  sessionUpdate: async (params) => { /* ... */ },
  requestPermission: async (params) => { /* ... */ },
  readTextFile: async (params) => { /* ... */ },
  writeTextFile: async (params) => { /* ... */ },
}
```

---

## 4. 新模块：AcpClient

### 4.1 定位

`AcpClient` 是一个薄包装类，负责：

1. **进程管理**：spawn 子进程，捕获 stderr，检测启动失败
2. **流传输**：将 ChildProcess 的 stdio 转换为 SDK 的 `Stream`
3. **协议通信**：透传 SDK `ClientSideConnection` 的方法
4. **断线处理**：将 SDK 的 `AbortSignal` 转换为结构化断线信息

### 4.2 接口

```typescript
class AcpClient {
  // 生命周期
  async start(command, args, env, cwd): Promise<InitializeResponse>
  async close(): Promise<void>
  get isRunning(): boolean

  // 协议方法（透传 SDK）
  async newSession(cwd, resumeSessionId?): Promise<NewSessionResponse>
  async loadSession(sessionId, cwd): Promise<LoadSessionResponse>
  async prompt(sessionId, content): Promise<PromptResponse>
  async cancel(sessionId): Promise<void>
  async setModel(sessionId, modelId): Promise<void>
  async setMode(sessionId, modeId): Promise<void>
  async setConfigOption(sessionId, id, value): Promise<void>
  async closeSession(sessionId): Promise<void>

  // 回调
  onDisconnect(handler: (info: DisconnectInfo) => void): void
}
```

### 4.3 关键实现细节

**启动失败检测**（参照 AionUi ProcessAcpClient）:
```
spawn() → waitForSpawn() → Promise.race([
  sdk.initialize(),
  processExit → AgentStartupError(stderr),
  60s timeout
])
```

**stderr 环形缓冲**（8KB max）:
- 从 spawn 开始就捕获 stderr
- 启动失败时附在错误信息中
- 运行中只保留最近 8KB

**NdjsonTransport**（参照 AionUi）:
```typescript
// 核心：将 Node.js Readable/Writable 转为 Web Streams
import { ndJsonStream } from '@agentclientprotocol/sdk'

function createStdioStream(child: ChildProcess): Stream {
  return ndJsonStream(
    child.stdin,   // WritableStream
    child.stdout   // ReadableStream
  )
}
```

注意：SDK 的 `ndJsonStream` 接受 Web Streams API (`ReadableStream`/`WritableStream`)。Node.js 的 `child.stdin` (Writable) 和 `child.stdout` (Readable) 需要用 `Readable.toWeb()` / `Writable.toWeb()` 转换，或使用 SDK 提供的 Node.js 适配器。

---

## 5. acp-types.ts 的简化

### 5.1 删除的类型（SDK 已提供）

以下类型由 SDK 导出，不再需要手写：

- ~~`AcpRequest`~~ → SDK: `JSONRPCRequest`
- ~~`AcpResponse`~~ → SDK: `JSONRPCResponse`
- ~~`AcpNotification`~~ → SDK: `JSONRPCNotification`
- ~~`AcpMessage`~~ → SDK 内部处理
- ~~`JSONRPC_VERSION`~~ → SDK: `PROTOCOL_VERSION`
- ~~`AcpInitializeResult`~~ → SDK: `InitializeResponse`

### 5.2 保留的类型（Bytro 特有）

- `AcpSessionUpdateKind` — Bytro 内部的 session update 歧视联合，event-mapper 需要
- `ACP_METHODS` — 如果 SDK 不导出方法名常量，保留
- `AcpToolCallContentItem` — event-mapper 需要
- `AcpPermissionRequest` / `AcpPermissionOption` — permission 处理需要
- `AcpSessionModels` / `AcpSessionModes` / `AcpSessionConfigOption` — UI 展示需要

---

## 6. acp-provider.ts 的改动

### 6.1 改动范围

改动集中在**内部实现**；`CLIProvider` 的既有必需方法不变，UI 集成阶段只新增可选方法：

| 方法 | 改动力度 | 说明 |
|------|----------|------|
| `detect()` | 不变 | |
| `initialize()` | 不变 | |
| `startSession()` | 重构 | 用 AcpClient 替换 AcpTransport |
| `endSession()` | 小幅 | 调用 AcpClient.close() 替代 transport.destroy() |
| `sendMessage()` | 小幅 | 调用 AcpClient.prompt() 替代 transport.sendPrompt() |
| `respondPermission()` | 小幅 | 回调方式改变 |
| `respondQuestion()` | 不变 | |
| `abort()` | 小幅 | 调用 AcpClient.cancel() |
| `onEvent/offEvent` | 不变 | |
| `getAvailableModels/setModel/getConfigOptions/setConfigOption` | 小幅 | 透传 AcpClient；`setConfigOption` 需加入 `CLIProvider` 可选接口 |
| 空闲超时 | 不变 | |
| 配置持久化 | 不变 | |

### 6.2 Session 创建流程变化

**旧流程**:
```
startSession() →
  resolveSpawnCommand() →
  transport.spawn(command, args, env, cwd) → 内部 initialize →
  transport.newSession(cwd, sessionId) →
  updateMetaFromTransport()
```

**新流程**:
```
startSession() →
  resolveSpawnCommand() →
  new AcpClient(handlers) →
  client.start(command, args, env, cwd) → spawn + SDK initialize →
  client.newSession(cwd, sessionId) → SDK newSession →
  updateMetaFromClient()
```

### 6.3 权限处理流程变化

**旧流程**:
```
transport 收到 permission notification →
  callbacks.onPermissionRequest(params) →
    返回 Promise<optionId> →
  transport 内部 sendResponse
```

**新流程 (SDK)**:
```
SDK 收到 permission request →
  handlers.requestPermission(params) →
    返回 Promise<RequestPermissionResponse> →
  SDK 自动发送响应
```

不再需要区分 request/notification 两种形式——SDK 统一处理。

---

## 7. UI 层当前状态与差距

### 7.1 当前数据流

```
ModelSelector.tsx                    sessionConfigStore (localStorage)
  │ 读 providerStore.providers         │ providerType, model
  │ 读 sessionConfigStore.model        │
  │                                   ChatInput.tsx
providerStore.ts                       │ 调用 window.api.chat.startSession(config)
  │ window.api.provider.list()         │ config = { providerType, model, ... }
  │ → 返回 ProviderMeta.models         │
  │   (注册时的静态 fallback)           │ model 只在 startSession 时传递
                                       │ 之后无法切换
```

### 7.2 关键差距

| 差距 | 详情 |
|------|------|
| **无 IPC 桥接** | `getAvailableModels`、`setModel`、`getConfigOptions`、`setConfigOption` 已在 `ACPProvider` 实现，但没有对应的 IPC handler、preload bridge、renderer 调用 |
| **AIEngine 未代理** | `aiEngine` 不代理这些动态方法，IPC 层无法通过 engine 会话路由到 provider |
| **无动态模型推送** | `session/new` 和 `config_option_update` 返回的新模型列表只在 `ACPProvider.updateMetaFromTransport()` 中更新 `this.meta`，没有 `AIEvent` 通知 renderer |
| **ModelSelector 用静态模型** | `ModelSelector` 从 `providerStore.providers[].meta.models` 读取模型 — 这是注册时的静态列表，不会随 session 动态更新 |
| **模型切换只有 localStorage** | `sessionConfigStore.setModel()` 写 localStorage，但 `startSession` 之后无法切换 ACP session 的模型 |
| **无 mid-session 模型切换** | UI 没有调用 `setModel` 的入口；ChatInput 没有模型切换 UI |
| **无 config option 展示** | ACP 后端返回的 `configOptions`（模型、模式、权限等）完全不可见于 UI |
| **`config_option_update` 被静默丢弃** | `acp-event-mapper.ts` 的 switch 中 `config_option_update` 走 default 分支，不产生任何 `AIEvent`；`usage_update`、`available_commands_update` 同理 |

### 7.3 Provider 接口与 UI 需求对照

| 需求 | Provider 方法 | Engine | IPC | Preload | UI |
|------|:--:|:--:|:--:|:--:|:--:|
| 获取动态模型列表 | ✅ `getAvailableModels` | ❌ | ❌ | ❌ | ❌ |
| 切换模型 | ✅ `setModel` | ❌ | ❌ | ❌ | ❌ |
| 获取配置选项 | ✅ `getConfigOptions` | ❌ | ❌ | ❌ | ❌ |
| 设置配置选项 | ✅ `setConfigOption` | ❌ | ❌ | ❌ | ❌ |
| 接收模型变更推送 | ❌ 无 AIEvent | — | ❌ | ❌ | ❌ |
| 接收配置变更推送 | ❌ 无 AIEvent | — | ❌ | ❌ | ❌ |

> ✅ = 已实现，❌ = 缺失

---

## 8. UI 层改动设计

### 8.1 全栈数据流（目标）

```
ACP Backend (CLI)
  │ session/new → { models, configOptions, modes }
  │ session/update → config_option_update
  ▼
AcpClient / SDK
  │
  ▼
ACPProvider
  │ 缓存 models / configOptions
  │ emit config_option_update → AIEvent
  ▼
AIEngine
  │ getAvailableModels(sessionId) → ModelInfo[]
  │ setModel(sessionId, modelId) → void
  │ getConfigOptions(sessionId) → ConfigOption[]
  │ setConfigOption(sessionId, id, value: string | boolean) → void
  ▼
IPC (chat.ts)
  │ chat:getAvailableModels / chat:setModel
  │ chat:getConfigOptions / chat:setConfigOption
  │ ai:event (config_option_update)
  ▼
Preload (window.api.chat)
  │
  ▼
Renderer
  ├─ ModelSelector.tsx → 动态模型列表 + mid-session 切换
  ├─ ConfigOptions.tsx (新) → 配置选项展示/编辑
  └─ providerStore / chatStore → 缓存动态数据
```

### 8.2 新增 AIEvent 类型

```typescript
// src/main/ai/types.ts — 新增
export interface ConfigOptionUpdateEvent {
  type: 'config_option_update'
  configOptions: ConfigOption[]
}

export interface ModelsUpdateEvent {
  type: 'models_update'
  models: ModelInfo[]
}

// 加入 AIEvent 联合类型
export type AIEvent =
  | ... // 现有类型
  | ConfigOptionUpdateEvent
  | ModelsUpdateEvent
```

同时更新 `src/renderer/src/types/global.d.ts` 的 `AIEvent` 类型。

### 8.3 AIEngine 新增方法

```typescript
// src/main/ai/engine.ts — 新增
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

### 8.4 新增 IPC 通道

```typescript
// src/main/ipc/chat.ts — 在 registerChatIpc() 中新增

ipcMain.handle('chat:getAvailableModels', async (_, sessionId: string) => {
  return aiEngine.getAvailableModels(assertSessionId(sessionId))
})

ipcMain.handle('chat:setModel', async (_, sessionId: string, modelId: string) => {
  await aiEngine.setModel(assertSessionId(sessionId), assertString(modelId, 'model id'))
})

ipcMain.handle('chat:getConfigOptions', async (_, sessionId: string) => {
  return aiEngine.getConfigOptions(assertSessionId(sessionId))
})

ipcMain.handle('chat:setConfigOption', async (_, sessionId: string, optionId: string, value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'boolean') throw new Error('Invalid config option value')
  await aiEngine.setConfigOption(assertSessionId(sessionId), assertString(optionId, 'option id'), value)
})
```

### 8.5 Preload Bridge 扩展

```typescript
// src/preload/index.ts — chat namespace 中新增

chat: {
  // ...现有方法...

  getAvailableModels: (sessionId: string): Promise<Array<{ id: string; name: string; contextWindow: number }>> =>
    ipcRenderer.invoke('chat:getAvailableModels', sessionId),
  setModel: (sessionId: string, modelId: string): Promise<void> =>
    ipcRenderer.invoke('chat:setModel', sessionId, modelId),
  getConfigOptions: (sessionId: string): Promise<Array<{ id: string; name?: string; label?: string; description?: string; category?: string; type: string; currentValue?: string; options?: Array<{ value: string; name?: string }> }> | null> =>
    ipcRenderer.invoke('chat:getConfigOptions', sessionId),
  setConfigOption: (sessionId: string, optionId: string, value: string | boolean): Promise<void> =>
    ipcRenderer.invoke('chat:setConfigOption', sessionId, optionId, value),
}
```

### 8.6 ModelSelector 改造

**文件**: `src/renderer/src/components/ModelSelector.tsx`

改动要点：

1. **双来源模型列表**：当有持久 ACP session 时，调用 `window.api.chat.getAvailableModels(sessionId)` 获取动态模型；无 session 时回退到 `provider.meta.models`（静态 fallback）
2. **mid-session 模型切换**：当用户选择新模型时，除 `sessionConfigStore.setModel()` 外，如果当前有活跃 session，同时调用 `window.api.chat.setModel(sessionId, modelId)`
3. **接收模型推送**：监听 `ai:event` 中的 `models_update` 事件，且只处理 `event.sessionId === activeSessionId` 的事件，自动刷新模型列表
4. **持久 session id 来源**：`activeSessionId` 不应使用 turn 结束后会清空的 `streamingRequestId`，而应来自 `chatStore` 暴露的当前 conversation → session 映射 selector。

```typescript
// ModelSelector 内部（伪代码）
function ModelSelector({ activeSessionId }: { activeSessionId?: string }) {
  const [dynamicModels, setDynamicModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    if (activeSessionId) {
      window.api.chat.getAvailableModels(activeSessionId).then(setDynamicModels)
    }
  }, [activeSessionId])

  // 监听 models_update 推送
  useEffect(() => {
    const unsub = window.api.chat.onEvent((event) => {
      if (event.type === 'models_update' && event.sessionId === activeSessionId) {
        setDynamicModels(event.models)
      }
    })
    return unsub
  }, [activeSessionId])

  const models = dynamicModels.length > 0
    ? dynamicModels
    : selectedProvider?.meta.models ?? []

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    if (activeSessionId) {
      window.api.chat.setModel(activeSessionId, newModel)
    }
  }

  // ... render
}
```

### 8.7 ConfigOptions 组件（新建）

**文件**: `src/renderer/src/components/ConfigOptions.tsx`（新建）

渲染 ACP 后端的配置选项（模型、模式、权限等）：

```typescript
// 配置选项类型
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

function ConfigOptions({ sessionId }: { sessionId: string }) {
  const [options, setOptions] = useState<ConfigOption[]>([])

  useEffect(() => {
    window.api.chat.getConfigOptions(sessionId).then((opts) => {
      if (opts) setOptions(opts)
    })
  }, [sessionId])

  const handleChange = (optionId: string, value: string | boolean) => {
    window.api.chat.setConfigOption(sessionId, optionId, value)
  }

  // 按 category 分组渲染，每个 option 根据 type 渲染为 select/checkbox/input
}
```

### 8.8 event-mapper 改动

```typescript
// src/main/ai/acp/acp-event-mapper.ts
// 在 switch 中添加：

case 'config_option_update': {
  events.push({
    type: 'config_option_update',
    configOptions: (update as AcpSessionUpdateKind & { sessionUpdate: 'config_option_update' }).configOptions,
  })
  break
}
case 'available_commands_update': {
  // 目前忽略，后续可用于展示可用命令
  break
}
```

初始 models/configOptions 不应只依赖 `models_update` 推送，因为当前 `chat:startSession` 是 start 完成后才注册事件转发，startSession 期间 emit 的事件可能被 renderer 错过。UI 必须在拿到持久 session id 后主动调用 `getAvailableModels()` / `getConfigOptions()` 作为初始数据来源；`models_update` / `config_option_update` 仅作为后续增量刷新。

### 8.9 global.d.ts 类型同步

`src/renderer/src/types/global.d.ts` 中需要：
1. `AIEvent` 联合类型添加 `models_update` 和 `config_option_update`
2. `chat` API 添加新方法签名

---

## 9. 兼容性设计

### 7.1 渐进开关

```typescript
// acp-provider.ts
const USE_SDK = process.env.BYTRO_ACP_SDK === '1'

async startSession(config: SessionConfig): Promise<Session> {
  if (USE_SDK) {
    return this.startSessionWithSdk(config)
  }
  return this.startSessionWithTransport(config) // 旧代码
}
```

### 7.2 Phase 策略

| Phase | 持续 | 策略 |
|-------|------|------|
| **Phase 1** | 1-2 周 | 新 SDK 路径与旧 transport 并存，默认走旧代码，`BYTRO_ACP_SDK=1` 灰度 |
| **Phase 2** | 1 周 | 默认走新 SDK，`BYTRO_ACP_LEGACY=1` 可回退 |
| **Phase 3** | 后续发布 | 删除旧 `acp-transport.ts` 和相关类型 |

---

## 10. 文件变更总览

| 文件 | 操作 | 行数变化 |
|------|------|----------|
| `acp/acp-client.ts` | **新建** | +~120 行 |
| `acp/acp-transport.ts` | Phase 0-3 保留 legacy；后续清理删除 | -574 行 |
| `acp/acp-types.ts` | 添加 SDK 类型重导出；后续清理移除 wire 类型 | -40 行 |
| `acp/acp-provider.ts` | 重构（内部替换 AcpTransport → AcpClient） | ~无变化 |
| `acp/acp-event-mapper.ts` | 添加 config_option_update / models_update 映射 | +15 行 |
| `acp/acp-backends.ts` | 微调 | ~±5 行 |
| `ai/engine.ts` | 新增 getAvailableModels / setModel / getConfigOptions / setConfigOption | +25 行 |
| `ai/types.ts` | 新增 ConfigOptionUpdateEvent / ModelsUpdateEvent | +15 行 |
| `ipc/chat.ts` | 新增 4 个 IPC handler | +25 行 |
| `preload/index.ts` | chat namespace 新增 4 个方法 | +10 行 |
| `renderer/types/global.d.ts` | 同步 AIEvent + chat API 类型 | +15 行 |
| `renderer/components/ModelSelector.tsx` | 支持动态模型 + mid-session 切换 | +20 行 |
| `renderer/components/ConfigOptions.tsx` | **新建**，配置选项 UI | +80 行 |
| `package.json` | 添加 `@agentclientprotocol/sdk` 依赖 | +1 行 |

**净效果（纯行数）**: +331 行新代码 / 非 UI 代码，-574 行旧 transport → **净减少 ~243 行**

**新建 UI 代码**: +100 行（ConfigOptions + ModelSelector 改造）

---

## 11. 参考

- [AionUi ACP 架构设计](https://github.com/iOfficeAI/AionUi/tree/main/docs/specs/acp-rewrite)
- [@agentclientprotocol/sdk on npm](https://www.npmjs.com/package/@agentclientprotocol/sdk)
- [ACP TypeScript SDK 文档](https://agentclientprotocol.com/libraries/typescript)
- [Bytro 统一 CLI 协议设计](../unified-cli-protocol.md)
