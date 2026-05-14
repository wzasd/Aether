---
status: active
priority: P2
last_verified: 2026-05-13
doc_kind: feature
---

# Feature: Memory Palace（记忆殿堂）

## Why（为什么做）

Memory Palace 是整个项目的知识库——用户和 AI agent 共同使用同一份数据。用户在 UI 里浏览和编辑，agent 在启动时自动获得注入的上下文。

它不是独立的笔记工具，而是 ProjectMemory 层的前端入口：
- 用户通过 Memory Palace UI 直接写入结构化知识（不走 candidate 审批流程，用户是可信写入者）
- Agent 通过 `buildMemoryContext` 在每次对话启动时自动读取（已有机制，见 `chatStore.ts:buildMemoryContext`）
- 同一份数据：`project_memory_items` 表，已有 FTS 索引（`memory_fts`）

**与 candidate 流程的关系**：
- 用户手动写入：Memory Palace UI 直接写 `project_memory_items`。
- Agent 自动蒸馏：`conversation:completed` 触发 distiller，按 category 直接写 `project_memory_items` 的 `active/draft`，同时写一条 `memory_candidates(status=materialized)` 作为审计日志。

完整架构设计见：[Memory Palace Design](../architecture/memory-palace-design.md)。

## What（功能需求）

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| C1 | 条目 CRUD | 创建/编辑/删除条目（category + title + content） | P0 |
| C2 | 分类筛选 | 按 5 个分类筛选 | P0 |
| C3 | MemoryContent 面板 | WorkspaceArea 的 `type:'memory'` 面板，左右双栏布局 | P0 |
| C4 | 持久化到 project_memory_items | 用已有表，schema v6 加 tags + cited_by 字段 | P0 |
| C5 | TaskRail 迷你区 | 底部展示 cited_by 最多的前 3 条 | P0 |
| C6 | Agent 自动读取 | 通过现有 buildMemoryContext 注入（已有机制） | 已有 |
| C7 | cited_by 自动写入 | Agent 引用时自动记录 | P2 |
| C8 | tags 编辑 UI | 编辑模式中管理 tags | ✅ |
| C9 | JSONL 导出导入 | 导出 active memory、从 JSONL 导入并按 id 跳过冲突 | ✅ |
| C10 | 自动蒸馏落库 | conversation 完成后提取决策/惯例/反模式，按 category 写 active/draft | ✅ |

## How（设计决策）

### 数据层

**使用现有 `project_memory_items` 表**。早期 schema v6 新增 `tags/cited_by`，Memory Palace Phase 1 后续新增 `category/source_doc`：

```sql
-- Migration v5 → v6: 在现有表上加列
ALTER TABLE project_memory_items ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_memory_items ADD COLUMN cited_by TEXT NOT NULL DEFAULT '[]';

-- Memory Palace category/doc index
ALTER TABLE project_memory_items ADD COLUMN category TEXT DEFAULT 'general';
ALTER TABLE project_memory_items ADD COLUMN source_doc TEXT DEFAULT NULL;
```

`kind` 字段值对齐 Memory Palace 分类（现有 kind 值已废弃，统一使用新值）：

| Memory Palace 分类 | kind 值 | 原 kind 值对应 |
|---|---|---|
| core | `core` | fact |
| architecture | `architecture` | fact / decision |
| conventions | `conventions` | convention |
| antipatterns | `antipatterns` | mistake / lesson |
| decisions | `decisions` | decision |

用户手动写入的 `status` 固定为 `'active'`。自动蒸馏写入时由 `DEFAULT_STATUS_BY_CATEGORY` 决定：`core/antipatterns` 自动 `active`，`conventions/decisions/architecture` 先 `draft`。

**FTS 已有**：`memory_fts` 触发器在 INSERT/DELETE `project_memory_items` 时自动更新，Memory Palace 写入会自动被索引，无需额外处理。

### IPC 层

命名空间 `memory-palace:*`，底层查 `project_memory_items` 表：

| handler | 参数 | 返回 |
|---------|------|------|
| `memory-palace:list` | `workspaceId, category?` | `MemoryEntry[]` |
| `memory-palace:create` | `workspaceId, entry` | `MemoryEntry` |
| `memory-palace:update` | `id, patch` | `MemoryEntry` |
| `memory-palace:delete` | `id` | `void` |
| `memory-palace:export` | `workspaceId, filePath` | `{ path, count }` |
| `memory-palace:import` | `workspaceId, filePath` | `{ imported, skipped }` |

用新命名空间而非直接扩展 `memory:*`，原因：`memory:*` 是候选审批流专用，两者语义不同，分开更清晰。

### Store 层

