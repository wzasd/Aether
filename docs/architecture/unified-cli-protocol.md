# 统一 CLI 通信层设计

## 背景与问题

Bytro 目前有 5 个 CLI Provider（Claude、Codex、Gemini、Kimi、OpenCode），每个都有：

- 独立的 `OutputParser`（5 套不同的 JSON/文本解析逻辑）
- 各自硬编码的 args 构造方式（`buildStreamJsonArgs` / `buildManualArgs`）
- 各自硬编码的 `ProviderMeta.models` 列表（静态，不能反映 CLI 实际可用模型）
- OpenCode 甚至完全覆盖了 `sendMessage`，因为它的调用方式和其他 CLI 根本不同

**痛点**：每新增一个 CLI，就要实现一套解析器、一套 args 构建逻辑，维护成本随 CLI 数量线性增长。

## 参考：AionUi 的 ACP 方案

[AionUi](https://github.com/iOfficeAI/AionUi) 通过 **ACP（Agent Communication Protocol）** 统一了 17+ CLI 后端：

- **协议**：JSON-RPC 2.0 over stdio
- **实现**：不直接调用 CLI，而是通过 npm bridge 包暴露 ACP 接口（如 `npx @agentclientprotocol/claude-agent-acp`）
- **优点**：`session/new` 响应中自动返回 `models`、`configOptions`、`modes`，无需静态维护

核心消息流：
```
initialize → session/new → session/prompt (streaming) → session/stop
```

## 设计目标

1. **统一解析**：一套 ACP JSON-RPC 协议，取代 5 套 OutputParser
2. **动态模型发现**：从 `session/new` 响应拉取可用模型，不再硬编码
3. **渐进迁移**：ACP 和旧 Provider 并存，不破坏现有会话
4. **向后兼容**：`CLIProvider` 接口保持不变，引擎层无需改动

---

## 架构设计

### 整体层次

```
┌─────────────────────────────────────────────────────┐
│                    Engine / Orchestrator             │
│              (aiEngine, orchestrator.ts)             │
└────────────────────┬────────────────────────────────┘
                     │ CLIProvider interface (不变)
          ┌──────────┴──────────┐
          │                     │
┌─────────▼──────────┐  ┌──────▼────────────────────┐
│  ACPProvider        │  │  BaseCLIProvider (保留)     │
│  (新)               │  │  claude/codex/kimi/...     │
└─────────┬──────────┘  └──────┬────────────────────┘
          │                    │
┌─────────▼──────────┐  ┌──────▼────────────────────┐
│  ACPTransport       │  │  各自的 OutputParser        │
│  JSON-RPC/stdio     │  │  (逐步废弃)                 │
└─────────┬──────────┘  └───────────────────────────┘
          │
  ┌───────▼──────────────────────┐
  │  ACP Bridge / CLI Native ACP │
  │  npx @acp/claude-agent-acp   │
  │  opencode acp                │
  │  npx @zed/codex-acp          │
  └──────────────────────────────┘
```

---

## 核心类型定义

### acp-types.ts（新增）

```typescript
// src/main/ai/acp/acp-types.ts

export interface AcpRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface AcpResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface AcpNotification {
  jsonrpc: '2.0'
  method: string  // no id field — fire-and-forget
  params?: unknown
}

// session/new 响应
export interface AcpSessionInfo {
  sessionId: string
  models: {
    currentModelId: string
    availableModels: Array<{ id: string; name: string; contextWindow?: number }>
  }
  configOptions?: Array<{
    category: string  // 'model' | 'permission' | ...
    type: 'select' | 'boolean' | 'string'
    key: string
    options?: string[]
    default?: unknown
  }>
}

// session/prompt 流式通知
export type AcpStreamEvent =
  | { method: 'session/textDelta'; params: { sessionId: string; delta: string } }
  | { method: 'session/thinkingDelta'; params: { sessionId: string; delta: string } }
  | { method: 'session/toolStart'; params: { sessionId: string; toolCallId: string; toolName: string; input: string } }
  | { method: 'session/toolResult'; params: { sessionId: string; toolCallId: string; success: boolean; result: string } }
  | { method: 'session/permissionRequest'; params: { sessionId: string; confirmId: string; toolName: string; input: string } }
  | { method: 'session/askUser'; params: { sessionId: string; confirmId: string; question: string; options?: string[] } }
  | { method: 'session/complete'; params: { sessionId: string; fullText: string; usage?: unknown } }
  | { method: 'session/done'; params: { sessionId: string } }
  | { method: 'session/error'; params: { sessionId: string; error: string } }
```

### ACPTransport（新增）

```typescript
// src/main/ai/acp/acp-transport.ts

export class ACPTransport {
  private process: ChildProcess
  private pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>()
  private notificationHandler?: (n: AcpNotification) => void
  private nextId = 1
  private buffer = ''

  constructor(binary: string, args: string[], env: Record<string, string>, cwd: string)

  // 发送 JSON-RPC 请求，等待响应
  async request(method: string, params?: unknown): Promise<unknown>

  // 发送通知（fire-and-forget，无 id）
  notify(method: string, params?: unknown): void

  // 注册流式通知回调
  onNotification(handler: (n: AcpNotification) => void): void

  // 关闭进程
  destroy(): void
}
```

核心实现：stdout 按行切割，有 `id` 字段的走 `pending` map 回调，没有 `id` 的走 `notificationHandler`。

---

## ACPProvider 实现

```typescript
// src/main/ai/providers/acp-provider.ts

export interface ACPBackendConfig {
  id: string           // e.g. 'claude-acp'
  name: string         // e.g. 'Claude (ACP)'
  vendor: string
  binary: string       // e.g. 'npx'
  args: string[]       // e.g. ['@agentclientprotocol/claude-agent-acp']
  authEnvKey?: string  // e.g. 'ANTHROPIC_API_KEY'
  secretsKey?: string  // key in Bytro Secrets store
}

export class ACPProvider implements CLIProvider {
  readonly meta: ProviderMeta  // populated after initialize()

  constructor(private readonly backendConfig: ACPBackendConfig) {}

  async initialize(config: ProviderConfig): Promise<void> {
    // 启动 ACP bridge，发送 initialize 请求
    // 解析响应，填充 this.meta.models（动态发现）
  }

  async startSession(config: SessionConfig): Promise<Session> {
    // 建立 ACPTransport
    // 发送 session/new { model, permissionMode, workingDir, sessionId? }
    // 从响应更新可用模型列表（动态）
  }

  sendMessage(sessionId: string, content: string): void {
    // 发送 session/prompt { sessionId, content }
    // 注册 onNotification 把 ACP 流式事件映射到 AIEvent
  }

  respondPermission(sessionId: string, approved: boolean): void {
    // 发送 session/respondPermission { sessionId, approved }
  }

  respondQuestion(sessionId: string, answer: string): void {
    // 发送 session/respondQuestion { sessionId, answer }
  }

  abort(sessionId: string): void {
    // 发送 session/abort { sessionId }
  }

  async endSession(sessionId: string): Promise<void> {
    // 发送 session/end { sessionId }
    // 销毁 transport
  }
}
```

### ACP 通知 → AIEvent 映射表

| ACP method              | AIEvent type          |
|-------------------------|-----------------------|
| session/textDelta       | text_delta            |
| session/thinkingDelta   | thinking_delta        |
| session/toolStart       | tool_start            |
| session/toolResult      | tool_result           |
| session/permissionRequest | permission_request  |
| session/askUser         | ask_user_question     |
| session/complete        | complete              |
| session/done            | done                  |
| session/error           | error                 |

这套映射集中在一个 `acpNotificationToAIEvent()` 纯函数里，可单独测试。

---

## ACP Backend 注册表（完整 17 个）

`src/main/ai/acp/acp-backends.ts` 中注册了全部 AionUi 支持的 ACP 后端：

| ID | 名称 | 厂商 | 策略 | ACP 启动方式 |
|----|------|------|------|-------------|
| claude-acp | Claude Code | Anthropic | npx | `npx @agentclientprotocol/claude-agent-acp@0.29.2` |
| codex-acp | Codex | OpenAI | npx | `npx @zed-industries/codex-acp@0.9.5` (平台特定包) |
| codebuddy-acp | CodeBuddy | Tencent | npx | `npx @tencent-ai/codebuddy-code@2.73.0 --acp` |
| qwen-acp | Qwen Code | Alibaba | npx | `npx @qwen-code/qwen-code --acp` |
| goose-acp | Goose | Block | cli | `goose acp` |
| kimi-acp | Kimi | Moonshot | cli | `kimi acp` |
| opencode-acp | OpenCode | SST | cli | `opencode acp` |
| auggie-acp | Augment Code | Augment | cli | `auggie --acp` |
| copilot-acp | GitHub Copilot | GitHub | cli | `copilot --acp --stdio` |
| droid-acp | Factory Droid | Factory AI | cli | `droid exec --output-format acp` |
| cursor-acp | Cursor Agent | Anysphere | cli | `agent acp` |
| kiro-acp | Kiro | AWS | cli | `kiro-cli acp` |
| hermes-acp | Hermes Agent | Nous Research | cli | `hermes acp` |
| vibe-acp | Mistral Vibe | Mistral | cli | `vibe-acp` |
| qoder-acp | Qoder | Qoder | cli | `qodercli --acp` |
| snow-acp | Snow | Snow AI | cli | `snow --acp` |

**注意**：Gemini 不支持 ACP 协议，仍使用旧 `GeminiCLIProvider`。

---

## 文件结构变化

```
src/main/ai/
├── acp/                          ← 新增目录
│   ├── acp-types.ts              ← ACP 协议类型
│   ├── acp-transport.ts          ← JSON-RPC/stdio 传输层
│   ├── acp-provider.ts           ← 统一 CLIProvider 实现
│   ├── acp-backends.ts           ← Backend 配置注册表
│   └── acp-event-mapper.ts       ← AcpNotification → AIEvent 映射
├── providers/                    ← 保留（渐进废弃）
│   ├── base-cli-provider.ts
│   ├── claude-cli.ts
│   ├── ...
│   └── parsers/
├── provider-registry.ts          ← 同时注册 ACP + 旧 Provider
├── provider.ts                   ← CLIProvider 接口（不变）
└── ...
```

---

## 迁移策略

### Phase 1：并存（当前 → 近期）

- 新增 `src/main/ai/acp/` 目录，实现 `ACPTransport` + `ACPProvider`
- `ProviderRegistry` 同时注册 ACP Provider（`claude-acp`）和旧 Provider（`claude-cli`）
- 用户可在 Settings > Providers 中选择使用哪个
- 新建 AgentProfile 默认使用 ACP 版本

### Phase 2：验证（近期）

- 对 claude-acp 和 claude-cli 做 A/B 对比测试
- 确认所有 AIEvent 类型都能正确触发（permission_request、ask_user_question、tool_start 等）
- 确认动态模型发现正常工作

### Phase 3：切换（稳定后）

- 默认注册 ACP Provider，旧 Provider 移入 `providers/legacy/`
- `ProviderMeta.models` 标记为 `fallback`（ACP 未响应时的兜底）
- 逐步下线 5 套 OutputParser

### Phase 4：清理（最终）

- 删除 `BaseCLIProvider`、5 个旧 Provider 文件、5 套 Parser
- `provider-registry.ts` 只保留 ACP backends

---

## 关键实现细节

### 动态模型发现 vs 静态兜底

```typescript
async initialize(config: ProviderConfig): Promise<void> {
  // 尝试 ACP initialize
  try {
    const info = await this.transport.request('initialize', { version: '1.0' })
    this.meta = buildMetaFromAcpInfo(info as AcpSessionInfo, this.backendConfig)
  } catch {
    // ACP bridge 未安装或不可用 → 降级到静态 meta
    this.meta = buildFallbackMeta(this.backendConfig)
  }
}
```

### npx 首次安装延迟

ACP bridge 首次运行需要 `npx` 下载包（数秒）。策略：
1. `--prefer-offline` 用本地缓存（快）
2. 失败时去掉 `--prefer-offline` 重试（慢但可靠）
3. UI 显示 "正在准备 Claude ACP..." loading 状态

### permissionMode → ACP config 映射

```typescript
function buildAcpSessionParams(config: SessionConfig): Record<string, unknown> {
  return {
    model: config.model,
    workingDir: config.workingDir,
    sessionId: config.sessionId,
    config: {
      permissionMode: config.permissionMode  // ACP 后端自行解释
    }
  }
}
```

ACP 协议定义 permissionMode 的映射，不再是 Bytro 硬编码 CLI flags。

---

## 不改动的部分

- `CLIProvider` 接口 — 完全不变
- `AIEngine` / `Orchestrator` — 完全不变
- `AIEvent` 联合类型 — 完全不变
- IPC 层（`chat.ts`、`orchestrator.ts`）— 完全不变
- Renderer/Zustand stores — 完全不变

**重构仅限 `src/main/ai/providers/` 和新增的 `src/main/ai/acp/`**，引擎以上的层完全无感知。

---

## 实现优先级

| 优先级 | 任务 | 估时 |
|--------|------|------|
| P0 | ACPTransport（JSON-RPC/stdio 核心） | 2h |
| P0 | acpNotificationToAIEvent 映射函数 | 1h |
| P0 | ACPProvider for claude-acp | 2h |
| P1 | ACPProvider for codex-acp, opencode-acp | 2h |
| P1 | 动态模型发现 + UI 接入 | 1h |
| P2 | kimi-acp, gemini-acp | 2h |
| P3 | 旧 Provider 迁入 legacy/ 目录 | 1h |

---

## 问题与风险

| 风险 | 缓解 |
|------|------|
| ACP bridge npm 包不稳定或未发布 | 旧 Provider 作为兜底，Phase 1 并存 |
| `npx` 首次下载慢 | UI loading 状态 + --prefer-offline 缓存 |
| ACP 协议版本差异 | 在 ACPTransport.initialize() 时协商版本 |
| 部分 CLI 无 ACP 支持 | 检测失败时自动降级到旧 Provider |
