# ACP SDK 迁移 — 实现计划

> **版本**: v1.0 | **日期**: 2026-05-06
> **依赖文档**: [01-architecture-design.md](01-architecture-design.md) | [02-module-design.md](02-module-design.md)

---

## Phase 0: 准备（估计 0.5h）

### Task 0.1 — 安装 SDK 依赖

```bash
cd bytro-app && pnpm add @agentclientprotocol/sdk
```

**验证**: `node -e "import('@agentclientprotocol/sdk').then(() => console.log('ok'))"` 不报错（SDK 是 ESM 包）

### Task 0.2 — 探索 SDK API

确认以下导出可用：

```
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'

import type {
  InitializeResponse,
  NewSessionResponse,
  LoadSessionResponse,
  PromptResponse,
  SessionNotification,
  RequestPermissionRequest,
  McpServer,
  Client,
  Stream,
} from '@agentclientprotocol/sdk'
```

**验证**: `pnpm run typecheck` 通过（只有 import，没有使用）

### Task 0.3 — 先建立并存开关

**文件**: `src/main/ai/acp/acp-provider.ts`

在改动 provider 调用点之前，先把当前实现移动到旧路径：

```typescript
// 环境变量 BYTRO_ACP_SDK=1 启用新 SDK transport
const USE_SDK = process.env.BYTRO_ACP_SDK === '1'

async startSession(config: SessionConfig): Promise<Session> {
  if (USE_SDK) return this.startSessionWithSdk(config)
  return this.startSessionWithTransport(config)
}
```

初始状态下 `startSessionWithSdk` 可以先抛出明确错误，随后在 Phase 1 填充实现。这样任何时候旧 transport 都保持可编译、可运行。

**验证**: 默认路径 `pnpm run typecheck && pnpm test` 仍走旧 transport；`BYTRO_ACP_SDK=1` 只进入 SDK 分支。

---

## Phase 1: 核心实现（估计 4-6h）

### Task 1.1 — 实现 `AcpClient` 类

**文件**: `src/main/ai/acp/acp-client.ts`（新建，~120 行）

**实现内容**:

1. `NdjsonTransport` 适配器 — Node.js `child.stdin/stdout` → Web Streams → SDK `ndJsonStream`
2. `start()` — spawn 子进程 + SDK `initialize` + Promise.race 启动失败检测
3. 协议方法透传 — `newSession` / `loadSession` / `prompt` / `cancel` / `setModel` / `setMode` / `setConfigOption` / `closeSession`
4. 断线检测 — `connection.signal.addEventListener('abort', ...)`
5. 优雅关闭 — 3 阶段 (`stdin.end` → `SIGTERM` → `SIGKILL`)
6. Session state 缓存 — 从 `NewSessionResponse` / `LoadSessionResponse` / `SetSessionConfigOptionResponse` / `config_option_update` 维护 `currentModels`、`currentModes`、`currentConfigOptions`

**关键实现**:

```typescript
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { Client, Stream, InitializeResponse } from '@agentclientprotocol/sdk'
import { spawn, type ChildProcess } from 'child_process'
import { Readable, Writable } from 'node:stream'

export class AcpClient {
  private _child: ChildProcess | null = null
  private _conn: ClientSideConnection | null = null
  private _initResult: InitializeResponse | null = null
  private _sessionId: string | null = null
  private _stderrBuf = ''
  private _disconnectHandler: ((info: DisconnectInfo) => void) | null = null

  // ...
}
```

**验证**: 
- `pnpm run typecheck`
- 单元测试: `acp-client.test.ts` (Mock SDK + Mock 子进程)

**SDK 方法映射约束**:

| Wrapper | SDK v0.21.0 方法 |
|---------|------------------|
| `setModel(sessionId, modelId)` | `unstable_setSessionModel({ sessionId, modelId })` |
| `setMode(sessionId, modeId)` | `setSessionMode({ sessionId, modeId })` |
| `setConfigOption(sessionId, configId, value)` | `setSessionConfigOption({ sessionId, configId, value })` |

`session/set_config_option` 的字段名是 `configId`，不要沿用旧 transport 的 `optionId`。

### Task 1.2 — 编写 `acp-client.test.ts`

**文件**: `src/main/ai/acp/__tests__/acp-client.test.ts`（新建）

覆盖 Task 1.1 的所有公开方法。使用 vitest mock SDK 的 `ClientSideConnection`。

**关键 mock 策略**:
```typescript
vi.mock('@agentclientprotocol/sdk', () => ({
  ClientSideConnection: vi.fn(),
  ndJsonStream: vi.fn(),
  PROTOCOL_VERSION: 1,
}))
```

