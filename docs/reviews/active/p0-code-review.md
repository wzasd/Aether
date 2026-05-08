---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: review
source: docs/specs/2026-04-28-bytro-p0-review.md
---

# Active P0 Code Review

This file contains only current unresolved findings. Historical review detail remains in `docs/specs/2026-04-28-bytro-p0-review.md`.

## Current Verification

- `pnpm run typecheck`: ✅ passing on 2026-04-30
- `pnpm build`: ✅ passing on 2026-04-30

## Findings

## Status Update 2026-05-01

- `DiffPanel 使用硬编码示例数据` is resolved by Module B; DiffPanel now reads `changeStore`.
- Preview allowlist no longer includes `0.0.0.0`; the remaining Preview issue is the missing `allow-popups` sandbox permission.
- BottomOutput resize, simulated output, duplicate divider, and missing tab badges remain open and should be collapsed into one BottomOutput implementation task.

### ~~[P0] react-resizable-panels v4 defaultSize 数值被当作 px 而非 %~~ → 已修复

- File: `src/renderer/src/components/workspace/WorkspaceShell.tsx`
- Status: **resolved**

`react-resizable-panels` v4 重大 API 变更：**数值型 `defaultSize`/`minSize`/`maxSize`/`collapsedSize` 被当作像素（px），而非百分比**。字符串无单位值（如 `"17"`）或带 `%` 后缀（如 `"17%"`）才是百分比。

原代码 `defaultSize={17}` = 17px，导致三栏总宽仅 100px，Workspace 面板占据剩余 90%+ 空间且拖拽无法缩小（因为 minSize={20}=20px 约束太小）。

Fix: 所有 size prop 改为百分比字符串格式（`"17%"`、`"8%"`、`"35%"`、`"0%"` 等）。

---

### ~~[P1] 点击 Task 项闪屏~~ → 已修复

- File: `src/renderer/src/stores/chatStore.ts` (L320-322)
- File: `src/renderer/src/pages/Chat.tsx` (L44-52)
- Status: **resolved**

点击 Task 项时，`loadConversation` 无条件 `set({ loading: true })`，导致两个闪屏：
1. **ChatPage**：`currentConversation` 为 null + `loading: true` → 渲染 "Conversation not found" → 数据加载后重新渲染消息列表
2. **TaskRail**：`loading: true` → 任务列表显示 "Loading..." → 数据加载后恢复列表

根因：`loadConversation` 不区分"首次加载"和"切换会话"两种场景。切换会话时不应触发全局 `loading: true`，应保留旧数据直到新数据加载完成后一次性替换。

Fix:
1. `loadConversation` 只在首次加载（`currentConversation === null`）时设 `loading: true`
2. `ChatPage` 新增 `loading && !currentConversation` 判断，显示 "Loading..." 而非 "Conversation not found"

**防回归要点**：任何异步加载函数（`loadXxx`）在设置 `loading: true` 前，必须考虑是否已有旧数据可展示。如果有，应保留旧数据直到新数据就绪，避免中间态闪烁。这是 Zustand store 中常见的模式：**乐观保留 → 原子替换**。

---

### [P1] BottomOutput 底部面板高度不可拖拽调整

- File: `src/renderer/src/components/workspace/WorkspaceShell.tsx`
- Lines: 130-139
- Status: open

WorkspaceShell 中底部面板使用固定 `h-[30%]` 高度，无法通过拖拽调整大小。PRD 4.3 定义"编辑器区域和底部面板可垂直拖拽调整大小"。当前 Workspace 面板内部没有使用 `react-resizable-panels` 的垂直 `Group` 来分割内容区和底部面板。

Recommended fix: 将 Workspace 面板内部改为垂直 `Group`，上方为内容区、下方为 BottomOutput，使用 `Separator` 实现拖拽调整。这与三栏水平布局的模式一致。

---

### [P1] PreviewPanel sandbox 缺少 `allow-popups`

- File: `src/renderer/src/components/workspace/PreviewPanel.tsx`
- Lines: 4, 66
- Status: partially resolved

技术选型文档 `workspace-surfaces-technology.md` P0 Preview allowlist 明确列出三个 origins：`http://localhost:*`、`http://127.0.0.1:*`、`http://[::1]:*`。PreviewPanel 的 `LOCALHOST_PATTERN` 允许 `localhost`/`127.0.0.1`/`[::1]` 是正确的，但正则中还包含了 `0\.0\.0\.0`，这不在技术选型文档的 allowlist 中。`0.0.0.0` 在某些系统上可能绑定到所有网络接口，存在安全隐患。

此外 `sandbox="allow-scripts allow-same-origin allow-forms"` 缺少 `allow-popups`。技术选型文档 P0 提到需要"同窗口导航"能力，没有 `allow-popups` 时 iframe 内的导航行为可能受限。

Update 2026-05-01: `0.0.0.0` has been removed from `LOCALHOST_PATTERN`; `allow-popups` is still missing.

Recommended fix:
1. `sandbox` 属性补充 `allow-popups`（注意不要加 `allow-popups-to-escape-sandbox`，以保持沙箱边界）

