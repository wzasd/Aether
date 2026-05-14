---
status: active
owner: bytro
last_verified: 2026-05-13
doc_kind: architecture
applies_to:
  - src/main/action-cards/action-types.ts
  - src/main/action-cards/executor-registry.ts
  - src/main/action-cards/action-card-service.ts
  - src/main/ipc/action-card.ts
  - src/main/core/db.ts
  - src/main/ai/a2a-memory-distiller.ts
  - src/renderer/src/stores/actionCardStore.ts
---

# Action Card Design

Action Card 是 Bytro 的**人类确认层**——Agent 可以 propose 有副作用的操作，但只有人类 commit 后 mutation 才真正执行。它是旁路控制面，不阻塞 Agent 执行链路。

## 核心问题

多 Agent 协作中，Agent 会产生三类有副作用的操作：

1. **记忆变更** — distiller 提取的 draft 记忆不应自动注入 agent context
2. **配置变更** — provider/runtime 配置修改影响全局行为
3. **Agent 创建** — 新 Agent 的权限边界和 runtime 配置需要人类把关

这些操作如果自动执行，会污染项目长期上下文、引入安全风险、或产生不可逆变更。Action Card 让 Agent 可以 propose，人类异步确认后才执行。

## Non-Negotiable Constraints

以下约束是 MUST，不是建议，直接影响 schema 和 executor registry 设计：

1. **Reject MUST transition target domain object out of pending review state.**
   `memory:activate` 被 reject 时，对应 `project_memory_items.status` 必须从 `draft` 改为 `rejected` 或 `archived`，否则 draft inbox 会永远挂着。

2. **Approve MUST be represented by audit fields/events, not a durable intermediate status.**
   持久状态只有 `pending → executing → executed/failed` 和旁路终态 `rejected/expired`。批准动作写 `approved_by_user_id` + `approved_at`，是审计事件而非状态停留。

3. **Execute MUST be idempotent and transaction-safe; cross-process operations MUST use `operation_id`.**
   SQLite 单写者下 CAS + domain ops + result/event 写入在同一个 transaction 内完成。跨进程 executor 用 `operation_id` 做幂等键。

4. **Agent creation MUST use an existing approved profile or create disabled until human completes runtime/model/computer.**
   `agent:create` Action Card 的 `profileId` 必须来自现有 profile 白名单。如果创建新 profile，默认 `enabled=false`，用户二次确认后才能启用。

5. **Deduplication MUST use explicit `dedupe_key`, not JSON payload expression indexes.**
   每个 action type 的 registry 自己生成 `dedupe_key`，DB 不需要理解 payload shape。

6. **Distiller MUST depend on ActionCardService interface, not IPC/UI layer.**
   `a2a-memory-distiller.ts` 只知道"draft memory 需要创建确认卡"，不知道卡片 UI 怎么渲染、IPC 怎么暴露。测试时 mock `ActionCardService`，断言 draft category 会创建 card，active category 不创建。

7. **Validation failed MUST transition to `expired`; transient failed MUST allow retry on the same card without creating a new one.**
   不允许为已 failed 的 card 生成新 dedupe_key 相同的 card。transient failed 通过 `action-card:execute` IPC 手动重试原卡。

## 副作用分级模型

| 级别 | 副作用 | 可逆性 | 影响范围 | 处理方式 |
|---|---|---|---|---|
| Level 0 | 只读/分析 | 无副作用 | 单次对话 | Agent 直接执行 |
| Level 1 | 工作区变更 | 可逆（git revert） | 单文件 | Agent 执行，人类事后 review |
| Level 2 | 配置/记忆变更 | 部分可逆 | 项目级 | Action Card，人类确认后执行 |
| Level 3 | Agent/系统变更 | 不可逆 | 全局 | Action Card + 多人确认 |

Phase 2 先做 Level 2（draft memory 确认 + provider 配置变更），Phase 3 再扩展 Level 3。

## 数据模型

