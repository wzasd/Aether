---
status: reference
doc_kind: module
note: P0 设计阶段的 UI spec。当前实现以 docs/design/ui-guidelines.md 和 docs/design/screens/chat.md 为准。
---

# 模块 4: AI 状态可视化

> Token 用量、Subagent 状态、Todo 列表

## 概述

将 AI 运行过程中的状态信息可视化：Token 用量统计、Subagent 执行状态、Todo 任务列表。数据来源统一为 AIEvent 事件流，不直接依赖 CLI 输出格式。

## 设计原则

**数据源契约：模块 4 只消费 AIEvent，不直接解析 CLI 输出。** 所有 CLI 特有的字段映射由模块 1（EventParser）负责。模块 4 的 store 从 chatStore 接收已映射的 AIEvent，保证与 Provider 实现解耦。

## 功能 1: Token 用量统计

### 数据来源

从 `complete` 事件（AIEvent）中提取 usage 数据。模块 1 的 EventParser 负责将 CLI result 事件映射为：

```typescript
// AIEvent 中 complete 事件的 usage 字段
interface CompleteEvent {
  type: 'complete'
  usage: {
    model: string
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
  }
  costUsd: number
}
```

### 接口定义

```typescript
// src/renderer/src/stores/usageStore.ts

import { create } from 'zustand'

export interface UsageRecord {
  conversationId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  costUsd: number
  timestamp: number
}

interface UsageState {
  /** 当前对话的累计用量 */
  currentUsage: Record<string, UsageRecord>
  /** 历史对话用量汇总 */
  historyUsage: UsageRecord[]
}

export const useUsageStore = create<UsageState & {
  /** 从 complete AIEvent 更新用量 */
  updateFromComplete: (conversationId: string, event: CompleteEvent) => void
  /** 获取对话总用量 */
  getConversationTotal: (conversationId: string) => UsageRecord | null
  /** 清空当前对话用量 */
  clearCurrent: (conversationId: string) => void
}>((set, get) => ({
  currentUsage: {},
  historyUsage: [],
  updateFromComplete: (conversationId, event) => {
    // 累加到 currentUsage
  },
  getConversationTotal: (conversationId) => {
    return get().currentUsage[conversationId] ?? null
  },
  clearCurrent: (conversationId) => {
    set((state) => {
      const { [conversationId]: _, ...rest } = state.currentUsage
      return { currentUsage: rest }
    })
  }
}))
```

### UI 显示

```
┌─────────────────────────────────────┐
│ 💰 本次对话                          │
│ 输入: 74,240 | 输出: 87 | 费用: $0.22│
└─────────────────────────────────────┘
```

- 显示在对话底部（消息区域下方）
- 每次 complete 事件后更新
- 显示：输入 token、输出 token、费用

## 功能 2: Subagent 状态

### 数据来源

从现有 AIEvent 中的 `subagent_started`、`subagent_stopped`、`subagent_completed` 事件获取。这些事件由模块 1 的 EventParser 从 CLI 输出映射而来，模块 4 不直接解析 CLI 原始事件。

```typescript
// 已存在于 src/main/ai/types.ts
interface SubagentStartedEvent {
  type: 'subagent_started'
  agentId: string
  agentType: string
  name: string
  description?: string
}

interface SubagentStoppedEvent {
  type: 'subagent_stopped'
  agentId: string
}

interface SubagentCompletedEvent {
  type: 'subagent_completed'
  agentId: string
  result?: string
}
```

### 接口定义

```typescript
// src/renderer/src/stores/subagentStore.ts

import { create } from 'zustand'

export interface SubagentInfo {
  id: string
  name: string
  type: string
  description?: string
  status: 'active' | 'completed' | 'stopped'
  result?: string
}

interface SubagentState {
  /** 当前对话的 subagent */
  agents: Record<string, SubagentInfo>
}

export const useSubagentStore = create<SubagentState & {
  onSubagentStarted: (event: SubagentStartedEvent) => void
  onSubagentStopped: (event: SubagentStoppedEvent) => void
  onSubagentCompleted: (event: SubagentCompletedEvent) => void
  clear: () => void
}>((set) => ({
  agents: {},
  onSubagentStarted: (event) => {
    set((state) => ({
      agents: {
        ...state.agents,
        [event.agentId]: {
          id: event.agentId,
          name: event.name,
          type: event.agentType,
          description: event.description,
          status: 'active'
        }
      }
    }))
  },
  onSubagentStopped: (event) => {
    set((state) => {
      const { [event.agentId]: _, ...rest } = state.agents
      return { agents: rest }
    })
  },
  onSubagentCompleted: (event) => {
    set((state) => ({
      agents: {
        ...state.agents,
        [event.agentId]: {
          ...state.agents[event.agentId],
          status: 'completed',
          result: event.result
        }
      }
    }))
  },
  clear: () => set({ agents: {} })
}))
```

