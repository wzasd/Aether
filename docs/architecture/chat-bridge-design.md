---
status: proposed
owner: Cindy
last_verified: 2026-05-13
doc_kind: design
applies_to:
  - src/main/chat-bridge/bytro-chat-bridge.ts
  - src/main/chat-bridge/transport.ts
  - src/main/chat-bridge/message-formatter.ts
  - src/main/chat-bridge/dedup-cache.ts
  - src/main/chat-bridge/http-client.ts
  - src/main/daemon/daemon.ts
  - src/main/ai/agent-runtime.ts
  - src/main/core/db.ts
---

# Chat Bridge MCP Sidecar — Detailed Design

本文档是 ADR-015 的详细设计补充，覆盖具体实现细节。所有架构决策已在 ADR-015 中定义，本文档只补充"怎么做"。

## 1. 进程启动与参数

### CLI 参数

```bash
node bytro-chat-bridge.js \
  --agent-profile-id <profileId>    # 必需，agent profile UUID
  --conversation-id <convId>        # 必需，当前 conversation UUID
  --api-url <url>                   # 必需，daemon Bridge API URL（http://127.0.0.1:9123）
  --auth-token <token>              # 必需，per-agent 鉴权 token
  --runtime <runtimeName>           # 可选，provider runtime 名称（用于 observability）
  --launch-id <launchId>            # 可选，启动批次 ID（用于 trace）
```

缺少必需参数时 exit code 1，打印错误信息。

### McpServer 初始化

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'chat',  // 硬编码，和 Slock 对齐
  version: '1.0.0'
})

// 注册所有 P0 tools
registerCoreTools(server, { profileId, conversationId, apiUrl, authToken })

// 启动 stdio transport
const transport = new StdioServerTransport()
await server.connect(transport)
```

### 进程生命周期

| 事件 | Daemon 行为 | Bridge 行为 |
|------|------------|-------------|
| agent 启动 | spawn bridge + 生成 MCP config | 初始化 McpServer + 连接 stdio |
| agent 正常退出 | kill bridge process | stdin 关闭 → 自动退出 |
| agent crash | 检测后 kill bridge + 清理 | stdin 关闭 → 自动退出 |
| bridge crash | 重启 bridge（不影响 agent） | 丢失 LRU 缓存 + 未 ack 的 seq |
| daemon shutdown | kill 所有 bridge 进程 | stdin 关闭 → 自动退出 |

Bridge 没有 graceful shutdown handler。依赖 stdin 关闭触发自动退出，和 Slock 一致。

## 2. Bridge-Daemon 通信方式

### 方案选择：HTTP API（和 Slock 一致）

Bridge 和 daemon 通信使用 **HTTP API**（`http://localhost:<port>/internal/agent/<profileId>/...`），和 Slock 完全一致。

**为什么不用 SQLite 直读 + IPC？**

虽然 bytro 是本地 app、SQLite 在本机，但 HTTP API 有以下优势：
1. **进程隔离**：Bridge 不需要直接访问 SQLite 文件，避免 WAL 锁竞争和崩溃风险
2. **鉴权天然**：每个 bridge 拿到独立的 auth token，daemon 可以验证每个请求的权限
3. **和 Slock 对齐**：减少架构差异，方便后续功能对齐
4. **可测试性**：HTTP API 容易 mock，SQLite 直读需要 mock 整个数据库

**Daemon 内嵌 HTTP Server**：

Daemon 在启动时创建一个轻量 HTTP server（Express/Fastify），监听 `127.0.0.1:9123`（可配置），只接受来自 bridge 的请求。

```ts
// daemon.ts 新增
import Fastify from 'fastify'

const httpServer = Fastify()

// Agent 鉴权中间件
httpServer.addHook('onRequest', async (req, reply) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const agentId = req.params.agentId
  if (!this.validateBridgeToken(agentId, token)) {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

// 注册路由
httpServer.get('/internal/agent/:agentId/receive', async (req) => { ... })
httpServer.post('/internal/agent/:agentId/send', async (req) => { ... })
httpServer.get('/internal/agent/:agentId/history', async (req) => { ... })
httpServer.get('/internal/agent/:agentId/tasks', async (req) => { ... })
httpServer.post('/internal/agent/:agentId/tasks/claim', async (req) => { ... })

await httpServer.listen({ port: 9123, host: '127.0.0.1' })
```

### HTTP API 端点

