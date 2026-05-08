---
status: active
owner: bytro
last_verified: 2026-05-01
doc_kind: plan
source: docs/features/memory-palace.md
progress: not-started
---

# Module C Implementation Plan: Memory Palace（记忆殿堂）

> 前置条件：Module A 剩余 P1 问题（A-P1-1、A-P1-3、A-P1-4）修复完成后开始。

## 关键架构决策

**不建新表。使用现有 `project_memory_items` 表。**

原设计（C-memory-palace.md）里 `memory_palace_items` 方案已废弃。理由：
- Memory Palace IS ProjectMemory，同一份数据，用户和 agent 共同读写
- `project_memory_items` 已有 FTS 索引，agent 已通过 `buildMemoryContext` 读取该表
- 新建表会导致两套数据孤立，agent 读不到 Memory Palace 写入的条目

schema 变更只需 `ALTER TABLE` 加两列，不需要 SCHEMA_VERSION 大改。

---

## Phase 1：Schema 迁移 + IPC

**目标**：`project_memory_items` 支持 Memory Palace 所需字段，IPC 可读写。

### Step 1.1 Schema v6 迁移

**文件**：`src/main/core/db.ts`

`SCHEMA_VERSION` 从 5 → 6：

```sql
-- 在 project_memory_items 上新增两列
ALTER TABLE project_memory_items ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_memory_items ADD COLUMN cited_by TEXT NOT NULL DEFAULT '[]';
```

同时在 `memory_fts` 的触发器中加入这两个字段（或保持现状——tags/cited_by 不参与全文检索均可）。

在 workspace 首次创建时（`workspace:create` handler）插入 3-4 条 seed 条目（`status: 'active'`，`kind` 用新分类值）：
- "Bytro 技术栈与定位" (core)
- "Electron IPC 安全约束" (architecture)
- "react-resizable-panels v4 API 差异" (antipatterns)

### Step 1.2 类型定义

在现有类型文件中新增（或扩展）：

```ts
export type MemoryCategory = 'core' | 'architecture' | 'conventions' | 'antipatterns' | 'decisions'

export interface MemoryEntry {
  id: string
  workspaceId: string
  category: MemoryCategory   // 对应 DB 的 kind 字段
  title: string
  content: string
  tags: string[]             // JSON array
  citedBy: string[]          // JSON array，P2 时由 agent 写入
  createdAt: number          // unixepoch
  updatedAt: number
}
```

### Step 1.3 IPC Handlers

**文件**：`src/main/ipc/memory-palace.ts`（新建）

查询 `project_memory_items` 表，`status = 'active'`，`kind` 即为 category 值：

```ts
// memory-palace:list(workspaceId, category?) → MemoryEntry[]
// memory-palace:create(workspaceId, entry) → MemoryEntry
// memory-palace:update(id, patch) → MemoryEntry
// memory-palace:delete(id) → void
```

- `list`：`SELECT ... WHERE workspace_id = ? AND status = 'active' [AND kind = ?]`
- `create`：INSERT，`status = 'active'`，`source_path = NULL`
- `update`：UPDATE，更新 `updated_at = unixepoch()`
- `delete`：DELETE（Memory Palace 直接删，不走 tombstone）

注册入口：`src/main/index.ts`，与 `registerChangeHandlers` 同级。

### Step 1.4 Preload 桥接

**文件**：`src/preload/index.ts`

```ts
memoryPalace: {
  list:   (workspaceId: string, category?: string) => ipcRenderer.invoke('memory-palace:list', workspaceId, category),
  create: (workspaceId: string, entry: NewEntryData) => ipcRenderer.invoke('memory-palace:create', workspaceId, entry),
  update: (id: string, patch: PatchData) => ipcRenderer.invoke('memory-palace:update', id, patch),
  delete: (id: string) => ipcRenderer.invoke('memory-palace:delete', id),
}
```

**验证**：`pnpm run typecheck` 通过。

---

## Phase 2：Store

**文件**：`src/renderer/src/stores/memoryPalaceStore.ts`（新建）

