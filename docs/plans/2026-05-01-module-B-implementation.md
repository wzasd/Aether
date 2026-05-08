---
status: active
owner: mochi
last_verified: 2026-05-01
doc_kind: plan
source: docs/design/modules/B-file-change-tracking.md
progress: completed-with-test-gaps
---

# Module B Implementation Plan: 文件变更追踪

> 基于 Module A 完成后的代码现状重建。Task = Conversation，所有 task_id 参数改为 conversation_id。

## 与原始设计文档的关键差异

原始设计文档（`B-file-change-tracking.md`）写于 Module A 之前，存在以下不一致：

| 原文档 | 实际现状（Module A 后） |
|--------|------------------------|
| `change_count` 写入 `tasks` 表 | 已在 `conversations.change_count` |
| `DiffPanel` 读取 `useTaskStore(s => s.activeTaskId)` | 路由参数 `useParams().id` = conversationId |
| `change:record(taskId, change)` IPC | 改为 `change:record(conversationId, change)` |
| `file_changes.task_id` 外键 | 改为 `file_changes.conversation_id` |

原设计文档的核心策略（从 tool call 事件流捕获、不依赖 fs.watch）保持不变。

---

## 当前状态（2026-05-01 更新）

| 组件 | 状态 | 说明 |
|------|:---:|------|
| `conversations.change_count` 字段 | ✅ | Module A 已建表和迁移 |
| `file_changes` DB 表 | ✅ | schema v5 已创建 |
| `change:*` IPC handlers | ✅ | `src/main/ipc/change.ts` 已存在并注册 |
| Preload `api.change` 桥接 | ✅ | `src/preload/index.ts` 已暴露 |
| `changeStore.ts` | ✅ | 已存在 |
| `chatStore` tool_result 文件检测 | ✅ | 已捕获 Write/Edit/Delete，包含 MCP 工具名修复 |
| `agent_count` 真实维护 | ✅ | `subagent_started` 已按 session 归属，并通过 main-process 原子自增持久化 |
| `DiffPanel` 真实数据 | ✅ | 已从 `changeStore` 读取，不再使用 `SAMPLE_DIFFS` |

> Re-review note: Module B implementation findings are resolved. Remaining work is targeted test coverage for change tracking and counters.

---

## Steps

### Step 1: DB Schema — `file_changes` 表 + SCHEMA_VERSION → 5

**文件**: `src/main/core/db.ts`

新增 `file_changes` 表，`conversation_id` 作为外键（而非原设计的 `task_id`）：

```sql
CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  status TEXT NOT NULL,           -- 'added' | 'modified' | 'deleted'
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_file_changes_conv ON file_changes(conversation_id);
```

同时 bump `SCHEMA_VERSION` 4 → 5，在 `applyMigrations()` 增加：

```ts
if (version < 5) {
  // file_changes 是新表，CREATE TABLE IF NOT EXISTS 已覆盖新库
  // 已有用户库无此表，exec 创建即可，无需 addMissingColumn
}
```

> 注：新表用 `CREATE TABLE IF NOT EXISTS` 覆盖即可，不需要 `addMissingColumn`；只需 bump version 确保未来迁移的版本边界正确。

**验证**: `pnpm run typecheck`

---

### Step 2: `change:*` IPC handlers

**文件**: `src/main/ipc/change.ts`（新建）

```ts
// 记录单条变更，同时自增 conversations.change_count
ipcMain.handle('change:record', (_, conversationId: string, change: {
  path: string; status: string; additions: number; deletions: number; toolCallId?: string
}) => { ... })

// 读取 conversation 的所有变更（按时间倒序）
ipcMain.handle('change:list', (_, conversationId: string) => { ... })

// 清空 conversation 的变更（暂不暴露 UI，供测试用）
ipcMain.handle('change:clear', (_, conversationId: string) => { ... })
```

`change:record` 在一个事务中：
1. `INSERT INTO file_changes`
2. `UPDATE conversations SET change_count = change_count + 1, updated_at = now WHERE id = ?`