```sql
CREATE TABLE action_cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  description TEXT,
  payload_json TEXT NOT NULL,
  draft_hint TEXT,
  dedupe_key TEXT NOT NULL,
  operation_id TEXT,
  created_by_agent_id TEXT,
  approved_by_user_id TEXT,
  approved_at INTEGER,
  result_json TEXT,
  error TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_action_cards_dedupe
  ON action_cards (workspace_id, type, dedupe_key)
  WHERE status IN ('pending', 'executing');
```

`operation_id` nullable — PR-4 不使用跨进程 executor，字段预留避免 PR-6 再改表。跨进程 executor 用 `operation_id` 做幂等键：同一个 `operation_id` 已执行过时 executor 必须返回 existing result，不重复执行。

状态机：

```
pending → executing → executed
pending → executing → failed（transient，可手动重试）
failed  → executing → executed/failed   -- manual retry same card (CAS)
pending → rejected（旁路终态）
pending → expired（旁路终态，daemon 定期清理）
failed  → expired（validation failure after retry/revalidate）
```

`action-card:execute` IPC 对 failed card 走 CAS `failed → executing`，和 pending card 的 `pending → executing` 共用同一个 executor 流程。

`approved_by_user_id` + `approved_at` 是审计字段，不是状态停留。

## Action Type Registry

使用 Zod discriminatedUnion 做 payload 验证：

```ts
const memoryActivateSchema = z.object({
  type: z.literal('memory:activate'),
  memoryItemId: z.string().uuid(),
})

const memoryBulkActivateSchema = z.object({
  type: z.literal('memory:bulk_activate'),
  memoryItemIds: z.array(z.string().uuid()).min(1).max(50),
})

const providerConfigUpdateSchema = z.object({
  type: z.literal('provider_config:update'),
  providerId: z.string(),
  patch: z.object({
    modelOverride: z.string().optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
    maxTokens: z.number().int().min(1024).max(200000).optional(),
  }).strict(),
})

const agentCreateSchema = z.object({
  type: z.literal('agent:create'),
  name: z.string().min(1).max(80),
  rolePrompt: z.string().max(2000),
  profileId: z.string(),
})

export const actionPayloadSchema = z.discriminatedUnion('type', [
  memoryActivateSchema,
  memoryBulkActivateSchema,
  providerConfigUpdateSchema,
  agentCreateSchema,
])
```

`provider_config:update` 的 `patch` 用 `.strict()` — Agent 不能改 API key、binary path、env vars 等敏感字段。

## Executor Registry

每个 action type 对应一个 executor：

```ts
interface ActionExecutor<T> {
  validate(payload: T, cardId: string): Promise<{ valid: boolean; reason?: string }>
  execute(payload: T, cardId: string): Promise<{ success: boolean; result?: unknown; error?: string }>
}
```

**validate()** 做执行前重校验：
- `memory:activate` — 检查 memory item 是否还是 draft、是否还存在
- `provider_config:update` — 检查 provider 是否存在、patch 字段是否在白名单内
- `agent:create` — 检查 profileId 是否在白名单、name 是否重复

**execute()** 做幂等执行：
- CAS 更新 `action_cards.status`：`pending → executing` 或 `failed → executing`（重试）
- 如果 CAS 失败（状态已不是 pending/failed），直接返回当前状态
- 执行具体操作
- 更新 `status → executed/failed` + 写 `result_json/error`

**reject handler** 做领域对象状态转换（C1）：
- `memory:activate` reject → `project_memory_items.status` 从 `draft` 改为 `rejected`
- `provider_config:update` reject → 无领域对象需要转换（配置未变更）
- `agent:create` reject → 如果已创建 disabled agent，删除或标记 `archived`

## ActionCardService 接口

distiller 不依赖 IPC/UI 层，只依赖服务接口：

```ts
interface CreateActionCardInput {
  workspaceId: string
  conversationId?: string
  type: string
  payload: Record<string, unknown>
  title: string
  description?: string
  draftHint?: string
  dedupeKey: string
  createdByAgentId?: string
  expiresAt?: number
}

interface ActionCardService {
  createCard(input: CreateActionCardInput): Promise<ActionCard>         // PR-4 generic
  createMemoryActivationCard(input: {                                   // PR-5 helper
    workspaceId: string
    conversationId: string
    memoryItemId: string
    title: string
    draftHint?: string
    createdByAgentId?: string
  }): Promise<ActionCard>
}
```

