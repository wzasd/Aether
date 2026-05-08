---
status: completed
owner: mochi
last_verified: 2026-05-01
doc_kind: plan
source: docs/design/modules/A-task-execution-engine.md
progress: completed
---

# Module A Implementation Plan: Task = Conversation

> Status: Completed with follow-up findings. Core `Task = Conversation` work has landed: conversation schema fields, `conversation:updateStatus`, TaskRail using `chatStore`, route-based conversation selection, and Home cleanup. Remaining behavior issues are tracked in `docs/reviews/active/2026-05-01-latest-code-review.md`.

## Steps

### Step 1: DB Schema — `conversations` 表扩展

**文件**: `src/main/core/db.ts`

在 `conversations` 表定义中增加 4 个字段（`CREATE TABLE IF NOT EXISTS` 中追加，供新库使用）：

```sql
status TEXT NOT NULL DEFAULT 'Idle',
mode TEXT DEFAULT 'build',
agent_count INTEGER NOT NULL DEFAULT 0,
change_count INTEGER NOT NULL DEFAULT 0
```

同时更新 `SCHEMA_VERSION`：当前代码已是 `SCHEMA_VERSION = 3`，Module A 应 bump 到 `4`。

必须补真实迁移，不能只改 `CREATE TABLE IF NOT EXISTS`。已有用户数据库不会因为 `CREATE TABLE IF NOT EXISTS conversations` 更新字段。

在 `applyMigrations()` 中增加：

```ts
if (version < 4) {
  addMissingColumn('conversations', 'status', "TEXT NOT NULL DEFAULT 'Idle'")
  addMissingColumn('conversations', 'mode', "TEXT DEFAULT 'build'")
  addMissingColumn('conversations', 'agent_count', 'INTEGER NOT NULL DEFAULT 0')
  addMissingColumn('conversations', 'change_count', 'INTEGER NOT NULL DEFAULT 0')
}
```

否则 `conversation:list` / `conversation:updateStatus` 一旦 SELECT 新字段，会在旧库上失败。

**验证**: `pnpm run typecheck`

---

### Step 2: `conversation:updateStatus` IPC — 新增

**文件**: `src/main/ipc/conversation.ts`

新增 handler，含状态转换合法性校验：

```ts
const VALID_TRANSITIONS: Record<string, string[]> = {
  Idle:    ['Running'],
  Running: ['Waiting', 'Done', 'Error', 'Idle'],
  Waiting: ['Running', 'Error', 'Idle'],
  Error:   ['Running', 'Idle'],
  Done:    ['Running'],
}
```

扩展 `conversation:list` 支持可选的 `status` 过滤参数。

注意：`Done` 不能作为不可继续的终态。已完成会话仍允许用户继续发消息，因此 `Done -> Running` 必须合法；否则再次发送消息时状态更新会失败，TaskRail 会停留在 `Done`。

**验证**: `pnpm run typecheck`

---

### Step 3: Preload + Types 更新

**文件**: `src/preload/index.ts`、`src/renderer/src/types/global.d.ts`

- `api.conversation` 新增 `updateStatus` 方法
- `ConversationItem` 类型新增 `status`/`mode`/`agent_count`/`change_count` 字段
- `conversation:list` 签名更新为 `(workspaceId?: string, status?: string)`

**验证**: `pnpm run typecheck`

---

### Step 4: chatStore 扩展

**文件**: `src/renderer/src/stores/chatStore.ts`

新增方法：

```ts
updateConversationStatus(id: string, status: string) → Promise<void>
```

修改 `sendMessage` 逻辑：
- 新消息保存后，如果是该 conversation 的第一条消息（`messages.length === 0`），调用 `conversation:autoTitle` 将 content 前 50 字符设为 title
- 发送后自动调用 `updateConversationStatus(id, 'Running')`

修改 `handleAIEvent` 中的状态联动：
- `complete` → `updateConversationStatus(id, 'Done')`
- `error` → `updateConversationStatus(id, 'Error')`
- `permission_request` / `ask_user_question` → `updateConversationStatus(id, 'Waiting')`
- 用户批准权限 `confirmPermission` 成功后 → `updateConversationStatus(id, 'Running')`
- 用户回答问题 `answerQuestion` 成功后 → `updateConversationStatus(id, 'Running')`

注意：不要用现有 `setConversationTitle` 做自动标题。当前 `conversation:setTitle` 会把 `title_source` 写成 `manual`，自动标题必须保持 `title_source = 'auto'`，手动编辑标题时才标记为 `manual`。

**验证**: `pnpm run typecheck`

---

### Step 5: TaskRail 切换到 chatStore

**文件**: `src/renderer/src/components/workspace/TaskRail.tsx`

