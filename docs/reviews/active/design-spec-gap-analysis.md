---
status: active
owner: mochi
last_verified: 2026-05-02
doc_kind: review
source: docs/design/mochi-design-reference.md
---

# Design Spec Gap Analysis

代码与 `mochi-design-reference.md` 设计规范的对比审计结果。

> Re-verified 2026-05-02 after UI bug-fix pass. Several previously "missing" items now exist.

## 严重程度定义

| 级别 | 含义 |
|------|------|
| 🔴 Critical | 功能完全缺失，影响产品可用性 |
| 🟠 High | 核心交互/结构不符合规范 |
| 🟡 Medium | 样式/Token 不符合规范 |
| ⚪ Low | 细节差异 |

---

## 一、缺失模块（🔴 Critical）

### 1.1 MemoryContent.tsx — ✅ 已实现
- 左右双栏布局、分类颜色系统、内联 Markdown 渲染、编辑模式均已实现
- 使用 `parseMarkdownBlocks`/`parseInlineSpans` 工具函数

### 1.2 SharedConversation 子组件 — 🟡 部分实现
- `AgentMessage`、`ThinkingBlock`、`ToolCallItem`、`ChangesSummary`、`MiniChangesSummary`、`AgentMarkdownContent` 已从 SharedConversation 中移除（死代码清理 2026-05-02）
- 这些组件在当前架构中不需要在 SharedConversation 层实现——对话流由 `ChatPage` + `MessageList` + `MessageItem` + `ToolCall` 处理
- `SessionChangesSummary` 存在于 `Chat.tsx`（功能版）和 `SharedConversation.tsx`（简化版）
- `type:'plan'` 和 `type:'change'` 消息卡片仍缺失

### 1.3 Trigger Counter Pattern — ✅ 已实现
- App.tsx 有 `settingsTrigger`/`viewChangesTrigger`/`memoryTrigger` 状态
- WorkspaceArea 有对应 trigger props 和 useEffect 响应
- TaskRail 有 `onOpenMemory` 回调

### 1.4 TaskRail Memory Palace 迷你区 — ✅ 已实现
- 底部 `shrink-0` 记忆摘要区已存在
- `memoryExpanded` 状态已实现

### 1.5 WorkspaceArea Panel 体系 — ✅ 已实现
- `memory` panel type（Brain icon）已存在
- 纵向 PanelGroup 已移除（底部面板统一由 WorkspaceShell 的 BottomOutput 处理）
- 内容组件分散到独立文件（CodePanel/DiffPanel/MemoryContent/PreviewPanel）

---

## 二、样式系统偏差（🟠 High）

### 2.1 排版
- 当前代码大量使用 `text-xs`（34处）、`text-sm`（8处）
- 设计规范要求精确 `text-[13px]`/`text-[12px]`/`text-[11px]`/`text-[10px]`
- `font-medium` 出现 6 处（规范禁止）

### 2.2 颜色系统冲突 — 🟡 改善中
- `.dark` 语义变量已对齐 zinc 色阶（2026-05-02 修复）：
  - `bg-background`/`bg-card` → zinc-950
  - `bg-muted`/`bg-secondary`/`bg-accent`/`border-border` → zinc-800
  - `bg-popover` → zinc-900
- 聊天组件使用 shadcn 语义 token（`bg-card`, `text-muted-foreground`）
- 工作区组件使用 zinc token（`bg-zinc-950`, `text-zinc-300`, `border-zinc-800`）
- 两套系统现在视觉一致，但代码层面仍需统一

### 2.3 字体
- 缺少 `fonts.css`（Inter + JetBrains Mono 导入）
- 缺少 `theme.css`
- `main.css` 使用系统字体栈而非 Inter

---

## 三、交互行为偏差（🟠 High）

### 3.1 ThinkingBlock
- 预览截断 100 字符（规范 90）
- 使用 shadcn 颜色而非 purple-400

### 3.2 AgentMarkdownContent
- SharedConversation 中的 AgentMarkdownContent 已移除（死代码）
- Chat 组件使用 `MarkdownContent` + `prose` 类 + `react-syntax-highlighter`

### 3.3 macOS Traffic Lights
- TaskRail 有三色圆点 div 但无 IPC 绑定（装饰性）

---

## 四、对齐项（✅ 已符合）

| 项目 | 状态 |
|------|------|
| react-resizable-panels v4 API（Group/Separator/panelRef, 字符串百分比） | ✅ |
| Tailwind v4（无 config 文件） | ✅ |
| react-markdown + remark-gfm 已安装 | ✅ |
| lucide-react 已安装 | ✅ |
| TaskRail 状态颜色（Idle/Running/Waiting/Error/Done） | ✅ |
| ToolCall formatInput 逻辑（统一到 utils/toolMeta.ts） | ✅ |
| Panel Tab Bar（Add/Close/Hover） | ✅ |
| Keyboard shortcuts | ✅ |
| MemoryContent 完整实现 | ✅ |
| Trigger Counter Pattern | ✅ |
| TaskRail Memory Palace 迷你区 | ✅ |
| WorkspaceArea memory panel type | ✅ |
| SessionChangesSummary（Chat.tsx 功能版） | ✅ |
| TOOL_META 统一到共享模块 | ✅ |
| 底部面板统一到 WorkspaceShell BottomOutput | ✅ |
| SharedConversation 死代码清理 | ✅ |
| Paperclip 按钮 disabled 状态 | ✅ |
| App.tsx loadConversations 去重 | ✅ |

---

## 五、修复优先级

| 优先级 | 模块 | 原因 |
|--------|------|------|
| P0 | 字体设置（Inter + JetBrains Mono） | 影响排版一致性 |
| P1 | 颜色系统代码层面统一（zinc → 语义 token） | 长期维护性 |
| P2 | 排版对齐（text-xs → text-[12px]） | 视觉精确度 |
| P3 | type:'plan' / type:'change' 消息卡片 | 功能完整性 |
| P4 | macOS Traffic Lights IPC 绑定 | 平台集成 |
| P5 | ThinkingBlock 截断长度对齐 | 细节 |
