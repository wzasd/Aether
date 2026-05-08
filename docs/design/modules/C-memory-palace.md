---
status: active
owner: mochi
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/renderer/src/components/workspace/MemoryContent.tsx (new)
  - src/renderer/src/components/workspace/TaskRail.tsx
  - src/renderer/src/components/workspace/WorkspaceArea.tsx
  - src/renderer/src/App.tsx
---

# 模块 C: Memory Palace（记忆殿堂）— 设计文档

## 1. 产品定位

项目知识库 + 实践约束的可读可查基础设施。人和 Agent 共享同一套真相来源，记录「应该怎么做」和「不能这样做」。

**架构：A+B 混合**
- **A（主体）**：WorkspaceArea 内的 `type:'memory'` 面板，完整 CRUD
- **B（常驻）**：TaskRail 底部迷你摘要区，展示最多引用的条目

## 2. 用户流程

```
主体面板：
  打开 Memory Palace 面板
    ├─ 左侧：5 个分类标签 + 条目标题列表
    ├─ 点击条目 → 右侧展示内容（渲染 Markdown）
    ├─ 点击"编辑" → 右侧切换为编辑模式（input + textarea + select）
    └─ 点击"新建" → 右侧空白编辑表单

TaskRail 迷你区：
  TaskRail 底部固定展示
    ├─ 默认折叠（memoryExpanded=false），点击展开
    ├─ 按 citedBy.length 降序取前 3 条
    ├─ 每条：彩色圆点 + 标题 + "引用 by Architect, Coder"
    └─ "打开记忆殿堂" → WorkspaceArea 打开 Memory 面板
```

## 3. 数据模型

### 3.1 MemoryEntry

```ts
type MemoryCategory = 'core' | 'architecture' | 'conventions' | 'antipatterns' | 'decisions'

interface MemoryEntry {
  id: string
  category: MemoryCategory
  title: string
  content: string        // Markdown-like text
  updatedAt: string      // 'YYYY-MM-DD'
  citedBy: string[]      // agent names
  tags: string[]
}
```

### 3.2 分类配置

```ts
const MEMORY_CATEGORY_CONFIG: Record<MemoryCategory, {
  label: string
  color: string        // Tailwind text color
  dotColor: string     // CSS color for dot
  description: string
}> = {
  core:          { label: 'Core',          color: 'text-violet-400',  dotColor: '#a78bfa', description: '项目概览、核心原则、技术栈' },
  architecture:  { label: 'Architecture',  color: 'text-blue-400',    dotColor: '#60a5fa', description: '布局结构、组件拆分、数据流' },
  conventions:   { label: 'Conventions',   color: 'text-emerald-400', dotColor: '#34d399', description: '字体/字号/颜色规范、命名约定' },
  antipatterns:  { label: 'Anti-patterns', color: 'text-red-400',     dotColor: '#f87171', description: '踩过的坑、已知 bug、禁忌写法' },
  decisions:     { label: 'Decisions',     color: 'text-amber-400',   dotColor: '#fbbf24', description: '架构决策记录（选了什么、为什么）' },
}
```

### 3.3 初始数据（INITIAL_MEMORIES）

与应用架构相关的种子数据，例如：
- "Bytro 定位与核心原则" (core)
- "三列布局架构" (architecture)
- "字体与颜色规范" (conventions)
- "react-resizable-panels v3 升级 v4 注意事项" (antipatterns)

## 4. 组件设计

### 4.1 MemoryContent.tsx

```
┌─ MemoryContent ──────────────────────────────────────────────────┐
│ ┌─ Left (w-[220px]) ────────┬── Right (flex-1) ─────────────────┤
│ │                            │                                    │
│ │ [All] [Core] [Arch] ...   │  ## Title                          │
│ │                            │                                    │
│ │ ┌─ Entry list ──────────┐ │  正文内容 (Markdown 渲染)           │
│ │ │ ● Fix collapse issue  │ │  - 列表项                          │
│ │ │ ● Add dark mode       │ │  `code` 内联代码                   │
│ │ │ ● ...                 │ │                                    │
│ │ └───────────────────────┘ │  Tags: [react] [state]             │
│ │                            │  Cited by: Architect, Coder        │
│ │ [+ New Entry]             │  Updated: 2026-04-28                │
│ │                            │                                    │
│ │                            │  [Edit] [Delete]                   │
│ └────────────────────────────┴────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────┘
```

