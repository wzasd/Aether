import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { useNavigate } from 'react-router-dom'
import { MessageSquarePlus, Trash2, PanelLeftClose, PanelLeft, Sun, Moon } from 'lucide-react'

export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations)
  const currentConversation = useChatStore((s) => s.currentConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const navigate = useNavigate()

  const handleNewChat = async () => {
    const conv = await createConversation({ title: 'New Chat' })
    if (conv) {
      navigate(`/chat/${conv.id}`)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteConversation(id)
    if (currentConversation?.id === id) {
      navigate('/')
    }
  }

  return (
    <aside
      className={`${sidebarOpen ? 'w-64' : 'w-0'} flex flex-col border-r border-border bg-card transition-all duration-200 overflow-hidden`}
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-sm font-semibold">Bytro</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={toggleSidebar} className="p-1.5 rounded-md hover:bg-accent transition-colors">
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </button>
        </div>
      </div>

      <div className="p-3">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
        >
          <MessageSquarePlus size={14} />
          New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
              currentConversation?.id === conv.id
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50 text-muted-foreground'
            }`}
            onClick={() => navigate(`/chat/${conv.id}`)}
          >
            <span className="truncate flex-1">{conv.title || 'Untitled'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(conv.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-all"
            >
              <Trash2 size={12} className="text-destructive" />
            </button>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border">
        <span className="text-xs text-muted-foreground">v0.1.0</span>
      </div>
    </aside>
  )
}