---

### [P2] `autoSaveId` 多 Project 支持

- File: `src/renderer/src/components/workspace/WorkspaceShell.tsx`
- Status: open

WorkspaceShell 已改为 `bytro-main-layout-${currentWorkspaceId ?? 'global'}`，支持多 Project 布局持久化。但三栏水平布局的 `Group` 使用 `key={layoutStorageKey}`，切换 Project 时会重新挂载所有面板组件，导致状态丢失。

Recommended fix: 切换 Project 时，使用 `Panel.setLayout()` API 编程式调整面板尺寸，而非通过 `key` 重新挂载。

---

### [P2] `active_agent_id` 冗余字段

- File: `docs/specs/2026-04-30-bytro-ai-native-workspace-prd.md`
- Status: open

PRD 附录 F 的 v3 迁移中 `tasks` 表有 `active_agent_id` 字段，但 task-system.md 的 DDL 和 db.ts 实际建表中没有此列。

Recommended fix: `active_agent_id` 可以从 `task_agents` 表推导（`WHERE task_id = ? AND status != 'idle' LIMIT 1`），不需要冗余存储。如果需要快速查询，可以添加但需要维护一致性。

---

### ~~[P2] DiffPanel 使用硬编码示例数据~~ → 已修复

- File: `src/renderer/src/components/workspace/DiffPanel.tsx`
- Status: resolved

DiffPanel 当前使用 `SAMPLE_DIFFS` 硬编码数据展示行级 diff。阶段五实现变更可见性时，需要替换为从 `file_changes` 表读取真实 diff 数据。

Fix: Module B removed `SAMPLE_DIFFS`; DiffPanel now reads conversation changes from `changeStore`.

---

### [P2] PreviewPanel 默认 URL 硬编码

- File: `src/renderer/src/components/workspace/PreviewPanel.tsx`
- Status: open

PreviewPanel 默认 URL 为 `http://localhost:5173`，但不同项目的 dev server 端口不同。

Recommended fix: 从项目配置或 Settings 中读取默认预览 URL，或提供最近使用的 URL 列表。

---

### [P2] ExplorerPanel 宽度硬编码

- File: `src/renderer/src/components/workspace/ExplorerPanel.tsx`
- Status: open

ExplorerPanel 使用 `w-52`（208px）固定宽度。如果项目目录层级深，文件名可能被截断。

Recommended fix: 后续可改为可拖拽调整宽度，或使用 `min-w-48 max-w-80` 弹性范围。

---

### [P2] BottomOutput 使用模拟数据

- File: `src/renderer/src/components/workspace/BottomOutput.tsx`
- Status: open

BottomOutput 的 4 个标签页（Terminal/Build/Test/Diagnostics）均使用硬编码的模拟输出内容。阶段七实现真实终端时，需要替换为 `terminal_sessions` + `terminal_chunks` 数据。

Recommended fix: 阶段七实现时，Terminal 标签页接入 `window.api.terminal` IPC，Build/Test/Diagnostics 标签页接入对应的 IPC 通道。

---

### [P2] WorkspaceArea `panelCounter` 使用模块级变量

- File: `src/renderer/src/components/workspace/WorkspaceArea.tsx`
- Line: 37
- Status: open

`let panelCounter = 3` 是模块级变量，在 HMR（开发模式热更新）时不会重置，可能导致面板 ID 递增不一致。在生产环境中不影响（页面刷新重置），但开发时可能产生意外行为。

Recommended fix: 使用 `useRef` 或 `useId` 替代模块级计数器，或在 `useState` 初始化时使用工厂函数。

---

### [P2] WorkspaceShell 底部面板 Separator 与 BottomOutput border-t 重复

- File: `src/renderer/src/components/workspace/WorkspaceShell.tsx` (L132)
- File: `src/renderer/src/components/workspace/BottomOutput.tsx` (L14)
- Status: open

WorkspaceShell 在底部面板前渲染了 `Separator`（带 `bg-zinc-900`），BottomOutput 自身又有 `border-t border-zinc-800`，视觉上可能产生双线效果。Separator 作为拖拽手柄已经提供了视觉分隔，BottomOutput 的 `border-t` 是多余的。

Recommended fix: 移除 BottomOutput 根 div 的 `border-t border-zinc-800`，由 WorkspaceShell 的 Separator 统一提供分隔线。

---

### [P2] BottomOutput 标签页缺少状态 badge

- File: `src/renderer/src/components/workspace/BottomOutput.tsx`
- Status: open

Diagnostics 标签页通常需要显示错误/警告计数 badge，Terminal 标签页可能需要显示运行状态指示器。当前 4 个标签页仅有文字，无法快速识别是否有活跃输出或问题。

Recommended fix: P0 阶段可接受纯文字标签。P1 接入真实终端数据后，为 Diagnostics 添加错误计数 badge（如 `Diagnostics (2)`），为 Terminal 添加运行状态圆点。

---

### [P1] TaskRail 任务卡片缺少删除/归档/重命名操作

- File: `src/renderer/src/components/workspace/TaskRail.tsx`
- Status: open

