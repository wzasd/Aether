---
status: reference
doc_kind: module
note: P0 设计阶段的 UI spec。当前 preload API 使用 namespaced window.api，与此文档中的 invoke 示例不同。以实际代码和 docs/design/ui-guidelines.md 为准。
---

# 模块 2: 模型/权限/目录选择器

> 对话级配置 UI

## 概述

在聊天输入框上方新增 3 个选择器，控制当前对话的 AI 行为。配置存入 SessionConfig，影响 CLI 启动参数。

## 接口定义

```typescript
// src/renderer/src/stores/sessionConfigStore.ts

import { create } from 'zustand'

type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto'

export interface SessionConfigState {
  /** 当前模型 */
  model: 'opus' | 'sonnet' | 'haiku'
  /** 当前权限模式（复用现有 UI 枚举） */
  permissionMode: PermissionMode
  /** 当前工作目录 */
  workingDir: string
}

export const useSessionConfigStore = create<SessionConfigState & {
  setModel: (model: SessionConfigState['model']) => void
  setPermissionMode: (mode: PermissionMode) => void
  selectWorkingDir: () => Promise<void>
}>((set) => ({
  model: 'sonnet',
  permissionMode: 'plan',
  workingDir: '',
  setModel: (model) => set({ model }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  selectWorkingDir: async () => {
    const dir = await window.api.dialog.openDirectory()
    if (dir) set({ workingDir: dir })
  }
}))
```

## UI 组件

### ModelSelector

```
┌─────────────────────────┐
│ 🤖 Sonnet          ▼    │
├─────────────────────────┤
│ ○ Opus    (最强，最慢)   │
│ ● Sonnet  (均衡)        │
│ ○ Haiku   (最快，最便宜) │
└─────────────────────────┘
```

- 下拉选择，3 个选项
- 选中后下次发送消息时生效（不重启当前 CLI 进程，新消息使用新配置启动新会话）
- 显示模型名称 + 一句话描述

### PermissionModeSelector

```
┌──────────────────────────────────┐
│ 🛡️ Plan                     ▼   │
├──────────────────────────────────┤
│ ○ Manual      (每次审批)        │
│ ● Plan        (只读自动，写需审批)│
│ ○ Auto-edit   (自动批准编辑)    │
│ ○ Full-auto   (跳过所有权限)    │
└──────────────────────────────────┘
```

- 下拉选择，4 个选项
- 选中后下次发送消息生效
- 每个选项带简短说明
- Manual 模式会触发 PTY 启动方式（模块 1 双模式）

### WorkingDirSelector

```
┌──────────────────────────────────────┐
│ 📁 /Users/xxx/project          📂   │
└──────────────────────────────────────┘
```

- 显示当前工作目录路径
- 点击 📂 按钮调用 `dialog.showOpenDialog({ properties: ['openDirectory'] })`
- 路径过长时中间省略

### 布局位置

```
┌──────────────────────────────────────────┐
│ [ModelSelector] [PermissionMode] [Dir]   │
├──────────────────────────────────────────┤
│                                          │
│  消息区域                                 │
│                                          │
├──────────────────────────────────────────┤
│ [输入框]                           [发送] │
└──────────────────────────────────────────┘
```

3 个选择器横排放在消息区域上方，紧凑排列。

## IPC 通道

```typescript
// 新增 namespace: dialog
// src/preload/index.ts 暴露:
dialog: {
  openDirectory: () => Promise<string | null>
}
```

通过 Electron `dialog.showOpenDialog` 实现，在 main 进程注册 `dialog:openDirectory`。

## 数据流

```
用户点击选择器 → sessionConfigStore 更新 state
              ↓
用户发送消息 → chatStore 从 sessionConfigStore 读取 config
              ↓
IPC chat:sendMessage → AIEngine.startSession(config) → ClaudeCLIProvider.spawn(args)
```

## 文件结构

```
src/renderer/src/
├── components/
│   ├── ModelSelector.tsx
│   ├── PermissionModeSelector.tsx
│   └── WorkingDirSelector.tsx
├── stores/
│   └── sessionConfigStore.ts
src/main/ipc/
└── dialog.ts              # dialog:openDirectory 处理
```

## 与现有代码的变更

| 文件 | 变更 |
|------|------|
| `src/renderer/src/pages/Chat.tsx` | 在消息区域上方插入 3 个选择器组件 |
| `src/renderer/src/stores/chatStore.ts` | sendMessage 时从 sessionConfigStore 读取 config |
| `src/main/ipc/` | 新增 dialog.ts 注册 dialog:openDirectory |
| `src/preload/index.ts` | 暴露 dialog:openDirectory IPC |