import { create } from 'zustand'
import { useSessionConfigStore } from './sessionConfigStore'
import { useUsageStore } from './usageStore'
import { useSubagentStore } from './subagentStore'
import { useTodoStore } from './todoStore'
import { useMemoryStore } from './memoryStore'
import { useWorkspaceStore } from './workspaceStore'

// ─── 类型定义 ───

interface Conversation {
  id: string
  workspace_id: string | null
  title: string | null
  model: string | null
  provider: string | null
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
  toolName: string
  toolInput: string
}

interface PendingQuestion {
  confirmId: string
  requestId: string
  sessionId: string
  questions: Array<{
    question: string
    options?: string[]
    multiSelect?: boolean
  }>
}

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

// ─── ChatState ───

interface ChatState {
  // 基础状态
  conversations: Conversation[]
  currentConversation: Conversation | null
  messages: Message[]
  loading: boolean

  // 流式状态（参考原版 §6）
  streamingRequestId: string | null
  isOptimisticStreaming: boolean
  streamingText: string
  thinkingText: string
  tools: Record<string, ToolState>
  currentTurnToolIds: string[]
  turnBoundary: boolean
  doneRequestIds: Record<string, number>

  // 权限/提问
  pendingPermissions: PendingPermission[]
  pendingQuestions: PendingQuestion[]

  // 任务/子代理
  todos: TodoItem[]
  subagents: Record<string, SubagentState>

  // 使用统计
  usage: UsageInfo | null

  // Actions
  loadConversations: (workspaceId?: string) => Promise<void>
  loadConversation: (id: string) => Promise<void>
  createConversation: (data: { title?: string; model?: string; provider?: string; workspace_id?: string }) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<void>
  setConversationTitle: (id: string, title: string) => Promise<void>
  sendMessage: (conversationId: string, content: string) => Promise<void>
  abortStream: () => void
  confirmPermission: (confirmId: string, approved: boolean) => void
  answerQuestion: (confirmId: string, answers: Record<string, string>) => void
  handleAIEvent: (event: AIEvent) => void
}

type AIEvent = any // 使用 global.d.ts 中的类型

const STREAMING_SAFETY_TIMEOUT = 300000 // 5 分钟

