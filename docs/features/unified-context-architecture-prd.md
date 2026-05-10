# Unified Context Architecture PRD

> 版本: v1.0 | 日期: 2026-05-10 | 作者: @架构设计
> 状态: Draft | 优先级: P1 | 关联: #all:185b4fd2

## 1. 概述

### 1.1 背景

Bytro 有两种 Agent 协作模式：**Orchestrated**（单 Agent 执行）和 **Open Floor**（多 Agent 并行讨论）。当前两种模式使用不同的上下文获取机制和数据源，导致 Agent 无法在上下文中区分"谁说了什么"。

### 1.2 问题

| 问题 | 影响 | 严重性 |
|------|------|--------|
| Orchestrated 模式上下文标签为 `@Agent`（不区分具体名字） | Agent 无法针对性回应其他 Agent 的观点 | P1 |
| 两种模式使用不同数据源（messages 表 vs agent_task_queue 表） | 上下文格式不一致，维护成本高 | P1 |
| Orchestrated 模式上下文由 Orchestrator 被动拼接 | Agent 无法主动拉取更多上下文 | P2 |
| 切换会话后旧 Agent 回话到错误界面 | webContentsMap 清理时机问题 | P0 |

### 1.3 设计原则

**@谁 → 谁自己去看上下文** — Agent 发现彼此靠 system prompt（已有），看上下文靠自己拉取（统一），@mention 只是决定"谁来响应"。

## 2. 架构统一方案

### 2.1 核心变更：统一上下文获取方式

**当前**：
- Orchestrated: Orchestrator 通过 `buildConversationContext()` 拼接历史 → 嵌入 task.message → Agent 被动接收
- Open Floor: Agent 通过 `readMessages` 工具主动拉取 `taskQueue.getConversationHistory()`

**目标**：
- **两种模式都使用 `readMessages` 工具** — Agent 主动拉取上下文
- Orchestrated 模式不再在 task.message 里拼接完整对话历史，只传任务指令
- 上下文数据源统一为 `messages` 表 + `agent_task_queue` 表的合并视图

### 2.2 统一上下文标签

**当前**：
- `context-selector.ts:392`: `const label = t.role === 'user' ? 'User' : (t.agentProfileId ? '@Agent' : 'Assistant')`
- `task-queue.ts:317`: `entries.push(`[${task.agentProfileId}] ${task.message}`)` — 用 profileId 而非名字

**目标**：
- 所有上下文标签统一为具体 Agent 名字：`@Claude`、`@Planner`、`@Coder` 等
- `agentProfileId` → 查询 `agent_profile_configs.name` → 输出 `@Claude`

### 2.3 Orchestrated 模式增加 readMessages 工具

**当前**：Orchestrated 模式的 Agent 没有 `readMessages` 工具，只能看到 Orchestrator 拼接的固定上下文。

**目标**：给 Orchestrated 模式的 Agent 也注入 `readMessages` 工具，让 Agent 可以主动拉取对话历史。

### 2.4 会话绑定修复

**当前**：`webContentsMap` 只在 `webContents.destroyed` 时清理，切换会话时没有主动解绑。

**目标**：切换会话时主动更新 `webContentsMap`，确保 Agent 回话只发到当前活跃的 webContents。

## 3. 功能需求

### FR-1: 统一上下文标签

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-1.1 | `context-selector.ts:392` 的 `@Agent` 标签改为查询 `agent_profile_configs.name` 输出具体名字 | P0 |
| FR-1.2 | `task-queue.ts:getConversationHistory()` 的 `[profileId]` 标签改为 `[profileName]` | P0 |
| FR-1.3 | `renderContextPacket()` 的 `[Agent]` 标签改为具体名字 | P0 |
| FR-1.4 | 新增 `getAgentName(agentProfileId)` 辅助函数，查询 `agent_profile_configs.name` | P0 |

### FR-2: Orchestrated 模式增加 readMessages 工具

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-2.1 | `orchestrator.ts` 的 `executeTask()` 给 Agent 注入 `readMessages` 工具 | P0 |
| FR-2.2 | `readMessages` 工具查询 `messages` 表 + `agent_task_queue` 表的合并视图 | P0 |
| FR-2.3 | `readMessages` 返回的上下文标签使用具体 Agent 名字 | P0 |

### FR-3: 减少 Orchestrated 模式的被动上下文拼接

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-3.1 | `sendUserMessage()` 不再在 task.message 里嵌入完整 `buildConversationContext()` | P1 |
| FR-3.2 | task.message 只包含任务指令 + 最少必要上下文（@mention 来源、handoff 信息） | P1 |
| FR-3.3 | Agent 通过 `readMessages` 工具自主决定拉取多少上下文 | P1 |

