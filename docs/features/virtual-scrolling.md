---
status: design
priority: P1
last_verified: 2026-05-02
doc_kind: feature
---

# Feature: Virtual Scrolling

## Why

当前 MessageList 渲染所有历史消息。长对话（100+ 条消息）时 DOM 节点过多，导致滚动卡顿、内存占用高。虚拟滚动只渲染可视区域内的消息，大幅降低 DOM 节点数。

**用户故事**：在一个有 200 条消息的长对话中流畅滚动，不会卡顿。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| V1 | MessageList 虚拟滚动 | 只渲染可视区域 ± 缓冲区内的消息 | P0 |
| V2 | 自动跟随 | 新消息到来时自动滚动到底部（如已在底部） | P0 |
| V3 | 动态高度 | 消息高度不固定（含代码块、工具卡片），支持动态测量 | P0 |
| V4 | 滚动到指定消息 | 点击引用/搜索跳转到指定消息 | P1 |
| V5 | 平滑滚动 | CSS scroll-behavior 或 JS 平滑滚动 | P1 |

## How

### 方案选择

使用 `@tanstack/virtual`（原名 `@tanstack/react-virtual`）：

- 轻量（< 5KB）
- 支持动态高度（`estimateSize` + 实测修正）
- React 18 原生支持
- 比 `react-window` 更灵活（不强制 absolute 定位子元素）

### 实现

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'

function MessageList({ messages }: { messages: Message[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<boolean>(true) // 是否在底部

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,       // 预估每条消息 120px
    overscan: 5,                    // 上下各多渲染 5 条
    // 动态高度测量
    measureElement: (el) => el.getBoundingClientRect().height
  })

  // 自动跟随：新消息到且用户在底部时自动滚到底
  useEffect(() => {
    if (bottomRef.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [messages.length])

  return (
    <div ref={parentRef} className="overflow-auto h-full">
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualItem.start}px)`
            }}
          >
            <MessageItem message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

### 自动跟随逻辑

```
用户在底部 (scrollTop + clientHeight >= scrollHeight - 50px)
  → 新消息 → 自动滚到底部

用户不在底部（正在查看历史）
  → 新消息 → 不滚动，显示 "↓ 新消息" 按钮

用户点击 "↓ 新消息" → 滚到底部
```

### 动态高度处理

消息高度不固定，因为：
- Markdown 渲染后高度取决于内容长度
- 包含代码块时高度更大
- 工具调用卡片有固定高度
- 思考块可折叠

使用 `measureElement` 回调在渲染后测量实际高度，`@tanstack/virtual` 会自动缓存和修正。

### 性能目标

| 指标 | 当前（无虚拟滚动） | 目标（虚拟滚动后） |
|------|-------------------|-------------------|
| DOM 节点数 (200 条消息) | ~2000+ | ~50-80 (可视 + overscan) |
| 滚动帧率 | < 30fps | 60fps |
| 初始渲染时间 | 500ms+ | < 100ms |

## Status

📋 **设计阶段。** 当前 MessageList 是全量渲染，需要引入 `@tanstack/virtual` 改造。

## Code

| 层 | 文件 | 变更 |
|----|------|------|
| 渲染 | `src/renderer/src/components/chat/MessageList.tsx` | **重构** — 引入 useVirtualizer |
| 渲染 | `package.json` | **修改** — 新增 `@tanstack/react-virtual` 依赖 |