| 方法 | 路径 | 对应 MCP Tool | 说明 |
|------|------|--------------|------|
| GET | `/internal/agent/:agentId/receive` | check_messages | 拉取未读消息 |
| POST | `/internal/agent/:agentId/send` | send_message | 发送消息 |
| GET | `/internal/agent/:agentId/history` | read_history | 读取历史 |
| GET | `/internal/agent/:agentId/conversations` | list_conversations | 列出会话 |
| GET | `/internal/agent/:agentId/tasks` | list_tasks | 列出任务 |
| POST | `/internal/agent/:agentId/tasks/claim` | claim_task | 认领任务 |
| POST | `/internal/agent/:agentId/tasks/unclaim` | unclaim_task | 取消认领 |
| POST | `/internal/agent/:agentId/tasks/update-status` | update_task_status | 更新任务状态 |
| POST | `/internal/agent/:agentId/receive-ack` | (内部) | 消息确认回执 |

### Bridge HTTP 客户端

```ts
class BridgeHttpClient {
  private baseUrl: string
  private authToken: string

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl
    this.authToken = authToken
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}/internal/agent/${this.agentId}${path}`
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(`HTTP ${response.status}: ${error.error || error.message}`)
    }
    return response.json()
  }
}
```

### Auth Token 生成

Daemon 在 spawn agent 时生成一个 per-agent auth token（UUID v4），存储在内存中：

```ts
// daemon.ts
private bridgeTokens: Map<string, string> = new Map()  // agentId → token

generateBridgeToken(agentId: string): string {
  const token = randomUUID()
  this.bridgeTokens.set(agentId, token)
  return token
}

validateBridgeToken(agentId: string, token: string): boolean {
  return this.bridgeTokens.get(agentId) === token
}
```

Token 通过 bridge CLI 参数 `--auth-token` 传递。

## 3. MCP Tools 详细实现

### P0: send_message

**Zod Schema**:

```ts
const sendMessageSchema = z.object({
  target: z.string().describe('Target: conv:<convId>, dm:<profileId>, conv:<convId>:<msgShortId>'),
  content: z.string().describe('Message content (plain text)'),
  attachment_ids: z.array(z.string()).optional().describe('Attachment IDs from upload_file')
})
```

**实现流程**:

1. 验证 target 格式（conv:xxx / dm:xxx / conv:xxx:msgShortId）
2. 生成 idempotency key（UUID v4）
3. 通过 HTTP API 转发给 daemon（`POST /internal/agent/:agentId/send`）
4. 超时 30 秒，自动重试一次（用同一个 idempotency key）
5. daemon 返回 `{ messageId, seq, recentUnread }`
6. 如果有 recentUnread，acknowledge 并去重
7. 格式化响应文本：
   ```
   Message sent to conv:conv-123 [msg=abc12345]
   To reply in this message's thread, use target "conv:conv-123:abc12345"
   ```

**幂等性**：和 Slock 一致，用 idempotency key 防止重复发送。daemon 端在 messages 表检查 idempotency_key 列（新增）。

### P0: check_messages

**Zod Schema**:

```ts
const checkMessagesSchema = z.object({})
```

**实现流程**:

1. 通过 HTTP API 从 daemon 获取新消息（`GET /internal/agent/:agentId/receive`）
2. 通过 LRU 缓存去重（`deliveredMessageKeys`，5000 条）
3. 格式化每条消息：
   ```
   [target=conv:conv-123 msg=abc12345 time=2026-05-13 22:55 type=human] @tomek-rumore: 消息内容
   ```
4. 通过 HTTP API 发送 ack（`POST /internal/agent/:agentId/receive-ack`，`{ lastSeenSeq }`）
5. 返回格式化文本

**ack 机制**：fire-and-forget。ack 失败只打 warn 日志，不阻塞消息投递。下次 poll 会重新投递未 ack 的消息。

### P0: read_history

**Zod Schema**:

```ts
const readHistorySchema = z.object({
  target: z.string().describe('Target: conv:<convId>'),
  limit: z.number().default(50).describe('Max messages to return'),
  before: z.string().optional().describe('Message ID to read before'),
  after: z.string().optional().describe('Message ID to read after'),
  around: z.string().optional().describe('Message ID to read around')
})
```

**实现流程**:

1. 通过 HTTP API 从 daemon 获取历史消息（`GET /internal/agent/:agentId/history`）
2. 应用 pagination（before/after/around/limit，daemon 端处理）
3. 格式化每条消息（和 Slock 一致的格式）：
   ```
   [seq=3515632 msg=b1e152d8 time=2026-05-13 11:01:29 type=agent] @架构设计: 消息内容
   ```
4. 返回格式化文本 + pagination hints

**格式化细节**：

```ts
function formatHistoryMessageLine(m: MessageRow): string {
  const parts = [
    `[seq=${m.seq} msg=${m.id.slice(0, 8)} time=${formatLocalTime(m.created_at)} type=${m.role}]`,
    `@${m.sender_name}:`,
    m.content
  ]
  if (m.task_number) {
    parts.push(`[task #${m.task_number} status=${m.task_status}]`)
  }
  return parts.join(' ')
}
```

### P0: list_conversations

**Zod Schema**:

```ts
const listConversationsSchema = z.object({})
```

**实现流程**:

1. 通过 HTTP API 从 daemon 获取会话列表（`GET /internal/agent/:agentId/conversations`）
2. 返回活跃会话列表：
   ```
   conv:conv-123 — "项目讨论" (3 agents, 1 human)
   conv:conv-456 — "代码 review" (2 agents, 1 human)
   ```

## 4. 消息去重机制

### LRU 缓存

```ts
class DeliveredMessageCache {
  private keys: Map<string, number> = new Map()  // key → insertion order
  private order: string[] = []                    // insertion order tracking
  private maxSize = 5000

