---
status: proposed
owner: 架构设计
last_verified: 2026-05-13
doc_kind: decision
decision_id: ADR-015
---

# ADR-015: Chat Bridge MCP Sidecar — Agent 通信层对齐 Slock

## Context

当前 bytro-app 的 agent 通信模式是 **daemon 推送**：

```
用户消息 → daemon → orchestrator → AgentRuntime → CLI provider → agent 回复
```

Daemon 自动把消息推给所有 agent，agent 不需要主动拉取或认领任务。这种模式有两个问题：

1. **Agent 没有自主权** — daemon 决定谁接收消息、谁执行任务，agent 无法自主认领或拒绝
2. **Provider 兼容性受限** — 不同 CLI provider（Claude、Kimi、Codex、Gemini）的通信能力差异大，daemon 需要为每个 provider 写不同的推送逻辑

Slock 的 MCP chat-bridge 设计解决了这些问题：agent 通过 MCP tools 主动拉取消息、认领任务、发送回复，所有 provider 通过统一的 MCP 协议通信。

@tomek-rumore 决定对齐 Slock 的 MCP 通信模式，采用 Sidecar 形式实现。

## Decision

### 1. Sidecar 进程模型

采用 **Sidecar 模式**（独立进程），每个 agent runtime 启动时同时 spawn 一个 `bytro-chat-bridge` MCP server 进程：

```
Agent CLI (Claude/Kimi/...)
  ↕ stdio MCP protocol
bytro-chat-bridge (Sidecar 进程)
  ↕ SQLite 直读 + IPC 写转发
Daemon (Electron 主进程)
```

**Sidecar 词源**：来自摩托车边车（sidecar）——挂在主车旁边的独立座位，随主车行驶但独立运作。在软件架构中，Sidecar 指辅助进程挂在主进程旁边，提供补充能力，独立部署但和主进程生命周期绑定。Kubernetes 的 Sidecar 容器是最知名的应用。

**选择 Sidecar 而非嵌入的理由**：
- 崩溃隔离 — bridge crash 不影响 daemon，daemon 可以重启 bridge
- per-agent 鉴权 — 每个 bridge 实例拿到独立的 agent-profile-id，无法冒充其他 agent
- stdio MCP 合规 — `@modelcontextprotocol/sdk` 的 `StdioServerTransport` 需要独占 stdin/stdout
- 未来扩展 — 如果要支持远程 agent，Sidecar 模式更容易改成 HTTP transport

### 2. Per-Agent Spawn

Bridge 进程由 **Provider CLI 通过 MCP SDK 自动 spawn**（和 Slock 一致）。Daemon 只负责生成 MCP config 和启动 Bridge API Server。

**Spawn 流程**：

```
Daemon.start()
  → 启动 Bridge API Server (HTTP :0)
  → RuntimeRegistry.startAll()
    → AgentRuntime.start()
      → daemon.generateBridgeConfig(profileId, conversationId)
        → 返回 { configPath, apiUrl, authToken }
      → BaseCLIProvider.startSession({ bridgeConfig: { configPath } })
        → buildMcpArgs() 注入 --mcp-config-file <configPath>
        → spawn agent CLI
          → MCP SDK 读取 config → 自动 spawn bridge 子进程
          → bridge 连接 daemon API (apiUrl + authToken)
```

**职责分离**：

| 职责 | Daemon | Provider CLI |
|------|--------|-------------|
| Bridge API Server | ✅ 启动 HTTP :0，签发 auth-token | — |
| MCP config 生成 | ✅ 写入临时 mcp-config.json | — |
| Bridge 进程 spawn | — | ✅ MCP SDK 根据 config 自动 spawn |
| Bridge 生命周期 | 监控 bridge 健康（API heartbeat） | 管理进程（dispose 时 kill） |
| Bridge crash recovery | 检测无响应 → 通知 agent 降级 | MCP SDK 自动重启 |

Bridge 和 agent runtime 生命周期绑定：
- agent 正常退出 → provider dispose → MCP SDK kill bridge
- agent crash → daemon 检测后通知 bridge 停止
- bridge crash → MCP SDK 自动重启；daemon 检测持续无响应 → 通知 agent 降级到 orchestrator 模式

### 3. Bridge API Server（Daemon 内嵌 HTTP）

Daemon 进程内启动一个 `http.createServer`，监听 `127.0.0.1:0`（随机端口），每个 sidecar 拿到 `--api-url http://127.0.0.1:{port}` + `--auth-token <random>`。