核心改动：
- `useTaskStore` → `useChatStore`
- 数据源：`tasks` → `conversations`
- "New Task" 按钮：`createTask()` → `createConversation({ title: 'New Task' })` + `navigate(/chat/:id)`
- 条目点击：`setActiveTask(id)` → 导航到 `/chat/:id`
- Filter tabs：基于 `conversation.status` 过滤
- 删除 `taskStore` import、`useWorkspaceStore` import
- 字号对齐：`text-xs` → `text-[12px]`，`text-sm` → `text-[13px]`

**需要传入 navigate**：TaskRail 新增 `onNewConversation` 和 `onSelectConversation` props，由 App.tsx 提供。

**设计变更 (2026-05-01)**：去掉了 workspace 前置检查。New Task 按钮始终可用，不要求先选 workspace。Conversation 创建时不绑定 `workspace_id`，workspace 后续在聊天面板中指定。

计数字段不能只展示不维护：
- `agent_count`：至少在 `subagent_started` / `subagent_completed` 或 `agent_sessions` 变化时更新
- `change_count`：M8 之前可先保持 0，但计划里必须明确它由后续 change tracking 或写入/编辑/删除工具事件维护

**验证**: `pnpm run typecheck`

---

### Step 6: App.tsx 调整

**文件**: `src/renderer/src/App.tsx`

- `loadTasks()` → 移除（改为 `loadConversations()`，已经在调用）
- `taskStore` import → 移除
- TaskRail 传入 `onNewConversation` + `onSelectConversation` 回调
- 旧 `activeTaskId` 相关逻辑移除（路由 param `:id` 就是 conversation id）
- `loadConversations()` 改为随 `currentWorkspaceId` 变化调用 `loadConversations(currentWorkspaceId ?? undefined)`
- `Cmd/Ctrl+N` 创建新会话时不绑定 workspace，行为与 TaskRail `[+New Task]` 保持一致

**设计变更 (2026-05-01)**：去掉了 workspace 前置检查。Cmd+N 和 New Task 按钮都不再要求先选 workspace，也不传 `workspace_id`。

**验证**: `pnpm run typecheck`

---

### Step 7: HomePage 清理

**文件**: `src/renderer/src/pages/Home.tsx`

- 删除 Recent Conversations 区域（`conversations.length > 0` 分支）
- 保留 branding + "Start New Chat" 按钮
- 字号对齐

**验证**: `pnpm run typecheck`

---

### Step 8: Build & Visual Check

```bash
pnpm build
# 启动 pnpm dev
# 目视检查：
# 1. TaskRail 显示 conversations（初始为空）
# 2. 未选择 workspace 时 [+New Task] 禁用
# 3. 选择 workspace 后 [+New Task] 创建带 workspace_id 的 conversation
# 4. 发送第一条消息 → title 自动生成
# 5. 状态从 Idle → Running → Done 流转
# 6. Done 会话继续发送消息 → 状态重新变为 Running
# 7. 权限/提问等待 → Waiting，用户继续后 → Running
# 8. HomePage 无 Recent Conversations
```

---

## Review 修正清单

| Finding | 必须修正的计划点 | 优先级 |
|---------|------------------|:---:|
| DB 计划缺少真实迁移步骤 | Module A 使用 `SCHEMA_VERSION = 4`，并在 `version < 4` 中 `addMissingColumn` | P1 |
| Done 终态会阻断继续对话 | 状态机允许 `Done -> Running` | P1 |
| New Task 没有绑定当前 workspace | ~~`TaskRail` 创建 conversation 时传 `workspace_id: currentWorkspaceId`，未选项目禁用~~ → **2026-05-01 设计变更**：Conversation 创建时不绑定 workspace，workspace 后续在聊天面板中指定 | P1 |
| 自动标题会被错误标记为 manual | 自动标题走 `conversation:autoTitle`，手动标题才走 `conversation:setTitle` | P2 |
| Waiting 恢复 Running 的触发点漏了 | `confirmPermission` / `answerQuestion` 成功后更新为 `Running` | P2 |
| agent_count/change_count 没有更新来源 | 明确 `agent_count` 本阶段维护；`change_count` 可延后到 M8，但不能宣称真实统计完成 | P2 |

---

## 每步完成标准

| Step | 通过 typecheck | 通过 build | 目视验证 |
|------|:---:|:---:|:---:|
| 1. DB Schema | ✅ | — | — |
| 2. IPC | ✅ | ✅ | — |
| 3. Preload + Types | ✅ | — | — |
| 4. chatStore | ✅ | ✅ | — |
| 5. TaskRail | ✅ | ✅ | ✅ |
| 6. App.tsx | ✅ | ✅ | ✅ |
| 7. HomePage | ✅ | ✅ | ✅ |
| 8. Build | — | ✅ | ✅ |

## Rollback Plan

若 Step 5-7 出问题：
- `tasks` 表和 `taskStore` 代码不删除，仅不调用
- TaskRail 恢复时只需改回 `useTaskStore`
