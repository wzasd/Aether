---
status: active
owner: mochi
last_verified: 2026-04-30
doc_kind: design
source: docs/design/mochi-design-reference.md
---

# P0: Style System Alignment — 设计文档

## 1. 设计目标

统一全项目样式系统，消除 shadcn token + Tailwind 内置类的双重技术债。所有组件使用精确 px 字号 + zinc 色系 + Inter/JetBrains Mono 字体。

## 2. 字号映射表（规范级）

所有替换以**语义**为锚点，不是机械替换 `text-xs` → 某个固定值。

| 语义 | 设计规范值 | 替换 `text-xs` | 替换 `text-sm` |
|------|----------|---------------|---------------|
| 正文、内容气泡、消息体 | `text-[13px]` | — | ✅ |
| 副文本、meta、sender、label | `text-[12px]` | ✅ | — |
| ToolCall label / badge / filter tab | `text-[12px]` | ✅ | — |
| Thinking preview / 代码行号 / mono / placeholder | `text-[11px]` | ✅（小字场景） | — |
| 极小 tag / close badge letter | `text-[10px]` | ✅（极小场景） | — |
| 面板标题 (h2) | `text-[13px]` | — | ✅ |

### 判断规则

当遇到 `text-xs` 时，按以下优先级判断替换值：
1. 该文字是否为代码/mono 内容？→ `text-[11px]`
2. 该文字是否为极小 UI 元素（关闭按钮、badge）？→ `text-[10px]`
3. 其他情况 → `text-[12px]`

当遇到 `text-sm` 时：
1. 是否在消息气泡/正文中？→ `text-[13px]`
2. 其他情况 → `text-[12px]`

## 3. 颜色 Token 映射表

### shadcn → zinc 主色系

| shadcn Token | 替换为 zinc | 语义 |
|-------------|-----------|------|
| `bg-background` | `bg-zinc-950` | 最深背景 |
| `bg-card` | `bg-zinc-900` | 卡片/面板 |
| `bg-muted` | `bg-zinc-900` | 次要背景（统一到 panel 色） |
| `bg-muted/30` | `bg-zinc-900/30` | 半透明背景 |
| `bg-accent` | `bg-zinc-800` | 悬停/激活 |
| `hover:bg-accent` | `hover:bg-zinc-800` | 悬停 |
| `text-foreground` | `text-zinc-200` | 正文 |
| `text-muted-foreground` | `text-zinc-500` | 次要文字 |
| `border-border` | `border-zinc-800` | 边框 |
| `ring-ring` | `ring-zinc-700` | Focus ring |
| `border-input` | `border-zinc-800` | 输入框边框 |

### shadcn → zinc 语义色

| shadcn Token | 替换 | 场景 |
|-------------|------|------|
| `text-primary` | `text-zinc-200` | 主文字 |
| `bg-primary` | `bg-blue-600` | 主按钮 |
| `text-primary-foreground` | `text-white` | 按钮文字 |
| `hover:bg-primary/90` | `hover:bg-blue-700` | 按钮 hover |

### 聊天组件专属映射

由于聊天组件（ThinkingBlock、ToolCall、MessageItem、MessageList、MarkdownContent）当前使用 shadcn token，需要**整组重写**类名：

| 当前 | 替换 | 组件 |
|------|------|------|
| `bg-card border-border` | `bg-zinc-900 border-zinc-800` | ToolCall card |
| `bg-muted/30` | `bg-zinc-900/30` | ToolCall hover |
| `text-muted-foreground` | `text-zinc-500` | 次要文字 |
| Thinking "purple" | `text-purple-400`（保持不变） | ThinkingBlock 标题 |
| `bg-blue-600 text-white` | 保持不变 | 用户消息气泡 |

## 4. 字体文件设计

### `src/renderer/src/styles/fonts.css`

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

/* JetBrains Mono 通过 Tailwind v4 font-mono 变量配置 */
```

### `src/renderer/src/main.css` 修改

```css
@import './styles/fonts.css';
@import './styles/theme.css';
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

## 5. 逐文件修改计划

### 第一组：聊天组件（shadcn token → zinc + 字号）

| 序号 | 文件 | 修改内容 |
|------|------|---------|
| 1 | `chat/ThinkingBlock.tsx` | shadcn→zinc, text-xs→text-[11px], font-medium 删除 |
| 2 | `chat/ToolCall.tsx` | shadcn→zinc, text-xs→text-[12px]/[11px], font-medium 删除 |
| 3 | `chat/MessageItem.tsx` | shadcn→zinc, text-xs→text-[12px], text-sm→text-[13px] |
| 4 | `chat/MessageList.tsx` | font-medium 删除, text-xs→text-[12px], text-sm→text-[13px] |
| 5 | `chat/MarkdownContent.tsx` | shadcn→zinc, text-xs→text-[12px]/[11px], text-sm→text-[13px], font-medium 删除 |
| 6 | `chat/ChatInput.tsx` | text-xs→text-[12px], text-sm→text-[13px] |

### 第二组：工作区组件（zinc 已正确，仅字号）

| 序号 | 文件 | 修改内容 |
|------|------|---------|
| 7 | `workspace/TaskRail.tsx` | text-xs→text-[12px], text-sm→text-[13px] |
| 8 | `workspace/SharedConversation.tsx` | text-xs→text-[12px] |
| 9 | `workspace/WorkspaceArea.tsx` | text-xs→text-[12px] |
| 10 | `workspace/BottomOutput.tsx` | text-xs→text-[12px] |
| 11 | `workspace/CodePanel.tsx` | text-xs→text-[12px] |
| 12 | `workspace/ExplorerPanel.tsx` | text-xs→text-[12px] |
| 13 | `workspace/DiffPanel.tsx` | text-xs→text-[12px] |
| 14 | `workspace/SettingsPanel.tsx` | text-xs→text-[12px], text-sm→text-[13px] |
| 15 | `workspace/PreviewPanel.tsx` | text-xs→text-[12px] |

### 第三组：页面组件

| 序号 | 文件 | 修改内容 |
|------|------|---------|
| 16 | `pages/Home.tsx` | text-xl 替换, font-bold 替换, text-sm→text-[13px] |
| 17 | `pages/Chat.tsx` | text-sm→text-[12px], font-medium 删除 |

### 第四组：基础设施

| 序号 | 文件 | 修改内容 |
|------|------|---------|
| 18 | `styles/fonts.css` | **新建** — Inter 字体导入 |
| 19 | `styles/theme.css` | **新建** — CSS 变量 |
| 20 | `main.css` | **修改** — 导入 fonts + theme，更新 @theme |

## 6. 验证检查点

修改一组（5-6 个文件）后立即验证：

```bash
pnpm run typecheck && pnpm build
```

全部完成后运行：

```bash
# 检查残留 shadcn token
grep -r "bg-card\|bg-muted\|bg-accent\|bg-background\|text-foreground\|text-muted-foreground\|border-border\|ring-ring" src/renderer/src/components/

# 检查残留 Tailwind 内置字号
grep -r "text-xs\|text-sm\|text-base\|text-lg\|text-xl" src/renderer/src/components/

# 检查残留字重
grep -r "font-medium\|font-semibold\|font-bold" src/renderer/src/components/
```
