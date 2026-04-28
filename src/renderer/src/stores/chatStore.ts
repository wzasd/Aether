import { create } from 'zustand'

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
  created_at: number
}

interface ChatState {
  conversations: Conversation[]
  currentConversation: Conversation | null
  messages: Message[]
  loading: boolean
  sending: boolean

  loadConversations: () => Promise<void>
  loadConversation: (id: string) => Promise<void>
  createConversation: (data: { title?: string; model?: string; provider?: string }) => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (conversationId: string, content: string) => Promise<void>
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  currentConversation: null,
  messages: [],
  loading: false,
  sending: false,

  loadConversations: async () => {
    set({ loading: true })
    try {
      const conversations = await window.api.conversation.list()
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
      if (result) {
        set({
          currentConversation: result,
          messages: result.messages || [],
          loading: false
        })
      } else {
        set({ currentConversation: null, messages: [], loading: false })
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

  sendMessage: async (conversationId, content) => {
    set({ sending: true })
    try {
      const message = await window.api.message.create({
        conversation_id: conversationId,
        role: 'user',
        content
      })
      set((state) => ({
        messages: [...state.messages, message as Message],
        sending: false
      }))
    } catch (err) {
      console.error('Failed to send message:', err)
      set({ sending: false })
    }
  }
}))