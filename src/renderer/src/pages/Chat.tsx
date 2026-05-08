import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileCode } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useChangeStore, type FileChange } from '../stores/changeStore'
import { useUIStore } from '../stores/uiStore'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { SubagentStatus } from '../components/SubagentStatus'
import { UsageBar } from '../components/UsageBar'
import { TaskGraph } from '../components/workspace/TaskGraph'

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const currentConversation = useChatStore((s) => s.currentConversation)
  const messages = useChatStore((s) => s.messages)
  const loadConversation = useChatStore((s) => s.loadConversation)
  const streamingText = useChatStore((s) => s.streamingText)
  const streamingRequestId = useChatStore((s) => s.streamingRequestId)
  const isOptimisticStreaming = useChatStore((s) => s.isOptimisticStreaming)
  const loading = useChatStore((s) => s.loading)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  // Track whether this component has truly mounted (not a StrictMode synthetic mount).
  // useLayoutEffect only fires on real mounts, so this ref stays false during dev-only
  // double-invoke and is only set to true when the component is actually committed to the DOM.
  const isCommittedRef = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)

  const taskRailCollapsed = useUIStore((s) => s.taskRailCollapsed)
  const workspaceCollapsed = useUIStore((s) => s.workspaceCollapsed)
  const bothCollapsed = taskRailCollapsed && workspaceCollapsed

  const isStreaming = isOptimisticStreaming || streamingRequestId !== null

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isUserScrollingRef.current = distanceFromBottom > 100
  }, [])

  useLayoutEffect(() => {
    isCommittedRef.current = true
    return () => {
      isCommittedRef.current = false
    }
  }, [])

  const hasSentRef = useRef(false)

  useEffect(() => {
    if (id) {
      hasSentRef.current = false
      loadConversation(id)
    }
  }, [id, loadConversation])


  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    if (!isUserScrollingRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, streamingText, isStreaming])

  if (loading && !currentConversation) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    )
  }

  if (!currentConversation) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Conversation not found
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="thin-scrollbar flex-1 min-h-0 overflow-y-auto px-3 py-4"
      >
        <div className={`mx-auto w-full ${bothCollapsed ? 'max-w-3xl' : 'max-w-[50vw]'}`}>
          <MessageList messages={messages} />
        </div>
      </div>

      {/* Task Graph — active tasks visualization */}
      <TaskGraph conversationId={id!} />

      {/* Session Changes — file changes summary */}
      <SessionChangesSummary conversationId={id!} />

      {/* Status bars */}
      <SubagentStatus />
      <UsageBar />

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className={`mx-auto w-full ${bothCollapsed ? 'max-w-3xl' : 'max-w-[50vw]'}`}>
          <ChatInput conversationId={id!} />
        </div>
      </div>
    </div>
  )
}

/* ─── SessionChangesSummary ─────────────────────────────── */

const CHANGES_STATUS_COLORS: Record<string, string> = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
}

function changesBasename(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function SessionChangesSummary({ conversationId }: { conversationId: string }) {
  const [expanded, setExpanded] = useState(false)
  const changes = useChangeStore((s) => s.changes[conversationId] ?? [])
  const loadChanges = useChangeStore((s) => s.loadChangesForConversation)

  useEffect(() => {
    loadChanges(conversationId)
  }, [conversationId, loadChanges])

  const aggregated = (() => {
    const seen = new Map<string, FileChange>()
    for (const c of changes) {
      if (!seen.has(c.path)) {
        seen.set(c.path, c)
      }
    }
    return Array.from(seen.values())
  })()

  if (aggregated.length === 0) return null

  const totalAddition = aggregated.reduce((sum, c) => sum + c.additions, 0)
  const totalDeletion = aggregated.reduce((sum, c) => sum + c.deletions, 0)

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-card transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={12} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground" />
          )}
          <FileCode size={12} className="text-muted-foreground" />
          <span className="text-[11px] text-foreground">
            {aggregated.length} 文件变更
          </span>
        </div>
        <div className="flex gap-2 text-[11px]">
          {totalAddition > 0 && (
            <span className="text-green-400">+{totalAddition}</span>
          )}
          {totalDeletion > 0 && (
            <span className="text-red-400">-{totalDeletion}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border max-h-[120px] overflow-y-auto scrollbar-thin"
          style={{ maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' }}
        >
          {aggregated.map((change) => (
            <div
              key={change.id}
              className="flex items-center gap-2 px-3 py-1 hover:bg-card transition-colors"
            >
              <FileCode size={10} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground font-mono truncate flex-1">
                {changesBasename(change.path)}
              </span>
              <span className={`text-[9px] ${CHANGES_STATUS_COLORS[change.status] || 'text-muted-foreground'} shrink-0`}>
                {change.status}
              </span>
              <div className="flex gap-1 text-[9px] shrink-0">
                {change.additions > 0 && (
                  <span className="text-green-400">+{change.additions}</span>
                )}
                {change.deletions > 0 && (
                  <span className="text-red-400">-{change.deletions}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
