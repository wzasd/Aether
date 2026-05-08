---
status: active
owner: bytro
last_verified: 2026-05-01
doc_kind: design-reference
applies_to: all
source: mochi
---

# Bytro — Design & Architecture Reference

> **说明**：这份文档源自 Mochi 项目的设计规范，Bytro 项目以此为前端设计参考。每次修改 Bytro 前端代码前，请先阅读与你任务相关的章节。修改完成后，如有设计决策变化，请同步更新本文档。

## 目录

1. [项目定位](#1-项目定位)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [字体与字号体系](#4-字体与字号体系)
5. [颜色系统](#5-颜色系统)
6. [整体布局架构](#6-整体布局架构)
7. [组件详解](#7-组件详解)
   - [App.tsx](#71-apptsx)
   - [TaskRail.tsx](#72-taskrailtsx)
   - [SharedConversation.tsx](#73-sharedconversationtsx)
   - [WorkspaceArea.tsx](#74-workspaceareatsx)
   - [MemoryContent.tsx](#75-memorycontenttsx)
8. [数据类型总览](#8-数据类型总览)
9. [核心交互原则](#9-核心交互原则)
10. [react-resizable-panels 使用规范](#10-react-resizable-panels-使用规范)
11. [Tailwind 使用规范](#11-tailwind-使用规范)
12. [禁忌实践（Anti-patterns）](#12-禁忌实践anti-patterns)
13. [跨组件通信模式](#13-跨组件通信模式)
14. [Memory Palace — 记忆殿堂](#14-memory-palace--记忆殿堂)

---

## 1. 项目定位

Mochi 是一个 **AI Native 代码开发工作台**可交互原型。

- **定位**：任务驱动、多 Agent 协作、资源工作区主导
- **平台**：桌面端（不需要移动端响应式）
- **气质**：专业、克制、偏开发者工具（深色主题，zinc 色阶为主）
- **设计语言**：VS Code / Linear 的克制感，不是 Figma 的视觉丰富感

**核心原则**：AI 只产生建议，用户点击 **Follow Suggestions** 后才在 Workspace 打开对应资源。

---

## 2. 技术栈

| 层级 | 选型 |
|------|------|
| UI 框架 | React 18 + TypeScript |
| 样式 | Tailwind CSS v4（无 tailwind.config.js） |
| 布局拆分 | `react-resizable-panels` |
| Markdown 渲染 | `react-markdown` + `remark-gfm`（仅在 SharedConversation 中） |
| 图标 | `lucide-react` |
| 包管理 | pnpm |

---

## 3. 目录结构

```
src/
  app/
    App.tsx                          # 根组件，持有全局状态，组装三列布局
    components/
      TaskRail.tsx                   # 左列：任务列表 + 记忆殿堂迷你区
      SharedConversation.tsx         # 中列：对话流 + composer
      WorkspaceArea.tsx              # 右列：多面板工作区
      MemoryContent.tsx              # 记忆殿堂面板内容（WorkspaceArea 子内容）
      figma/
        ImageWithFallback.tsx        # ⚠️ 受保护文件，禁止修改
  styles/
    fonts.css                        # 字体 @import（只能在此文件加字体）
    theme.css                        # CSS 变量 / Tailwind token
```

---

## 4. 字体与字号体系

### 字体

```css
/* fonts.css */
UI 文字：Inter
代码/mono：JetBrains Mono
```

引用方式：`font-mono` → JetBrains Mono；其余默认 → Inter。

### 字号（严格使用精确值，禁止 Tailwind 内置字号类）

| 用途 | 值 | Tailwind 写法 |
|------|-----|--------------|
| 正文、内容气泡 | 13px | `text-[13px]` |
| 副文本、meta、sender | 12–12.5px | `text-[12px]` / `text-[12.5px]` |
| ToolCall label / badge | 12px | `text-[12px]` |
| Thinking preview / 小字 | 11–11.5px | `text-[11px]` / `text-[11.5px]` |
| 代码、mono、行号 | 11px | `text-[11px]` |
| 极小 tag / badge letter | 10–10.5px | `text-[10px]` / `text-[10.5px]` |

> ❌ 禁止使用：`text-xs`、`text-sm`、`text-base`、`text-lg`、`text-xl` 等
> ❌ 禁止使用：`font-bold`、`font-semibold`（通过 `<strong>` 或 theme 变量控制）
> ❌ 禁止使用：`leading-none`、`leading-tight` 等（通过精确 `leading-[1.65]` 等控制）

---

## 5. 颜色系统

Mochi 使用 `zinc` 作为中性色主调，语义色使用 Tailwind 默认色阶：

| 语义 | 颜色 |
|------|------|
| 背景最深层 | `zinc-950` |
| 面板背景 | `zinc-900` |
| 悬停/激活背景 | `zinc-800` |
| 边框 | `zinc-800` / `zinc-700`（强调） |
| 正文 | `zinc-200` / `zinc-300` |
| 次要文字 | `zinc-400` / `zinc-500` |
| 占位 / 禁用 | `zinc-600` / `zinc-700` |
| 主操作（CTA） | `blue-600` hover `blue-700` |
| Thinking 块 | `purple-400` |
| 成功 / 添加 | `emerald-400` / `green-400` |
| 警告 / 修改 | `yellow-400` / `amber-400` |
| 错误 / 删除 | `red-400` |
| Memory Palace | `violet-400` / `violet-500` |

### ToolCall 颜色映射

```ts
Bash      → #8B5CF6  (紫)
Read      → #3B82F6  (蓝)
Write/Edit→ #F59E0B  (琥珀)
Glob      → #10B981  (绿)
Grep      → #06B6D4  (青)
WebFetch/Search → #8B5CF6
Delete    → #EF4444  (红)
mcp__*    → #06B6D4
```

---

## 6. 整体布局架构

```
┌─────────────────────────────────────────────────────────────────┐
│ ●●●  [macOS traffic lights — absolute z-50 左上角]              │
├────────────┬──────────────────┬────────────────────────────────┤
│            │                  │  [Panel Tab Bar]               │
│            │                  ├────────────────────────────────┤
│ TaskRail   │  Shared          │  [File Tabs — Code 面板专属]   │
│            │  Conversation    │  [Follow Suggestions bar]      │
│  17%       │                  ├──────────────────┬─────────────┤
│  collap-   │  28%             │  Main Content    │ File        │
│  sible     │                  │  (PanelGroup     │ Explorer    │
│            │                  │   vertical)      │ or Outline  │
│            │                  ├──────────────────┴─────────────┤
│            │                  │  Bottom Panel                  │
│            │                  │  Terminal/Build/Test/Diag      │
└────────────┴──────────────────┴────────────────────────────────┘
```

### 列尺寸配置

> ⚠️ `react-resizable-panels` v4 API 变更：数值型 size 被当作像素（px），百分比必须用字符串格式（如 `"17%"`）。

```tsx
// TaskRail Panel
defaultSize="17%"  minSize="8%"  maxSize="35%"
collapsible  collapsedSize="0%"

// SharedConversation Panel
defaultSize="28%"  minSize="12%"  maxSize="70%"

// WorkspaceArea Panel
defaultSize="55%"  minSize="20%"  maxSize="70%"
collapsible  collapsedSize="0%"
```

> ⚠️ v4 中 Panel 外层默认 `height: auto`，在水平 Group 中需要 `style={{ height: '100%' }}` 才能让面板撑满全高。

### autoSaveId

```
横向 Group：autoSave="bytro-shell-layout"
纵向 Group：autoSave="workspace-vertical"
```

### macOS 窗口拖拽区域

> 本项目使用 Electron `titleBarStyle: 'hiddenInset'`，macOS traffic lights 由系统渲染在 (16, 16) 位置。
> 不需要手动渲染三色圆点。

```tsx
// 每个 Panel 内部顶部 38px 为窗口拖拽区域（-webkit-app-region: drag）
// 交互元素（按钮、输入框、Separator）使用 titlebar-no-drag 排除拖拽
<div className="titlebar-drag absolute top-0 left-0 right-0 h-[38px]" />
<div className="titlebar-no-drag flex-1 flex flex-col min-h-0 relative z-10">
  {/* 交互内容 */}
</div>
```

> ⚠️ 拖拽区域与面板内容重叠，不占额外布局空间。交互元素必须设 `titlebar-no-drag`，否则点击会触发窗口拖拽而非交互。

---

## 7. 组件详解

### 7.1 App.tsx

**职责**：根组件，持有顶层状态，组装三列布局。

**状态**：

```ts
taskRailCollapsed: boolean            // TaskRail 是否折叠
workspaceCollapsed: boolean           // Workspace 是否折叠
showSidePanel: boolean                // WorkspaceArea 右侧 Outline 面板
bottomPanelOpen: boolean              // WorkspaceArea 底部 Terminal 面板
```

**跨组件触发模式**（Trigger Pattern）：

```ts
// 父组件持有 counter，通过 useEffect 在子组件内响应变化
// 子组件不暴露 ref，父组件通过 trigger prop 驱动
const [memoryTrigger, setMemoryTrigger] = useState(0);
// 触发：setMemoryTrigger(n => n + 1)
// 子组件：useEffect(() => { if (!memoryTrigger) return; ... }, [memoryTrigger])
```

**TaskRail 折叠/展开**：

```ts
// 通过 PanelImperativeHandle ref 控制
const taskRailPanelRef = useRef<PanelImperativeHandle>(null);
taskRailPanelRef.current?.collapse();  // 折叠
taskRailPanelRef.current?.expand();    // 展开
```

---

### 7.2 TaskRail.tsx

**职责**：任务列表（上）+ 记忆殿堂迷你摘要区（下）。

**Props 接口**：

```ts
interface TaskRailProps {
  tasks: Task[];
  activeTaskId: string;
  onTaskSelect: (taskId: string) => void;
  onToggleCollapse?: () => void;   // 点击 ChevronLeft 折叠自身
  onOpenMemory?: () => void;        // 点击条目或"打开记忆殿堂"按钮
}
```

**Task 类型**：

```ts
interface Task {
  id: string;
  name: string;
  status: 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done';
  time: string;
  agentCount: number;
  changes: number;
}
```

**Task 状态颜色**：

```ts
Idle    → text-zinc-500
Running → text-blue-400
Waiting → text-yellow-400
Error   → text-red-400
Done    → text-green-400
```

**布局结构**（从上到下）：

1. Header 行（`h-11`，含 `pl-16` 为三色圆点留空间）
2. New Task 按钮
3. Filter tabs（all / active / pending / completed）
4. Task list（`flex-1 overflow-y-auto`）
5. Memory Palace 迷你区（`shrink-0`，底部固定）

**记忆殿堂迷你区**：
- 折叠/展开状态由 `memoryExpanded` 控制
- 展示 `INITIAL_MEMORIES` 中按 `citedBy.length` 降序排列的前 3 条
- 每条：彩色圆点（对应 category）+ 标题 + Agent 引用数
- 底部有"打开记忆殿堂"按钮，调用 `onOpenMemory`

---

### 7.3 SharedConversation.tsx

**职责**：对话流渲染（上）+ SessionChangesSummary（固定在 composer 上方）+ InputComposer（底部）。

**Props 接口**：

```ts
interface SharedConversationProps {
  agents: Agent[];
  messages: Message[];
  taskRailCollapsed?: boolean;
  onExpandTaskRail?: () => void;
  onOpenSettings?: () => void;
  onNewTask?: () => void;
  onViewChanges?: () => void;
}
```

**消息类型（Message.type）**：

| type | 渲染方式 |
|------|---------|
| `'user'` | 右对齐气泡，白底 / 蓝色 |
| `'agent'` | 左对齐，Thinking→ToolCalls→Content→Actions 顺序 |
| `'plan'` | 居中计划卡片，带序号列表 |
| `'change'` | `ChangesSummary` 组件（文件变更列表 + Follow Suggestions 按钮） |

**Agent 消息渲染顺序**（严格遵守）：

```
1. ThinkingBlock（紫色，默认折叠，预览截断 90 字符）
2. ToolCallItem × N（每个独立行，默认折叠）
3. Content 气泡（AgentMarkdownContent + 可选 MiniChangesSummary）
4. Copy / Retry 操作行（group-hover 显现，opacity-0 → opacity-100）
```

**子组件一览**：

| 组件 | 作用 |
|------|------|
| `ThinkingBlock` | 紫色可折叠 Thinking 块 |
| `ToolCallItem` | 单条 ToolCall 行，可展开查看 Input/Result |
| `AgentMessage` | 组合以上三层 + hover actions |
| `AgentMarkdownContent` | 用 `react-markdown` + `remark-gfm` 渲染 agent content |
| `ChangesSummary` | 独立 `type:'change'` 消息的文件变更卡片，含 Follow Suggestions |
| `MiniChangesSummary` | 嵌入 agent content 气泡底部的精简变更摘要 |
| `SessionChangesSummary` | **固定钉在 composer 正上方**，聚合本次会话所有 change 文件 |

**SessionChangesSummary 关键特性**：
- 只能展开/折叠，**不能关闭**（无 × 按钮）
- 不参与消息流滚动（`shrink-0` 在 flex column 中）
- 聚合逻辑：遍历所有 `type:'change'` 消息的 `files`，以 `path` 为 key 用 Map 去重，后者覆盖前者

**ToolCall formatInput 规则**：

```ts
Bash       → p.command
Read/Write/Delete → basename(p.file_path || p.path)
Edit       → basename(p.file_path)
Glob       → p.pattern
Grep       → `${p.pattern} in ${basename(p.path)}`
WebFetch   → p.url
WebSearch  → p.query
mcp__X__Y  → `X:Y`（从工具名解析）
其他       → 截断到 80 字符
```

**file tab 关闭按钮的特殊处理**：

```tsx
// 文件 tab 内的关闭 X 必须用 <span role="button">，不能用 <button>
// 因为外层已经是 <button>，嵌套 <button> 是非法 HTML
<span
  role="button"
  onClick={(e) => closeFileTab(tab.id, e)}
  onKeyDown={(e) => { if (e.key === 'Enter') closeFileTab(tab.id, e); }}
  className="..."
>
  <X size={10} />
</span>
```

**Header 区域**：
- `h-11`，含项目选择器（FolderOpen + 项目名 + ChevronDown 下拉）
- TaskRail 折叠时：左侧出现 `ChevronRight` 展开按钮，`paddingLeft` 从 `10px` 变 `56px`（transition）

**AgentMarkdownContent 渲染映射**：

```
h2 → text-[13px] text-zinc-100，下边框 border-zinc-800
h3 → text-[12px] text-zinc-300
p  → text-[13px] text-zinc-300 leading-[1.65]
strong → text-zinc-100
li → 自定义前缀 · text-zinc-600，正文 text-zinc-300
inline code → bg-zinc-800/80 text-[11.5px] text-zinc-300
block code  → bg-zinc-950 border-zinc-800，text-[11px] text-zinc-400
table → 完整 th/td 样式，border-zinc-800
```

---

### 7.4 WorkspaceArea.tsx

**职责**：多面板工作区，含 Panel Tab Bar（顶部）、File Tabs（Code 专属）、主内容区（纵向 PanelGroup）、底部 Terminal 面板、File Explorer（Code 专属右侧）、Outline（其他面板）。

**Props 接口**：

```ts
interface WorkspaceAreaProps {
  showSidePanel: boolean;
  showBottomPanel: boolean;
  onToggleSidePanel: () => void;
  onToggleBottomPanel: () => void;
  onCollapseWorkspace: () => void;
}
```

**Panel 类型（PanelType）**：

```ts
type PanelType = 'code' | 'diff' | 'docs' | 'preview' | 'settings' | 'memory';
```

**PANEL_CATALOGUE**（顺序固定，决定 Add 下拉菜单顺序）：

```ts
code     → Code Editor    → Code2 icon
diff     → Track Changes  → GitCompare icon
docs     → Documentation  → BookOpen icon
preview  → Preview        → Monitor icon
memory   → Memory Palace  → Brain icon
settings → Settings       → Settings icon
```

**Panel Tab Bar 行为**：
- 同一 type 只能有一个实例（添加已存在的 type 会 focus 已有 tab）
- hover 显示 × 关闭按钮（`absolute -top-1 -right-1`）
- 右侧有 Terminal 切换按钮（PanelBottom）和 Outline 切换按钮（PanelRight）

**File Explorer（Code 面板专属）**：
- 仅当 `activePanel.type === 'code'` 时渲染，宽度 `w-52`，在内容区右侧
- 用 `expandedFolders: Set<string>` 管理折叠状态

**Outline 面板**：
- 当 `showSidePanel && activePanel.type !== 'code'` 时渲染

**Follow Suggestions 行**：
- 仅在 Code 面板且有 suggestions 时显示
- suggestions 根据当前 fileTab.type 返回（code → tsx 文件建议，docs → md 文件建议）

**Bottom Panel Tabs**：`terminal` | `build` | `test` | `diagnostics`

**纵向 PanelGroup 尺寸**：

```tsx
// workspace-content：无 bottom 时 defaultSize=100%，有 bottom 时 defaultSize=70%
<Panel id="workspace-content" defaultSize="70%" minSize="30%">
// bottom-output：仅 bottomPanelOpen 时渲染
<Panel id="bottom-output" defaultSize="30%" minSize="10%" maxSize="60%">
```

**子内容组件**：

| 函数 | 渲染什么 |
|------|---------|
| `CodeEditorContent` | 带行号的伪代码高亮，mono 字体 |
| `DiffContent` | 文件 diff 卡片，红绿行背景 |
| `DocsContent` | CLAUDE.md 样式文档预览 |
| `PreviewContent` | 浏览器地址栏 + 占位符 |
| `SettingsContent` | 左侧 nav + 右侧内容，5 个设置分区 |
| `MemoryContent` | 来自 `MemoryContent.tsx`（外部导入） |

---

### 7.5 MemoryContent.tsx

**职责**：记忆殿堂面板。左侧分类筛选 + 条目列表，右侧详情/编辑。

**导出内容**（TaskRail 也会 import）：

```ts
export type MemoryCategory = 'core' | 'architecture' | 'conventions' | 'antipatterns' | 'decisions';
export interface MemoryEntry { ... }
export const MEMORY_CATEGORY_CONFIG: Record<MemoryCategory, CategoryConfig>
export const INITIAL_MEMORIES: MemoryEntry[]
export function MemoryContent(): JSX.Element
```

**MemoryEntry 结构**：

```ts
interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;       // Markdown-like，支持 **bold**、`code`、- 列表
  updatedAt: string;     // 'YYYY-MM-DD'
  citedBy: string[];     // agent names（如 ['Architect', 'Coder']）
  tags: string[];
}
```

**分类颜色系统**：

| category | 颜色 | 语义 |
|----------|------|------|
| core | violet | 项目概览、核心原则 |
| architecture | blue | 系统结构、布局 |
| conventions | emerald | 编码规范、字体规则 |
| antipatterns | red | 已知错误、禁忌做法 |
| decisions | amber | 架构决策记录（ADR） |

**布局**：左侧 `w-[220px]` 固定 + 右侧 `flex-1`。

**内联 Markdown 渲染**（不依赖外部库）：
- `**text**` → `<strong className="text-zinc-200">`
- `` `code` `` → `<code className="bg-zinc-800 text-violet-300 ...">`
- 行首 `- ` → 列表项（`·` 前缀）
- 空行 → `<div className="h-2">`

**编辑模式**：点击"编辑"后 title 变 `<input>`，content 变 `<textarea>`，category 变 `<select>`。保存时更新 `updatedAt` 为当天日期。

---

## 8. 数据类型总览

```ts
// ── 任务 ──
interface Task {
  id: string;
  name: string;
  status: 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done';
  time: string;
  agentCount: number;
  changes: number;
}

// ── Agent ──
interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'idle' | 'thinking' | 'editing' | 'reviewing' | 'waiting';
}

// ── 消息 ──
interface Message {
  id: string;
  type: 'user' | 'agent' | 'change' | 'plan';
  sender?: string;          // agent 消息的发送者名
  content?: string;         // markdown 正文
  thinking?: string;        // agent 思考过程（原始文本，非 markdown）
  toolCalls?: ToolCallData[];
  files?: FileChange[];     // type:'change' 消息专属
  changesMini?: MiniChanges;// 嵌入 agent 消息的精简变更摘要
  timestamp: string;
  isStreaming?: boolean;    // 是否正在流式输出（显示光标）
}

// ── ToolCall ──
interface ToolCallData {
  id: string;
  toolName: string;
  toolInput: string;        // JSON 字符串
  status: 'running' | 'completed' | 'error';
  result?: string;
}

// ── 文件变更 ──
interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  additions?: number;
  deletions?: number;
}

interface MiniChanges {
  totalAdditions: number;
  totalDeletions: number;
  files: FileChange[];
}
```

---

## 9. 核心交互原则

1. **AI 建议 → 用户确认**：AI Agent 通过 `ChangesSummary` 展示建议，用户点击 **Follow Suggestions** 才在 Workspace 打开对应资源。
2. **Thinking 默认折叠**：`ThinkingBlock` 初始状态 `open=false`，展示截断预览。
3. **ToolCall 默认折叠**：`ToolCallItem` 初始 `open=false`，只显示工具名 + 参数摘要 + 状态。
4. **Copy/Retry hover 显现**：`.group` + `opacity-0 group-hover:opacity-100 transition-opacity`。
5. **SessionChangesSummary 不可关闭**：只能展开/折叠，始终显示本次会话所有文件变更。
6. **TaskRail 折叠后**：SharedConversation header 的 padding-left 从 10px 过渡到 56px，并出现展开箭头。

---

## 10. react-resizable-panels 使用规范

> ⚠️ 本项目使用 `react-resizable-panels` v4（4.10.0+）。v4 与 v3 有重大 API 变更：
> - `direction` → `orientation`（prop 名称变更）
> - `PanelGroup` → `Group`，`PanelResizeHandle` → `Separator`（组件名称变更）
> - 数值型 `defaultSize`/`minSize`/`maxSize`/`collapsedSize` 被当作像素（px），百分比必须用字符串格式（`"17%"`）
> - `autoSaveId` → `autoSave`（prop 名称变更）
> - `order` prop 已移除（v4.10.0 不再需要）
> - `ImperativePanelHandle` → `PanelImperativeHandle`（类型名称变更）
> - Panel 外层默认 `height: auto` + `display: flex`，水平 Group 中需要 `style={{ height: '100%' }}` 让面板撑满全高
> - `PanelGroup` 上禁止 `className="h-full"`（破坏 vertical 方向尺寸计算）

### 正确用法

```tsx
// ✅ 父容器用 min-h-0，不在 Group 上加 h-full
<div className="flex-1 flex flex-col min-h-0">
  <Group orientation="vertical" autoSave="workspace-vertical">
    <Panel id="editor-main" defaultSize="70%" minSize="25%">
      <div className="h-full overflow-auto">
        {/* 内容 */}
      </div>
    </Panel>
    {showBottomPanel && (
      <Separator className="..." />
    )}
    {showBottomPanel && (
      <Panel id="editor-bottom" defaultSize="30%" minSize="10%" maxSize="60%">
        {/* 内容 */}
      </Panel>
    )}
  </Group>
</div>
```

### 关键规则

1. **每个 Panel 必须有 `id`**，尤其是条件渲染的 Panel
2. **`defaultSize` 必须与实际渲染的 Panel 数量匹配**：只有一个 Panel 时 `defaultSize="100%"`
3. **`Group` 上禁止 `className="h-full"`**（破坏 vertical 方向尺寸计算）
4. **水平 Group 中的 Panel 需要 `style={{ height: '100%' }}`**（覆盖 v4 默认的 `height: auto`）
5. `collapsible` 的 Panel 需同时设置 `collapsedSize="0%"` + `onResize` 回调同步折叠状态
6. 使用 `PanelImperativeHandle` ref + `panelRef` prop 进行命令式折叠/展开
7. **所有 size props 使用百分比字符串格式**（`"17%"` 而非 `{17}`）
8. **`autoSave` prop 自动持久化布局到 localStorage**，无需手动存储

### Separator 样式模板

```tsx
// 横向
<Separator className="group w-[3px] bg-zinc-900 hover:bg-blue-600/40 transition-colors cursor-col-resize flex items-center justify-center">
  <div className="h-8 w-px bg-zinc-700 group-hover:bg-blue-500 rounded-full transition-colors" />
</Separator>

// 纵向
<Separator className="group h-1 bg-zinc-900 hover:bg-zinc-700 transition-colors cursor-row-resize flex items-center justify-center">
  <div className="w-8 h-0.5 rounded-full bg-zinc-700 group-hover:bg-zinc-500 transition-colors" />
</Separator>
```

---

## 11. Tailwind 使用规范

### 允许

```tsx
// 布局
flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden shrink-0
// 尺寸
w-full h-full w-[220px] h-[36px]
// 间距
p-3 px-4 py-2 gap-2 space-y-1
// 颜色
bg-zinc-950 text-zinc-300 border-zinc-800
// 状态
hover:bg-zinc-900 transition-colors opacity-0 group-hover:opacity-100
// 精确字号
text-[13px] text-[11px] text-[10px]
```

### 禁止

```tsx
text-xs text-sm text-base text-lg text-xl text-2xl  // ❌ 字号类
font-bold font-semibold font-medium                   // ❌ 字重类（除极个别场景）
leading-none leading-tight leading-snug              // ❌ 行高类（用 leading-[1.65] 精确值）
```

---

## 12. 禁忌实践（Anti-patterns）

### A. Group 上加 `h-full`

```tsx
// ❌ 错误 — 破坏 vertical 方向高度计算
<Group className="h-full" orientation="vertical">

// ✅ 正确 — 父容器 min-h-0
<div className="flex-1 flex flex-col min-h-0">
  <Group orientation="vertical">
```

### B. `<button>` 内嵌套 `<button>`

```tsx
// ❌ 非法 HTML
<button onClick={outer}>
  <button onClick={inner}>×</button>  // ← 非法，浏览器行为不确定
</button>

// ✅ 使用 span role="button"
<button onClick={outer}>
  <span role="button" onClick={(e) => { e.stopPropagation(); inner(); }}>×</span>
</button>
```

### C. 动态 Panel 缺少 id

```tsx
// ❌ 警告：Invalid layout total size
{showPanel && <Panel defaultSize="30%">...</Panel>}

// ✅ 始终提供 id
{showPanel && <Panel id="my-panel" defaultSize="30%">...</Panel>}
```

### D. 在非 fonts.css 文件里添加 @import 字体

```css
/* ❌ 不要在 theme.css 或组件内 style 里加字体 import */
/* ✅ 只在 src/styles/fonts.css 顶部添加 */
@import url('https://fonts.googleapis.com/...');
```

### E. 修改受保护文件

```
❌ 禁止修改：
  src/app/components/figma/ImageWithFallback.tsx
  pnpm-lock.yaml
```

---

## 13. 跨组件通信模式

Bytro 使用 **Zustand Store** 实现跨组件状态共享，避免了 ref 透传和 trigger counter 模式。

```ts
// 1. uiStore.ts 定义全局 UI 状态
export const useUIStore = create<UIState>((set) => ({
  taskRailCollapsed: false,
  workspaceCollapsed: false,
  bottomPanelOpen: true,
  // ...
}))

// 2. 任意组件读取和修改状态
const collapsed = useUIStore((s) => s.workspaceCollapsed)
const setCollapsed = useUIStore((s) => s.setWorkspaceCollapsed)

// 3. WorkspaceShell 通过 PanelImperativeHandle 响应状态变化
useEffect(() => {
  const panel = workspacePanelRef.current
  if (!panel) return
  if (workspaceCollapsed && !panel.isCollapsed()) panel.collapse()
  if (!workspaceCollapsed && panel.isCollapsed()) panel.expand()
}, [workspaceCollapsed])
```

**扩展新的跨组件状态**：
1. uiStore.ts 增加状态字段和 setter
2. 在需要读取的组件中 `useUIStore((s) => s.xxx)`
3. 在需要修改的组件中调用 setter

---

## 14. Memory Palace — 记忆殿堂

**核心定位**：项目知识库 + 实践约束的可读可查基础设施。人和 Agent 共享同一套真相来源，记录「应该怎么做」和「不能这样做」，每次修改时同步更新。

**架构决策：A+B 混合**：
- **A（主体）**：WorkspaceArea 内的独立面板（`type: 'memory'`），完整的增删改查体验
- **B（常驻）**：TaskRail 底部迷你摘要区，展示最近被 Agent 引用的条目，保持可见性

**5 个分类**（添加新条目时必须归入其中之一）：

| category | 存放内容 |
|----------|---------|
| `core` | 项目概览、定位、核心原则、技术栈 |
| `architecture` | 布局结构、组件拆分、数据流 |
| `conventions` | 字体/字号/颜色规范、命名约定、文件结构 |
| `antipatterns` | 踩过的坑、已知 bug 复现路径、禁忌写法 |
| `decisions` | 架构决策记录（选了什么、为什么） |

**与 Agent 的联动（规划中）**：
- Agent 消息的 ToolCall 中将出现 `ReadMemory` / `UpdateMemory` 类工具
- ToolCall 渲染时引用的 memory entry id 会在条目的 `citedBy` 列表中体现
- 每次 Agent 修改文件后，应提示用户更新对应的 memory 条目

**当前状态**：数据存储在组件本地 state（`INITIAL_MEMORIES` 初始化）。未来接入 Supabase 后，`MemoryEntry` 将持久化到数据库。

---

*最后更新：2026-05-01*
*维护者：Bytro 项目 AI 协作团队*