`memoryPalaceStore.ts`（Zustand）：

```ts
interface MemoryPalaceStore {
  items: MemoryEntry[]
  filterCategory: MemoryCategory | 'all'
  selectedId: string | null
  isEditing: boolean
  editDraft: Partial<MemoryEntry>

  loadItems: (workspaceId: string) => Promise<void>
  createItem: (workspaceId: string, data: NewEntryData) => Promise<void>
  updateItem: (id: string, patch: Partial<MemoryEntry>) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  setFilter: (category: MemoryCategory | 'all') => void
  selectEntry: (id: string | null) => void
  startEditing: () => void
  cancelEditing: () => void
  setDraft: (patch: Partial<MemoryEntry>) => void
  requestOpenPanel: () => void   // WorkspaceArea 监听此 action 打开 memory 面板
}
```

workspace 切换时 reload：订阅 `useWorkspaceStore` 的 `currentWorkspaceId` 变化。

### UI 层

**WorkspaceArea**：`PanelType` 加 `'memory'`，添加 Memory Palace tab，render switch 加 `<MemoryContent />`。

**打开面板**：TaskRail 调用 `memoryPalaceStore.requestOpenPanel()`，WorkspaceArea 用 `useEffect` 监听并调用内部 `addPanel('memory')`。不用 trigger counter prop drilling。

**Markdown 渲染**：内联实现，不引入外部库。支持 `**bold**`、`` `code` ``、`- list`、`## heading`。

### Agent 读取路径

当前有两条读取路径：

- Renderer 启动对话时的 `buildMemoryContext` 会读取 `project_memory_items`。
- Main 侧 `context-selector.ts` 会按 category 优先级、任务关键词和 Agent role 过滤注入，并轻量注入 `[PROJECT DOCS]` 索引。

## Status（当前状态）

✅ **Phase 1–6 已实现**（2026-05-02）
✅ **Memory Palace Phase 1 增强已实现**（2026-05-13）

- Schema v6：`project_memory_items` 新增 `tags` 和 `cited_by` 列（ALTER TABLE）
- IPC：`memory-palace:list/create/update/delete` 全部注册
- Preload：`window.api.memoryPalace.*` 桥接
- Store：`useMemoryPalaceStore`（CRUD + filterCategory + _openPanelSeq）
- UI：WorkspaceArea 加 `'memory'` PanelType，MemoryContent 左右双栏组件
- TaskRail：底部 Memory Palace 迷你区（折叠/展开 + top 3 + Open 跳转）
- C8：Tags 编辑 UI（逗号分隔、Enter 添加、× 删除）
- Phase 6 测试：markdown 工具函数 18 个测试、store 18 个测试
- Schema：`category/tags/source_doc` 支持
- Context：category-aware injection + docs index
- JSONL：`memory-palace:export/import`
- Auto distill：`conversation:completed` → `A2AMemoryDistiller` → `project_memory_items` + audit candidate
- Verification：typecheck clean，313 tests pass / 3 skipped，build pass

待完成：
- C7 cited_by 自动写入（P2）
- draft/active UI 审批
- JSONL append-only / git sync
- Project Scanner cold start

实现计划：[→ docs/plans/2026-05-01-module-C-implementation.md](../plans/2026-05-01-module-C-implementation.md)

## Code（代码位置）

- `src/main/ipc/memory-palace.ts` — IPC 处理器
- `src/main/core/db.ts` — Schema（tags, cited_by, category, source_doc）
- `src/main/core/memory-index.ts` — Memory Palace/candidate 写入 API
- `src/main/ai/context-selector.ts` — category-aware injection + project docs index
- `src/main/ai/a2a-memory-distiller.ts` — conversation 完成后的链级蒸馏
- `src/main/daemon/daemon.ts` — `conversation:completed` 事件触发
- `src/preload/index.ts` — `window.api.memoryPalace.*` 桥接
- `src/renderer/src/stores/memoryPalaceStore.ts` — Zustand CRUD + filter + draft
- `src/renderer/src/stores/memoryPalaceStore.test.ts` — 18 个单测
- `src/renderer/src/components/workspace/MemoryContent.tsx` — UI 面板（含 C8 tags 编辑）
- `src/renderer/src/components/workspace/WorkspaceArea.tsx` — 加 memory panel type
- `src/renderer/src/components/workspace/TaskRail.tsx` — Plus 迷你区
- `src/renderer/src/utils/markdown.ts` — 内联 Markdown 解析（C6 提取）
- `src/renderer/src/utils/markdown.test.ts` — 18 个单测

**参考设计**：`docs/design/modules/C-memory-palace.md`
**完整架构**：`docs/architecture/memory-palace-design.md`
