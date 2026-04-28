interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string | null
  thinking: string | null
  created_at: number
}

export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Start a conversation...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card border border-border text-foreground'
            }`}
          >
            {msg.thinking && (
              <div className="mb-2 p-2 bg-muted rounded text-xs text-muted-foreground italic">
                Thinking: {msg.thinking.slice(0, 200)}...
              </div>
            )}
            <div className="whitespace-pre-wrap">{msg.content || ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}