```ts
interface MemoryPalaceStore {
  items: MemoryEntry[]
  filterCategory: MemoryCategory | 'all'
  selectedId: string | null
  isEditing: boolean
  editDraft: Partial<MemoryEntry>
  _openPanelSeq: number   // WorkspaceArea 监听此值变化

  loadItems: (workspaceId: string) => Promise<void>
  createItem: (workspaceId: string, data: NewEntryData) => Promise<void>
  updateItem: (id: string, patch: PatchData) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  setFilter: (category: MemoryCategory | 'all') => void
  selectEntry: (id: string | null) => void
  startEditing: () => void
  cancelEditing: () => void
  setDraft: (patch: Partial<MemoryEntry>) => void
  requestOpenPanel: () => void
}
```

workspace 切换时 reload：在 store 内订阅 `useWorkspaceStore(s => s.currentWorkspaceId)`，变化时调用 `loadItems`。

**验证**：`pnpm run typecheck` 通过。

---

## Phase 3：WorkspaceArea 扩展

**文件**：`src/renderer/src/components/workspace/WorkspaceArea.tsx`

改动点：
1. `PanelType` 加 `'memory'`
2. `PANEL_TEMPLATES` 加 `{ type: 'memory', label: 'Memory Palace', icon: <Brain size={15} /> }`
3. render switch 加 `{activePanel?.type === 'memory' && <MemoryContent />}`
4. 加 `useEffect` 监听 `memoryPalaceStore._openPanelSeq`，变化时调用 `addPanel('memory')`

**验证**：能在 WorkspaceArea 切换到 Memory 标签（内容暂为空）。

---

## Phase 4：MemoryContent 组件

**文件**：`src/renderer/src/components/workspace/MemoryContent.tsx`（新建）

布局参考 `docs/design/modules/C-memory-palace.md` §4.1：

```
左栏 220px
  分类 tab（All / Core / Architecture / Conventions / Anti-patterns / Decisions）
  条目列表（彩色圆点 + 标题）
  [+ New Entry] 按钮

右栏 flex-1
  查看模式：标题 + Markdown 渲染 + citedBy + updatedAt + [Edit] [Delete]
  编辑模式：title input + content textarea(6行) + category select + [Save] [Cancel]
  空状态：selectedId 为 null 时展示提示文字
```

状态全部来自 `memoryPalaceStore`。内联 Markdown 渲染（不引入外部库）：`**bold**`、`` `code` ``、`- list`、`## heading`。

**验证**：CRUD 完整，分类筛选正常，重启后数据保留。

---

## Phase 5：TaskRail 迷你区

**文件**：`src/renderer/src/components/workspace/TaskRail.tsx`

在 TaskRail 底部加折叠/展开区：

```tsx
const topMemories = useMemoryPalaceStore(s =>
  [...s.items].sort((a, b) => b.citedBy.length - a.citedBy.length).slice(0, 3)
)
// 点击 "Open Memory Palace" → memoryPalaceStore.requestOpenPanel()
```

**验证**：折叠/展开正常，点击后 WorkspaceArea 打开 Memory 面板。

---

## Phase 6：测试

| 测试目标 | 类型 |
|---------|------|
| `memory-palace:list/create/update/delete` IPC handler | 单测 |
| schema v6 迁移（ALTER TABLE）不破坏现有数据 | 集成测试 |
| store `loadItems` / `createItem` / `updateItem` / `deleteItem` | 单测 |
| workspace 切换时 store reload | 单测 |
| MemoryContent CRUD 流程 | 组件测试 |
| 内联 Markdown 各格式 | 单测 |
| `buildMemoryContext` 能读到 Memory Palace 写入的条目 | 集成测试 |

---

## 完成标准

- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 全绿
- [ ] 写入条目后，下次对话 agent 能在 `buildMemoryContext` 中读到该条目
- [ ] WorkspaceArea Memory 面板可 CRUD，重启数据保留
- [ ] TaskRail 迷你区正常展示和跳转
- [ ] 现有 `memory_candidates` / candidate 审批流不受影响

## 不在范围

- Agent 自动写入 `cited_by`（P2）
- tags 编辑 UI（P1）
- 全文搜索 UI（FTS 已有，UI 入口后续）
- `.bytro/project-memory.md` 文件同步（Memory Palace 直接写 DB，不走文件层）