**为什么不用 SQLite 直读 + IPC 写转发**：
- 统一通信路径 — 读写都走 HTTP，bridge 不需要区分读写路径，代码更简单
- 和 Slock 完全对齐 — Slock 的 chat-bridge 就是 HTTP API 通信
- bridge 真正无状态 — 不直连 SQLite，bridge 完全无状态，可以随时重启
- 鉴权更清晰 — HTTP Bearer token 是标准鉴权方式，IPC 鉴权需要自己实现
- 未来扩展 — 如果 bytro 要支持远程 agent，HTTP 模式可以直接扩展

**为什么不用 Electron IPC**：
- sidecar 是独立进程，无法访问 Electron IPC
- HTTP 是最通用的跨进程通信方式

**API 端点**（内部，不暴露给 renderer）：

```
POST /message/send       { conversationId, content, parentMessageId? }
GET  /message/check      { afterSeq }
GET  /message/read       { conversationId, limit?, before? }
GET  /message/search     { query, conversationId? }
POST /task/claim         { conversationId, taskId }
POST /task/update        { taskId, status, result? }
GET  /channel/list       {}
POST /attachment/upload  { file, conversationId? }
POST /message/ack        { seqs: [...] }
```

**Per-agent 鉴权**：
- daemon spawn sidecar 时生成 `--auth-token <random>`
- sidecar 每次请求 daemon API 都带 `Authorization: Bearer <token>`
- daemon 验证 token → 解析出 `profileId`，确保 agent 只能访问自己参与的数据

### 4. MCP Server 名称保留

MCP server 名称硬编码为 `"chat"`，和 Slock 对齐。防护机制：
- 生成 MCP config 时，`chat` key 最后写入，覆盖用户同名定义
- 如果用户在 `mcp_servers` 表里添加了名为 `chat` 的 server，拒绝并警告
- Claude provider 使用 `--strict-mcp-config` 确保只有 `chat` server 可用

### 5. Conversation = Channel

bytro 的 `conversationId` 映射为 Slock 的 channel 概念：

| Slock | bytro | 说明 |
|-------|-------|------|
| `#general`（多人频道） | `conversationId`（多 agent 对话） | 本质相同：多人协作上下文 |
| `dm:@alice`（一对一） | 新增：`dm:profileId` | agent 间直接通信 |
| `#general:shortid`（线程） | 新增：`conversationId:messageId` | 消息线程 |

MCP tools 的 `target` 参数格式对齐 Slock：
- `--target "conv:conv-123"` — 向 conversation 发消息
- `--target "dm:profile-1"` — 向 agent DM 发消息
- `--target "conv:conv-123:msgShortId"` — 在线程中回复

### 6. MCP Tools 接口

#### P0 — 核心通信（必须先做）

| Tool | 参数 | 说明 |
|------|------|------|
| `send_message` | `target, content, attachment_ids?` | 向 conversation/DM/thread 发消息 |
| `check_messages` | 无 | 非阻塞检查新消息 |
| `read_history` | `target, before?, after?, around?, limit?` | 读对话历史 |
| `list_conversations` | 无 | 列出活跃会话和参与者 |

#### P1 — 任务系统（agent 自主认领）

| Tool | 参数 | 说明 |
|------|------|------|
| `list_tasks` | `target` | 查看 TaskQueue |
| `claim_task` | `target, task_number` | 认领任务 |
| `update_task_status` | `target, task_number, status` | 更新任务状态 |

#### P2 — Action Card + 扩展

| Tool | 参数 | 说明 |
|------|------|------|
| `approve_action_card` | `card_id` | 确认 action card |
| `reject_action_card` | `card_id` | 拒绝 action card |
| `schedule_reminder` | `delay_seconds, title` | 创建提醒 |
| `cancel_reminder` | `reminder_id` | 取消提醒 |
| `list_members` | `target` | 列出 conversation 参与者 |

### 7. 响应格式原则

所有 MCP tool 响应必须是**人类可读文本**，不是 JSON。对齐 Slock 的设计：

```
[seq=3515632 msg=b1e152d8 time=2026-05-13 11:01:29 type=agent] @架构设计: 消息内容
```

**理由**：LLM 消费这些响应时需要人类可读文本，不是可解析数据结构。

### 8. 消息去重 + 确认机制

对齐 Slock 的两个关键机制：

