---
status: active
owner: mochi
last_verified: 2026-04-30
doc_kind: design
replaces:
  - docs/design/modules/A-task-execution-engine.md (old)
  - docs/design/modules/B-task-conversation-binding.md (absorbed)
applies_to:
  - src/main/core/db.ts
  - src/main/ipc/conversation.ts
  - src/renderer/src/stores/chatStore.ts
  - src/renderer/src/components/workspace/TaskRail.tsx
  - src/renderer/src/components/workspace/SharedConversation.tsx
---

# 模块 A: 任务即会话 — 设计文档（重写）

## 1. 核心概念纠正

> **Task = Conversation。它们是同一个东西。**

- TaskRail 里展示的「任务」就是 Conversation 列表
- 不存在独立的 `tasks` 表，Conversation 自身承载 status/mode/agent_count/change_count
- 用户创建的是「一次会话」，不是"先建任务再往里放对话"

## 2. 用户流程

```
1. 用户进入 app，TaskRail 显示最近的 conversations
2. 用户点击 [+New Task] → 创建一条空 conversation (status=Idle)
3. 用户输入第一句话 "修复 ToolCall 折叠问题" → 发送
    ├─ 这句话成为 conversation 的 title（自动标题）
    └─ Agent 开始执行 → status 变为 Running
4. Agent 思考/调用工具/写代码 → 对话流持续更新
5. Agent 完成 → status 变为 Done
6. 用户点击 TaskRail 中另一个 conversation → 对话切换
```

## 3. 数据模型变更

### 3.1 `conversations` 表扩展

```sql
-- 新增字段
ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'Idle';
ALTER TABLE conversations ADD COLUMN mode TEXT DEFAULT 'build';
ALTER TABLE conversations ADD COLUMN agent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN change_count INTEGER NOT NULL DEFAULT 0;
```

### 3.2 状态定义

```ts
type ConversationStatus = 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done'
```

### 3.3 Conversation 完整类型

```ts
interface Conversation {
  id: string
  workspace_id: string | null
  title: string | null
  model: string | null
  provider: string | null
  status: ConversationStatus    // 新增
  mode: string | null            // 新增 (build/plan/review/ask)
  agent_count: number            // 新增
  change_count: number           // 新增
  title_source: string
  created_at: number
  updated_at: number
  messages?: MessageItem[]
}
```

### 3.4 旧 `tasks` 表处理

已创建的 `tasks`/`task_agents`/`task_events` 表标记为 deprecated，数据不迁移（开发阶段无真实数据）。`task:*` IPC 通道保留但不再扩展。TaskRail 改为读取 `conversation:list`。

## 4. 状态转换

```
Idle ──→ Running    （用户发送第一条消息，Agent 开始响应）
Running ──→ Waiting  （Agent 发 permission_request 或 ask_user_question）
Waiting ──→ Running  （用户回复权限/问题）
Running ──→ Done     （Agent 发送 complete/done）
Running ──→ Error    （Agent 报错或用户 abort）
Error ──→ Running    （用户重试/继续发消息）
Done                   （终态，仍可发新消息）
```

## 5. HomePage 清理

### 当前问题

`HomePage.tsx` 有独立的 "Recent Conversations" 列表，与 TaskRail 功能重复。

### 改为

HomePage 只保留 branding + CTA：
- "Bytro" 标题 + "AI-Native Development Workspace" 副标题
- "Start New Chat" 按钮 → 创建 conversation → 导航到 `/chat/:id`
- **删除** Recent Conversations 区域

用户的会话历史通过 **TaskRail** 查看，不需要 HomePage 再展示一遍。

## 6. 标题自动生成

### 规则

1. **用户第一条消息** → 自动作为 conversation title
2. 截取前 50 个字符，超出加 `...`
3. `title_source = 'auto'`
4. 用户可以在 SharedConversation header 手动编辑标题（`title_source = 'manual'`，手动编辑后不再自动覆盖）

### 已有代码

`chatStore` 中 `complete` 事件处理已有自动标题逻辑（前 50 字符）。保留并强化：改为取用户第一条消息而非 AI 响应前 50 字符。

## 6. TaskRail 重构

### 当前

- 读取 `taskStore.tasks`（来自 `tasks` 表）
- 调用 `task:create` 创建任务

### 改为

- 读取 `chatStore.conversations`（来自 `conversations` 表）
- Filter tabs 基于 `status` 字段：
  - All → 全部
  - Active → status = 'Running' | 'Waiting'
  - Pending → status = 'Idle'
  - Done → status = 'Done' | 'Error'
