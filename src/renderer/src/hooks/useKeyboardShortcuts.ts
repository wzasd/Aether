import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import { useUIStore } from '../stores/uiStore'

function isEditableTarget(target: HTMLElement): boolean {
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return true
  return target.closest('.monaco-editor') !== null
}

export function useKeyboardShortcuts(
  onOpenSettings: () => void,
  onOpenMemory: () => void,
  onNewConversation: () => void,
) {
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isMod = e.metaKey || e.ctrlKey

      // ─── Shortcuts that work even in input fields ───

      // Cmd+Enter: focus chat input (works everywhere)
      if (isMod && e.key === 'Enter') {
        e.preventDefault()
        const chatInput = document.querySelector('[data-chat-input]') as HTMLTextAreaElement | null
        chatInput?.focus()
        return
      }

      // Escape: abort stream if active, otherwise blur
      if (e.key === 'Escape') {
        const store = useChatStore.getState()
        if (store.streamingRequestId || store.isOptimisticStreaming) {
          e.preventDefault()
          store.abortStream()
          return
        }
        if (target !== document.body) {
          target.blur()
        }
        return
      }

      // ─── Shortcuts that DON'T work in input fields ───

      if (isEditableTarget(target)) return

      // Cmd+N: New conversation
      if (isMod && e.key === 'n' && !e.shiftKey) {
        e.preventDefault()
        onNewConversation()
        return
      }

      // Cmd+W: Close/delete current conversation
      if (isMod && e.key === 'w' && !e.shiftKey) {
        e.preventDefault()
        const { currentConversation, deleteConversation } = useChatStore.getState()
        if (currentConversation && window.confirm(`Delete "${currentConversation.title || 'Untitled'}"?`)) {
          deleteConversation(currentConversation.id)
          navigate('/')
        }
        return
      }

      // Cmd+K: Focus conversation list in TaskRail
      if (isMod && e.key === 'k' && !e.shiftKey) {
        e.preventDefault()
        const taskList = document.querySelector('[data-task-list]') as HTMLElement | null
        if (taskList) {
          taskList.dispatchEvent(new CustomEvent('kbd-focus'))
          taskList.focus()
        }
        return
      }

      // Cmd+,: Open Settings
      if (isMod && e.key === ',') {
        e.preventDefault()
        onOpenSettings()
        return
      }

      // Cmd+\: Toggle sidebar
      if (isMod && e.key === '\\') {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
        return
      }

      // Cmd+Shift+S: Toggle sidebar (alternative)
      if (isMod && e.shiftKey && e.key === 's') {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
        return
      }

      // Cmd+B: Toggle task rail
      if (isMod && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        useUIStore.getState().toggleTaskRailCollapsed()
        return
      }

      // Cmd+Shift+T: Toggle Terminal (bottom panel)
      if (isMod && e.shiftKey && e.key === 't') {
        e.preventDefault()
        useUIStore.getState().toggleBottomPanel()
        return
      }

      // Cmd+Shift+E: Toggle Explorer (side panel)
      if (isMod && e.shiftKey && e.key === 'e') {
        e.preventDefault()
        const ui = useUIStore.getState()
        ui.setShowSidePanel(!ui.showSidePanel)
        return
      }

      // Cmd+Shift+M: Open Memory
      if (isMod && e.shiftKey && e.key === 'm') {
        e.preventDefault()
        onOpenMemory()
        return
      }

      // Cmd+1~9: Switch to Nth conversation (uses filter-consistent list)
      if (isMod && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const index = parseInt(e.key, 10) - 1
        const { conversations, filter } = useChatStore.getState()
        const mappedFilter = filter === 'completed' ? 'done' : filter === 'pending' ? 'active' : filter
        const filtered = conversations.filter((conv) => {
          if (mappedFilter === 'all') return true
          if (mappedFilter === 'active') return conv.status === 'Running' || conv.status === 'Waiting'
          if (mappedFilter === 'done') return conv.status === 'Done' || conv.status === 'Error'
          return true
        })
        const targetConv = filtered[index]
        if (targetConv) {
          navigate(`/chat/${targetConv.id}`)
        }
        return
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [navigate, onOpenSettings, onOpenMemory, onNewConversation])
}
