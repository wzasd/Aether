---
status: active
owner: mochi
last_verified: 2026-04-30
doc_kind: requirements
source: docs/design/mochi-design-reference.md
depends_on: []
---

# P0: Style System Alignment — 需求文档

## 背景

当前代码存在两套冲突的样式系统：
- 聊天组件使用 shadcn 语义 token（`bg-card`、`text-muted-foreground`、`bg-muted`）
- 工作区组件使用 zinc token（`bg-zinc-950`、`text-zinc-300`）
- 排版使用 Tailwind 内置字号类（`text-xs`、`text-sm`）而非精确 px 值

设计规范 `mochi-design-reference.md` 要求统一使用 zinc 色系 + 精确 px 字号 + Inter/JetBrains Mono 字体。

## 功能需求

### FR-1: 字号替换

所有组件中的 Tailwind 内置字号类必须替换为精确像素值：

| 当前类 | 替换为 | 适用场景 |
|--------|--------|---------|
| `text-xs` | `text-[12px]` | 副文本、meta、label、badge、placeholder |
| `text-xs`（小字场景） | `text-[11px]` | Thinking preview、代码行号、mono |
| `text-xs`（极小场景） | `text-[10px]` | close badge、tag letter |
| `text-sm` | `text-[13px]` | 正文、内容气泡、列表项 |
| `text-base` | `text-[13px]` | 等同于正文 |
| `text-lg` | `text-[16px]` | 大标题（极少使用） |

**规则**：Tailwind 内置字号类在代码库中应该 **零出现**。

### FR-2: 字重替换

所有 `font-medium`、`font-semibold`、`font-bold` 必须替换：

| 当前类 | 替换策略 |
|--------|---------|
| `font-medium` | 删除（正文不需要 medium），或特定场景用语义强调 |
| `font-semibold` / `font-bold` | 通过 `<strong>` 标签或 theme 变量控制 |
| `font-normal` | 保留（等同默认） |

### FR-3: 颜色 Token 统一

所有 shadcn 语义 token 替换为 zinc 色阶：

| 当前 Token | 替换为 | 语义 |
|-----------|--------|------|
| `bg-background` | `bg-zinc-950` | 背景最深层 |
| `bg-card` | `bg-zinc-900` | 卡片/面板背景 |
| `bg-muted` | `bg-zinc-900` | 次要背景 |
| `bg-accent` | `bg-zinc-800` | 悬停/激活背景 |
| `text-foreground` | `text-zinc-200` | 正文 |
| `text-muted-foreground` | `text-zinc-500` | 次要文字 |
| `border-border` | `border-zinc-800` | 边框 |
| `text-primary` 等 shadcn 色 | 对应语义色（blue-400 等） | CTA/强调 |

### FR-4: 字体文件

创建 `src/renderer/src/styles/fonts.css`：
- `@import` Inter 字体（Google Fonts 或本地）
- JetBrains Mono 已通过 Tailwind `font-mono` 可用，确认配置正确

### FR-5: Theme 文件

创建 `src/renderer/src/styles/theme.css`：
- Tailwind v4 `@theme` 块
- 字体族变量：`--font-sans: 'Inter', ...`、`--font-mono: 'JetBrains Mono', ...`

### FR-6: 受影响的文件

需要修改的文件（按代码库扫描）：

| 文件 | 主要问题 |
|------|---------|
| `components/chat/ThinkingBlock.tsx` | shadcn token + font-medium + text-xs |
| `components/chat/ToolCall.tsx` | shadcn token + text-xs + font-medium |
| `components/chat/MessageItem.tsx` | shadcn token + text-xs + text-sm |
| `components/chat/MessageList.tsx` | shadcn token + text-xs + text-sm + font-medium |
| `components/chat/MarkdownContent.tsx` | shadcn token + text-xs + text-sm + font-medium |
| `components/chat/ChatInput.tsx` | text-xs + text-sm |
| `components/workspace/TaskRail.tsx` | text-xs + text-sm（zinc token 已正确） |
| `components/workspace/SharedConversation.tsx` | text-xs（zinc token 已正确） |
| `components/workspace/WorkspaceArea.tsx` | text-xs（zinc token 已正确） |
| `components/workspace/BottomOutput.tsx` | text-xs（zinc token 已正确） |
| `components/workspace/CodePanel.tsx` | text-xs（zinc token 已正确） |
| `components/workspace/ExplorerPanel.tsx` | text-xs（zinc token 已正确） |
| `components/workspace/DiffPanel.tsx` | text-xs（zinc token 已正确） |
| `components/workspace/SettingsPanel.tsx` | text-xs + text-sm（zinc token 已正确） |
| `components/workspace/PreviewPanel.tsx` | text-xs（zinc token 已正确） |
| `pages/Home.tsx` | text-sm + text-xl + font-bold |
| `pages/Chat.tsx` | text-sm + font-medium |
| `components/Sidebar.tsx` | 待检查 |
| `components/SubagentStatus.tsx` | 待检查 |
| `components/UsageBar.tsx` | 待检查 |

### FR-7: 代码审查检查点

修改完成后需验证：
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm build` 通过
- [ ] `grep -r "text-xs\|text-sm\|text-base\|text-lg\|text-xl\|text-2xl" src/renderer/src/` 零结果
- [ ] `grep -r "font-medium\|font-semibold\|font-bold" src/renderer/src/components/` 零结果（或仅无可避免的场景）
- [ ] `grep -r "bg-card\|bg-muted\|bg-accent\|bg-background\|text-foreground\|text-muted-foreground\|border-border" src/renderer/src/components/` 零结果
