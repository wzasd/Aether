import { useParams } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { useEffect } from 'react'

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const currentConversation = useChatStore((s) => s.currentConversation)
  const messages = useChatStore((s) => s.messages)
  const loadConversation = useChatStore((s) => s.loadConversation)

  useEffect(() => {
    if (id) {
      loadConversation(id)
    }
  }, [id, loadConversation])

  if (!currentConversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Conversation not found
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <h2 className="text-sm font-medium truncate">
          {currentConversation.title || 'Untitled'}
        </h2>
        <span className="text-xs text-muted-foreground">
          {currentConversation.model || 'claude-sonnet-4'}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <MessageList messages={messages} />
      </div>
      <div className="border-t border-border p-4">
        <ChatInput conversationId={id!} />
      </div>
    </div>
  )
}