**验证**: `pnpm test acp-client`

### Task 1.3 — 简化 `acp-types.ts`

**文件**: `src/main/ai/acp/acp-types.ts`

1. 保留 `JSONRPC_VERSION`、`AcpRequest`、`AcpResponse`、`AcpNotification`、`AcpMessage`，直到 Phase 4 删除旧 transport
2. 保留 `AcpSessionUpdateKind`、`AcpPermissionRequest`、`AcpSessionConfigOption`、`AcpSessionModels`、`AcpSessionModes`、`ACP_METHODS`
3. 添加 SDK 类型重导出: `InitializeResponse`、`NewSessionResponse` 等

**验证**: `pnpm run typecheck`

### Task 1.4 — 重构 `acp-provider.ts`

**文件**: `src/main/ai/acp/acp-provider.ts`

1. `import { AcpClient } from './acp-client'` 替换 `import { AcpTransport } from './acp-transport'`
2. `SessionEntry.transport` → `SessionEntry.client`
3. `createTransport()` → `createClient()`
4. 只实现 `startSessionWithSdk()`；默认 `startSession()` 仍通过 Task 0.3 的开关分流
5. `endSession()` / `sendMessage()` / `abort()` / `getAvailableModels()` / `setModel()` / `getConfigOptions()` / `setConfigOption()` 在内部按 session entry 类型分发到 `AcpTransport` 或 `AcpClient`
6. `updateMetaFromTransport()` → `updateMetaFromClient()`
7. 其他方法（空闲超时、配置持久化、事件映射）保持不变

**验证**: 
- `pnpm run typecheck`
- `pnpm test` (所有已有测试通过)
- `pnpm build`

---

## Phase 2: 兼容验证（估计 1h）

### Task 2.1 — 验证并存开关

**文件**: `src/main/ai/acp/acp-provider.ts`

确认 Task 0.3 的分流在完整 SDK 实现后仍成立：

- 默认：旧 transport 路径，作为生产保护
- `BYTRO_ACP_SDK=1`：新 SDK 路径，作为灰度验证

**验证**: 默认走旧路径，`BYTRO_ACP_SDK=1 pnpm dev` 走新路径；两条路径均通过 `pnpm run typecheck && pnpm test`

### Task 2.2 — 手动验证：单个 ACP 后端

**步骤**:

1. `BYTRO_ACP_SDK=1 pnpm dev`
2. 在 Settings > Providers 中选择一个 ACP 后端（推荐从 `goose-acp` 开始，因为它是 CLI 策略，不需要 npx 下载）
3. 发送消息，验证：
   - [ ] 文本增量 (text_delta) 正常显示
   - [ ] 工具调用 (tool_start / tool_result) 正常显示
   - [ ] 权限请求 (permission_request) 弹出并可以批准/拒绝
   - [ ] 会话完成 (done) 正常触发
   - [ ] 错误消息正确显示
4. 测试第二个后端: `claude-acp` (npx 策略)

**验证**: 所有 AIEvent 类型正确触发

---

## Phase 3: 默认切换（估计 1h）

### Task 3.1 — 默认启用新 SDK

```diff
- const USE_SDK = process.env.BYTRO_ACP_SDK === '1'
+ const USE_SDK = process.env.BYTRO_ACP_LEGACY !== '1'  // 默认走新 SDK
```

### Task 3.2 — 保留 legacy 降级路径

本 Phase **不删除**旧 transport，只把默认路径切到 SDK，并保留 `BYTRO_ACP_LEGACY=1` 降级：

```typescript
const USE_LEGACY = process.env.BYTRO_ACP_LEGACY === '1'

async startSession(config: SessionConfig): Promise<Session> {
  if (USE_LEGACY) return this.startSessionWithTransport(config)
  return this.startSessionWithSdk(config)
}
```

旧 `acp-transport.ts`、旧 wire types、`startSessionWithTransport` 至少保留一个发布周期。

**验证**: `pnpm run typecheck && pnpm test && pnpm build`

### Task 3.3 — 回归测试

在真实应用中测试所有 16 个 ACP 后端至少能启动和发送一条消息。

优先级:
- **P0**: `claude-acp`, `codex-acp`, `goose-acp`, `kimi-acp`
- **P1**: `opencode-acp`, `auggie-acp`, `copilot-acp`, `qwen-acp`
- **P2**: 其余 8 个

**验证**: 每个后端的基本消息流正常

---

