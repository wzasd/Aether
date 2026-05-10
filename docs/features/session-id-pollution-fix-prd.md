# Session ID Pollution Fix PRD

> 版本: v1.1 | 日期: 2026-05-10 | 作者: @需求文档师
> 状态: Review APPROVED ✅ | 优先级: P0 (Critical) | 关联: #all:185b4fd2

## 1. 概述

### 1.1 背景

Bytro 的多 Agent 架构中，每个 Agent 可使用不同 CLI Provider（Claude、OpenCode、Gemini 等）。当用户切换 Agent 的 Provider 时（例如将 @Planner 从 OpenCode 切换到 Claude），session ID 跨 Provider 污染导致所有非 OpenCode Provider 无法恢复会话，进程崩溃。

### 1.2 问题严重性

**P0 Critical** — 当 OpenCode 先运行后，所有其他 Provider 的 `--resume` 参数收到 OpenCode 格式的 session ID（如 `oc-mozewl23-d4ql8k`），导致：
- Claude CLI 拒绝非 UUID 格式 → 进程崩溃
- Codex/Gemini/Kimi/Copilot/Cursor 收到不属于自己的 session ID → 行为不可预测
- 用户只能使用 OpenCode，其他 Provider 全部失败

### 1.3 根因

Session ID 的存储和查找不区分 Provider：

1. **`task-queue.ts` 的 `getLastSessionId(conversationId, agentProfileId)`** — 只按 `(conversationId, profileId)` 查找，不按 Provider 过滤
2. **`runtime-registry.ts` 的 `idleAgentConfigs` Map** — 缓存 key 是 `profileId`，不区分 Provider
3. **`orchestrator.ts` 的 `primarySessionIds` Map** — key 是 `${conversationId}:${profile.id}`，fingerprint 包含 providerType 但只在 orchestrator 层校验
4. **`agent_task_queue` 表** — 有 `session_id` 列但没有 `provider` 列

当 OpenCode 为 @Planner 创建 session `oc-mozewl23-d4ql8k` 后，用户切换 @Planner 到 Claude，`getLastSessionId()` 返回 OpenCode 的 session ID → Claude 收到 `--resume oc-mozewl23-d4ql8k` → 崩溃。

### 1.4 现有防御层

`base-cli-provider.ts` 的 `isValidSessionId()` 方法已存在，各 Provider 子类实现了格式校验：
- Claude: UUID 正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-...$/i`
- OpenCode: `oc-` 前缀校验
- Gemini: UUID 格式
- Codex: UUID 格式
- Kimi/Copilot/Cursor: 各自格式

**但防御层不够**：`isValidSessionId()` 在 `startSession()` 内部调用，校验失败时静默 fallback 到 `randomUUID()` 创建新 session。这意味着：
- Resume 功能静默失效 — 用户以为在继续旧对话，实际是新 session
- `idleAgentConfigs` 缓存仍存储错误 session ID — 后续请求继续污染
- 无任何日志或用户提示 — 问题难以诊断

---

## 2. 问题陈述

### 2.1 核心问题

**Session ID 存储和查找不区分 Provider，导致跨 Provider 污染。**

### 2.2 影响范围

| 场景 | 影响 | 严重性 |
|------|------|--------|
| 用户切换 Agent 的 Provider | 旧 Provider session ID 传给新 Provider → resume 失败 | Critical |
| Open Floor 多 Agent 同时运行 | 第一个 Agent 的 session ID 污染后续 Agent | Critical |
| Orchestrated 模式 @mention 不同 Provider | 前一个 Provider 的 session ID 残留 | High |
| 同一 Agent 重启（Provider 不变） | 正常工作 — session ID 格式匹配 | None |

### 2.3 用户故事

> 作为 bytro 用户，当我将 @Planner 的 Provider 从 OpenCode 切换到 Claude 时，我希望 Claude 能正常启动并创建新 session（而不是收到 OpenCode 格式的 session ID 后崩溃），以便我能继续使用任何 Provider 进行对话。

> 作为 bytro 开发者，当 session resume 失败时，我希望在 runtime.log 中看到明确的警告（而不是静默 fallback），以便快速诊断问题。

---

## 3. 功能需求

### FR-1: `getLastSessionId` 增加 Provider 过滤

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-1.1 | `getLastSessionId(conversationId, agentProfileId, providerType)` 新增 `providerType` 参数 | P0 |
| FR-1.2 | 查询 `agent_task_queue` 表时增加 `WHERE provider = ?` 条件 | P0 |
| FR-1.3 | `agent_task_queue` 表新增 `provider TEXT` 列（migration） | P0 |
| FR-1.4 | 入队时（`enqueue`）将 `providerType` 写入 `provider` 列 | P0 |
| FR-1.5 | 所有调用 `getLastSessionId` 的地方传入 `providerType` | P0 |

**改动预估**：~25 行（`task-queue.ts` + DB migration）

### FR-2: `primarySessionIds` Map key 包含 Provider

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-2.1 | `primarySessionIds` Map key 从 `${conversationId}:${profile.id}` 改为 `${conversationId}:${profile.id}:${providerType}` | P0 |
| FR-2.2 | 写入和读取 `primarySessionIds` 时使用新 key 格式 | P0 |
| FR-2.3 | `fingerprint` 字段保留作为防御性校验（不变） | P1 |

**改动预估**：~10 行（`orchestrator.ts`）

### FR-3: `idleAgentConfigs` Map 包含 Provider

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-3.1 | `idleAgentConfigs` Map key 从 `profileId` 改为 `${profileId}:${providerType}` | P0 |
| FR-3.2 | 缓存查找时使用新 key 格式 | P0 |
| FR-3.3 | 缓存失效逻辑（`cachedAt` 超时）不变 | P1 |

**改动预估**：~10 行（`runtime-registry.ts`）

### FR-4: `agent_sessions` 表查询使用 Provider 列

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-4.1 | `agent_sessions` 表已有 `provider TEXT NOT NULL` 列 — 确认查询时使用 | P0 |
| FR-4.2 | `saveSession()` 写入时确保 `provider` 字段正确 | P0 |
| FR-4.3 | `getSession()` 查询时增加 `WHERE provider = ?` 条件 | P0 |

**改动预估**：~15 行（`db.ts` session 相关方法）

### FR-5: Resume 失败可观测性

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-5.1 | `isValidSessionId()` 校验失败时调用 `writeObservabilityEvent('runtime:session_id_rejected', { sessionId, providerType, reason })` 写入 runtime.log | P1 |
| FR-5.2 | `isValidSessionId()` 校验失败时 emit `session:resume_rejected` 事件 | P1 |
| FR-5.3 | 前端收到 `session:resume_rejected` 时显示 toast 提示"会话恢复失败，已创建新会话" | P2 |

**改动预估**：~20 行（`base-cli-provider.ts` + 前端 toast）

---

## 4. 非功能需求

| ID | 需求 | 标准 |
|----|------|------|
| NFR-1 | 向后兼容 | DB migration 是纯增量（新增列），不破坏现有数据 |
| NFR-2 | 性能 | 新增 `provider` 过滤条件不增加查询延迟（`provider` 列已有索引或查询量小） |
| NFR-3 | 测试覆盖 | 每项 FR 有对应单元测试 |
| NFR-4 | 改动量控制 | 总改动 ≤ 80 行 |

---

## 5. 技术方案

### 5.1 DB Migration

```sql
-- 新增列，允许 NULL 以兼容已有记录
ALTER TABLE agent_task_queue ADD COLUMN provider TEXT;

