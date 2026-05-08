import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Brain, ChevronDown, ChevronRight, Bot, Users } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useMemoryPalaceStore } from '../../stores/memoryPalaceStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { MEMORY_CATEGORY_CONFIG } from './MemoryContent'
import { AgentActivityPanel } from './AgentActivityPanel'
import { ConversationExportMenu } from '../ConversationExportMenu'
import { DeleteConfirmDialog } from '../ConversationDeleteConfirm'

type TaskStatus = 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done'

const STATUS_TEXT_COLORS: Record<TaskStatus, string> = {
  Idle: 'text-muted-foreground',
  Running: 'text-blue-400',
  Waiting: 'text-yellow-400',
  Error: 'text-red-400',
  Done: 'text-green-400',
}

const FILTERS = ['all', 'active', 'done'] as const

interface TaskRailProps {
  onToggleCollapse?: () => void
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onOpenMemory?: () => void
}

export function TaskRail({ onToggleCollapse, onNewConversation, onSelectConversation, onOpenMemory }: TaskRailProps) {
  const conversations = useChatStore((s) => s.conversations)
  const currentConversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const filter = useChatStore((s) => s.filter)
  const setFilter = useChatStore((s) => s.setFilter)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const setConversationTitle = useChatStore((s) => s.setConversationTitle)
  const loading = useChatStore((s) => s.loading)

  const [memoryExpanded, setMemoryExpanded] = useState(true)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ conversationId: string; title: string; x: number; y: number } | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const taskListRef = useRef<HTMLDivElement>(null)
  const memoryItems = useMemoryPalaceStore((s) => s.items)
  const loadItems = useMemoryPalaceStore((s) => s.loadItems)
  const requestOpenPanel = useMemoryPalaceStore((s) => s.requestOpenPanel)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  useEffect(() => {
    if (currentWorkspaceId) {
      loadItems(currentWorkspaceId).catch(() => {})
    }
  }, [currentWorkspaceId, loadItems])

  const topMemories = [...memoryItems]
    .sort((a, b) => b.citedBy.length - a.citedBy.length)
    .slice(0, 3)

  const mappedFilter = filter === 'completed' ? 'done' : filter === 'pending' ? 'active' : filter

  const filteredTasks = conversations.filter((conv) => {
    if (mappedFilter === 'all') return true
    if (mappedFilter === 'active') return conv.status === 'Running' || conv.status === 'Waiting'
    if (mappedFilter === 'done') return conv.status === 'Done' || conv.status === 'Error'
    return true
  })

  const handleMemoryClick = onOpenMemory ?? requestOpenPanel

  const handleContextMenu = useCallback((e: React.MouseEvent, conv: { id: string; title: string | null }) => {
    e.preventDefault()
    setContextMenu({ conversationId: conv.id, title: conv.title || 'Untitled', x: e.clientX, y: e.clientY })
  }, [])

  const handleTaskListKeyDown = useCallback((e: React.KeyboardEvent) => {
    const len = filteredTasks.length
    if (len === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        if (prev === null) return 0
        return Math.min(prev + 1, len - 1)
      })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        if (prev === null) return len - 1
        return Math.max(prev - 1, 0)
      })
      return
    }
    if (e.key === 'Enter' && focusedIndex !== null) {
      e.preventDefault()
      const conv = filteredTasks[focusedIndex]
      if (conv) onSelectConversation(conv.id)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (focusedIndex === null) return
      e.preventDefault()
      const conv = filteredTasks[focusedIndex]
      if (!conv) return
      setDeleteTargetId(conv.id)
      return
    }
    if (e.key === 'F2' && focusedIndex !== null) {
      e.preventDefault()
      const conv = filteredTasks[focusedIndex]
      if (!conv) return
      const newTitle = window.prompt('Rename conversation:', conv.title || '')
      if (newTitle && newTitle.trim()) {
        setConversationTitle(conv.id, newTitle.trim())
      }
      return
    }
  }, [filteredTasks, focusedIndex, onSelectConversation, setDeleteTargetId, setConversationTitle])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex === null || !taskListRef.current) return
    const items = taskListRef.current.querySelectorAll('[data-task-item]')
    const item = items[focusedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  // Reset focused index when filter or conversations change
  useEffect(() => {
    setFocusedIndex(null)
  }, [filter, conversations.length])

  // Listen for Cmd+K custom event to auto-select first item
  useEffect(() => {
    const el = taskListRef.current
    if (!el) return
    const handler = () => {
      if (filteredTasks.length > 0) setFocusedIndex(0)
    }
    el.addEventListener('kbd-focus', handler)
    return () => el.removeEventListener('kbd-focus', handler)
  }, [filteredTasks.length])

  return (
    <aside className="h-full border-r border-border bg-background flex flex-col overflow-hidden">

      {/* Header row */}
      <div className="h-11 flex items-center justify-between pr-3 shrink-0 border-b border-border" style={{ paddingLeft: 'var(--traffic-light-offset)' }}>
        <span className="text-xs text-muted-foreground select-none">Tasks</span>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            title="Collapse Task Rail"
            className="titlebar-no-drag relative z-40 p-1.5 rounded transition-colors bg-secondary text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
              <rect x="3.5" y="4.5" width="4" height="15" rx="0.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        )}
      </div>

      {/* New Task */}
      <div className="p-3 border-b border-border">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-card hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/60 rounded text-xs transition-colors"
        >
          <Plus size={13} />
          New Task
        </button>
      </div>

      {/* Filter tabs */}
      <div className="px-3 py-2 border-b border-border flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f === 'done' ? 'completed' : f === 'active' ? 'pending' : f)}
            className={`px-2.5 py-1 rounded text-xs transition-colors capitalize ${
              mappedFilter === f
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div
        ref={taskListRef}
        data-task-list="true"
        tabIndex={0}
        role="listbox"
        onKeyDown={handleTaskListKeyDown}
        onBlur={() => setFocusedIndex(null)}
        onFocus={() => { /* selection handled by kbd-focus event from Cmd+K */ }}
        className="flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500/50"
      >
        {loading && (
          <div className="p-4 text-center text-xs text-muted-foreground">Loading...</div>
        )}
        {!loading && filteredTasks.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {conversations.length === 0 ? 'No tasks yet' : 'No matching tasks'}
          </div>
        )}
        {filteredTasks.map((conv, index) => {
          const isActive = conv.id === currentConversationId
          const isFocused = index === focusedIndex
          return (
            <button
              key={conv.id}
              data-task-item="true"
              onClick={() => onSelectConversation(conv.id)}
              onContextMenu={(e) => handleContextMenu(e, conv)}
              tabIndex={-1}
              className={`w-full p-3 border-b border-border text-left hover:bg-card transition-colors ${
                isActive ? 'bg-card border-l-2 border-l-blue-500' : ''
              } ${isFocused ? 'bg-card/70 ring-1 ring-inset ring-blue-500/30' : ''}`}
            >
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-sm text-foreground line-clamp-2 flex-1">{conv.title || 'New Chat'}</h3>
                {conv.team_id && <Users size={12} className="text-muted-foreground shrink-0 ml-1.5 mt-0.5" />}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={STATUS_TEXT_COLORS[conv.status as TaskStatus] || 'text-muted-foreground'}>
                  {conv.status}
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground">
                  {formatTime(conv.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span>{conv.agent_count ?? 0} agents</span>
                {(conv.change_count ?? 0) > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-yellow-500">{conv.change_count} changes</span>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Agent Activity (M2-5: A2A Task Queue) */}
      <AgentActivityPanel />

      {/* Memory Palace mini section */}
      <div className="border-t border-border shrink-0">
        <button
          onClick={() => setMemoryExpanded((v) => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card/60 transition-colors"
        >
          <Brain size={12} className="text-violet-500 shrink-0" />
          <span className="flex-1 text-left text-[11.5px] text-muted-foreground">Memory Palace</span>
          <span className="text-[10px] text-muted-foreground mr-1">{memoryItems.length}</span>
          <ChevronDown
            size={10}
            className={`text-muted-foreground transition-transform duration-150 ${memoryExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {memoryExpanded && (
          <div className="pb-1">
            {topMemories.length === 0 ? (
              <p className="px-3 py-1 text-[11px] text-muted-foreground">No entries yet</p>
            ) : (
              topMemories.map((entry) => {
                const cfg = MEMORY_CATEGORY_CONFIG[entry.category as keyof typeof MEMORY_CATEGORY_CONFIG]
                return (
                  <button
                    key={entry.id}
                    onClick={handleMemoryClick}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-card/60 transition-colors group"
                  >
                    {cfg ? (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent" />
                    )}
                    <span className="flex-1 text-left text-[11px] text-muted-foreground group-hover:text-foreground truncate transition-colors">
                      {entry.title}
                    </span>
                    {entry.citedBy.length > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-violet-700 shrink-0">
                        <Bot size={9} />{entry.citedBy.length}
                      </span>
                    )}
                  </button>
                )
              })
            )}

            <button
              onClick={handleMemoryClick}
              className="w-full flex items-center justify-center gap-1 mx-2 mt-1 py-1 rounded text-[10.5px] text-violet-600 hover:text-violet-400 hover:bg-violet-950/30 transition-colors"
              style={{ width: 'calc(100% - 16px)' }}
            >
              View all memories <ChevronRight size={10} />
            </button>
          </div>
        )}
      </div>
      {contextMenu && (
        <ConversationExportMenu
          conversationId={contextMenu.conversationId}
          title={contextMenu.title}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onDelete={(id) => setDeleteTargetId(id)}
        />
      )}
      <DeleteConfirmDialog
        open={deleteTargetId !== null}
        onConfirm={async () => {
          if (!deleteTargetId) return
          await deleteConversation(deleteTargetId)
          setFocusedIndex((prev) => {
            if (prev === null) return null
            return Math.min(prev, filteredTasks.length - 2)
          })
          setDeleteTargetId(null)
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </aside>
  )
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}