同时在 `src/main/ipc/index.ts` 中注册 `registerChangeIpc()`。

**验证**: `pnpm run typecheck`

---

### Step 3: Preload + Types 更新

**文件**: `src/preload/index.ts`、`src/renderer/src/types/global.d.ts`

Preload 新增：

```ts
change: {
  record: (conversationId: string, change: FileChange) => Promise<{ id: string }>
  list: (conversationId: string) => Promise<FileChangeItem[]>
}
```

global.d.ts 新增：

```ts
interface FileChangeItem {
  id: string
  conversation_id: string
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  tool_call_id: string | null
  created_at: number
  updated_at: number
}
```

同时更新 `ElectronAPI` 声明。

**验证**: `pnpm run typecheck`

---

### Step 4: `changeStore.ts`（新建）

**文件**: `src/renderer/src/stores/changeStore.ts`

```ts
interface ChangeState {
  // conversationId → 变更列表（最新在前）
  changes: Record<string, FileChangeItem[]>

  recordChange: (conversationId: string, change: {
    path: string; status: 'added' | 'modified' | 'deleted'
    additions: number; deletions: number; toolCallId?: string
  }) => Promise<void>

  loadChanges: (conversationId: string) => Promise<void>
  getChanges: (conversationId: string) => FileChangeItem[]
  clearChanges: (conversationId: string) => void
}
```

`recordChange`：
- 乐观更新本地 state（prepend 到列表）
- 调用 `window.api.change.record(conversationId, change)`
- 成功后用返回的 id 更新本地条目

**验证**: `pnpm run typecheck`

---

### Step 5: chatStore — tool_result 文件检测 + agent_count 维护

**文件**: `src/renderer/src/stores/chatStore.ts`

#### 5a: 文件变更检测

在 `tool_result` case 中，识别文件操作 tool 并调用 changeStore：

```ts
const FILE_OPERATION_TOOLS = new Set(['Write', 'Edit', 'Delete', 'MultiEdit'])

function extractFileChange(toolName: string, toolInput: string, success: boolean) {
  if (!success) return null
  const base = toolName.startsWith('mcp__') ? toolName.split('__').slice(-1)[0] : toolName
  if (!FILE_OPERATION_TOOLS.has(base)) return null

  try {
    const parsed = JSON.parse(toolInput)
    const path = parsed.file_path || parsed.path
    if (!path) return null

    const status = base === 'Write' ? 'added' : base === 'Delete' ? 'deleted' : 'modified'
    let additions = 0, deletions = 0

    if (base === 'Edit' && parsed.old_string && parsed.new_string) {
      additions = (parsed.new_string.match(/\n/g) || []).length + 1
      deletions = (parsed.old_string.match(/\n/g) || []).length + 1
    } else if (base === 'Write' && parsed.content) {
      additions = (parsed.content.match(/\n/g) || []).length + 1
    }

    return { path, status, additions, deletions }
  } catch {
    return null
  }
}
```

在 `tool_result` 分支末尾：

```ts
const convId = state.currentConversation?.id
if (convId && event.success) {
  const tool = state.tools[event.toolCallId]
  if (tool) {
    const change = extractFileChange(tool.name, tool.input, event.success)
    if (change) {
      useChangeStore.getState().recordChange(convId, {
        ...change,
        toolCallId: event.toolCallId
      }).catch(() => {})
      // 乐观更新 conversations 列表中的 change_count
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === convId ? { ...c, change_count: c.change_count + 1 } : c
        ),
        currentConversation: s.currentConversation?.id === convId
          ? { ...s.currentConversation, change_count: s.currentConversation.change_count + 1 }
          : s.currentConversation
      }))
    }
  }
}
```

#### 5b: agent_count 维护

在 `subagent_started` 分支增加：

```ts
const convId = state.currentConversation?.id
if (convId) {
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === convId ? { ...c, agent_count: c.agent_count + 1 } : c
    ),
    currentConversation: s.currentConversation?.id === convId
      ? { ...s.currentConversation, agent_count: s.currentConversation.agent_count + 1 }
      : s.currentConversation
  }))
  // 持久化
  window.api.conversation.update(convId, {
    agent_count: (state.currentConversation?.agent_count ?? 0) + 1
  }).catch(() => {})
}
```