-- 已有记录的 provider 为 NULL，getLastSessionId 查询时
-- WHERE provider = ? OR provider IS NULL 确保兼容
```

### 5.2 `getLastSessionId` 改造

```typescript
// Before
getLastSessionId(conversationId: string, agentProfileId: string): string | null

// After
getLastSessionId(conversationId: string, agentProfileId: string, providerType: string): string | null
```

查询 SQL：
```sql
SELECT session_id FROM agent_task_queue
WHERE conversation_id = ? AND agent_profile_id = ?
  AND (provider = ? OR provider IS NULL)
ORDER BY created_at DESC LIMIT 1
```

`OR provider IS NULL` 确保迁移前的旧记录仍可被查到。

### 5.3 `primarySessionIds` Key 格式

```typescript
// Before
const key = `${conversationId}:${profile.id}`;

// After
const key = `${conversationId}:${profile.id}:${config.providerType}`;
```

### 5.4 `idleAgentConfigs` Key 格式

```typescript
// Before
const cacheKey = profileId;

// After
const cacheKey = `${profileId}:${config.providerType}`;
```

### 5.5 调用链路验证

```
用户消息 → Orchestrator.executeOrchestrated()
  → config = resolveConfig(profile)  // 包含 providerType
  → primarySessionIds key = `${convId}:${profile.id}:${config.providerType}`
  → TaskQueue.enqueue(task)  // task 包含 providerType
  → RuntimeRegistry.claimAndExecute()
    → idleAgentConfigs key = `${profileId}:${config.providerType}`
    → lastSessionId = getLastSessionId(convId, profileId, providerType)
    → resumeConfig = { ...config, sessionId: lastSessionId }
    → provider.startSession(resumeConfig)
      → isValidSessionId(sessionId)  // 防御性校验
      → 如果校验失败 → runtime.log 警告 + 新 session