PR-4 提供 generic `createCard()`，PR-5 增加 memory-specific `createMemoryActivationCard()` helper。`createMemoryActivationCard()` 内部调用 `createCard()`，自动生成 `dedupeKey = memoryItemId` 和 `type = 'memory:activate'`。

## IPC 层

| handler | 参数 | 返回 |
|---|---|---|
| `action-card:list` | `workspaceId` | `ActionCard[]`（pending 优先） |
| `action-card:create` | `workspaceId, type, payload, draftHint?` | `ActionCard` |
| `action-card:approve` | `id, approvedByUserId` | `ActionCard`（触发 executor） |
| `action-card:reject` | `id, rejectedByUserId` | `ActionCard` |
| `action-card:execute` | `id` | `ActionCard`（手动重试 failed card） |

## 过期与失效

- **时间过期**：`provider_config:update` 和 `agent:create` 设 `expires_at = now + 24h`。`memory:activate` 不设过期。
- **状态失效**：executor 的 `validate()` 检查前置条件。如果 draft memory 已被删除/已 active，card 自动标记 `expired`。
- **定期清理**：daemon 启动时扫 `action_cards WHERE status = 'pending' AND expires_at > 0 AND expires_at < now`，标记为 `expired`。

## Failed 状态处理

- **validation failed** → 标记 `expired`，不重试，不生成新卡
- **transient failed** → 保持 `failed`，允许手动重试（`action-card:execute` IPC），不生成新卡

## Memory Palace 对接

```
conversation:completed
  → distiller 提取
  → core/antipatterns: 直接写 active（不变）
  → conventions/decisions/architecture: 写 draft + createActionCard('memory:activate')
```

改动点：`a2a-memory-distiller.ts` 的 `persistToMemoryPalace()` 对 draft category 加 `actionCardService.createMemoryActivationCard()`，约 10 行代码。

draft memory 不注入 agent context。只有 active memory 才进入 `context-selector.ts` 的注入路径。

## 非阻塞设计

Action Card 是旁路控制面，不阻塞 Agent 执行：

- Agent/distiller 创建 Action Card 后不等确认，继续执行后续任务
- Action Card 的 approve/reject 是异步事件，通过 EventBus 通知
- Agent 需要知道 Action Card 结果时，通过 `action-card:executed` 事件触发后续逻辑

## 可观测性

每个 Action Card 状态变更写 observability event：

```
action_card:created     → { type, cardId, createdBy }
action_card:approved    → { cardId, approvedBy }
action_card:executed    → { cardId, result }
action_card:rejected    → { cardId, rejectedBy }
action_card:expired     → { cardId, reason }
action_card:failed      → { cardId, error }
```

## 实施计划

### PR-4：Action Card 基础设施（2 天）
- `action_cards` 表 + migration
- `action-types.ts` — Zod discriminatedUnion + strict() payload 白名单
- `executor-registry.ts` — validate + execute + CAS 状态机
- `action-card-service.ts` — 服务接口（distiller 依赖）
- IPC：create/list/approve/reject/execute
- 过期清理（daemon startup）
- 单测覆盖：payload 验证、CAS 状态机、去重、过期

### PR-5：Memory Draft Confirmation（1 天）
- `persistToMemoryPalace()` 对 draft category 加 `actionCardService.createMemoryActivationCard()`
- `memory:activate` executor — validate draft exists + update status to active
- `memory:activate` reject handler — validate draft exists + update status to rejected（C1）
- UI：draft memory + "Accept" / "Reject" 按钮
- 单测覆盖：distiller + action card 集成、reject 领域对象转换

### PR-6（Phase 3）：Provider Config Update + Agent Create Card（2 天）
- `provider_config:update` executor — 白名单校验 + 配置更新
- `agent:create` executor — profile 白名单校验 + disabled 创建
- UI：配置变更卡片 + Agent 创建卡片

## Related

- `docs/architecture/memory-palace-design.md`
- `docs/features/memory-palace.md`
- `docs/architecture/a2a-memory-bridge.md`