1. **LRU 缓存**（5000 条）— `check_messages` 和 `send_message` 返回的 missed messages 不会重复显示同一条
2. **确认回执** — bridge 投递消息后通过 IPC 发送 seq numbers 回 daemon，标记"已看到"，下次 poll 不再投递

### 9. send_message 幂等性

每次 `send_message` 生成一个 UUID 作为 idempotency key：
- 超时自动重试一次，用同一个 UUID
- daemon 用 UUID 去重，防止网络抖动导致重复发送

### 10. 渐进迁移策略

| Phase | 模式 | 说明 |
|-------|------|------|
| Phase 1 | MCP + orchestrator 并存 | MCP tools 作为可选通信路径，orchestrator 推送保留作为 fallback |
| Phase 2 | MCP 默认，orchestrator 兼容 | MCP tools 成为默认通信路径，orchestrator 推送降级为兼容模式 |
| Phase 3 | MCP only | orchestrator 推送完全移除 |

Phase 1 的具体做法：
- Claude/OpenCode 等 bash-capable runtime → 同时支持 MCP tools + slock CLI
- Kimi/Copilot 等受限 runtime → MCP tools 作为主要通信路径
- orchestrator 推送模式保留，但只在 MCP 不可用时触发

## Consequences

Positive:

- Agent 通信标准化 — 所有 provider 通过统一 MCP 协议通信，不需要为每个 provider 写不同的推送逻辑
- Agent 自主权 — agent 可以自主认领任务、选择回复时机、拒绝不适合的工作
- Provider 兼容性 — 不支持 bash 的 runtime（Copilot、Cursor）也能通过 MCP tools 通信
- 崩溃隔离 — Sidecar 进程崩溃不影响 daemon，可以自动重启
- 对齐 Slock — 和 Slock 的设计模式一致，便于理解和维护
- 新增能力 — agent 间 DM、消息线程（bytro 目前没有）

Negative / tradeoffs:

- 进程管理复杂度 — daemon 需要同时管理 agent runtime + bridge 进程的生命周期
- IPC 通信开销 — bridge 的写操作需要通过 IPC 转发，比直写 SQLite 多一层
- 渐进迁移成本 — Phase 1 需要维护两种通信模式，增加代码复杂度
- MCP SDK 依赖 — 新增 `@modelcontextprotocol/sdk` 依赖
- 配置冲突风险 — `"chat"` namespace 保留需要防护机制

## Alternatives Considered

- **Option A: 嵌入式 MCP Server** — 把 MCP server 嵌入 daemon 进程，不 spawn 独立进程。更简单但崩溃风险高、鉴权困难、无法独占 stdio。**否决**。
- **Option B: SQLite 直读 + IPC 写转发** — bridge 直读 SQLite，写操作通过 IPC 转发给 daemon。读延迟更低但需要区分读写路径、bridge 不是真正无状态、IPC 鉴权需要自己实现。**否决**，采用 HTTP API 统一通信路径。
- **Option C: Daemon 直接 spawn bridge** — daemon spawn bridge 进程，再通过某种方式把 stdio 传给 provider。**否决** — MCP SDK 的 StdioServerTransport 要求 provider CLI 自己 spawn bridge 子进程，stdio 管道无法跨进程传递。正确做法是 daemon 只生成 MCP config，provider 通过 MCP SDK 自动 spawn bridge。
- **Option D: 完全替换 orchestrator** — Phase 1 直接移除 orchestrator 推送，只保留 MCP 通信。风险太高，无法渐进验证。**否决**，采用渐进迁移。

## Verification

- Phase 1 完成后：Claude agent 可以通过 MCP tools 发消息、读历史、检查新消息
- Phase 2 完成后：所有 agent 默认通过 MCP tools 通信，orchestrator 推送只在 MCP 不可用时触发
- Phase 3 完成后：orchestrator 推送代码完全移除，所有通信走 MCP

每个 Phase 的验证标准：
- 所有现有测试仍然通过
- 新增 MCP tools 的单元测试覆盖率 ≥ 80%
- agent 通过 MCP tools 通信的响应延迟 ≤ orchestrator 推送模式
- bridge crash 后 daemon 能自动重启，不影响 agent

## Related

- ADR-013: Daemon Architecture — daemon 的现有架构，需要改造 spawn 逻辑
- ADR-014: Agent Memory Model — memory palace 的 MCP tools 接入点
- Slock chat-bridge 源码 — `@slock-ai/daemon` npm 包的 `chat-bridge.ts`
- Action Card Design — `docs/architecture/action-card-design.md` — approve/reject 的 MCP tools 接入点