  has(key: string): boolean {
    return this.keys.has(key)
  }

  add(key: string): void {
    if (this.keys.has(key)) return
    if (this.order.length >= this.maxSize) {
      const oldest = this.order.shift()!
      this.keys.delete(oldest)
    }
    this.keys.set(key, this.order.length)
    this.order.push(key)
  }
}

// key 格式：seq:${seq} 或 msg:${messageId.slice(0, 8)}
```

和 Slock 一致的 5000 条 LRU 缓存，防止 `check_messages` 和 `send_message` 返回的 missed messages 重复显示。

### Ack 回执

```ts
async function acknowledgeReceivedMessages(seqs: number[]): Promise<void> {
  try {
    await httpClient.post(`/internal/agent/${profileId}/receive-ack`, {
      conversationId,
      seqs
    })
  } catch (e) {
    // fire-and-forget，失败只打 warn
    logger.warn(`receive-ack failed for agent ${profileId}; delivery will replay on next poll`)
  }
}
```

## 5. Target 格式与 Conversation 映射

### Target 格式

| 类型 | 格式 | 示例 | 说明 |
|------|------|------|------|
| Conversation | `conv:<convId>` | `conv:conv-123` | 多 agent 对话 |
| DM | `dm:<profileId>` | `dm:profile-1` | agent 间直接通信（新增） |
| Thread | `conv:<convId>:<msgShortId>` | `conv:conv-123:abc12345` | 消息线程（新增） |

### 解析逻辑

```ts
function parseTarget(target: string): { type: 'conv' | 'dm' | 'thread', id: string, threadId?: string } {
  if (target.startsWith('conv:')) {
    const parts = target.split(':')
    if (parts.length === 3) {
      return { type: 'thread', id: parts[1], threadId: parts[2] }
    }
    return { type: 'conv', id: parts[1] }
  }
  if (target.startsWith('dm:')) {
    return { type: 'dm', id: parts[1] }
  }
  throw new Error(`Invalid target format: ${target}`)
}
```

### 和 Slock 的对照

| Slock | bytro | 说明 |
|-------|-------|------|
| `#general` | `conv:conv-123` | 多人协作上下文 |
| `dm:@alice` | `dm:profile-1` | 一对一通信 |
| `#general:shortid` | `conv:conv-123:msgShortId` | 消息线程 |

bytro 用 `conv:` / `dm:` 前缀代替 Slock 的 `#` / `dm:@` 前缀，因为 bytro 的 ID 是 UUID 而不是人类可读名称。

## 6. Daemon Spawn 改造

### 职责划分

| 职责 | Daemon | Provider CLI |
|------|--------|-------------|
| Bridge API Server | ✅ 启动 HTTP :0，签发 auth-token | — |
| MCP config 生成 | ✅ 写入临时 mcp-config.json（含 bridge command/args + api-url + auth-token） | — |
| Bridge 进程 spawn | — | ✅ MCP SDK 根据 mcp-config.json 自动 spawn bridge |
| Bridge 生命周期 | 监控 bridge 健康（通过 API heartbeat） | 管理 bridge 进程（dispose 时 kill） |
| Bridge crash recovery | 检测到 bridge 无响应 → 通知 agent runtime 降级 | MCP SDK 自动重启 bridge |