> 注：`conversation:update` 目前只允许 `title/title_source/model/provider` 字段，需在 Step 5 中扩展 allowedFields。

**验证**: `pnpm run typecheck`

---

### Step 6: conversation:update 扩展 allowedFields

**文件**: `src/main/ipc/conversation.ts`

在 `conversation:update` handler 中，扩展 allowedFields：

```ts
const allowedFields = new Set(['title', 'title_source', 'model', 'provider', 'agent_count'])
```

> `change_count` 不暴露给 renderer 直接更新，始终由 `change:record` 在事务中自增，保证计数准确。

**验证**: `pnpm run typecheck`

---

### Step 7: DiffPanel 接入真实数据

**文件**: `src/renderer/src/components/workspace/DiffPanel.tsx`

从 `useParams().id` 取当前 conversationId，从 `changeStore` 读取数据：

```tsx
export function DiffPanel() {
  const { id: conversationId } = useParams<{ id: string }>()
  const changes = useChangeStore((s) =>
    conversationId ? (s.changes[conversationId] ?? []) : []
  )

  // 按路由切换时加载
  useEffect(() => {
    if (conversationId) {
      useChangeStore.getState().loadChanges(conversationId)
    }
  }, [conversationId])

  if (changes.length === 0) { /* 空状态 */ }

  return changes.map((change) => <FileDiffCard key={change.id} change={change} />)
}
```

删除 `SAMPLE_DIFFS` 硬编码。保留现有的 diff hunk UI 结构，但数据来源改为真实数据。

> 本阶段不计算行级 diff（hunk），只展示文件列表 + additions/deletions 数字。详细 hunk 是 P1 工作。

**验证**: `pnpm run typecheck`

---

### Step 8: Build & Visual Check

```bash
pnpm build
# 启动 pnpm dev，验证：
# 1. Agent 调用 Edit/Write/Delete → DiffPanel 出现对应文件条目
# 2. TaskRail 中 change_count 数字递增
# 3. TaskRail 中 agent_count 在子代理启动时递增
# 4. 切换 conversation → DiffPanel 清空并加载对应变更
# 5. 无 SAMPLE_DIFFS 硬编码残留
```

---

## 每步完成标准

| Step | typecheck | build | 目视验证 |
|------|:---:|:---:|:---:|
| 1. DB Schema | ✅ | — | — |
| 2. IPC | ✅ | ✅ | — |
| 3. Preload + Types | ✅ | — | — |
| 4. changeStore | ✅ | ✅ | — |
| 5. chatStore 检测 | ✅ | ✅ | — |
| 6. allowedFields 扩展 | ✅ | — | — |
| 7. DiffPanel | ✅ | ✅ | ✅ |
| 8. Build | — | ✅ | ✅ |

## P0 vs P1 范围

| 版本 | 内容 |
|------|------|
| **P0（本计划）** | tool_result 捕获 Write/Edit/Delete → file_changes 持久化 → DiffPanel 展示文件列表 + 数字 |
| **P1（后续）** | 行级 diff hunk（before/after 对比）、SessionChangesSummary 组件、点击跳转 CodePanel |

## 变更文件清单

| 文件 | 类型 |
|------|------|
| `src/main/core/db.ts` | 修改 |
| `src/main/ipc/change.ts` | 新建 |
| `src/main/ipc/index.ts` | 修改（注册） |
| `src/main/ipc/conversation.ts` | 修改（allowedFields） |
| `src/preload/index.ts` | 修改 |
| `src/renderer/src/types/global.d.ts` | 修改 |
| `src/renderer/src/stores/changeStore.ts` | 新建 |
| `src/renderer/src/stores/chatStore.ts` | 修改 |
| `src/renderer/src/components/workspace/DiffPanel.tsx` | 修改 |
