---
status: reference
doc_kind: module
note: P0 设计阶段的模块 spec。当前实现以实际代码和 docs/reviews/active/p0-code-review.md 中的契约修正为准。
---

# 模块 3: 对话管理增强

> 搜索、标题生成、删除确认

## 概述

增强侧边栏对话列表的管理能力：全文搜索、自动标题、删除确认。FTS5 全文搜索已在 DB 层就绪，需补前端 UI。

## 功能 1: 对话搜索

### 接口定义

```typescript
// src/main/ipc/conversation.ts — 新增

/** 全文搜索对话 */
'conversation:search': (query: string) => Promise<ConversationSearchResult[]>

export interface ConversationSearchResult {
  id: string
  title: string
  /** 匹配的消息摘要 */
  snippet: string
  /** 匹配的消息时间 */
  matchedAt: number
  /** 搜索排名 */
  rank: number
}
```

### DB 查询

```sql
-- 使用 FTS5 全文搜索（表名与 src/main/core/db.ts 一致）
SELECT c.id, c.title,
       snippet(messages_fts, 0, '<<', '>>', '...', 32) as snippet,
       m.created_at as matchedAt,
       bm25(messages_fts) as rank
FROM messages_fts
JOIN messages m ON m.rowid = messages_fts.rowid
JOIN conversations c ON c.id = m.conversation_id
WHERE messages_fts MATCH ?
ORDER BY rank
LIMIT 20
```

> 注意：`snippet()` 第 2 个参数为列索引（0-based），消息内容在 FTS 表的第 0 列；第 6 个参数为 token 数。需根据 `src/main/core/db.ts` 中 FTS 表定义确认列索引。

### UI 组件

```
┌──────────────────────┐
│ 🔍 搜索对话...       │
├──────────────────────┤
│ 对话标题              │
│ <<匹配关键词>>摘要... │
│ 3 分钟前             │
├──────────────────────┤
│ 对话标题              │
│ <<匹配关键词>>摘要... │
│ 1 小时前             │
└──────────────────────┘
```

- 搜索框在侧边栏顶部
- 输入时 debounce 300ms 后触发搜索
- 空输入时显示正常对话列表
- 搜索结果高亮匹配关键词

## 功能 2: 对话标题自动生成

### 策略

从 AI 第一条文本回复中提取标题：
1. 取第一条 assistant 消息的文本内容
2. 截取前 50 个字符
3. 去除换行和多余空格
4. 如果首条回复为空，使用 "新对话" + 时间戳

### 标题保护

```typescript
// conversations 表新增字段（src/main/core/db.ts）
interface Conversation {
  // ... 现有字段
  title_source: 'auto' | 'manual'  // 标题来源：auto=自动生成，manual=用户手动设置
}
```

- 自动生成标题仅在 `title_source === 'auto'` 时执行
- 用户手动编辑标题后，设置 `title_source = 'manual'`，后续不再自动覆盖
- 新建对话默认 `title_source = 'auto'`

### 接口定义

```typescript
// src/main/ipc/conversation.ts — 新增

/** 自动生成标题（仅当 title_source === 'auto' 时更新） */
'conversation:autoTitle': (id: string, title: string) => Promise<void>

/** 用户手动设置标题（同时设置 title_source = 'manual'） */
'conversation:setTitle': (id: string, title: string) => Promise<void>
```

### 触发时机

在 `complete` 事件触发后（AI 回复完成），自动提取标题并调用 `conversation:autoTitle`。

## 功能 3: 对话删除确认

### UI 交互

```
┌────────────────────────────┐
│  确定删除这个对话吗？       │
│  此操作不可撤销。           │
│                            │
│  [取消]      [删除]        │
└────────────────────────────┘
```

- 点击对话旁的删除按钮 → 弹出确认对话框
- 确认后调用 `conversation:delete` IPC
- 删除当前正在查看的对话时，自动切换到下一个对话

### 接口

已有 `conversation:delete` IPC，无需新增。只需在前端加确认弹窗。

## 文件结构

```
src/renderer/src/
├── components/
│   ├── ConversationSearch.tsx       # 搜索框 + 结果列表
│   └── ConversationDeleteConfirm.tsx # 删除确认弹窗
src/main/ipc/
└── conversation.ts                  # 新增 search + autoTitle + setTitle
```

## 与现有代码的变更

| 文件 | 变更 |
|------|------|
| `src/renderer/src/components/Sidebar.tsx` | 顶部插入 ConversationSearch 组件 |
| `src/renderer/src/components/ConversationItem.tsx` | 添加删除按钮 + 确认弹窗 |
| `src/renderer/src/stores/chatStore.ts` | 新增 searchConversations action，complete 事件后自动生成标题 |
| `src/main/ipc/conversation.ts` | 新增 conversation:search、conversation:autoTitle、conversation:setTitle |
| `src/main/db/` | conversations 表新增 title_source 字段（'auto' \| 'manual'） |
| `src/preload/index.ts` | 暴露新 IPC 通道 |