- "New Task" 按钮 → `chatStore.createConversation({ title: 'New Task' })` → 导航到 `/chat/:id`

### TaskRail 条目展示

```
┌─ TaskRail 条目 ────────────────────────────┐
│  修复 ToolCall 折叠问题                      │  ← title
│  Running · 10:24                            │  ← status + time
│  2 agents · 3 changes                       │  ← agent_count + change_count
└──────────────────────────────────────────────┘
```

状态颜色（与设计规范一致）：
- Idle → `text-zinc-500`
- Running → `text-blue-400`
- Waiting → `text-yellow-400`
- Error → `text-red-400`
- Done → `text-green-400`

## 7. IPC 变更

### 7.1 `conversation:updateStatus` — 新增

```ts
// conversation:updateStatus(id, status) → Conversation
// 主进程验证状态转换合法性
ipcMain.handle('conversation:updateStatus', (_, id, status) => {
  // UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?
  // 状态转换校验：Idle→Running, Running→Waiting/Done/Error, etc.
})
```

### 7.2 `conversation:list` 增强

```ts
// 支持按 status 过滤
// conversation:list(workspaceId?, status?)
ipcMain.handle('conversation:list', (_, workspaceId?, status?) => {
  // SELECT * FROM conversations
  // WHERE (workspace_id = ?) AND (status = ?)
  // ORDER BY updated_at DESC
})
```

### 7.3 废弃 `task:*` IPC

`task:create`、`task:list`、`task:updateStatus`、`task:delete` 全部由 `conversation:*` 替代。

## 8. Store 变更

### 8.1 chatStore 新增/修改方法

```ts
interface ChatState {
  // ... 现有

  // 状态管理
  updateConversationStatus: (id: string, status: ConversationStatus) => Promise<void>
  
  // sendMessage 增强：如果是第一条消息，自动更新 title
  sendMessage: (conversationId: string, content: string) => Promise<void>
}
```

### 8.2 taskStore 简化/废弃

`taskStore` 改为 thin wrapper，内部调用 `chatStore`。或直接废弃，TaskRail 改用 `chatStore`。

推荐：**废弃 taskStore**。TaskRail 组件直接使用 `useChatStore`。

## 9. sendMessage 流程更新

```
用户输入 "修复 ToolCall 折叠问题" → 发送
  │
  ├─ 如果是 conversation 的第一条消息：
  │   ├─ title = content.slice(0, 50)
  │   └─ IPC conversation:setTitle(id, title)
  │
  ├─ conversation.status = Idle？
  │   └─ IPC conversation:updateStatus(id, 'Running')
  │
  ├─ 保存 user message (role='user')
  │
  ├─ 启动 AI session
  │
  ├─ AI 事件流
  │   ├─ tool_start → 更新 tool state
  │   ├─ tool_result → 如果是 Write/Edit/Delete，更新 change_count
  │   ├─ complete → conversation:updateStatus(id, 'Done')
  │   ├─ permission_request → conversation:updateStatus(id, 'Waiting')
  │   └─ error → conversation:updateStatus(id, 'Error')
  │
  └─ 完成
```

## 10. 架构边界

```
Main Process                          Renderer
───────────                           ────────

conversation:create ─────────────────→ chatStore.createConversation
  (status='Idle')                       ├─ conversations 列表更新
                                        └─ navigate to /chat/:id

conversation:updateStatus ────────────→ chatStore.updateStatus
  (验证状态转换)                          ├─ 本地 conversations 更新
                                        └─ TaskRail 自动重渲染

chat:startSession ────────────────────→ chatStore.startSession
  (启动 AI)                              └─ 现有逻辑不变

AI 事件流 ←─────────────────────────── chatStore.handleAIEvent
  ai:event                              ├─ 现有 text_delta/thinking...
                                        ├─ 新增：自动更新 conversation.status
                                        └─ 新增：捕获文件变更 → change_count
```

## 11. 与本模块一起实现的前端优化

TaskRail 从 `useTaskStore` 切换到 `useChatStore` 后：
- 字号：`text-xs` → `text-[12px]`，`text-sm` → `text-[13px]`
- 颜色：已在用 zinc token（✅ 不用改）

## 12. 未涉及范围

- Memory Palace（模块 D）
- 多 Agent 角色切换（后续）
- 审批/权限门控（后续）
