import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useSessionConfigStore } from '../../stores/sessionConfigStore'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { ModelSelector } from '../ModelSelector'
import { ConfigOptions } from '../ConfigOptions'

const MODES = ['build', 'plan', 'review', 'ask'] as const
type ChatMode = (typeof MODES)[number]

type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto'

function modeToPermission(mode: ChatMode): PermissionMode {
  if (mode === 'build') return 'autoEdit'
  return 'plan'
}

function permissionToMode(permissionMode: PermissionMode): ChatMode {
  if (permissionMode === 'autoEdit' || permissionMode === 'fullAuto') return 'build'
  return 'plan'
}

interface MentionSuggestion {
  id: string
  name: string
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
  const setPermissionMode = useSessionConfigStore((s) => s.setPermissionMode)
  const permissionMode = useSessionConfigStore((s) => s.permissionMode)
  const providerType = useSessionConfigStore((s) => s.providerType)
  const executionMode = useSessionConfigStore((s) => s.executionMode)
  const setExecutionMode = useSessionConfigStore((s) => s.setExecutionMode)
  const activeSessionId = useChatStore(
    (s) => s.activeSessionMap[`${conversationId}:${providerType}`] ?? undefined
  )

  const [mode, setMode] = useState<ChatMode>(
    permissionToMode(permissionMode)
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Agent profile selector
  const { profiles, activeProfileId, setActiveProfile, loadProfiles } = useAgentProfileStore()
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const enabledProfiles = profiles.filter((p) => p.isEnabled)
  const activeProfile = profiles.find((p) => p.id === activeProfileId)

  useEffect(() => {
    loadProfiles(currentWorkspaceId ?? undefined).catch(() => {})
  }, [loadProfiles, currentWorkspaceId])

  const isStreaming = isOptimisticStreaming || streamingRequestId !== null

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [conversationId])

  useEffect(() => {
    setMode(permissionToMode(permissionMode))
  }, [permissionMode])

  const handleModeChange = (m: ChatMode) => {
    setMode(m)
    setPermissionMode(modeToPermission(m))
  }

  // @mention autocomplete logic
  const filteredSuggestions: MentionSuggestion[] = mentionQuery !== null
    ? enabledProfiles.filter((p) =>
        p.name.toLowerCase().startsWith(mentionQuery.toLowerCase())
      ).map((p) => ({ id: p.id, name: p.name }))
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
        <div className="absolute bottom-full left-0 mb-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-40 overflow-hidden">
          {filteredSuggestions.map((s, i) => (
            <button
              key={s.id}
              onMouseDown={(e) => {
                e.preventDefault()
                applyMention(s.name)
              }}
              className={`w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-secondary ${i === mentionIndex ? 'bg-secondary' : ''}`}
            >
              @{s.name}
            </button>
          ))}
        </div>
      )}

      {/* Mode + Agent + Execution mode row */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                mode === m
                  ? 'bg-blue-600 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

{/* Provider + Model selector (shown when no agent profile is active) */}
        {!activeProfile && <ModelSelector activeSessionId={activeSessionId} />}

        {/* Live agent config options (ACP session_config_option_update) */}
        {activeSessionId && <ConfigOptions activeSessionId={activeSessionId} />}

        {/* Execution mode toggle (M2-1: unlocked after per-task buffer support) */}
        {activeProfile && (
          <button
            onClick={() => {
              const next = executionMode === 'serial' ? 'parallel' : 'serial'
              setExecutionMode(next)
            }}
            className={`px-2 py-1 rounded text-xs border ${
              executionMode === 'parallel'
                ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30'
                : 'text-muted-foreground border-border hover:border-ring'
            }`}
            title={executionMode === 'parallel' ? '并行模式：多个 Agent 同时执行' : '串行模式：Agent 按顺序执行'}
          >
            {executionMode === 'parallel' ? '并行' : '串行'}
          </button>
        )}

        {/* Agent selector */}
        {enabledProfiles.length > 0 && (
          <select
            value={activeProfileId ?? ''}
            onChange={(e) => setActiveProfile(e.target.value || null)}
            className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-border ml-auto"
          >
            <option value="">Default</option>
            {enabledProfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

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
