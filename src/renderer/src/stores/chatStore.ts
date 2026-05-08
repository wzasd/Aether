import { create } from 'zustand'
import { useSessionConfigStore } from './sessionConfigStore'
import { useAgentProfileStore } from './agentProfileStore'
import { useUsageStore } from './usageStore'
import { useSubagentStore } from './subagentStore'
import { useTodoStore } from './todoStore'
import { useMemoryStore } from './memoryStore'
import { useWorkspaceStore } from './workspaceStore'
import { useChangeStore } from './changeStore'
import { useA2AStore } from './a2aStore'
import { extractFileChange } from '../utils/fileChange'

type CollaborationMode = 'orchestrated' | 'open_floor'

// ─── 类型定义 ───

interface Conversation {
  id: string
  workspace_id: string | null
  title: string | null
  model: string | null
  provider: string | null
  status: string
  mode: string | null
  agent_count: number
  change_count: number
  team_id: string | null
  is_draft: number
  created_at: number
  updated_at: number
}

interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string | null
  thinking: string | null
  tool_calls?: string
  created_at: number
}

interface ToolState {
  name: string
  input: string
  status: 'running' | 'completed' | 'error'
  result?: string
}

interface TodoItem {
  content: string
  status: string
  activeForm?: string
}

interface SubagentState {
  id: string
  name: string
  type: string
  description?: string
  status: 'active' | 'completed' | 'stopped'
  result?: string
}

interface PendingPermission {
  confirmId: string
  requestId: string
  sessionId: string
  conversationId?: string
  profileId?: string
  taskId?: string
  toolName: string
  toolInput: string
}

interface PendingQuestion {
  confirmId: string
  requestId: string
  sessionId: string
  conversationId?: string
  profileId?: string
  taskId?: string
  questions: Array<{
    question: string
    header?: string
    multiSelect?: boolean
    options?: Array<{ label: string; description?: string }>
  }>
}

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

interface TaskStreamState {
  taskId: string
  agentProfileId: string | null
  agentName: string | null
  streamingText: string
  thinkingText: string
  tools: Record<string, ToolState>
  currentTurnToolIds: string[]
  isActive: boolean
}

type RoutedAIEvent = AIEvent & {
  sessionId?: string
  conversationId?: string
  agentProfileId?: string | null
  taskId?: string
}

// ─── ChatState ───

interface ChatState {
  // 基础状态
  conversations: Conversation[]
  currentConversation: Conversation | null
  messages: Message[]
  loading: boolean
  filter: string

  // 流式状态（参考原版 §6）
  streamingRequestId: string | null
  // ACP session id keyed by `${conversationId}:${providerType}`. Persists across
  // turn boundaries so ConfigOptions/ModelSelector keep working when not streaming.
  activeSessionMap: Record<string, string>
  isOptimisticStreaming: boolean
  streamingText: string
  thinkingText: string
  tools: Record<string, ToolState>
  currentTurnToolIds: string[]
  turnBoundary: boolean
  doneRequestIds: Record<string, number>

  // Per-task 流式缓冲区（M2-2: 并行多 Agent 支持）
  taskStreams: Record<string, TaskStreamState>

  // 权限/提问
  pendingPermissions: PendingPermission[]
  pendingQuestions: PendingQuestion[]

  // 任务/子代理
  todos: TodoItem[]
  subagents: Record<string, SubagentState>

  // 任务级 Runtime 覆盖 (Phase 3c: NewTaskDialog → sendMessage)
  pendingTaskOverrides: { providerType?: string; model?: string } | null
  setPendingTaskOverrides: (overrides: { providerType?: string; model?: string } | null) => void
  // 预填 @mentions (AC #3: NewTaskDialog → first message)
  pendingInitialMentions: string | null
  setPendingInitialMentions: (mentions: string | null) => void
  pendingCollaborationMode: Record<string, CollaborationMode>
  setPendingCollaborationMode: (conversationId: string, mode: CollaborationMode) => void

  // Canonical NewTask dialog — single entry point for all "New" buttons
  newTaskDialogOpen: boolean
  openNewTaskDialog: () => void
  closeNewTaskDialog: () => void

  // Open Floor state
  openFloorStates: Record<string, {
    status: 'active' | 'closing' | 'closed'
    responses: Array<{ agentId: string; agentName: string; content: string; timestamp: number; relevanceScore: number }>
    startTime: number
  }>
  addOpenFloorResponse: (conversationId: string, response: { agentId: string; agentName: string; content: string; timestamp: number; relevanceScore: number }) => void
  closeOpenFloor: (conversationId: string) => void

  // 使用统计
  usage: UsageInfo | null

  // Actions
  setFilter: (filter: string) => void
  loadConversations: (workspaceId?: string) => Promise<void>
  loadConversation: (id: string) => Promise<void>
  createConversation: (data: { title?: string; model?: string; provider?: string; workspace_id?: string; team_id?: string; task_id?: string; is_draft?: number }) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<void>
  setConversationTitle: (id: string, title: string) => Promise<void>
  updateConversationStatus: (id: string, status: string) => Promise<void>
  updateCurrentConversation: (id: string, patch: Partial<Conversation>) => void
  sendMessage: (conversationId: string, content: string) => Promise<void>
  abortStream: (notice?: string) => void
  confirmPermission: (confirmId: string, approved: boolean) => void
  answerQuestion: (confirmId: string, answers: Record<string, string>) => void
  handleAIEvent: (event: AIEvent) => void
}

const STREAMING_SAFETY_TIMEOUT = 300000 // 5 分钟