### FR-4: 会话绑定修复

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-4.1 | 切换会话时主动更新 `webContentsMap`，解绑旧会话的 webContents | P0 |
| FR-4.2 | `webContentsMap` 在 `webContents.isDestroyed()` 时自动清理 | P0 |

## 4. 技术方案

### 4.1 getAgentName 辅助函数

```typescript
// 新增到 context-selector.ts 或单独的 utils 文件
function getAgentName(agentProfileId: string | null): string {
  if (!agentProfileId) return 'Assistant'
  const db = getDb()
  const row = db
    .prepare('SELECT name FROM agent_profile_configs WHERE id = ?')
    .get(agentProfileId) as { name: string } | undefined
  return row?.name ?? agentProfileId
}
```

### 4.2 buildConversationContext 标签改造

```typescript
// Before
const label = t.role === 'user' ? 'User' : (t.agentProfileId ? '@Agent' : 'Assistant')

// After
const label = t.role === 'user' ? 'User' : `@${getAgentName(t.agentProfileId)}`
```

### 4.3 getConversationHistory 标签改造

```typescript
// Before
entries.push(`[${task.agentProfileId}] ${task.message}`)
entries.push(`[${task.agentProfileId}]: ${task.result}`)

// After
const agentName = getAgentName(task.agentProfileId)
entries.push(`[@${agentName}] ${task.message}`)
entries.push(`[@${agentName}]: ${task.result}`)
```

### 4.4 Orchestrated 模式 readMessages 工具注入

```typescript
// orchestrator.ts executeTask() 中，与 Open Floor 的 claimAndExecute() 对齐
const readMessagesTool: ObservationTool = {
  name: 'readMessages',
  description: '读取对话历史，了解最近的讨论内容和上下文。',
  parameters: {
    limit: { type: 'number', description: '返回最近 N 条消息，默认50，最大100' },
  },
  execute: async (args: Record<string, unknown>) => {
    const limit = Math.min(typeof args.limit === 'number' ? args.limit : 50, 100)
    const history = taskQueue.getConversationHistory(conversationId, limit)
    return history.length > 0 ? history.join('\n\n') : '（暂无对话历史）'
  },
}
```

### 4.5 会话绑定修复

```typescript
// sendUserMessage() 开头增加
this.webContentsMap.set(conversationId, webContents)
// 清理其他会话的过期 webContents
for (const [cid, wc] of this.webContentsMap.entries()) {
  if (cid !== conversationId && wc.isDestroyed()) {
    this.webContentsMap.delete(cid)
  }
}
```

## 5. 实施计划

| Phase | 任务 | 预估 | 依赖 |
|-------|------|------|------|
| Phase 1 | FR-1: 统一上下文标签 | ~30 行 | 无 |
| Phase 2 | FR-2: Orchestrated 增加 readMessages | ~20 行 | Phase 1 |
| Phase 3 | FR-3: 减少被动上下文拼接 | ~15 行 | Phase 2 |
| Phase 4 | FR-4: 会话绑定修复 | ~10 行 | 无 |

**总预估**：~75 行

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `getAgentName()` 查询增加 DB 访问 | 低 | 低 | 结果缓存到 Map，避免重复查询 |
| Orchestrated Agent 不使用 readMessages 工具 | 中 | 中 | 保留最少必要上下文在 task.message 里（FR-3.2） |
| 上下文格式变更影响 Agent 行为 | 中 | 中 | 标签从 `@Agent` → `@Claude` 是增强信息，不破坏现有行为 |
| readMessages 工具返回过多上下文 | 低 | 低 | 默认 limit=50，Agent 可自行调整 |

## 7. 验证计划

1. Orchestrated 模式：@Claude 能看到上下文里 `@Planner: ...` 和 `@Coder: ...` 的具体标签
2. Open Floor 模式：所有 Agent 的上下文标签统一为具体名字
3. Orchestrated Agent 能使用 `readMessages` 工具主动拉取更多上下文
4. 切换会话后旧会话的 Agent 不再回话到错误界面
5. 两种模式的上下文格式完全一致

## 8. 不在范围内

| 项目 | 说明 |
|------|------|
| 合并两种模式为一种 | 两种模式的调度逻辑（谁回复）保持独立 |
| 修改 Agent 发现机制 | system prompt 注入成员卡片的方式不变 |
| 修改 @mention 解析 | `parseMentions()` 的逻辑不变 |