### Spawn 流程

```
Daemon.start()
  → 启动 Bridge API Server (HTTP :0，随机端口)
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

### Daemon generateBridgeConfig

```ts
// daemon.ts 新增
private bridgeTokens: Map<string, string> = new Map()  // agentId → token

generateBridgeConfig(profileId: string, conversationId: string): BridgeConfig {
  // 1. 签发 per-agent auth token
  const authToken = randomUUID()
  this.bridgeTokens.set(profileId, authToken)

  // 2. 构建 MCP config JSON
  const config = {
    mcpServers: {
      chat: {
        command: 'node',
        args: [
          path.join(__dirname, 'chat-bridge/bytro-chat-bridge.js'),
          '--agent-profile-id', profileId,
          '--conversation-id', conversationId,
          '--api-url', `http://127.0.0.1:${this.httpServerPort}`,
          '--auth-token', authToken
        ]
      }
    }
  }

  // 3. 写入临时文件（权限 0o600）
  const configPath = path.join(os.tmpdir(), `bytro-mcp-${profileId}.json`)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })

  return {
    configPath,
    apiUrl: `http://127.0.0.1:${this.httpServerPort}`,
    authToken
  }
}

validateBridgeToken(agentId: string, token: string): boolean {
  return this.bridgeTokens.get(agentId) === token
}
```

### Bridge 生命周期

| 事件 | Daemon 行为 | Provider/bridge 行为 |
|------|------------|---------------------|
| agent 启动 | generateBridgeConfig → 传给 provider | Provider spawn agent CLI → MCP SDK spawn bridge |
| agent 正常退出 | 清理 token + config 文件 | Provider kill bridge → bridge stdin 关闭 → 自动退出 |
| agent crash | 检测后清理 token + config | bridge stdin 关闭 → 自动退出 |
| bridge crash | 检测到 API 无响应 → EventBus `bridge:crashed` | MCP SDK 可能自动重启 bridge |
| daemon shutdown | 清理所有 token + config 文件 | bridge stdin 关闭 → 自动退出 |

**Bridge crash recovery**：daemon 通过 HTTP API heartbeat 检测 bridge 健康：
1. 定期 `GET /internal/agent/:agentId/health`（bridge 端实现 health endpoint）
2. 连续 N 次无响应 → 发布 EventBus `bridge:crashed`
3. AgentRuntime 收到事件后降级到 orchestrator 推送模式

## 7. 错误处理

### 三层错误处理（和 Slock 一致）

1. **HTTP 层**：超时 30 秒，自动重试一次（仅 send_message）
2. **Daemon 层**：检查 HTTP response 的 `success` 字段，提取 `error` 信息
3. **Bridge 层**：try/catch 包裹所有 tool handler，返回 `{ isError: true, content: [{ type: 'text', text: 'Error: ...' }] }`

### 错误响应格式

```ts
function formatError(error: string): McpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${error}` }]
  }
}
```

### 特殊错误场景

| 场景 | 处理 |
|------|------|
| daemon API 不可达 | 返回 `Error: Daemon API connection failed` |
| agentProfileId 权限不足 | 返回 `Error: Agent not authorized for this conversation` |
| target 格式无效 | 返回 `Error: Invalid target format. Use conv:<id>, dm:<id>, or conv:<id>:<msgShortId>` |
| idempotency key 重复 | daemon 返回已存在的 messageId，bridge 格式化为 "Message already sent" |
| daemon API 500 | 返回 `Error: Internal server error` |

## 8. "chat" Namespace 保护

### MCP Config 生成时的保护

```ts
function buildMcpConfig(userServers: Record<string, McpServerConfig>, bridgeConfig: McpServerConfig): object {
  // 检查用户是否定义了 "chat" server
  if (userServers['chat']) {
    logger.warn(`User MCP server "chat" is reserved by bytro and will be overwritten`)
  }

  // "chat" key 最后写入，覆盖用户同名定义（和 Slock 一致）
  return {
    mcpServers: {
      ...userServers,   // 用户自定义 server 先展开
      chat: bridgeConfig  // "chat" 最后写入，覆盖同名
    }
  }
}
```

### mcp_servers 表的保护