## Phase 3.5: UI 集成 — 打通动态模型和配置选项（估计 3-4h）

> 此 Phase 与 Phase 3 独立，可在 SDK transport 稳定后并行执行。
> 核心目标：让 `ModelSelector` 能展示 ACP 的动态模型，用户能切换模型和配置选项。

### Task 3.5.1 — 新增 AIEvent 类型

**文件**: `src/main/ai/types.ts`

```typescript
export interface ConfigOptionUpdateEvent {
  type: 'config_option_update'
  configOptions: ConfigOption[]
}
export interface ModelsUpdateEvent {
  type: 'models_update'
  models: ModelInfo[]
}
// 加入 AIEvent 联合类型
```

**验证**: `pnpm run typecheck`

### Task 3.5.2 — event-mapper 添加映射

**文件**: `src/main/ai/acp/acp-event-mapper.ts`

在 `acpSessionUpdateToEvents` 中为 `config_option_update` 和 `available_commands_update` 添加 case。

同时在 `ACPProvider` 中，`session/new` 成功后可以 emit `models_update` 事件作为增量刷新。但 UI 初始数据不能只依赖这个事件，因为当前 IPC 转发 handler 在 `startSession()` 返回后才注册，start 期间的事件可能被错过。实现必须在拿到持久 session id 后主动调用 `getAvailableModels()` / `getConfigOptions()`。

**验证**: 单元测试覆盖新 case

### Task 3.5.3 — CLIProvider 接口 + AIEngine 添加代理方法

**文件**: `src/main/ai/provider.ts` + `src/main/ai/engine.ts`

1. 在 `CLIProvider` 上补充可选方法：
   ```typescript
   setConfigOption?(sessionId: string, optionId: string, value: string | boolean): Promise<void>
   ```
2. 在 `AIEngine` 新增 `getAvailableModels` / `setModel` / `getConfigOptions` / `setConfigOption` 方法。
3. `setConfigOption` 全链路保留 `string | boolean`，不要把 boolean 强转成字符串。

**验证**: `pnpm run typecheck`

### Task 3.5.4 — IPC 通道 + Preload Bridge

**文件**: `src/main/ipc/chat.ts` + `src/preload/index.ts`

新增 4 个 IPC handler + 4 个 preload 方法。`chat:setConfigOption` 的 value 参数类型为 `string | boolean`：

- IPC handler 校验 `typeof value === 'string' || typeof value === 'boolean'`
- Preload 方法签名为 `setConfigOption(sessionId, optionId, value: string | boolean)`
- 不使用 `String(value)`

**验证**: `pnpm run typecheck`

### Task 3.5.5 — global.d.ts 类型同步

**文件**: `src/renderer/src/types/global.d.ts`

`AIEvent` 联合类型 + `ElectronAPI.chat` 类型同步。

`models_update` / `config_option_update` 的 renderer 类型需要带可选 `sessionId`，`setConfigOption` value 类型为 `string | boolean`。

**验证**: `pnpm run typecheck`

### Task 3.5.6 — chatStore 持久 session id + ModelSelector 改造

**文件**: `src/renderer/src/stores/chatStore.ts` + `src/renderer/src/components/chat/ChatInput.tsx` + `src/renderer/src/components/ModelSelector.tsx`

1. 在 `chatStore` state 中暴露 conversation → provider session 的持久映射和 selector，例如 `getActiveSessionId(conversationId)`。
2. `ChatInput` 使用当前 conversation 的持久 session id 传给 `ModelSelector`，不要使用 turn 结束后会清空的 `streamingRequestId`。
3. `ModelSelector` 接受 `activeSessionId` prop，双来源模型列表，mid-session 切换。
4. `models_update` 监听必须按 `event.sessionId === activeSessionId` 过滤，并把 `activeSessionId` 放进 effect 依赖。
5. 组件 mount / `activeSessionId` 变化时主动调用 `getAvailableModels(activeSessionId)` 作为初始数据来源。

**验证**: 在应用中验证模型列表动态更新

### Task 3.5.7 — ConfigOptions 组件

**文件**: `src/renderer/src/components/ConfigOptions.tsx`（新建）

渲染配置选项（select / boolean / string），按 category 分组，折叠面板。

`boolean` 类型用 checkbox/toggle 渲染并传递 boolean；`select` / `string` 传递 string。组件 mount / `sessionId` 变化时主动调用 `getConfigOptions(sessionId)` 作为初始数据来源，后续可监听 `config_option_update` 进行刷新。

**验证**: 在应用中验证配置选项展示和切换

