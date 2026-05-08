---
status: design
priority: P1
last_verified: 2026-05-02
doc_kind: feature
---

# Feature: Dark/Light Theme

## Why

当前只有暗色主题。许多用户偏好亮色模式，且亮色模式在明亮环境下阅读体验更好。Tailwind v4 原生支持 dark mode，实现成本低。

**用户故事**：在设置里切换暗色/亮色/跟随系统，所有面板和组件即时响应主题切换。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| T1 | 三模式切换 | 暗色 / 亮色 / 跟随系统 | P0 |
| T2 | 主题持久化 | localStorage 存储用户选择 | P0 |
| T3 | 全组件覆盖 | 所有面板、组件、编辑器终端正确响应主题 | P0 |
| T4 | Monaco 主题同步 | Monaco Editor 跟随主题切换 | P1 |
| T5 | xterm 主题同步 | 终端跟随主题切换 | P1 |
| T6 | 语法高亮主题同步 | react-syntax-highlighter 跟随主题 | P1 |
| T7 | 过渡动画 | 主题切换时有 200ms 颜色过渡 | P2 |

## How

### Tailwind v4 dark mode

Tailwind v4 使用 CSS `prefers-color-scheme` 或手动 class 切换。本方案使用 **class-based** 模式（`dark` class 在 `<html>` 上）：

```css
/* src/renderer/src/styles/globals.css */
@import "tailwindcss";

/* 亮色主题 CSS 变量 */
:root {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8f9fa;
  --color-bg-tertiary: #f1f3f5;
  --color-bg-elevated: #ffffff;
  --color-text-primary: #1a1a2e;
  --color-text-secondary: #495057;
  --color-text-tertiary: #868e96;
  --color-border: #e9ecef;
  --color-border-light: #f1f3f5;
  --color-accent: #3b82f6;
  --color-danger: #ef4444;
  --color-warning: #f59e0b;
  --color-success: #10b981;
}

/* 暗色主题 CSS 变量 */
.dark {
  --color-bg-primary: #0d1117;
  --color-bg-secondary: #161b22;
  --color-bg-tertiary: #21262d;
  --color-bg-elevated: #1c2128;
  --color-text-primary: #e6edf3;
  --color-text-secondary: #8b949e;
  --color-text-tertiary: #6e7681;
  --color-border: #30363d;
  --color-border-light: #21262d;
  --color-accent: #58a6ff;
  --color-danger: #f85149;
  --color-warning: #d29922;
  --color-success: #3fb950;
}
```

### Theme Store

```typescript
// src/renderer/src/stores/themeStore.ts

import { create } from 'zustand'

type ThemeMode = 'dark' | 'light' | 'system'

interface ThemeStore {
  mode: ThemeMode
  resolved: 'dark' | 'light'  // 实际生效的主题

  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: (localStorage.getItem('theme') as ThemeMode) || 'dark',
  resolved: 'dark',

  setMode: (mode) => {
    localStorage.setItem('theme', mode)
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode
    applyTheme(resolved)
    set({ mode, resolved })
  },

  toggle: () => {
    const { resolved } = get()
    set({ mode: resolved === 'dark' ? 'light' : 'dark' })
    // ...
  }
}))

function applyTheme(resolved: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}
```

### 与现有语义化 token 的关系

现有 `mochi-design-reference.md` 已经定义了语义化颜色 token。主题切换只需修改 token 的 CSS 变量值，不需要改组件代码：

```tsx
// 现有组件无需修改，自动响应 CSS 变量变化
<div className="bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
```

### Monaco Editor 主题同步

```typescript
// Monaco Editor 需要手动切换主题
import { useThemeStore } from '../stores/themeStore'

function CodePanel() {
  const resolved = useThemeStore(s => s.resolved)

  return (
    <Editor
      theme={resolved === 'dark' ? 'vs-dark' : 'vs'}
      // ...
    />
  )
}
```

### xterm.js 主题

xterm.js 使用 `ITerminalOptions.theme` 配置颜色：

```typescript
const darkTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#58a6ff',
  // ...
}

const lightTheme = {
  background: '#ffffff',
  foreground: '#1a1a2e',
  cursor: '#3b82f6',
  // ...
}
```

## Status

📋 **设计阶段。** 现有代码使用内联颜色值较多，需要先统一为 CSS 变量，再加亮色主题。

### 实现计划

| Step | 内容 |
|------|------|
| 1 | 定义 CSS 变量体系（暗色 = 当前色值，亮色 = 新色值） |
| 2 | 将现有内联颜色值替换为 CSS 变量引用 |
| 3 | 实现 themeStore + `<html>` class 切换 |
| 4 | 适配 Monaco / xterm / syntax-highlighter |
| 5 | 设置页增加主题选择 UI |

## Code

| 层 | 文件 | 变更 |
|----|------|------|
| 渲染 | `src/renderer/src/styles/globals.css` | **修改** — 增加 CSS 变量 + 亮色主题值 |
| 渲染 | `src/renderer/src/stores/themeStore.ts` | **新建** |
| 渲染 | `src/renderer/src/components/workspace/SettingsPanel.tsx` | **修改** — 增加主题选择 |
| 渲染 | `src/renderer/src/components/workspace/CodePanel.tsx` | **修改** — Monaco 主题同步 |
| 渲染 | `src/renderer/src/components/workspace/TerminalPanel.tsx` | **修改** — xterm 主题同步 |
| — | 多个组件 | **修改** — 硬编码颜色值 → CSS 变量 |