```ts
// mcp.ts IPC handler — 新增检查
ipcMain.handle('mcp:add', async (event, serverConfig) => {
  if (serverConfig.name === 'chat') {
    return { ok: false, code: 'RESERVED_NAME', message: 'The name "chat" is reserved by bytro for the communication bridge MCP server' }
  }
  // ... 正常添加逻辑
})
```

## 9. 和 Slock 的差异点

| 方面 | Slock | bytro | 原因 |
|------|-------|-------|------|
| Bridge-Daemon 通信 | HTTP API | HTTP API（和 Slock 一致） | 统一通信路径，鉴权天然，可测试性好 |
| Bridge spawn | Provider CLI spawn（通过 MCP config） | Provider CLI spawn（和 Slock 一致） | MCP SDK 自动建立 stdio 管道 |
| Target 格式 | `#general` / `dm:@alice` | `conv:convId` / `dm:profileId` | bytro 的 ID 是 UUID，不是人类可读名称 |
| Auth token | Bearer token（daemonApiKey） | Bearer token（per-agent UUID） | bytro 用 UUID token，Slock 用 daemonApiKey |
| 响应格式 | prose（和 Slock 一致） | prose（和 Slock 一致） | LLM 需要人类可读文本 |
| 消息去重 | LRU 5000 + ack | LRU 5000 + ack（和 Slock 一致） | 防止重复投递 |
| send_message 幂等 | idempotency key + retry | idempotency key + retry（和 Slock 一致） | 防止网络抖动重复发送 |
| Namespace 保护 | `--strict-mcp-config` + 覆盖写入 | 覆盖写入 + mcp:add 拒绝 | bytro 没有 strict-mcp-config，用表级拒绝 |
| HTTP 端口 | `localhost:3001`（固定） | `localhost:0`（随机端口） | bytro 用随机端口避免多实例冲突 |

## 10. 数据库变更

### messages 表新增列

```sql
-- idempotency_key 列（send_message 幂等性）
ALTER TABLE messages ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_messages_idempotency
  ON messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

### agent_task_queue 表新增列

```sql
-- task_number 列（对齐 Slock 的 task 编号）
ALTER TABLE agent_task_queue ADD COLUMN task_number INTEGER;
-- conversation 内自增序列，从 1 开始
```

### conversations 表新增列

```sql
-- last_seq 列（消息确认机制）
ALTER TABLE conversations ADD COLUMN last_seq INTEGER DEFAULT 0;
```

## 11. 文件结构

```
src/main/chat-bridge/
  ├── bytro-chat-bridge.ts       # 主入口，McpServer + CLI args + tool 注册
  ├── http-client.ts             # HTTP 客户端（和 daemon API 通信）
  ├── message-formatter.ts       # 消息格式化（prose 格式）
  ├── dedup-cache.ts             # LRU 去重缓存
  ├── target-parser.ts           # Target 格式解析
  ├── schemas.ts                 # Zod schemas（所有 MCP tools）
  └── logger.ts                  # Bridge 专用日志

src/main/daemon/
  ├── daemon.ts                  # 新增：Fastify HTTP server + bridge spawn + MCP config 生成
  ├── agent-runtime.ts           # 改造：spawn 时传入 MCP config
  └── bridge-api.ts              # 新增：HTTP API 路由定义（/internal/agent/:agentId/...）
```

## 12. 测试策略

### 单元测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `bytro-chat-bridge.test.ts` | CLI args 解析、McpServer 初始化、tool 注册 |
| `transport.test.ts` | HTTP 客户端：连接、超时、重试、错误处理 |
| `message-formatter.test.ts` | 消息格式化：prose 格式、task suffix、pagination hints |
| `dedup-cache.test.ts` | LRU 缓存：add、has、eviction、容量限制 |
| `target-parser.test.ts` | Target 解析：conv/dm/thread 格式、错误格式 |
| `schemas.test.ts` | Zod schema 验证：有效/无效参数 |

### 集成测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `chat-bridge-integration.test.ts` | Bridge + daemon HTTP API 全流程：send_message → read_history → check_messages |
| `daemon-spawn-bridge.test.ts` | Daemon spawn 改造：MCP config 生成、bridge 生命周期 |

### 覆盖率目标

- 单元测试覆盖率 ≥ 80%
- 集成测试覆盖核心通信流程（send → read → check → ack）

## Related

- ADR-015: Chat Bridge MCP Sidecar — 架构决策
- ADR-015 C4 Model — 架构图
- Slock chat-bridge 源码 — `@slock-ai/daemon` npm 包
- Action Card Design — `docs/architecture/action-card-design.md`