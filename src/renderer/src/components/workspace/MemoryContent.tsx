import { useEffect, useState, useRef, useMemo } from 'react'
import {
  Brain, Search, Plus, Edit2, Check, X,
  AlertTriangle, FileText, Layout, CheckSquare,
  Clock, Bot, Tag, Trash2,
} from 'lucide-react'
import { useMemoryPalaceStore } from '../../stores/memoryPalaceStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { MemoryCategory, MemoryEntry } from '../../stores/memoryPalaceStore'
import { parseMarkdownBlocks, parseInlineSpans } from '../../utils/markdown'

export const MEMORY_CATEGORY_CONFIG: Record<MemoryCategory, {
  label: string
  color: string
  bg: string
  border: string
  dot: string
  icon: React.ReactNode
}> = {
  core:         { label: '核心概览', color: 'text-violet-400', bg: 'bg-violet-950/50',  border: 'border-violet-800/40', dot: 'bg-violet-500', icon: <Brain size={11} /> },
  architecture: { label: '架构设计', color: 'text-blue-400',   bg: 'bg-blue-950/50',    border: 'border-blue-800/40',   dot: 'bg-blue-500',   icon: <Layout size={11} /> },
  conventions:  { label: '约定规范', color: 'text-emerald-400',bg: 'bg-emerald-950/50', border: 'border-emerald-800/40',dot: 'bg-emerald-500',icon: <CheckSquare size={11} /> },
  antipatterns: { label: '禁忌实践', color: 'text-red-400',    bg: 'bg-red-950/50',     border: 'border-red-800/40',    dot: 'bg-red-500',    icon: <AlertTriangle size={11} /> },
  decisions:    { label: '决策记录', color: 'text-amber-400',  bg: 'bg-amber-950/50',   border: 'border-amber-800/40',  dot: 'bg-amber-500',  icon: <FileText size={11} /> },
}