export const useChatStore = create<ChatState>((set, get) => {
  let streamingTimeoutId: ReturnType<typeof setTimeout> | null = null
  let unsubscribeAI: (() => void) | null = null
  const conversationSessionIds = new Map<string, string>()
  const sessionConversationIds = new Map<string, string>()
  const persistentSessionIds = new Set<string>()

  const resetStreamingTimeout = (): void => {
    clearStreamingTimeout()
    streamingTimeoutId = setTimeout(() => {
      const state = get()
      if (state.streamingRequestId || state.isOptimisticStreaming) {
        set({
          streamingRequestId: null,
          isOptimisticStreaming: false,
          streamingText: '',
          thinkingText: '',
          doneRequestIds: {}
        })
      }
    }, STREAMING_SAFETY_TIMEOUT)
  }

  const clearStreamingTimeout = (): void => {
    if (streamingTimeoutId) {
      clearTimeout(streamingTimeoutId)
      streamingTimeoutId = null
    }
  }

  return {
    // 基础状态
    conversations: [],
    currentConversation: null,
    messages: [],
    loading: false,

    // 流式状态
    streamingRequestId: null,
    isOptimisticStreaming: false,
    streamingText: '',
    thinkingText: '',
    tools: {},
    currentTurnToolIds: [],
    turnBoundary: false,
    doneRequestIds: {},

    // 权限/提问
    pendingPermissions: [],
    pendingQuestions: [],

    // 任务/子代理
    todos: [],
    subagents: {},

    // 使用统计
    usage: null,

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
      set({ loading: true })
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
            pendingPermissions: [],
            pendingQuestions: [],
            todos: [],
            subagents: {},
            usage: null
          })
          // Restore persisted usage and todos from DB
          try {
            const usageRecords = await window.api.conversation.usageList(id)
            useUsageStore.getState().loadFromDB(id, usageRecords)
          } catch { /* best-effort */ }
          try {
            const todoRecords = await window.api.conversation.todoList(id)
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
        const conversation = await window.api.conversation.create(data)
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          currentConversation: conversation,
          messages: []
        }))
        return conversation
      } catch (err) {
        console.error('Failed to create conversation:', err)
        return null
      }
    },

    deleteConversation: async (id) => {
      try {
        await window.api.conversation.delete(id)
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          currentConversation: state.currentConversation?.id === id ? null : state.currentConversation,
          messages: state.currentConversation?.id === id ? [] : state.messages
        }))
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

    sendMessage: async (conversationId, content) => {
      const state = get()

      // 如果正在流式生成，点击发送按钮 → 中断
      if (state.streamingRequestId || state.isOptimisticStreaming) {
        get().abortStream()
        return
      }

      // 保存用户消息到 DB
      try {
        const message = await window.api.message.create({
          conversation_id: conversationId,
          role: 'user',
          content
        })
        set((state) => ({
          messages: [...state.messages, message as Message]
        }))
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

      // 启动 AI 流式响应（session-based API）
      try {
        const config = useSessionConfigStore.getState()
        const resumeSessionId = conversationSessionIds.get(conversationId)
        const { id: sessionId } = await window.api.chat.startSession({
          model: config.model,
          permissionMode: config.permissionMode,
          workingDir: config.workingDir,
          sessionId: resumeSessionId
        })

        conversationSessionIds.set(conversationId, sessionId)
        sessionConversationIds.set(sessionId, conversationId)
        if (config.permissionMode === 'manual') {
          persistentSessionIds.add(sessionId)
        } else {
          persistentSessionIds.delete(sessionId)
        }

        // Track agent session in memory system
        try {
          const memoryStore = useMemoryStore.getState()
          const workspaceId = useWorkspaceStore.getState().currentWorkspaceId || ''
          memoryStore.createAgentSession({
            workspace_id: workspaceId,
            conversation_id: conversationId,
            agent_id: config.model || 'unknown',
            provider: 'claude-code',
            external_session_id: sessionId,
            seq: 1,
            status: 'active'
          })
        } catch { /* best-effort */ }

        // 订阅 AI 事件流（如果尚未订阅）
        if (!unsubscribeAI) {
          unsubscribeAI = window.api.chat.onEvent((event) => {
            get().handleAIEvent(event)
          })
        }

        // 发送消息
        set({ streamingRequestId: sessionId })
        await window.api.chat.sendMessage(sessionId, content)
      } catch (err) {
        console.error('Failed to start AI stream:', err)
        set({ isOptimisticStreaming: false, streamingRequestId: null })
        clearStreamingTimeout()
      }
    },

    abortStream: () => {
      const state = get()
      if (state.streamingRequestId) {
        window.api.chat.abort(state.streamingRequestId)
      }
      set({
        streamingRequestId: null,
        isOptimisticStreaming: false,
        streamingText: '',
        thinkingText: '',
        doneRequestIds: {}
      })
      clearStreamingTimeout()
    },

    confirmPermission: (confirmId, approved) => {
      const pending = get().pendingPermissions.find((p) => p.confirmId === confirmId)
      const sessionId = pending?.sessionId || get().streamingRequestId
      if (sessionId) {
        window.api.chat.respondPermission(sessionId, approved)
      }
      set((state) => ({
        pendingPermissions: state.pendingPermissions.filter((p) => p.confirmId !== confirmId)
      }))
    },

    answerQuestion: (confirmId, answers) => {
      const pending = get().pendingQuestions.find((q) => q.confirmId === confirmId)
      const sessionId = pending?.sessionId || get().streamingRequestId
      if (sessionId) {
        const answerStr = Object.values(answers).join(',')
        window.api.chat.respondQuestion(sessionId, answerStr)
      }
      set((state) => ({
        pendingQuestions: state.pendingQuestions.filter((q) => q.confirmId !== confirmId)
      }))
    },

    handleAIEvent: (event: AIEvent) => {
      const state = get()

      switch (event.type) {
        case 'text_delta': {
          set({
            isOptimisticStreaming: false,
            streamingText: state.streamingText + (event.delta || '')
          })
          resetStreamingTimeout()
          break
        }

        case 'thinking_delta': {
          set({
            thinkingText: state.thinkingText + (event.delta || '')
          })
          resetStreamingTimeout()
          break
        }

        case 'tool_start': {
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
          const newTools = { ...state.tools }
          if (newTools[event.toolCallId]) {
            newTools[event.toolCallId] = {
              ...newTools[event.toolCallId],
              status: event.success ? 'completed' : 'error',
              result: event.result
            }
          }
          set({ tools: newTools })
          break
        }

        case 'tool_denied': {
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
          set({
            pendingPermissions: [
              ...state.pendingPermissions,
              {
                confirmId: event.confirmId,
                requestId: event.id,
                sessionId: event.sessionId || state.streamingRequestId || '',
                toolName: event.toolName,
                toolInput: event.toolInput
              }
            ]
          })
          break
        }

        case 'ask_user_question': {
          set({
            pendingQuestions: [
              ...state.pendingQuestions,
              {
                confirmId: event.confirmId,
                requestId: event.id,
                sessionId: event.sessionId || state.streamingRequestId || '',
                questions: event.questions
              }
            ]
          })
          break
        }

        case 'todo_updated': {
          set({ todos: event.todos || [] })
          useTodoStore.getState().onTodoUpdated(event)
          // Persist todos to DB
          const todoConvId = state.currentConversation?.id
          if (todoConvId && event.todos) {
            window.api.conversation.todoSync(todoConvId, event.todos.map((t: { content: string; status: string }, i: number) => ({
              content: t.content,
              completed: t.status === 'completed' ? 1 : 0,
              order_index: i
            }))).catch(() => {})
          }
          break
        }

        case 'subagent_started': {
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
          break
        }

        case 'subagent_stopped': {
          const newSubagents = { ...state.subagents }
          delete newSubagents[event.agentId]
          set({ subagents: newSubagents })
          useSubagentStore.getState().onSubagentStopped(event)
          break
        }

        case 'subagent_completed': {
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
          // 保存 AI 消息到 DB
          const fullText = event.fullText || state.streamingText
          const conversationId =
            (event.sessionId && sessionConversationIds.get(event.sessionId)) ||
            state.currentConversation?.id ||
            null

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
                usage: event.usage ? JSON.stringify(event.usage) : undefined
              })
              .then((message) => {
                set((currentState) => {
                  if (currentState.currentConversation?.id !== conversationId) {
                    return currentState
                  }
                  return {
                    ...currentState,
                    messages: [...currentState.messages, message as Message]
                  }
                })
              })
              .catch(() => {
                /* best-effort persistence */
              })

            // Auto-title: extract first 50 chars from AI response
            if (fullText) {
              const autoTitle = fullText.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').slice(0, 50).trim()
              if (autoTitle) {
                window.api.conversation.autoTitle(conversationId, autoTitle).catch(() => {})
                set((currentState) => ({
                  ...currentState,
                  currentConversation:
                    currentState.currentConversation?.id === conversationId
                      ? { ...currentState.currentConversation!, title: autoTitle }
                      : currentState.currentConversation,
                  conversations: currentState.conversations.map((conversation) =>
                    conversation.id === conversationId
                      ? { ...conversation, title: autoTitle }
                      : conversation
                  )
                }))
              }
            }
          }

          set({
            streamingText: '',
            thinkingText: '',
            currentTurnToolIds: []
          })

          if (event.usage) {
            set({ usage: event.usage })
            // Route to usageStore
            if (conversationId) {
              useUsageStore.getState().updateFromComplete(conversationId, {
                usage: event.usage,
                costUsd: event.costUsd
              })
              // Persist usage to DB
              window.api.conversation.usageCreate({
                conversation_id: conversationId,
                model: event.usage.model || 'unknown',
                input_tokens: event.usage.inputTokens,
                output_tokens: event.usage.outputTokens,
                cache_read_tokens: event.usage.cacheReadTokens,
                cache_creation_tokens: event.usage.cacheCreationTokens,
                cost_usd: event.costUsd
              }).catch(() => {})
            }
          }

          // End active agent session in memory system
          if (conversationId) {
            try {
              const memoryStore = useMemoryStore.getState()
              const activeSession = memoryStore.agentSessions.find(
                (s) => s.conversation_id === conversationId && s.status === 'active'
              )
              if (activeSession) {
                memoryStore.endAgentSession(activeSession.id)
              }
            } catch { /* best-effort */ }
          }
          break
        }

        case 'done': {
          // 清理流式状态，标记 turn boundary
          const doneId = event.id || state.streamingRequestId
          const newDoneIds = { ...state.doneRequestIds }
          if (doneId) newDoneIds[doneId] = Date.now()

          // 清理 60s 前的 doneRequestIds
          const cutoff = Date.now() - 60000
          for (const key of Object.keys(newDoneIds)) {
            if (newDoneIds[key] < cutoff) delete newDoneIds[key]
          }

          // 非 manual 的 print-mode Claude 进程会在 turn 结束后退出；manual PTY 是长会话。
          if (doneId && !persistentSessionIds.has(doneId)) {
            const convId = sessionConversationIds.get(doneId)
            if (convId) {
              conversationSessionIds.delete(convId)
              sessionConversationIds.delete(doneId)
            }
          }

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
          break
        }

        case 'error': {
          const errorId = event.id || state.streamingRequestId
          if (errorId) {
            const convId = sessionConversationIds.get(errorId)
            if (convId) {
              conversationSessionIds.delete(convId)
              sessionConversationIds.delete(errorId)
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

        case 'system_init': {
          // CLI 初始化，可记录 session 信息
          break
        }
      }
    }
  }
})