#### Props

```ts
interface MemoryContentProps {
  onOpenFile?: (filePath: string) => void  // 点击内容中引用的文件路径
}
```

#### 状态

```ts
const [memories, setMemories] = useState<MemoryEntry[]>(INITIAL_MEMORIES)
const [selectedId, setSelectedId] = useState<string | null>(null)
const [filterCategory, setFilterCategory] = useState<MemoryCategory | 'all'>('all')
const [isEditing, setIsEditing] = useState(false)
const [editDraft, setEditDraft] = useState<Partial<MemoryEntry>>({})
```

### 4.2 内联 Markdown 渲染

不依赖外部库，用简单的行解析：

```tsx
function renderMemoryContent(content: string): JSX.Element {
  return content.split('\n').map((line, i) => {
    // **text** → <strong>
    // `code` → <code>
    // - list → <li> with · prefix
    // ## heading → <h3>
    // empty line → spacer
  })
}
```

### 4.3 编辑模式

点击"编辑"后：
- title → `<input>` 绑定 `editDraft.title`
- content → `<textarea>` 绑定 `editDraft.content`（6 行高度）
- category → `<select>` 绑定 `editDraft.category`
- "保存" → 更新 `memories` 数组中对应条目，`updatedAt` 设为当天
- "取消" → 恢复原始数据，退出编辑模式

### 4.4 TaskRail 迷你区

在 TaskRail.tsx 底部增加 `shrink-0` 区块：

```tsx
{/* Memory Palace 迷你摘要 */}
<div className="shrink-0 border-t border-zinc-800">
  <button onClick={() => setMemoryExpanded(v => !v)}
    className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-zinc-900 transition-colors">
    <Brain size={13} className="text-violet-400" />
    <span className="text-[12px] text-zinc-400">Memory Palace</span>
    <ChevronDown size={11} className={`ml-auto text-zinc-600 transition-transform ${memoryExpanded ? 'rotate-180' : ''}`} />
  </button>

  {memoryExpanded && (
    <div className="px-3 pb-2 space-y-1">
      {topMemories.map(entry => (
        <div key={entry.id} className="flex items-center gap-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: MEMORY_CATEGORY_CONFIG[entry.category].dotColor }} />
          <span className="text-[12px] text-zinc-300 truncate flex-1">{entry.title}</span>
          <span className="text-[11px] text-zinc-600">{entry.citedBy.length} refs</span>
        </div>
      ))}
      <button onClick={onOpenMemory}
        className="w-full text-[12px] text-violet-400 hover:text-violet-300 transition-colors text-left mt-1">
        Open Memory Palace →
      </button>
    </div>
  )}
</div>
```

## 5. 跨组件通信（Trigger Counter Pattern）

```
App.tsx
  const [memoryTrigger, setMemoryTrigger] = useState(0)

TaskRail
  onOpenMemory={() => setMemoryTrigger(n => n + 1)}
  // 传递给 TaskRail → 触发 App 的 setMemoryTrigger

WorkspaceArea
  openMemoryTrigger={memoryTrigger}
  // useEffect: 打开 memory 面板（如果未打开则 addPanel('memory')）
```

## 6. 存储策略

| 阶段 | 方案 |
|------|------|
| P0 | 本地 state（`useState(INITIAL_MEMORIES)`），重启丢失 |
| P1 | SQLite 持久化（`project_memory_items` 表复用或新建 `memories` 表） |
| P2 | 与 Agent 联动（Agent 通过工具读写 memory，`citedBy` 自动更新） |

## 7. 导出清单

`MemoryContent.tsx` 需导出供 `TaskRail.tsx` 使用的公共 API：

```ts
export type { MemoryCategory, MemoryEntry }
export { MEMORY_CATEGORY_CONFIG, INITIAL_MEMORIES }
export { MemoryContent }  // 默认导出组件
```

## 8. 未涉及范围

- 与 Supabase 同步
- Agent 自动创建/更新 memory
- 全文搜索
- 版本历史