function formatDate(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function renderContent(text: string) {
  const blocks = parseMarkdownBlocks(text)

  return blocks.map((block, i) => {
    switch (block.type) {
    case 'blank':
      return <div key={i} className="h-2" />
    case 'h1':
      return <div key={i} className="text-sm font-bold text-foreground mt-3 mb-1">{block.content}</div>
    case 'h2':
      return <div key={i} className="text-xs font-semibold text-foreground mt-3 mb-1">{block.content}</div>
    case 'li':
      return (
        <div key={i} className="flex gap-2 pl-1">
          <span className="text-muted-foreground shrink-0 mt-px">·</span>
          <span>{renderInline(block.content)}</span>
        </div>
      )
    default:
      return <div key={i}>{renderInline(block.content)}</div>
    }
  })
}

function renderInline(text: string): React.ReactNode {
  const spans = parseInlineSpans(text)
  return spans.map((span, j) => {
    switch (span.type) {
    case 'bold':
      return <strong key={j} className="text-foreground">{span.text}</strong>
    case 'code':
      return <code key={j} className="bg-secondary text-violet-300 px-1 rounded font-mono text-[10px]">{span.text}</code>
    default:
      return <span key={j}>{span.text}</span>
    }
  })
}

function EntryDetail({ entry }: { entry: MemoryEntry }) {
  const { startEditing, deleteItem } = useMemoryPalaceStore()
  const catCfg = MEMORY_CATEGORY_CONFIG[entry.category]

  const handleDelete = () => {
    if (window.confirm(`删除「${entry.title}」？`)) {
      deleteItem(entry.id).catch(() => {})
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className={`px-4 py-3 border-b border-border shrink-0 flex items-start gap-3 ${catCfg.bg}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${catCfg.color} ${catCfg.bg} ${catCfg.border}`}>
              {catCfg.icon}
              <span>{catCfg.label}</span>
            </span>
          </div>
          <h2 className="text-[14px] text-foreground">{entry.title}</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={startEditing}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors"
          >
            <Edit2 size={11} />编辑
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-secondary transition-colors"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 text-[12.5px] text-muted-foreground leading-relaxed space-y-0.5">
          {renderContent(entry.content)}
        </div>
      </div>
      {entry.tags.length > 0 || entry.citedBy.length > 0 ? (
        <div className="border-t border-border px-4 py-2.5 shrink-0 flex items-center gap-4 bg-background">
          {entry.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Tag size={10} className="text-muted-foreground shrink-0" />
              <div className="relative flex-1 min-w-0">
                <div className="hide-scrollbar flex gap-1 overflow-x-auto">
                  {entry.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 bg-secondary rounded text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground">
            {entry.citedBy.length > 0 && (
              <span className="flex items-center gap-1 text-violet-600">
                <Bot size={10} />
                被 {entry.citedBy.join('、')} 引用
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {formatDate(entry.updatedAt)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function EntryEditor({ entry }: { entry?: MemoryEntry }) {
  const { editDraft, setDraft, updateItem, createItem, cancelEditing } = useMemoryPalaceStore()
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  const draftTags: string[] = (editDraft.tags as string[]) ?? []

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase()
    if (!trimmed || draftTags.includes(trimmed)) return
    setDraft({ tags: [...draftTags, trimmed] })
    setTagInput('')
  }

  const handleRemoveTag = (tag: string) => {
    setDraft({ tags: draftTags.filter((t) => t !== tag) })
  }

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    } else if (e.key === 'Backspace' && tagInput === '' && draftTags.length > 0) {
      handleRemoveTag(draftTags[draftTags.length - 1])
    }
  }

  const handleSave = () => {
    if (!editDraft.title?.trim() || !editDraft.content?.trim()) return

    if (entry) {
      updateItem(entry.id, {
        title: editDraft.title,
        content: editDraft.content,
        category: editDraft.category,
        tags: draftTags
      }).catch(() => {})
    } else {
      if (!workspaceId || !editDraft.category) return
      createItem(workspaceId, {
        category: editDraft.category as MemoryCategory,
        title: editDraft.title,
        content: editDraft.content,
        tags: draftTags
      }).catch(() => {})
    }
  }

  const catCfg = MEMORY_CATEGORY_CONFIG[(editDraft.category as MemoryCategory) ?? 'core']

  return (
    <div className="flex flex-col h-full">
      <div className={`px-4 py-3 border-b border-border shrink-0 flex items-start gap-3 ${catCfg.bg}`}>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={editDraft.title ?? ''}
            onChange={(e) => setDraft({ title: e.target.value })}
            placeholder="标题"
            className="w-full bg-card/80 border border-border rounded px-2 py-1 text-[13px] text-foreground outline-none focus:border-violet-600 transition-colors placeholder:text-muted-foreground"
          />
          <select
            value={editDraft.category ?? 'core'}
            onChange={(e) => setDraft({ category: e.target.value as MemoryCategory })}
            className="bg-card border border-border rounded text-[11px] text-muted-foreground px-2 py-1 outline-none"
          >
            {(Object.entries(MEMORY_CATEGORY_CONFIG) as [MemoryCategory, typeof MEMORY_CATEGORY_CONFIG[MemoryCategory]][]).map(([cat, cfg]) => (
              <option key={cat} value={cat}>{cfg.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-1 flex-wrap">
            {draftTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent text-foreground"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="添加标签 (Enter)"
              className="bg-transparent text-[10px] text-foreground placeholder:text-muted-foreground outline-none min-w-[60px] flex-1"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleSave}
            disabled={!editDraft.title?.trim() || !editDraft.content?.trim()}
            className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={11} />保存
          </button>
          <button
            onClick={cancelEditing}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <textarea
          value={editDraft.content ?? ''}
          onChange={(e) => setDraft({ content: e.target.value })}
          placeholder="在此输入 Markdown 内容…"
          className="w-full h-full resize-none bg-card text-[12px] text-foreground leading-relaxed p-4 outline-none font-mono placeholder:text-muted-foreground border-0"
        />
      </div>
    </div>
  )
}

export function MemoryContent() {
  const {
    items, filterCategory, selectedId, isEditing,
    loadItems, setFilter, selectEntry, startEditing
  } = useMemoryPalaceStore()

  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (workspaceId) loadItems(workspaceId).catch(() => {})
  }, [workspaceId, loadItems])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    const catFiltered = filterCategory === 'all'
      ? items
      : items.filter((item) => item.category === filterCategory)
    if (!q) return catFiltered
    return catFiltered.filter((item) =>
      item.title.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.tags.some((t) => t.includes(q))
    )
  }, [items, filterCategory, query])

  const counts = useMemo(() =>
    items.reduce((acc, e) => { acc[e.category] = (acc[e.category] ?? 0) + 1; return acc }, {} as Record<string, number>),
    [items]
  )

  const selectedEntry = items.find((item) => item.id === selectedId) ?? null

  const handleNewEntry = () => {
    selectEntry(null)
    startEditing()
  }

  return (
    <div className="h-full bg-card flex overflow-hidden">
      <div className="w-[220px] shrink-0 border-r border-border bg-background flex flex-col">
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 bg-card border border-border rounded px-2 py-1.5">
            <Search size={11} className="text-muted-foreground shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索记忆…"
              className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none min-w-0"
            />
          </div>
        </div>

        <div className="border-b border-border shrink-0 p-1.5 space-y-0.5">
          <button
            onClick={() => setFilter('all')}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[12px] transition-colors ${
              filterCategory === 'all' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-card'
            }`}
          >
            <Brain size={11} className="text-muted-foreground" />
            <span className="flex-1 text-left">全部</span>
            <span className="text-[10px] text-muted-foreground">{items.length}</span>
          </button>
          {(Object.entries(MEMORY_CATEGORY_CONFIG) as [MemoryCategory, typeof MEMORY_CATEGORY_CONFIG[MemoryCategory]][]).map(([cat, cfg]) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[12px] transition-colors ${
                filterCategory === cat ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              <span className={`${cfg.color} shrink-0`}>{cfg.icon}</span>
              <span className="flex-1 text-left">{cfg.label}</span>
              {(counts[cat] ?? 0) > 0 && (
                <span className="text-[10px] text-muted-foreground">{counts[cat]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">无匹配条目</div>
          )}
          {filtered.map((item) => {
            const cfg = MEMORY_CATEGORY_CONFIG[item.category]
            return (
              <button
                key={item.id}
                onClick={() => { selectEntry(item.id) }}
                className={`w-full px-3 py-2.5 border-b border-border/60 text-left transition-colors ${
                  selectedId === item.id ? 'bg-secondary/70 border-l-2 border-l-violet-500' : 'hover:bg-card/60'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                  <span className="text-[11.5px] text-foreground truncate">{item.title}</span>
                </div>
                <div className="flex items-center gap-2 pl-4">
                  <span className="text-[10px] text-muted-foreground">{formatDate(item.updatedAt)}</span>
                  {item.citedBy.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-violet-600">
                      <Bot size={9} />{item.citedBy.length}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div className="p-2 border-t border-border shrink-0">
          <button
            onClick={handleNewEntry}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary border border-border hover:border-border transition-colors"
          >
            <Plus size={12} />新建条目
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-w-0">
        {isEditing ? (
          <EntryEditor entry={selectedEntry ?? undefined} />
        ) : selectedEntry ? (
          <EntryDetail entry={selectedEntry} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Brain size={28} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-[12px] text-muted-foreground">选择左侧条目查看详情</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