### UI 显示

```
┌─────────────────────────────────┐
│ 🔄 Subagent 运行中 (2)          │
│ ├─ Agent #1: 运行中 12s         │
│ └─ Agent #2: 运行中 5s          │
└─────────────────────────────────┘
```

- 显示在消息区域底部，仅在有活跃 subagent 时显示
- 运行中显示计时，完成后显示总耗时

## 功能 3: Todo 列表

### 数据来源

优先从 `todo_updated` AIEvent 获取。该事件由模块 1 的 EventParser 从 CLI 输出映射而来。

```typescript
// 已存在于 src/main/ai/types.ts
interface TodoUpdatedEvent {
  type: 'todo_updated'
  todos: Array<{
    content: string
    status: string
    activeForm?: string
  }>
}
```

降级策略：如果 CLI 暂时无法稳定提供 `todo_updated` 事件，则 P0 中 Todo 列表降级为"有事件则显示，无事件则隐藏"，不从 `text_delta` 文本猜测 markdown checkbox。

### 接口定义

```typescript
// src/renderer/src/stores/todoStore.ts

import { create } from 'zustand'

export interface TodoItem {
  content: string
  status: string
  activeForm?: string
}

interface TodoState {
  /** 当前对话的 Todo 列表 */
  items: TodoItem[]
}

export const useTodoStore = create<TodoState & {
  /** 从 todo_updated AIEvent 更新 */
  onTodoUpdated: (event: TodoUpdatedEvent) => void
  /** 清空（对话切换时） */
  clear: () => void
}>((set) => ({
  items: [],
  onTodoUpdated: (event) => {
    set({ items: event.todos || [] })
  },
  clear: () => set({ items: [] })
}))
```

### UI 显示

```
┌─────────────────────────────────┐
│ 📋 任务列表                      │
│ ○ 读取 package.json             │
│ ○ 分析依赖关系                   │
│ ● 生成报告                      │
│ ✓ 确认文件结构                   │
└─────────────────────────────────┘
```

- 显示在侧边栏或消息区域侧面板
- 实时更新，随 text_delta 事件变化
- ○ 待办 / ● 进行中 / ✓ 已完成

## 事件分发流程

```
ClaudeCLIProvider.onEvent
  → chatStore 接收 AIEvent
    → complete → usageStore.updateFromComplete()
    → subagent_started → subagentStore.onSubagentStarted()
    → subagent_stopped → subagentStore.onSubagentStopped()
    → subagent_completed → subagentStore.onSubagentCompleted()
    → todo_updated → todoStore.onTodoUpdated()
```

chatStore 作为事件分发中心，将 AIEvent 路由到各子 store。

## 文件结构

```
src/renderer/src/
├── components/
│   ├── UsageBar.tsx          # Token 用量条
│   ├── SubagentStatus.tsx    # Subagent 状态面板
│   └── TodoList.tsx          # Todo 列表
├── stores/
│   ├── usageStore.ts
│   ├── subagentStore.ts
│   └── todoStore.ts
```

## 与现有代码的变更

| 文件 | 变更 |
|------|------|
| `src/renderer/src/pages/Chat.tsx` | 底部插入 UsageBar，消息区域底部插入 SubagentStatus |
| `src/renderer/src/components/Sidebar.tsx` | 或右侧面板插入 TodoList |
| `src/renderer/src/stores/chatStore.ts` | complete 后调用 usageStore.updateFromComplete；hook 事件调用 subagentStore；text_delta 调用 todoStore |

## 待实测确认

1. hook_started/hook_response 事件的具体字段名（由模块 1 EventParser 映射后确定）
2. Todo 列表在 CLI 输出中的确切格式（是否为标准 markdown checkbox）
3. Subagent 事件是否在 stream-json 模式下输出