### Task 3.5.8 — 端到端验证

1. 启动应用，选择 ACP provider
2. 发送消息 → session 创建后 ModelSelector 展示动态模型
3. turn 完成后，ModelSelector 仍持有当前 conversation 的 provider session id
4. 切换模型 → 后续消息使用新模型
5. ConfigOptions 展示模型/模式选项
6. 修改 string/select 配置选项 → 选项生效
7. 修改 boolean 配置选项 → main process 收到 boolean，不是 `'true'` / `'false'`
8. 多会话/切换 conversation 时，`models_update` 不串到非当前 session 的 ModelSelector

**验证**: 完整的 ACP 动态模型 + 配置选项流程

---

## Phase 4: 清理旧 transport（后续发布，估计 1h）

只有在 SDK 默认路径经历至少一个发布周期且没有依赖 `BYTRO_ACP_LEGACY=1` 回滚时执行：

1. 删除 `acp-transport.ts`
2. 删除 `acp-types.ts` 中仅被 transport 使用的类型（`AcpRequest` / `AcpResponse` / `AcpNotification` / `AcpMessage` / `JSONRPC_VERSION`）
3. 删除 `acp-provider.ts` 中旧的 `startSessionWithTransport` 方法和 transport 分支
4. 清理未使用的 import

**验证**: `pnpm run typecheck && pnpm test && pnpm build`

---

## 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| SDK `ndJsonStream` 与 Node.js `Readable.toWeb()` 不兼容 | 中 | 提前验证；备选方案是自己实现 `ReadableStream` 包装 |
| 某些 CLI 后端的 ACP 实现与 SDK 协议版本不匹配 | 中 | 保留 `BYTRO_ACP_LEGACY=1` 降级路径 |
| `session/request_permission` 的 SDK 行为与手搓不同 | 低 | Phase 2 手动测试覆盖 |
| Electron 主进程限制 Web Streams API | 低 | Electron 28+ 支持完整 Web Streams |
| 性能退化（SDK 比手搓慢） | 极低 | JSON-RPC 不是性能瓶颈；SDK 是轻量包装 |

---

## 时间估算

| Phase | 任务 | 估时 |
|-------|------|------|
| 0 | 准备 + 并存开关 | 0.75h |
| 1.1 | 实现 AcpClient | 2h |
| 1.2 | 编写 acp-client 测试 | 1h |
| 1.3 | 简化 acp-types | 0.5h |
| 1.4 | 重构 acp-provider | 1.5h |
| 2.1 | 验证并存开关 | 0.25h |
| 2.2 | 手动验证 | 0.5h |
| 3.1 | 默认切换 | 0.25h |
| 3.2 | 保留 legacy 降级路径 | 0.25h |
| 3.3 | 回归测试 | 1h |
| 3.5.1-3.5.2 | 新增 AIEvent + event-mapper | 0.5h |
| 3.5.3 | CLIProvider 接口 + AIEngine 代理方法 | 0.5h |
| 3.5.4 | IPC + Preload Bridge | 0.5h |
| 3.5.5 | global.d.ts 类型同步 | 0.25h |
| 3.5.6 | chatStore session selector + ModelSelector 改造 | 1h |
| 3.5.7 | ConfigOptions 组件 | 1h |
| 3.5.8 | 端到端验证 | 0.5h |
| 4 | 后续清理旧代码 | 1h |
| **合计（Phase 0-3）** | | **~8h** |
| **合计（Phase 3.5 UI）** | | **~4.25h** |
| **合计（含 UI + 清理）** | | **~13h** |

---

## 成功标准

1. Phase 0-3 后默认走 SDK，`BYTRO_ACP_LEGACY=1` 可降级到旧 transport
2. 新增 `acp-client.ts` (~120 行)
3. 所有现有测试继续通过
4. `pnpm run typecheck && pnpm build` 通过
5. 16 个 ACP 后端中至少 4 个 P0 后端通过手动验证
6. `BYTRO_ACP_LEGACY=1` 降级路径可用
7. **UI 集成**: `ModelSelector` 展示 ACP 动态模型，支持 mid-session 切换
8. **UI 集成**: `ConfigOptions` 组件正确渲染和编辑 ACP 配置选项
9. **UI 集成**: `config_option_update` 和 `models_update` 事件正确推送到 renderer
10. **UI 集成**: turn 完成后仍可通过持久 session id 切换模型/配置
11. **UI 集成**: boolean config option 全链路保持 boolean
12. **UI 集成**: 多 session 下 `models_update` / `config_option_update` 不串 session