export const useChatStore = create<ChatState>((set, get) => {
  let streamingTimeoutId: ReturnType<typeof setTimeout> | null = null
    let unsubscribeAI: (() => void) | null = null
    const conversationSessionIds = new Map<string, string>()
    const sessionConversationIds = new Map<string, string>()
    const persistentSessionIds = new Set<string>()
    const abortedSessionIds = new Set<string>()

  // Wire up A2A task lifecycle events once
  const a2aStore = useA2AStore.getState()
  window.api.orchestrator.onA2ATaskCreated((task) => {
    a2aStore.onTaskCreated(task as Parameters<typeof a2aStore.onTaskCreated>[0])
  })
  window.api.orchestrator.onA2ATaskCompleted((payload) => {
    a2aStore.onTaskCompleted(payload as Parameters<typeof a2aStore.onTaskCompleted>[0])
  })
  window.api.orchestrator.onA2ATaskQueued((payload) => {
    a2aStore.onTaskQueued(payload as Parameters<typeof a2aStore.onTaskQueued>[0])
  })

    const appendMessageIfVisible = (conversationId: string, message: Message): void => {
      set((currentState) => {
        if (currentState.currentConversation?.id !== conversationId) {
          return currentState
        }
        return {
          ...currentState,
          messages: [...currentState.messages, message]
        }
      })
    }

    const getEventSessionId = (event: RoutedAIEvent): string | null => {
      if (typeof event.sessionId === 'string' && event.sessionId) return event.sessionId
      if ('id' in event && typeof event.id === 'string' && event.id) return event.id
      return null
    }

    const getEventConversationId = (event: RoutedAIEvent, state: ChatState): string | null => {
      if (typeof event.conversationId === 'string' && event.conversationId) {
        return event.conversationId
      }

      const sessionId = getEventSessionId(event)
      if (sessionId?.startsWith('orch:')) return sessionId.slice(5)
      if (sessionId && sessionConversationIds.has(sessionId)) {
        return sessionConversationIds.get(sessionId)!
      }

      if (state.streamingRequestId?.startsWith('orch:')) {
        return state.streamingRequestId.slice(5)
      }

      return state.currentConversation?.id ?? null
    }

    const isEventForVisibleConversation = (event: RoutedAIEvent, state: ChatState): boolean => {
      const conversationId = getEventConversationId(event, state)
      return Boolean(conversationId && state.currentConversation?.id === conversationId)
    }

    const isEventForActiveStream = (event: RoutedAIEvent, state: ChatState): boolean => {
      const activeStreamId = state.streamingRequestId
      if (!activeStreamId) return false

      const sessionId = getEventSessionId(event)
      if (sessionId === activeStreamId) return true

      const conversationId = getEventConversationId(event, state)
      return Boolean(
        activeStreamId.startsWith('orch:') &&
        conversationId === activeStreamId.slice(5)
      )
    }

    const serializeCurrentToolCalls = (state: ChatState): string | undefined => {
      if (state.currentTurnToolIds.length === 0) return undefined
      const toolCalls = state.currentTurnToolIds
        .map((tid) => {
          const tool = state.tools[tid]
          return tool
            ? {
                id: tid,
                toolName: tool.name,
                toolInput: tool.input,
                status: tool.status === 'running' ? 'error' : tool.status,
                result: tool.result
              }
            : null
        })
        .filter(Boolean)

      return toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined
    }

    const persistStoppedTurn = (state: ChatState, conversationId: string, notice: string): void => {
      const partialText = state.streamingText.trim()
      const thinking = state.thinkingText.trim()
      const toolCalls = serializeCurrentToolCalls(state)
      const hasGeneratedData = Boolean(partialText || thinking || toolCalls)

      void (async () => {
        if (hasGeneratedData) {
          const assistantMessage = await window.api.message.create({
            conversation_id: conversationId,
            role: 'assistant',
            content: partialText,
            thinking: thinking || undefined,
            tool_calls: toolCalls
          })
          appendMessageIfVisible(conversationId, assistantMessage as Message)
        }

        const systemMessage = await window.api.message.create({
          conversation_id: conversationId,
          role: 'system',
          content: notice
        })
        appendMessageIfVisible(conversationId, systemMessage as Message)
      })().catch(() => {
        /* best-effort stopped-turn persistence */
      })
    }

    const resetStreamingTimeout = (): void => {
      clearStreamingTimeout()
      streamingTimeoutId = setTimeout(() => {
        const state = get()
        if (state.streamingRequestId || state.isOptimisticStreaming) {
          get().abortStream('生成超时，已停止')
        }
      }, STREAMING_SAFETY_TIMEOUT)
    }

  const clearStreamingTimeout = (): void => {
    if (streamingTimeoutId) {
      clearTimeout(streamingTimeoutId)
      streamingTimeoutId = null
    }
  }

  /**
   * Build full memory context for orchestrator-bound messages.
   *
   * Design note: This is the RENDERER-SIDE comprehensive path. It reads
   * .bytro/project-memory.md, memory palace items, latest summary, and agent
   * profile — then prepends them as XML-like tagged blocks.
   *
   * The MAIN-PROCESS path (memory-injection.buildInjectionPrompt) does a
   * lightweight FTS + recent-items injection on every message. The two paths
   * are intentionally different: renderer-side is comprehensive but heavier;
   * main-side is always-on and cheap.
   */
  async function buildMemoryContext(workspaceId: string | null, conversationId: string): Promise<string> {
    if (!workspaceId) return ''
    const parts: string[] = []

    try {
      const projectMemory = await window.api.memory.readProjectMemory(workspaceId)
      if (projectMemory) parts.push(`<project-memory>\n${projectMemory}\n</project-memory>`)
    } catch { /* best-effort */ }

    try {
      const memoryPalaceItems = await window.api.memoryPalace.list(workspaceId)
      if (memoryPalaceItems.length > 0) {
        const formatted = memoryPalaceItems
          .map((item) => `## ${item.category}: ${item.title}\n${item.content}`)
          .join('\n\n')
        parts.push(`<memory-palace>\n${formatted}\n</memory-palace>`)
      }
    } catch { /* best-effort */ }

    try {
      const summary = await window.api.memory.getLatestSummary(conversationId)
      if (summary) parts.push(`<conversation-summary>\n${summary.summary}\n</conversation-summary>`)
    } catch { /* best-effort */ }

    try {
      const profile = await window.api.memory.getAgentProfile(workspaceId, 'claude-code')
      if (profile?.content) parts.push(`<agent-profile>\n${profile.content}\n</agent-profile>`)
    } catch { /* best-effort */ }

    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : ''
  }

  function shouldGenerateSummary(messages: Message[]): boolean {
    return messages.length > 0 && messages.length % 10 === 0
  }

  function buildSummaryFromMessages(messages: Message[]): {
    summary: string
    completedItems: string[]
    pendingItems: string[]
    changedFiles: string[]
    risks: string[]
    nextSteps: string[]
  } {
    const userMessages = messages.filter((m) => m.role === 'user')
    const assistantMessages = messages.filter((m) => m.role === 'assistant')

    const summary = `Conversation with ${userMessages.length} user messages and ${assistantMessages.length} assistant responses.`

    const completedItems: string[] = []
    const pendingItems: string[] = []
    const changedFiles: string[] = []
    const risks: string[] = []
    const nextSteps: string[] = []

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      const fileMatches = content.match(/[\w/.-]+\.\w{1,10}/g) || []
      changedFiles.push(...fileMatches.slice(0, 3))
    }

    return {
      summary,
      completedItems,
      pendingItems,
      changedFiles: Array.from(new Set(changedFiles)),
      risks,
      nextSteps
    }
  }

  function maybeCreateSummary(conversationId: string, messages: Message[]): void {
    if (!shouldGenerateSummary(messages)) return

    const summaryData = buildSummaryFromMessages(messages)
    const memoryStore = useMemoryStore.getState()
    memoryStore.createSummary({
      conversation_id: conversationId,
      summary: summaryData.summary,
      completed_items: JSON.stringify(summaryData.completedItems),
      pending_items: JSON.stringify(summaryData.pendingItems),
      changed_files: JSON.stringify(summaryData.changedFiles),
      risks: JSON.stringify(summaryData.risks),
      next_steps: JSON.stringify(summaryData.nextSteps),
      from_message_id: messages[0]?.id,
      to_message_id: messages[messages.length - 1]?.id
    })
  }

  return {
    // 基础状态
    conversations: [],
    currentConversation: null,
    messages: [],
    loading: false,
    filter: 'all',

    // 流式状态
    streamingRequestId: null,
    activeSessionMap: {},
    isOptimisticStreaming: false,
    streamingText: '',
    thinkingText: '',
    tools: {},
    currentTurnToolIds: [],
    turnBoundary: false,
    doneRequestIds: {},

    taskStreams: {},

    // 权限/提问
    pendingPermissions: [],
    pendingQuestions: [],

    // 任务/子代理
    todos: [],
    subagents: {},

    // 任务级 Runtime 覆盖（Phase 3c）
    pendingTaskOverrides: null,
    setPendingTaskOverrides: (overrides) => set({ pendingTaskOverrides: overrides }),
    // 预填 @mentions（AC #3）
    pendingInitialMentions: null,
    setPendingInitialMentions: (mentions) => set({ pendingInitialMentions: mentions }),
    pendingCollaborationMode: {},
    setPendingCollaborationMode: (conversationId, mode) =>
      set((s) => ({ pendingCollaborationMode: { ...s.pendingCollaborationMode, [conversationId]: mode } })),

    // Canonical NewTask dialog — single entry point for all "New" buttons
    newTaskDialogOpen: false,
    openNewTaskDialog: () => set({ newTaskDialogOpen: true }),
    closeNewTaskDialog: () => set({ newTaskDialogOpen: false }),

    // Open Floor state
    openFloorStates: {},
    addOpenFloorResponse: (conversationId, response) =>
      set((s) => {
        const existing = s.openFloorStates[conversationId]
        if (!existing || existing.status === 'closed') return s
        return {
          openFloorStates: {
            ...s.openFloorStates,
            [conversationId]: {
              ...existing,
              responses: [...existing.responses, response]
            }
          }
        }
      }),
    closeOpenFloor: (conversationId) =>
      set((s) => {
        const existing = s.openFloorStates[conversationId]
        if (!existing) return s
        // Only close the cycle state — user's mode selection (pendingCollaborationMode)
        // must persist across cycles. Deleting it here causes the next sendMessage to
        // see undefined mode, skip openFloorStates init, and drop all agent_observation events.
        const retainedMode = s.pendingCollaborationMode[conversationId]
        console.info('[chatStore] closeOpenFloor: conv=%s status→closed, pendingMode=%s (retained for next cycle)',
          conversationId, retainedMode ?? 'undefined')
        return {
          openFloorStates: {
            ...s.openFloorStates,
            [conversationId]: { ...existing, status: 'closed' as const }
          },
        }
      }),

    // 使用统计
    usage: null,

    setFilter: (filter) => set({ filter }),

    loadConversations: async (workspaceId?: string) => {
      set({ loading: true })
      try {
        const conversations = await window.api.conversation.list(workspaceId)
        set({ conversations, loading: false })
      } catch (err) {
        console.error('Failed to load conversations:', err)
        set({ loading: false })
      }
    },

    loadConversation: async (id) => {
      const state = get()
      const optimistic = state.conversations.find((c) => c.id === id) ?? null
      if (state.currentConversation?.id !== id) {
        set({
          currentConversation: optimistic,
          messages: [],
          loading: false,
          streamingText: '',
          thinkingText: '',
          currentTurnToolIds: [],
          taskStreams: {},
          pendingPermissions: [],
          pendingQuestions: [],
          todos: [],
          subagents: {},
          usage: null,
        })
      }
      try {
        const result = await window.api.conversation.get(id)
        useTodoStore.getState().clear()
        useSubagentStore.getState().clear()
        if (result) {
          set({
            currentConversation: result,
            messages: result.messages || [],
            loading: false,
            streamingText: '',
            thinkingText: '',
            currentTurnToolIds: [],
        taskStreams: {},

            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            subagents: {},
            usage: null
          })
          // Restore persisted usage and todos from DB
          try {
            const usageRecords = await window.api.usage.list(id)
            useUsageStore.getState().loadFromDB(id, usageRecords)
          } catch { /* best-effort */ }
          try {
            const todoRecords = await window.api.todo.list(id)
            useTodoStore.getState().loadFromDB(todoRecords)
          } catch { /* best-effort */ }
          // Load memory context for this conversation
          try {
            const memoryStore = useMemoryStore.getState()
            memoryStore.loadLatestSummary(id)
            memoryStore.loadAgentSessions(id)
          } catch { /* best-effort */ }
        } else {
          set({
            currentConversation: null,
            messages: [],
            loading: false,
            streamingText: '',
            thinkingText: '',
            currentTurnToolIds: [],
        taskStreams: {},

            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            subagents: {},
            usage: null
          })
        }
      } catch (err) {
        console.error('Failed to load conversation:', err)
        set({ loading: false })
      }
    },

    createConversation: async (data) => {
      try {
        const conversation = await window.api.conversation.create({
          ...data,
          team_id: data.team_id ?? undefined,
          task_id: data.task_id ?? undefined,
          is_draft: 0
        })
        set((state) => ({
          conversations: [conversation, ...state.conversations],
        }))
        set({ currentConversation: conversation, messages: [] })
        return conversation
      } catch (err) {
        console.error('Failed to create conversation:', err)
        return null
      }
    },

    deleteConversation: async (id) => {
      try {
        await window.api.conversation.delete(id)
        set((state) => {
          // Clean up per-conversation state to prevent memory leak (CR #5)
          const { [id]: _, ...restModes } = state.pendingCollaborationMode
          const { [id]: __, ...restOpenFloor } = state.openFloorStates
          return {
            conversations: state.conversations.filter((c) => c.id !== id),
            currentConversation: state.currentConversation?.id === id ? null : state.currentConversation,
            messages: state.currentConversation?.id === id ? [] : state.messages,
            pendingCollaborationMode: restModes,
            openFloorStates: restOpenFloor,
          }
        })
      } catch (err) {
        console.error('Failed to delete conversation:', err)
      }
    },

    setConversationTitle: async (id, title) => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) return

      try {
        await window.api.conversation.setTitle(id, trimmedTitle)
        set((state) => ({
          currentConversation:
            state.currentConversation?.id === id
              ? { ...state.currentConversation, title: trimmedTitle }
              : state.currentConversation,
          conversations: state.conversations.map((conversation) =>
            conversation.id === id
              ? { ...conversation, title: trimmedTitle }
              : conversation
          )
        }))
      } catch (err) {
        console.error('Failed to set conversation title:', err)
      }
    },

    updateCurrentConversation: (id, patch) => {
      set((state) => ({
        currentConversation:
          state.currentConversation?.id === id
            ? { ...state.currentConversation, ...patch }
            : state.currentConversation,
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, ...patch } : c
        )
      }))
    },

    updateConversationStatus: async (id, status) => {
      try {
        const updated = await window.api.conversation.updateStatus(id, status)
        set((state) => ({
          currentConversation:
            state.currentConversation?.id === id
              ? { ...state.currentConversation, status: updated.status }
              : state.currentConversation,
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, status: updated.status } : c
          )
        }))
      } catch (err) {
        console.error('Failed to update conversation status:', err)
      }
    },

    sendMessage: async (conversationId, content) => {
      const state = get()

      // 如果正在流式生成，点击发送按钮 → 中断
      if (state.streamingRequestId || state.isOptimisticStreaming) {
        get().abortStream()
        return
      }

      // Auto-title from first user message
      const isFirstMessage = state.messages.length === 0
      if (isFirstMessage) {
        const autoTitle = content.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').slice(0, 50).trim()

        // Await autoTitle so the DB row carries the right title before promotion
        if (autoTitle) {
          await window.api.conversation.autoTitle(conversationId, autoTitle).catch(() => {})
          set((currentState) => ({
            currentConversation:
              currentState.currentConversation?.id === conversationId
                ? { ...currentState.currentConversation, title: autoTitle }
                : currentState.currentConversation,
            conversations: currentState.conversations.map((c) =>
              c.id === conversationId ? { ...c, title: autoTitle } : c
            )
          }))
        }

        // 保存用户消息到 DB
      try {
        const message = await window.api.message.create({
          conversation_id: conversationId,
          role: 'user',
          content
        })
        appendMessageIfVisible(conversationId, message as Message)
      } catch (err) {
        console.error('Failed to save user message:', err)
      }

      // 设置乐观流式状态
      set({
        isOptimisticStreaming: true,
        streamingText: '',
        thinkingText: '',
        tools: {},
        currentTurnToolIds: [],
        turnBoundary: false,
        doneRequestIds: {}
      })
      resetStreamingTimeout()
      }

      const config = useSessionConfigStore.getState()
      const agentStore = useAgentProfileStore.getState()
      let activeProfile = agentStore.profiles.find((p) => p.isEnabled) ?? undefined
      const workspaceId = state.currentConversation?.workspace_id || useWorkspaceStore.getState().currentWorkspaceId
      const workspaceEntry = workspaceId
        ? useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
        : null
      const workingDir = workspaceEntry?.repo_path ?? config.workingDir

      // Team mode: resolve primary profile from team config (P1 #9/#14/#19)
      // Must resolve regardless of activeProfile — team conversations always need
      // an orchestrator primary, even when no global profile is selected.
      const teamId = state.currentConversation?.team_id ?? null
      if (teamId) {
        try {
          const teamConfig = await window.api.team.get(teamId)
          if (teamConfig) {
            const primaryMember = teamConfig.members?.[0]
            if (primaryMember) {
              if (agentStore.profiles.length === 0) {
                await agentStore.loadProfiles(workspaceId)
              }
              const freshProfiles = useAgentProfileStore.getState().profiles
              const primaryProfile = freshProfiles.find(
                (p) => p.id === primaryMember.profileId && p.isEnabled
              )
              if (primaryProfile) activeProfile = primaryProfile
            }
          }
        } catch {
          // Fall back to user's active profile (or default path if none)
        }
      }

      // ─── Orchestrator path (profile selected) ───
      if (activeProfile) {
        try {
          // Memory injection is handled by the orchestrator — don't prepend here
          // or it pollutes mention detection.
          const initialMentions = get().pendingInitialMentions
          if (initialMentions) set({ pendingInitialMentions: null })

          // Subscribe to AI events (orchestrator forwards via same channel)
          if (!unsubscribeAI) {
            unsubscribeAI = window.api.chat.onEvent((event) => {
              get().handleAIEvent(event)
            })
          }

          // Use conversationId as streaming identifier for orchestrator path
          set({ streamingRequestId: `orch:${conversationId}` })
          get().updateConversationStatus(conversationId, 'Running').catch(() => {})

          const taskOverrides = get().pendingTaskOverrides
          if (taskOverrides) set({ pendingTaskOverrides: null })

          // collaborationMode is now per-conversation (Record<string, CollaborationMode>)
          const collaborationMode = get().pendingCollaborationMode[conversationId]
          if (collaborationMode) {
            const { [conversationId]: _, ...rest } = get().pendingCollaborationMode
            set({ pendingCollaborationMode: rest })
          }
          console.debug('[chatStore] sendMessage: conv=%s mode=%s', conversationId, collaborationMode ?? 'undefined')

          const isOpenFloor = collaborationMode === 'open_floor'

          // Initialize frontend Open Floor state so agent_observation events
          // pass the status === 'active' guard in the ai:event handler.
          if (isOpenFloor) {
            set((s) => ({
              openFloorStates: {
                ...s.openFloorStates,
                [conversationId]: { status: 'active' as const, responses: [], startTime: Date.now() }
              }
            }))
          }

          const modeExecution = isOpenFloor ? 'parallel' : config.executionMode ?? 'serial'
          const modePermission = isOpenFloor ? 'manual' : config.permissionMode

          await window.api.orchestrator.sendMessage({
            conversationId,
            profileId: activeProfile.id,
            content: content,
            sessionConfig: {
              providerType: config.providerType,
              model: config.model,
              permissionMode: modePermission,
              workingDir
            },
            executionMode: modeExecution,
            collaborationMode,
            overrides: taskOverrides ?? undefined,
            initialMentions: initialMentions ?? undefined
          })

          // Orchestrator promise resolves only after the full task chain
          // (primary → pipeline → serial queue → feedback) completes.
          // Task-level done events skip global cleanup (they have taskId),
          // so we clear streaming state here at conversation level (P1 #20).
          set({
            isOptimisticStreaming: false,
            streamingRequestId: null,
            streamingText: '',
            thinkingText: '',
            currentTurnToolIds: [],
            turnBoundary: true
          })
          clearStreamingTimeout()
        } catch (err) {
          console.error('Orchestrator sendMessage failed:', err)
          set({ isOptimisticStreaming: false, streamingRequestId: null })
          clearStreamingTimeout()
        }
        return
      }

      // ─── Default path (no profile) ───
      try {
        const model = config.model
        const sessionKey = `${conversationId}:${config.providerType}`
        const resumeSessionId = conversationSessionIds.get(sessionKey)
        const { id: sessionId } = await window.api.chat.startSession({
          providerType: config.providerType,
          model,
          permissionMode: config.permissionMode,
          workingDir,
          sessionId: resumeSessionId
        })

        conversationSessionIds.set(sessionKey, sessionId)
        sessionConversationIds.set(sessionId, conversationId)
        set((s) => ({ activeSessionMap: { ...s.activeSessionMap, [sessionKey]: sessionId } }))
        if (config.permissionMode === 'manual') {
          persistentSessionIds.add(sessionId)
        } else {
          persistentSessionIds.delete(sessionId)
        }

        try {
          const memoryStore = useMemoryStore.getState()
          if (workspaceId) {
            await memoryStore.createAgentSession({
              workspace_id: workspaceId,
              conversation_id: conversationId,
              agent_id: 'claude-code',
              provider: 'claude-code',
              external_session_id: sessionId,
              status: 'active'
            })
          }
        } catch { /* best-effort */ }

        if (!unsubscribeAI) {
          unsubscribeAI = window.api.chat.onEvent((event) => {
            get().handleAIEvent(event)
          })
        }

        const memoryPrefix = await buildMemoryContext(workspaceId || null, conversationId)
        const messageContent = memoryPrefix + content
        set({ streamingRequestId: sessionId })
        get().updateConversationStatus(conversationId, 'Running').catch(() => {})
        await window.api.chat.sendMessage(sessionId, messageContent)
      } catch (err) {
        console.error('Failed to start AI stream:', err)
        set({ isOptimisticStreaming: false, streamingRequestId: null })
        clearStreamingTimeout()
      }
    },

    abortStream: (notice = '已手动停止生成') => {
      const state = get()
      const sessionId = state.streamingRequestId
      const conversationId =
        (sessionId?.startsWith('orch:') ? sessionId.slice(5) : null) ||
        (sessionId && sessionConversationIds.get(sessionId)) ||
        state.currentConversation?.id ||
        null

        if (sessionId) {
          abortedSessionIds.add(sessionId)
          if (sessionId.startsWith('orch:')) {
            const convId = sessionId.slice(5)
            window.api.orchestrator.abort(convId)
          } else {
            window.api.chat.abort(sessionId)
            useMemoryStore.getState().endAgentSessionByExternalId(sessionId).catch(() => {})
          }
        }

        if (conversationId) {
          persistStoppedTurn(state, conversationId, notice)
        }

        set({
          streamingRequestId: null,
          isOptimisticStreaming: false,
          streamingText: '',
          thinkingText: '',
          tools: {},
          currentTurnToolIds: [],
          taskStreams: {},
          pendingPermissions: sessionId
            ? state.pendingPermissions.filter((permission) => permission.sessionId !== sessionId)
            : [],
          pendingQuestions: sessionId
            ? state.pendingQuestions.filter((question) => question.sessionId !== sessionId)
            : [],
          doneRequestIds: {}
        })
        clearStreamingTimeout()
      },

    confirmPermission: (confirmId, approved) => {
      const pending = get().pendingPermissions.find((p) => p.confirmId === confirmId)
      const sessionId = pending?.sessionId || get().streamingRequestId
      if (pending?.conversationId) {
        window.api.orchestrator.respondPermission(pending.conversationId, approved, pending.profileId, pending.taskId)
      } else if (sessionId) {
        window.api.chat.respondPermission(sessionId, approved)
      }
      if (approved) {
        const convId = pending?.conversationId || (sessionId && sessionConversationIds.get(sessionId))
        if (convId) {
          get().updateConversationStatus(convId, 'Running').catch(() => {})
        }
      }
      set((state) => ({
        pendingPermissions: state.pendingPermissions.filter((p) => p.confirmId !== confirmId)
      }))
    },

    answerQuestion: (confirmId, answers) => {
      const pending = get().pendingQuestions.find((q) => q.confirmId === confirmId)
      const sessionId = pending?.sessionId || get().streamingRequestId
      const answerStr = Object.values(answers).join(',')
      if (pending?.conversationId) {
        window.api.orchestrator.respondQuestion(pending.conversationId, answerStr, pending.profileId, pending.taskId)
      } else if (sessionId) {
        window.api.chat.respondQuestion(sessionId, answerStr)
      }
      if (pending?.conversationId || sessionId) {
        const convId = pending?.conversationId || (sessionId && sessionConversationIds.get(sessionId))
        if (convId) {
          get().updateConversationStatus(convId, 'Running').catch(() => {})
        }
      }
      set((state) => ({
        pendingQuestions: state.pendingQuestions.filter((q) => q.confirmId !== confirmId)
      }))
    },

    handleAIEvent: (event: AIEvent) => {
      const state = get()
      const routedEvent = event as RoutedAIEvent
      const taskId = routedEvent.taskId
      const eventConversationId = getEventConversationId(routedEvent, state)
      const isVisibleConversation = isEventForVisibleConversation(routedEvent, state)
      const isActiveStreamEvent = isEventForActiveStream(routedEvent, state)

      // Helper: update a per-task stream
      const updateTaskStream = (updates: Partial<TaskStreamState> & { taskId: string }): void => {
        set((s) => {
          const existing = s.taskStreams[updates.taskId] ?? {
            taskId: updates.taskId,
            agentProfileId: routedEvent.agentProfileId ?? null,
            agentName: null,
            streamingText: '',
            thinkingText: '',
            tools: {},
            currentTurnToolIds: [],
            isActive: true
          }
          return {
            taskStreams: {
              ...s.taskStreams,
              [updates.taskId]: { ...existing, ...updates, isActive: true }
            }
          }
        })
      }

      // Helper: mark a task stream inactive (completion)
      const deactivateTaskStream = (tid: string): void => {
        set((s) => {
          const { [tid]: _removed, ...rest } = s.taskStreams
          return { taskStreams: rest }
        })
      }

      switch (event.type) {
        case 'text_delta': {
          if (taskId) {
            updateTaskStream({
              taskId,
              streamingText: (state.taskStreams[taskId]?.streamingText ?? '') + (event.delta || '')
            })
            set({ isOptimisticStreaming: false })
            resetStreamingTimeout()
            break
          }
          if (!isVisibleConversation) break
          set({
            isOptimisticStreaming: false,
            streamingText: state.streamingText + (event.delta || '')
          })
          resetStreamingTimeout()
          break
        }

        case 'thinking_delta': {
          if (taskId) {
            updateTaskStream({
              taskId,
              thinkingText: (state.taskStreams[taskId]?.thinkingText ?? '') + (event.delta || '')
            })
            resetStreamingTimeout()
            break
          }
          if (!isVisibleConversation) break
          set({
            thinkingText: state.thinkingText + (event.delta || '')
          })
          resetStreamingTimeout()
          break
        }

        case 'tool_start': {
          if (taskId) {
            const ts = state.taskStreams[taskId]
            const taskTools = { ...(ts?.tools ?? {}) }
            taskTools[event.toolCallId] = { name: event.toolName, input: event.toolInput, status: 'running' }
            const taskTurnIds = [...(ts?.currentTurnToolIds ?? [])]
            if (!taskTurnIds.includes(event.toolCallId)) {
              taskTurnIds.push(event.toolCallId)
            }
            updateTaskStream({ taskId, tools: taskTools, currentTurnToolIds: taskTurnIds })
            set({ isOptimisticStreaming: false })
            resetStreamingTimeout()
            break
          }
          if (!isVisibleConversation) break
          const newTools = { ...state.tools }
          newTools[event.toolCallId] = {
            name: event.toolName,
            input: event.toolInput,
            status: 'running'
          }
          const currentTurnToolIds = state.currentTurnToolIds.includes(event.toolCallId)
            ? state.currentTurnToolIds
            : [...state.currentTurnToolIds, event.toolCallId]
          set({
            isOptimisticStreaming: false,
            tools: newTools,
            currentTurnToolIds
          })
          resetStreamingTimeout()
          break
        }

        case 'tool_result': {
          if (taskId) {
            const ts = state.taskStreams[taskId]
            const taskTools = { ...(ts?.tools ?? {}) }
            if (taskTools[event.toolCallId]) {
              taskTools[event.toolCallId] = {
                ...taskTools[event.toolCallId],
                status: event.success ? 'completed' : 'error',
                result: event.result
              }
            }
            updateTaskStream({ taskId, tools: taskTools })
            // Module B: detect file changes from task tools
            if (event.success && ts) {
              const tool = ts.tools[event.toolCallId]
              if (tool) {
                const change = extractFileChange(tool.name, tool.input)
                if (change && eventConversationId) {
                  useChangeStore.getState().recordChange({
                    conversation_id: eventConversationId,
                    path: change.path,
                    status: change.status,
                    additions: change.additions,
                    deletions: change.deletions,
                    diff_text: change.diff_text ?? undefined,
                    tool_call_id: event.toolCallId
                  }).catch(() => {})
                }
              }
            }
            break
          }
          if (!isVisibleConversation) break
          const newTools = { ...state.tools }
          if (newTools[event.toolCallId]) {
            newTools[event.toolCallId] = {
              ...newTools[event.toolCallId],
              status: event.success ? 'completed' : 'error',
              result: event.result
            }
          }
          set({ tools: newTools })

          // Module B: Detect file operations and record changes
          if (event.success) {
            const tool = state.tools[event.toolCallId]
            if (tool) {
              const change = extractFileChange(tool.name, tool.input)
              if (change) {
                const sessionId = event.sessionId || state.streamingRequestId
                const convId = eventConversationId || (sessionId && sessionConversationIds.get(sessionId)) || state.currentConversation?.id
                if (convId) {
                  useChangeStore.getState().recordChange({
                    conversation_id: convId,
                    path: change.path,
                    status: change.status,
                    additions: change.additions,
                    deletions: change.deletions,
                    diff_text: change.diff_text ?? undefined,
                    tool_call_id: event.toolCallId
                  }).catch(() => {})

                  // Optimistic: update change_count in local UI state
                  set((currentState) => {
                    const nextConv = currentState.currentConversation?.id === convId
                      ? { ...currentState.currentConversation, change_count: currentState.currentConversation.change_count + 1 }
                      : currentState.currentConversation
                    return {
                      currentConversation: nextConv,
                      conversations: currentState.conversations.map((c) =>
                        c.id === convId ? { ...c, change_count: c.change_count + 1 } : c
                      )
                    }
                  })
                }
              }
            }
          }
          break
        }

        case 'tool_denied': {
          if (!isVisibleConversation) break
          const newTools = { ...state.tools }
          if (newTools[event.toolCallId]) {
            newTools[event.toolCallId] = {
              ...newTools[event.toolCallId],
              status: 'error'
            }
          }
          set({ tools: newTools })
          break
        }

        case 'permission_request': {
          const permConvId = eventConversationId
          if (permConvId) {
            get().updateConversationStatus(permConvId, 'Waiting').catch(() => {})
          }
          // Show permission dialog when:
          // 1. The event is for the currently visible conversation, OR
          // 2. The orchestrator is streaming for this conversation (delegated tasks)
          const isOrchStreaming = state.streamingRequestId?.startsWith('orch:')
          const isCurrentConv = Boolean(permConvId && state.currentConversation?.id === permConvId)
          if (!isVisibleConversation && !(isOrchStreaming && isCurrentConv)) break
          set({
            pendingPermissions: [
              ...state.pendingPermissions,
              {
                confirmId: event.confirmId,
                requestId: event.id,
                sessionId: event.sessionId || state.streamingRequestId || '',
                conversationId: routedEvent.conversationId ?? permConvId,
                profileId: routedEvent.agentProfileId ?? undefined,
                taskId: routedEvent.taskId,
                toolName: event.toolName,
                toolInput: event.toolInput
              }
            ]
          })
          break
        }

        case 'ask_user_question': {
          const questionConvId = eventConversationId
          if (questionConvId) {
            get().updateConversationStatus(questionConvId, 'Waiting').catch(() => {})
          }
          if (!isVisibleConversation) break
          set({
            pendingQuestions: [
              ...state.pendingQuestions,
              {
                confirmId: event.confirmId,
                requestId: event.id,
                sessionId: event.sessionId || state.streamingRequestId || '',
                conversationId: routedEvent.conversationId,
                profileId: routedEvent.agentProfileId ?? undefined,
                taskId: routedEvent.taskId,
                questions: event.questions
              }
            ]
          })
          break
        }

        case 'todo_updated': {
          const sessionId = (event as any).sessionId || state.streamingRequestId
          const todoConvId = eventConversationId || (sessionId && sessionConversationIds.get(sessionId)) || state.currentConversation?.id
          const isVisibleConversation = Boolean(todoConvId && state.currentConversation?.id === todoConvId)

          if (isVisibleConversation) {
            set({ todos: event.todos || [] })
            useTodoStore.getState().onTodoUpdated(event)
          }

          // Persist todos to DB — route by sessionId to avoid writing to wrong conversation
          if (todoConvId && event.todos) {
            window.api.todo.sync(todoConvId, event.todos.map((t: { content: string; status: string }, i: number) => ({
              content: t.content,
              completed: t.status === 'completed' ? 1 : 0,
              order_index: i
            }))).catch(() => {})
          }
          break
        }

        case 'subagent_started': {
          if (!isVisibleConversation) break
          const newSubagents = { ...state.subagents }
          newSubagents[event.agentId] = {
            id: event.agentId,
            name: event.name,
            type: event.agentType,
            description: event.description,
            status: 'active'
          }
          set({ subagents: newSubagents })
          useSubagentStore.getState().onSubagentStarted(event)

          // Module B: Increment agent_count
          const sessionId = event.sessionId || state.streamingRequestId
          const agentConvId = eventConversationId || (sessionId && sessionConversationIds.get(sessionId)) || state.currentConversation?.id
          if (agentConvId) {
            window.api.conversation.incrementAgentCount(agentConvId).catch(() => {})
            set((currentState) => {
              const nextConv = currentState.currentConversation?.id === agentConvId
                ? { ...currentState.currentConversation, agent_count: currentState.currentConversation.agent_count + 1 }
                : currentState.currentConversation
              return {
                currentConversation: nextConv,
                conversations: currentState.conversations.map((c) =>
                  c.id === agentConvId ? { ...c, agent_count: c.agent_count + 1 } : c
                )
              }
            })
          }
          break
        }

        case 'subagent_stopped': {
          if (!isVisibleConversation) break
          const newSubagents = { ...state.subagents }
          delete newSubagents[event.agentId]
          set({ subagents: newSubagents })
          useSubagentStore.getState().onSubagentStopped(event)
          break
        }

        case 'subagent_completed': {
          if (!isVisibleConversation) break
          const newSubagents = { ...state.subagents }
          if (newSubagents[event.agentId]) {
            newSubagents[event.agentId] = {
              ...newSubagents[event.agentId],
              status: 'completed',
              result: event.result
            }
          }
          set({ subagents: newSubagents })
          useSubagentStore.getState().onSubagentCompleted(event)
          break
        }

          case 'complete': {
            if (event.sessionId && abortedSessionIds.has(event.sessionId)) {
              break
            }

            // 保存 AI 消息到 DB
            // Per-task completion (M2-2)
          if (taskId) {
            const ts = state.taskStreams[taskId]
            const fullTaskText = event.fullText || ts?.streamingText || ''
            const taskConvId = eventConversationId
            if (fullTaskText && taskConvId) {
              const taskToolIds = ts?.currentTurnToolIds ?? []
              const taskToolCalls = taskToolIds.length > 0
                ? JSON.stringify(
                    taskToolIds.map((tid) => {
                      const t = ts?.tools[tid]
                      return t ? { id: tid, toolName: t.name, toolInput: t.input, status: t.status, result: t.result } : null
                    }).filter(Boolean)
                  )
                : undefined

              void window.api.message
                .create({
                  conversation_id: taskConvId,
                  role: 'assistant',
                  content: fullTaskText,
                  thinking: ts?.thinkingText || undefined,
                  tool_calls: taskToolCalls,
                  usage: event.usage ? JSON.stringify(event.usage) : undefined,
                  agent_profile_id: event.agentProfileId ?? null
                })
                .then((message) => {
                  appendMessageIfVisible(taskConvId, message as Message)
                  const latestState = get()
                  if (latestState.currentConversation?.id === taskConvId) {
                    maybeCreateSummary(taskConvId, latestState.messages)
                  }
                })
                .catch(() => {})
            }
            if (taskConvId) {
              get().updateConversationStatus(taskConvId, 'Done').catch(() => {})
            }
            deactivateTaskStream(taskId)
            break
          }

          const fullText = event.fullText || state.streamingText
          const conversationId = eventConversationId

          if (fullText && conversationId) {
            const toolCalls = state.currentTurnToolIds.length > 0
              ? JSON.stringify(
                  state.currentTurnToolIds.map((tid) => {
                    const t = state.tools[tid]
                    return t
                      ? { id: tid, toolName: t.name, toolInput: t.input, status: t.status, result: t.result }
                      : null
                  }).filter(Boolean)
                )
              : undefined

            void window.api.message
              .create({
                conversation_id: conversationId,
                role: 'assistant',
                content: fullText,
                thinking: state.thinkingText || undefined,
                tool_calls: toolCalls,
                usage: event.usage ? JSON.stringify(event.usage) : undefined,
                agent_profile_id: event.agentProfileId ?? null
              })
              .then((message) => {
                appendMessageIfVisible(conversationId, message as Message)

                const latestState = get()
                if (latestState.currentConversation?.id === conversationId) {
                  maybeCreateSummary(conversationId, latestState.messages)
                }
              })
              .catch(() => {
                /* best-effort persistence */
              })

          }

          if (isVisibleConversation || isActiveStreamEvent) {
            set({
              streamingText: '',
              thinkingText: '',
              currentTurnToolIds: []
            })
          }

          // Update conversation status to Done
          if (conversationId) {
            get().updateConversationStatus(conversationId, 'Done').catch(() => {})
          }

          if (event.usage) {
            set({ usage: event.usage })
            // Route to usageStore
            if (conversationId) {
              useUsageStore.getState().updateFromComplete(conversationId, {
                usage: event.usage,
                costUsd: event.costUsd
              })
              // Persist usage to DB
              const config = useSessionConfigStore.getState()
              window.api.usage.create({
                conversation_id: conversationId,
                model: config.model || 'unknown',
                input_tokens: event.usage.inputTokens,
                output_tokens: event.usage.outputTokens,
                cache_read_tokens: event.usage.cacheReadTokens,
                cache_creation_tokens: event.usage.cacheCreationTokens,
                cost_usd: event.costUsd,
                provider_id: config.providerType || undefined
              }).catch(() => {})
            }
          }

          // End active agent session in memory system
          if (conversationId) {
            try {
              const memoryStore = useMemoryStore.getState()
              const externalSessionId = event.sessionId || state.streamingRequestId
              if (externalSessionId) {
                memoryStore.endAgentSessionByExternalId(externalSessionId)
              }
            } catch { /* best-effort */ }

            // Summary generation runs after the assistant message is appended,
            // so it only uses messages from the visible conversation.
          }
          break
        }

          case 'done': {
            // Per-task completion (orchestrator sub-task): only clean up
            // per-task state, do NOT release the global composer. The
            // orchestrator task chain (pipeline, feedback follow-ups) may
            // still be running.
          if (taskId) {
            deactivateTaskStream(taskId)
            break
          }

          // 清理流式状态，标记 turn boundary
            const doneId = event.id || state.streamingRequestId
            const newDoneIds = { ...state.doneRequestIds }
            if (doneId) newDoneIds[doneId] = Date.now()
            if (doneId) abortedSessionIds.delete(doneId)

          // 清理 60s 前的 doneRequestIds
          const cutoff = Date.now() - 60000
          for (const key of Object.keys(newDoneIds)) {
            if (newDoneIds[key] < cutoff) delete newDoneIds[key]
          }

          // 非 manual 的 print-mode Claude 进程会在 turn 结束后退出，但 conversation -> sessionId
          // 必须保留，下一轮才能用 --resume 续接 Claude 上下文。
          if (doneId && !persistentSessionIds.has(doneId)) {
            sessionConversationIds.delete(doneId)
          }

          if (isVisibleConversation || isActiveStreamEvent) {
            set({
              streamingRequestId: null,
              isOptimisticStreaming: false,
              streamingText: '',
              thinkingText: '',
              currentTurnToolIds: [],
              turnBoundary: true,
              doneRequestIds: newDoneIds
            })
            clearStreamingTimeout()
          }
          break
        }

          case 'error': {
            const errorId = event.sessionId || event.id || state.streamingRequestId
            if (errorId) {
              abortedSessionIds.delete(errorId)
              const convId = sessionConversationIds.get(errorId)
            if (convId) {
              conversationSessionIds.delete(convId)
              sessionConversationIds.delete(errorId)
              set((s) => {
                const prefix = `${convId}:`
                const next: Record<string, string> = {}
                for (const key of Object.keys(s.activeSessionMap)) {
                  if (!key.startsWith(prefix)) next[key] = s.activeSessionMap[key]
                }
                return { activeSessionMap: next }
              })
              get().updateConversationStatus(convId, 'Error').catch(() => {})
            }
            persistentSessionIds.delete(errorId)
          }

          set({
            streamingRequestId: null,
            isOptimisticStreaming: false,
            streamingText: '',
            thinkingText: '',
            doneRequestIds: {}
          })
          clearStreamingTimeout()
          break
        }

        case 'usage': {
          set({ usage: event.usage })
          break
        }

        case 'system_message': {
          const sysConvId = event.conversationId || state.currentConversation?.id
          const content = event.content || ''
          if (sysConvId && content) {
            void window.api.message.create({
              conversation_id: sysConvId,
              role: 'system',
              content
            }).then((message) => {
              appendMessageIfVisible(sysConvId, message as Message)
            }).catch(() => {})
          }
          break
        }

        case 'system_init': {
          // CLI 初始化，可记录 session 信息
          break
        }

        case 'agent_observation': {
          const obsConvId = event.conversationId || state.currentConversation?.id
          if (!obsConvId) break
          // Guard: ignore late observations after Open Floor has been closed (CR #9)
          if (state.openFloorStates[obsConvId]?.status !== 'active') {
            console.warn('[chatStore] agent_observation dropped: openFloorStates[%s] = %s (expected "active"), agent=%s',
              obsConvId, state.openFloorStates[obsConvId]?.status ?? 'undefined', event.agentName)
            break
          }
          // Add the observation to the Open Floor state
          get().addOpenFloorResponse(obsConvId, {
            agentId: event.agentProfileId,
            agentName: event.agentName,
            content: event.content,
            timestamp: event.timestamp,
            relevanceScore: event.relevanceScore ?? 0
          })
          // Also append as a visible message in the conversation
          if (state.currentConversation?.id === obsConvId) {
            void window.api.message.create({
              conversation_id: obsConvId,
              role: 'assistant',
              content: `**${event.agentName}** (relevance: ${Math.round((event.relevanceScore ?? 0) * 100)}%)\n\n${event.content}`,
              agent_profile_id: event.agentProfileId
            }).then((message) => {
              appendMessageIfVisible(obsConvId, message as Message)
            }).catch((err) => {
              console.error('Failed to create agent observation message:', err)
            })
          }
          break
        }

        case 'open_floor_closed': {
          const closedConvId = event.conversationId || state.currentConversation?.id
          if (!closedConvId) break
          get().closeOpenFloor(closedConvId)
          // Summary system message is already emitted by the backend via appendSystemMessage.
          break
        }
      }
    }
  }
})
