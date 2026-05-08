---
status: active
owner: mochi
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/main/ipc/change.ts (new)
  - src/main/core/db.ts
  - src/renderer/src/stores/changeStore.ts (new)
  - src/renderer/src/stores/chatStore.ts
  - src/renderer/src/components/workspace/DiffPanel.tsx
  - src/renderer/src/components/workspace/SharedConversation.tsx
---

# 模块 B: 文件变更追踪 — 设计文档

## 1. 用户流程

```
Agent 调用 Edit 工具修改 ToolCall.tsx
  │
  ├─ 前端收到 tool_start(Edit, file_path=ToolCall.tsx)
  ├─ 前端收到 tool_result(Edit, success=true)
  │
  ├─ chatStore 识别到文件操作 tool
  │   ├─ 记录 file_change (status=modified, path=ToolCall.tsx, additions=1, deletions=1)
  │   └─ 更新 task.change_count
  │
  ├─ DiffPanel 切换到 Track Changes 面板
  │   └─ 展示当前 Task 的 file_changes 列表（不再用硬编码假数据）
  │
  └─ SessionChangesSummary（composer 上方）
      └─ 展示 "+1 -1 ToolCall.tsx (modified)"
```

## 2. 核心策略：从 Tool Call 提取变更

**不依赖 fs.watch**，而是从 Agent 的 tool call 事件流中捕获文件操作：

| Tool | 变更类型 | 文件路径来源 | 增删行来源 |
|------|---------|------------|----------|
| Write | added (新建) | `file_path` | 写入内容行数 |
| Edit | modified (修改) | `file_path` | 从 `old_string`/`new_string` 计算 |
| Delete | deleted (删除) | `file_path` | 被删文件行数 |
| Bash | — | 不追踪 | 构建/测试命令不直接产生文件变更 |

## 3. 数据模型

### 3.1 `file_changes` 表（已在 DB schema 定义）

```sql
-- 已存在，确认字段一致
CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT,
  path TEXT NOT NULL,
  status TEXT NOT NULL,         -- 'modified' | 'added' | 'deleted'
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  diff_text TEXT,               -- 简单 diff 内容（新增字段）
  tool_call_id TEXT,            -- 关联的 tool call（新增字段）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_changes_task ON file_changes(task_id);
```

### 3.2 TypeScript 类型

```ts
// 复用设计规范中的定义
interface FileChange {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions?: number
  deletions?: number
  diffText?: string    // 简单 diff
}
```

## 4. 事件处理逻辑

### 4.1 chatStore.handleAIEvent 增强

在现有 `handleAIEvent` 的 `tool_result` 分支中增加文件变更检测：

```ts
case 'tool_result': {
  // ... 现有 tool state 更新逻辑

  // 新增：检测是否为文件操作 tool
  if (isFileOperationTool(toolName)) {
    const taskId = useTaskStore.getState().activeTaskId
    if (taskId) {
      // 提取文件路径和变更信息
      const change = extractFileChange(toolName, toolInput, toolResult)
      if (change) {
        // 记录到本地 + 通过 IPC 持久化
        useChangeStore.getState().recordChange(taskId, change)
        // 更新 task 的 change_count
        useTaskStore.getState().incrementChangeCount(taskId)
      }
    }
  }
}
```

### 4.2 文件操作识别

```ts
const FILE_OPERATION_TOOLS = new Set(['Write', 'Edit', 'Delete'])

function isFileOperationTool(toolName: string): boolean {
  // 移除 mcp__ 前缀检查
  const baseName = toolName.startsWith('mcp__') ? toolName.split('__').slice(1).join('__') : toolName
  return FILE_OPERATION_TOOLS.has(baseName)
}
```

### 4.3 变更信息提取

```ts
function extractFileChange(toolName: string, input: string, result: string): FileChange | null {
  try {
    const parsed = JSON.parse(input)
    const filePath = parsed.file_path || parsed.path
    if (!filePath) return null

    const status = toolName === 'Write' ? 'added' : toolName === 'Delete' ? 'deleted' : 'modified'

    // 计算增删行数
    let additions = 0, deletions = 0
    if (toolName === 'Edit' && parsed.old_string && parsed.new_string) {
      additions = parsed.new_string.split('\n').length - 1
      deletions = parsed.old_string.split('\n').length - 1
    } else if (toolName === 'Write' && result) {
      additions = result.split('\n').length
    }

    return { path: filePath, status, additions, deletions }
  } catch {
    return null
  }
}
```

## 5. IPC 变更

### 5.1 新增 `change:*` 命名空间

```ts
// src/main/ipc/change.ts
ipcMain.handle('change:record', (_, taskId, change) => {
  // INSERT INTO file_changes
  // UPDATE tasks SET change_count = change_count + 1, updated_at = now
})

ipcMain.handle('change:listForTask', (_, taskId) => {
  // SELECT * FROM file_changes WHERE task_id = ? ORDER BY created_at DESC
})

ipcMain.handle('change:getDiff', (_, changeId) => {
  // SELECT diff_text FROM file_changes WHERE id = ?
})
```

## 6. Store 变更

### 6.1 changeStore（新增）

```ts
interface ChangeState {
  changes: Record<string, FileChange[]>  // taskId → FileChange[]
  
  recordChange: (taskId: string, change: FileChange) => Promise<void>
  loadChangesForTask: (taskId: string) => Promise<void>
  getAggregatedChanges: (taskId: string) => FileChange[]
}
```

### 6.2 taskStore 新增

```ts
incrementChangeCount: (taskId: string) => void  // 本地乐观更新
```

## 7. UI 变更

### 7.1 DiffPanel 接入真实数据

`DiffPanel.tsx` 从 `changeStore` 读取当前 task 的变更列表，替换硬编码 `SAMPLE_DIFFS`：

```tsx
export function DiffPanel() {
  const activeTaskId = useTaskStore(s => s.activeTaskId)
  const changes = useChangeStore(s => 
    activeTaskId ? (s.changes[activeTaskId] ?? []) : []
  )

  if (changes.length === 0) {
    return <EmptyState />  // "Changes from active tasks will appear here"
  }

  return changes.map(change => <FileDiffCard key={change.path} change={change} />)
}
```

### 7.2 SessionChangesSummary 接入 SharedConversation

`SharedConversation.tsx` 中 composer 上方增加 `SessionChangesSummary` 组件。该组件：
- 读取当前 task 的 changeStore 数据
- 聚合去重（同文件多次修改取最后一次）
- 展开/折叠，不可关闭

### 7.3 Follow Suggestions

点击变更文件 → WorkspaceArea 的 Code 面板打开对应文件（通过 `fileStore.openFile`）。

## 8. P0 vs P1 范围

| 版本 | 内容 |
|------|------|
| P0 | 从 tool call 捕获 Write/Edit/Delete → 记录 file_change → DiffPanel 展示列表 |
| P1 | 计算详细 diff（before/after 对比）、MiniChangesSummary、审批流 |

## 9. 未涉及的范围

- fs.watch 实时文件监控
- 非 Agent 造成的文件变更（用户手动编辑）
- 审批门控（risky operation confirmation）