```

---

## 6. 实施计划

### Phase 1: DB Migration + 核心修复（P0）

| 任务 | 负责人 | 预估 | 依赖 |
|------|--------|------|------|
| FR-1.3: `agent_task_queue` 新增 `provider` 列 | @Coder | ~5 行 | 无 |
| FR-1.1-1.2: `getLastSessionId` 增加 Provider 过滤 | @Coder | ~15 行 | FR-1.3 |
| FR-1.4: `enqueue` 写入 `providerType` | @Coder | ~5 行 | FR-1.3 |
| FR-2.1-2.2: `primarySessionIds` key 包含 Provider | @Coder | ~10 行 | 无 |
| FR-3.1-3.2: `idleAgentConfigs` key 包含 Provider | @Coder | ~10 行 | 无 |
| FR-4.1-4.3: `agent_sessions` 查询增加 Provider 过滤 | @Coder | ~15 行 | 无 |
| FR-1.5: 所有调用点传入 `providerType` | @Coder | ~5 行 | FR-1.1 |

**总预估**：~65 行

### Phase 2: 可观测性增强（P1）

| 任务 | 负责人 | 预估 | 依赖 |
|------|--------|------|------|
| FR-5.1: `isValidSessionId` 失败写 runtime.log | @Coder | ~10 行 | 无 |
| FR-5.2: emit `session:resume_rejected` 事件 | @Coder | ~5 行 | FR-5.1 |

### Phase 3: 前端提示（P2）

| 任务 | 负责人 | 预估 | 依赖 |
|------|--------|------|------|
| FR-5.3: 前端 toast 提示 resume 失败 | @UI设计专家 | ~15 行 | FR-5.2 |

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| DB migration 失败（列已存在） | 低 | 中 | `ALTER TABLE ... ADD COLUMN` 是幂等的；加 `IF NOT EXISTS` 守卫 |
| 旧记录 `provider` 为 NULL 导致查询遗漏 | 低 | 中 | `OR provider IS NULL` 兼容旧记录 |
| `primarySessionIds` key 格式变更导致已有缓存失效 | 低 | 低 | Map 是内存缓存，重启后自动清空 |
| `idleAgentConfigs` key 变更导致 idle agent 缓存 miss | 低 | 低 | 缓存 miss = 重新创建 session，行为正确 |
| Provider 切换后旧 session 永远无法 resume | 中 | 低 | 这是预期行为 — 不同 Provider 的 session 不应互相 resume |

---

## 8. 验证计划

### 8.1 单元测试

| FR | 测试用例 |
|----|----------|
| FR-1 | `task-queue.test.ts`: `getLastSessionId` 按 Provider 过滤，OpenCode session 不返回给 Claude |
| FR-1 | `task-queue.test.ts`: `enqueue` 写入 `provider` 字段 |
| FR-2 | `orchestrator.test.ts`: `primarySessionIds` key 包含 Provider |
| FR-3 | `runtime-registry.test.ts`: `idleAgentConfigs` key 包含 Provider |
| FR-4 | `db.test.ts`: `agent_sessions` 查询按 Provider 过滤 |
| FR-5 | `base-cli-provider.test.ts`: `isValidSessionId` 失败写日志 |

### 8.2 E2E 验证

1. **跨 Provider 切换**：@Planner(OpenCode) 对话 → 切换到 @Planner(Claude) → Claude 正常启动，不崩溃
2. **Open Floor 多 Provider**：6 个 Agent 同时运行（不同 Provider）→ 各自 resume 自己的 session
3. **Session 隔离**：Claude 的 `--resume` 参数始终是 UUID 格式，OpenCode 的始终是 `oc-` 格式
4. **旧记录兼容**：迁移前创建的 task 记录（`provider` 为 NULL）仍可被查到
5. **Resume 失败可观测**：手动注入错误格式 session ID → runtime.log 有 `runtime:session_id_rejected` 结构化记录
6. **跨 Provider 切换集成测试**：创建 OpenCode session → 切换到 Claude → 验证 Claude 不收到 OpenCode session ID → 验证 Claude 创建新 session

---

## 10. Review History

### v1.0 → v1.1 (2026-05-10, @Reveiw工程师 Review APPROVED ✅)

| # | 建议 | 采纳 | 变更 |
|---|------|------|------|
| 1 | FR-1.3 migration 用 ALTER TABLE ADD COLUMN 而非重建表 | ✅ | PRD 5.1 节已写明此方案，无需修改 |
| 2 | FR-2 确认 fingerprint 生成时机是否覆盖 provider 切换 | ✅ | 确认 runtime-registry 层不经过 fingerprint 校验，FR-3 的 key 改造覆盖此缺口 |
| 3 | FR-5.1 用 `writeObservabilityEvent()` 替代 `console.warn` | ✅ | FR-5.1 更新为调用 `writeObservabilityEvent('runtime:session_id_rejected', ...)` |
| 4 | 补充跨 Provider 切换 integration test | ✅ | 验证计划 8.2 节新增第 6 项 |

---

## 9. 不在范围内

| 项目 | 说明 |
|------|------|
| Session 格式校验强化 | `isValidSessionId()` 已存在，本次不改动校验逻辑 |
| 跨 Provider session 迁移 | 不同 Provider 的 session 不应互相迁移 |
| `agent_sessions` 表 schema 变更 | 已有 `provider` 列，无需 migration |
| 前端 Provider 切换 UI | 本次只修后端逻辑，前端切换流程不变 |
