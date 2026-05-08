import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Cpu } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { AgentStatusBar } from './AgentStatusBar'

interface MentionSuggestion {
  id: string
  name: string
  role: string
}

const ROLE_ICON_COLORS: Record<string, string> = {
  planning:       'text-blue-400',
  implementation: 'text-green-400',
  review:         'text-orange-400',
  ui:             'text-purple-400',
  assistant:      'text-cyan-400',
  coder:          'text-emerald-400',
}

const ROLE_BADGE_COLORS: Record<string, string> = {
  planning:       'bg-blue-600/20 text-blue-400 border-blue-600/30',
  implementation: 'bg-green-600/20 text-green-400 border-green-600/30',
  review:         'bg-orange-600/20 text-orange-400 border-orange-600/30',
  ui:             'bg-purple-600/20 text-purple-400 border-purple-600/30',
  assistant:      'bg-cyan-600/20 text-cyan-400 border-cyan-600/30',
  coder:          'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
}

export function ChatInput({ conversationId }: { conversationId: string }) {
  const [input, setInput] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const abortStream = useChatStore((s) => s.abortStream)
  const isOptimisticStreaming = useChatStore((s) => s.isOptimisticStreaming)
  const streamingRequestId = useChatStore((s) => s.streamingRequestId)
  const collaborationMode = useChatStore((s) => s.pendingCollaborationMode[conversationId])
  const openFloorState = useChatStore((s) => s.openFloorStates[conversationId])
  const isOpenFloor = openFloorState?.status === 'active'

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Agent profiles for @mention
  const { profiles } = useAgentProfileStore()
  const enabledProfiles = profiles.filter((p) => p.isEnabled)

  const isStreaming = isOptimisticStreaming || streamingRequestId !== null

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [conversationId])

  // @mention autocomplete logic
  const filteredSuggestions: MentionSuggestion[] = mentionQuery !== null
    ? enabledProfiles.filter((p) =>
        p.name.toLowerCase().startsWith(mentionQuery.toLowerCase())
      ).map((p) => ({ id: p.id, name: p.name, role: p.role }))
    : []

  const detectMentionQuery = (text: string, cursor: number): string | null => {
    const before = text.slice(0, cursor)
    const match = before.match(/(?:^|[\s\n])@([\w-]*)$/)
    return match ? match[1] : null
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    const cursor = e.target.selectionStart ?? val.length
    const query = detectMentionQuery(val, cursor)
    setMentionQuery(query)
    setMentionIndex(0)
  }

  const applyMention = (agentName: string) => {
    const cursor = textareaRef.current?.selectionStart ?? input.length
    const before = input.slice(0, cursor)
    const after = input.slice(cursor)
    // Replace trailing @... with @AgentName:
    const replaced = before.replace(/(?:^|(?<=[\s\n]))@[\w-]*$/, (match) => {
      const prefix = match.startsWith('@') ? '' : match[0]
      return `${prefix}@${agentName}: `
    })
    const next = replaced + after
    setInput(next)
    setMentionQuery(null)
    setTimeout(() => {
      textareaRef.current?.focus()
      const pos = replaced.length
      textareaRef.current?.setSelectionRange(pos, pos)
    }, 0)
  }

  const handleSend = async () => {
    if (isStreaming) {
      abortStream()
      return
    }

    if (!input.trim()) return
    const content = input.trim()
    setInput('')
    setMentionQuery(null)

    if (content.startsWith('/remember ')) {
      const memoryText = content.slice('/remember '.length).trim()
      if (!memoryText) return
      const workspaceId = useWorkspaceStore.getState().currentWorkspaceId
      if (workspaceId) {
        try {
          await useMemoryStore.getState().createCandidate({
            workspace_id: workspaceId,
            kind: 'user-note',
            title: memoryText.length > 50 ? memoryText.slice(0, 50) + '...' : memoryText,
            content: memoryText,
            source_conversation_id: conversationId,
            confidence: 'high'
          })
          setToast('已添加到待确认记忆')
        } catch {
          setToast('添加记忆失败')
        }
        setTimeout(() => setToast(null), 3000)
      }
      return
    }

    await sendMessage(conversationId, content)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery !== null && filteredSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % filteredSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + filteredSuggestions.length) % filteredSuggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyMention(filteredSuggestions[mentionIndex].name)
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [input])

  return (
    <div className="relative">
      {toast && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs px-3 py-1 rounded shadow-lg whitespace-nowrap z-10">
          {toast}
        </div>
      )}

      {/* @mention suggestions popover */}
      {mentionQuery !== null && filteredSuggestions.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-48 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-border">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Agent 提及</span>
          </div>
          {filteredSuggestions.map((s, i) => (
            <button
              key={s.id}
              onMouseDown={(e) => {
                e.preventDefault()
                applyMention(s.name)
              }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 text-xs hover:bg-secondary transition-colors ${i === mentionIndex ? 'bg-secondary' : ''}`}
            >
              <Cpu size={12} className={`shrink-0 ${ROLE_ICON_COLORS[s.role] ?? 'text-muted-foreground'}`} />
              <span className="text-foreground font-medium">@{s.name}</span>
              <span className={`text-[10px] px-1 py-0 rounded border ml-auto ${ROLE_BADGE_COLORS[s.role] ?? 'bg-accent/20 text-muted-foreground border-border/30'}`}>
                {s.role}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Unified Agent Status Bar */}
      <AgentStatusBar conversationId={conversationId} />

      {/* Input row */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            data-chat-input="true"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
          />
          <button
            className="absolute bottom-2 right-2 p-1 text-muted-foreground hover:text-muted-foreground cursor-not-allowed opacity-50"
            title="Attachments coming soon"
            disabled
          >
            <Paperclip size={16} />
          </button>
        </div>
        <button
          onClick={handleSend}
          className={`p-2 rounded-lg transition-colors ${
            isStreaming
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
          disabled={!isStreaming && !input.trim()}
          title={isStreaming ? 'Stop' : 'Send'}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}
