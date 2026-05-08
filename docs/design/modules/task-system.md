---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/main/core/db.ts
  - src/main/ipc/task.ts (new)
  - src/preload/index.ts
  - src/renderer/src/stores/taskStore.ts (new)
  - src/renderer/src/components/workspace/TaskRail.tsx (new)
---

# Task System

## Goal

Introduce a task-first data model and the TaskRail UI component. Every conversation and agent event belongs to an active task. The TaskRail shows the work queue with status, agent count, and change count, matching the Figma left panel.

## Data Model

### `tasks` Table

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Idle',
  mode TEXT DEFAULT 'build',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```

### `task_agents` Table

Tracks which agents are assigned to a task.

```sql
CREATE TABLE IF NOT EXISTS task_agents (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_profile_id TEXT NOT NULL,
  provider_session_id TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

### `task_events` Table

Append-only event log for task lifecycle.

```sql
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

### TypeScript Types

```ts
type TaskStatus = 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done'

interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  mode: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
  agent_count: number
  change_count: number
}

interface TaskAgent {
  id: string
  task_id: string
  agent_profile_id: string
  provider_session_id: string | null
  role: string
  status: 'idle' | 'thinking' | 'editing' | 'reviewing' | 'waiting'
  model: string | null
  created_at: number
  updated_at: number
}
```

## IPC Namespace: `task:*`

| Channel | Signature | Return |
|---------|-----------|--------|
| `task:create` | `(projectId: string, data: { title, description?, mode? })` | `Task` |
| `task:list` | `(projectId?: string) ` | `Task[]` |
| `task:get` | `(id: string)` | `Task \| undefined` |
| `task:updateStatus` | `(id: string, status: TaskStatus)` | `Task` |
| `task:delete` | `(id: string)` | `{ success: true }` |

Task creation also creates a `task_event` of type `task.created`.

## Preload API

```ts
api.task = {
  create: (projectId: string, data: { title: string; description?: string; mode?: string }) => ipcRenderer.invoke('task:create', projectId, data),
  list: (projectId?: string) => ipcRenderer.invoke('task:list', projectId),
  get: (id: string) => ipcRenderer.invoke('task:get', id),
  updateStatus: (id: string, status: string) => ipcRenderer.invoke('task:updateStatus', id, status),
  delete: (id: string) => ipcRenderer.invoke('task:delete', id),
}
```

## Renderer: `taskStore`

```ts
interface TaskState {
  tasks: Task[]
  activeTaskId: string | null
  filter: 'all' | 'active' | 'pending' | 'completed'
  loading: boolean

  loadTasks: (projectId?: string) => Promise<void>
  createTask: (projectId: string, data: { title: string; description?: string; mode?: string }) => Promise<Task>
  setActiveTask: (taskId: string) => void
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  setFilter: (filter: TaskState['filter']) => void
}
```

## Renderer: `TaskRail` Component

### Props

```ts
interface TaskRailProps {
  tasks: Task[]
  activeTaskId: string | null
  onTaskSelect: (taskId: string) => void
  onNewTask: () => void
  onToggleCollapse?: () => void
}
```

### Layout (matching Figma source)

```
┌─ Header (h-11, pl-16, border-b) ──────────────────────────────────┐
│  "Tasks"                                              [Collapse ◀] │
├─ New Task button (p-3, border-b) ─────────────────────────────────┤
│  [  + New Task  ]  (bg-blue-600, full-width)                       │
├─ Filter tabs (p-2, border-b) ─────────────────────────────────────┤
│  [All] [Active] [Pending] [Done]                                   │
├─ Task list (flex-1, overflow-y-auto) ─────────────────────────────┤
│  ┌─ Task row (p-3, border-b) ─────────────────────────────────┐   │
│  │  Task title (text-sm, line-clamp-2)                         │   │
│  │  Status • Time                                               │   │
│  │  N agents • M changes                                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ...                                                               │
└────────────────────────────────────────────────────────────────────┘
```

### Status Colors

| Status | Text Color |
|--------|-----------|
| Idle | `text-zinc-500` |
| Running | `text-blue-400` |
| Waiting | `text-yellow-400` |
| Error | `text-red-400` |
| Done | `text-green-400` |

### Active Task

Active task row has `bg-zinc-900` background and a `border-l-2 border-l-blue-500` left edge.

### States

| State | Behavior |
|-------|----------|
| Empty (no tasks) | Centered muted text "No tasks yet" |
| Empty (filtered) | "No matching tasks" |
| Loading | Skeleton rows or subtle spinner |
| Error | Inline error with retry |

## Implementation Steps

1. Add `tasks`, `task_agents`, `task_events` tables to `db.ts`
2. Create `src/main/ipc/task.ts` with `registerTaskIpc()`
3. Register in `src/main/ipc/index.ts`
4. Add `task` namespace to preload
5. Add types to `global.d.ts`
6. Create `src/renderer/src/stores/taskStore.ts`
7. Create `src/renderer/src/components/workspace/TaskRail.tsx`
8. Wire TaskRail into WorkspaceShell's `taskRail` slot

## Verification

- [ ] `pnpm run typecheck`
- [ ] `pnpm build`
- [ ] TaskRail visible in left panel
- [ ] Can create a new task
- [ ] Tasks filter correctly (All/Active/Pending/Done)
- [ ] Active task highlighted with blue left border
- [ ] Empty state renders when no tasks exist