TaskRail 的任务卡片没有删除、归档、重命名的 UI 入口。后端 `task:delete` / `conversation:delete` IPC 和 `taskStore.deleteTask` / `chatStore.deleteConversation` 已存在，但 TaskRail 组件没有暴露这些操作。

PRD 4.1.3–4.1.4 已补充定义：
- Hover 任务卡片 → 右侧浮现删除按钮（X）和更多按钮（⋯）
- 删除按钮 → 确认对话框 → 级联删除
- 更多按钮 → 上下文菜单（Rename / Archive / Delete）

Recommended fix: 在 TaskRail 任务卡片中添加 hover 操作按钮和上下文菜单。归档功能需要 `conversations` 表新增 `archived` 字段或 `status = 'Archived'`。计划文档 P0.8 已记录此 Feature。

---

### [P2] 57 处违反 mochi-design-reference 字号规范

- Files: 8 个 workspace 组件文件
- Status: open

`mochi-design-reference.md` Section 4 严格禁止使用 Tailwind 内置字号类（`text-xs`、`text-sm`、`text-base` 等）和 `font-bold`/`font-semibold`，要求使用精确像素值（`text-[13px]`、`text-[12px]` 等）。当前代码有 57 处违反此规范。

主要违反文件：
- WorkspaceArea.tsx (12 处)
- SettingsPanel.tsx (17 处)
- SharedConversation.tsx (9 处)
- CodePanel.tsx (7 处)
- ExplorerPanel.tsx (4 处)
- PreviewPanel.tsx (4 处)
- BottomOutput.tsx (2 处)
- WorkspaceShell.tsx (2 处)

Recommended fix: 批量替换所有 `text-xs` → `text-[12px]`、`text-sm` → `text-[13px]`、`font-semibold` → `<strong>` 或 `font-medium` → 精确值。工作量较大，建议作为独立 PR 处理。

---

## Resolved In Latest Review (2026-04-30 Round 6 — M6+M7 Re-review)

- ~~[P2] PreviewPanel 默认 URL 硬编码~~ → 降级保留为 P2（确认仍需从配置读取）
- ~~[P2] ExplorerPanel 宽度硬编码~~ → 降级保留为 P2（确认仍需弹性宽度）

## Resolved From Prior Reviews (2026-04-30)

- ~~[P0] TaskStatus 大小写不一致~~ → 统一为 PascalCase
- ~~[P0] `task_agents` 表缺少 `provider_session_id` 列~~ → db.ts v3 迁移已补充
- ~~[P1] New Task writes to a nonexistent project~~ → 使用 workspaceStore.currentWorkspaceId
- ~~[P1] TaskRail collapse control is not wired~~ → WorkspaceShell 实现 handleCollapse/Expand
- ~~[P1] `taskStore` 的 `filter` 映射与 TaskStatus 不对齐~~ → getFilteredTasks() 映射
- ~~[P1] TaskItem 缺少 `agent_count` 和 `change_count` 字段~~ → global.d.ts + SQL LEFT JOIN
- ~~[P1] `task:create` 缺少 `project_id` 存在性校验~~ → workspace 存在性检查
- ~~[P1] TaskRail collapse/expand 缺少键盘快捷键~~ → Cmd+B 快捷键
- ~~[P1] SharedConversation 和 WorkspaceArea 是空壳占位~~ → SharedConversation 复用 ChatPage，WorkspaceArea 含标签栏 + Explorer + CodePanel
- ~~[P1] macOS 红绿灯区域留白~~ → TaskRail header pl-16
- ~~[P2] New task tables are outside an explicit schema migration boundary~~ → SCHEMA_VERSION 3
- ~~[P2] task IPC lacks validation and transactional writes~~ → task:create 校验 + updateStatus 白名单
- ~~[P2] `task:updateStatus` 缺少状态转换校验~~ → VALID_STATUSES 白名单
- ~~[P2] `task_events` 表 IPC 已暴露但缺少分页/限制~~ → limit 参数 + DESC 排序
- ~~[P2] `deleteTask` 缺少乐观更新~~ → 先本地移除，失败回滚
- ~~[P2] `global.d.ts` 缩进不一致~~ → 统一空格缩进
- ~~[P2] `file:read` 对大文件使用同步 readFileSync~~ → 异步化
- ~~[P2] `file:list` 深层目录扫描性能~~ → depth 参数 + 异步化

## Resolved From Prior Reviews (Pre-Phase-1)

- `memory:createProjectItem` is no longer exposed through preload/global types; renderer cannot directly create `project_memory_items`.
- `todo_updated` persistence is routed by `event.sessionId -> conversationId`, and visible Todo UI only updates when the originating conversation is currently selected.
- Safety timeout now calls `abortStream()`, which aborts the provider session and ends the memory agent session.
- Abort clears streaming text, thinking text, current tools, current tool ids, pending permissions, and pending questions.
- `EventParser` handles `input_json_delta` and initializes streamed tool input buffers as empty strings, avoiding `{}{...}` parse failures.
- `deleteProjectItem` now updates the durable project memory source when possible, or writes a deletion tombstone before deleting the read-model row.
