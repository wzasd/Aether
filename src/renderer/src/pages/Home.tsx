import { useChatStore } from '../stores/chatStore'
import { useNavigate } from 'react-router-dom'

export function HomePage() {
  const conversations = useChatStore((s) => s.conversations)
  const createConversation = useChatStore((s) => s.createConversation)
  const navigate = useNavigate()

  const handleNewChat = async () => {
    const conv = await createConversation({ title: 'New Chat' })
    if (conv) {
      navigate(`/chat/${conv.id}`)
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold text-foreground">Bytro</h1>
      <p className="text-muted-foreground">Multi-model AI Chat IDE</p>
      <button
        onClick={handleNewChat}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Start New Chat
      </button>
      {conversations.length > 0 && (
        <div className="mt-8 w-full max-w-md">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Recent Conversations</h2>
          <div className="space-y-1">
            {conversations.slice(0, 5).map((conv) => (
              <button
                key={conv.id}
                onClick={() => navigate(`/chat/${conv.id}`)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-accent transition-colors text-sm"
              >
                {conv.title || 'Untitled'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}