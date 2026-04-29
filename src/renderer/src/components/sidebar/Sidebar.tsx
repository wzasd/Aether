import { useState, useEffect } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useNavigate } from 'react-router-dom'
import { MessageSquarePlus, Trash2, PanelLeftClose, PanelLeft, Sun, Moon, FolderOpen } from 'lucide-react'
import { ConversationSearch } from '../ConversationSearch'
import { DeleteConfirmDialog } from '../ConversationDeleteConfirm'
import { TodoList } from '../TodoList'
import { useMemoryStore } from '../../stores/memoryStore'

export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations)
  const currentConversation = useChatStore((s) => s.currentConversation)
  const createConversation = useChatStore((s) => s.createConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace)
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces)
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace)
  const navigate = useNavigate()
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [showNewWorkspace, setShowNewWorkspace] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const memoryCandidates = useMemoryStore((s) => s.candidates)
  const loadCandidates = useMemoryStore((s) => s.loadCandidates)
  const approveCandidate = useMemoryStore((s) => s.approveCandidate)
  const rejectCandidate = useMemoryStore((s) => s.rejectCandidate)

  useEffect(() => {
    loadWorkspaces()
  }, [])

  useEffect(() => {
    if (currentWorkspaceId) {
      loadCandidates(currentWorkspaceId, 'captured')
    }
  }, [currentWorkspaceId])

  const handleWorkspaceChange = (id: string | null) => {
    setCurrentWorkspace(id)
    loadConversations(id || undefined)
  }

  const handleCreateWorkspace = async () => {
    const name = newWorkspaceName.trim()
    if (!name) return
    const ws = await createWorkspace({ name })
    if (ws) {
      setCurrentWorkspace(ws.id)
      loadConversations(ws.id)
    }
    setNewWorkspaceName('')
    setShowNewWorkspace(false)
  }

  const handleNewChat = async () => {
    const conv = await createConversation({ title: 'New Chat', workspace_id: currentWorkspaceId || undefined })
    if (conv) {
      navigate(`/chat/${conv.id}`)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return
    await deleteConversation(deleteTargetId)
    if (currentConversation?.id === deleteTargetId) {
      navigate('/')
    }
    setDeleteTargetId(null)
  }

  return (
    <aside
      className={`${sidebarOpen ? 'w-64' : 'w-0'} flex flex-col border-r border-border bg-card transition-all duration-200 overflow-hidden`}
    >
      {/* 标题栏 + Workspace 选择器 */}
      <div className="titlebar-drag flex items-center justify-between h-12 px-4 border-b border-border">
        <span className="text-sm font-semibold pl-14">Bytro</span>
        <div className="titlebar-no-drag flex items-center gap-1">
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

      {/* Workspace 选择器 + 新建 */}
      <div className="px-3 pt-2 pb-1 space-y-1.5">
        <select
          value={currentWorkspaceId || ''}
          onChange={(e) => handleWorkspaceChange(e.target.value || null)}
          className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
        >
          <option value="">所有对话</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>
        {showNewWorkspace ? (
          <div className="flex gap-1">
            <input
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
              placeholder="工作区名称"
              className="flex-1 text-xs rounded-md border border-border bg-background px-2 py-1 text-foreground placeholder:text-muted-foreground"
              autoFocus
            />
            <button onClick={handleCreateWorkspace} className="text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground">添加</button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewWorkspace(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <FolderOpen size={12} /> 新建工作区
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
        >
          <MessageSquarePlus size={14} />
          New Chat
        </button>
      </div>

      <ConversationSearch onSelect={(id) => navigate(`/chat/${id}`)} />

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
                setDeleteTargetId(conv.id)
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-all"
            >
              <Trash2 size={12} className="text-destructive" />
            </button>
          </div>
        ))}
      </div>

      <TodoList />

      {/* Memory Candidates */}
      {memoryCandidates.length > 0 && (
        <div className="px-3 py-2 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">待确认记忆</div>
          {memoryCandidates.slice(0, 3).map((c) => (
            <div key={c.id} className="bg-zinc-900 border border-zinc-700 rounded p-2 mb-1.5 text-xs">
              <div className="text-zinc-300 font-medium truncate">{c.title}</div>
              <div className="text-zinc-500 truncate">{c.content.slice(0, 80)}</div>
              <div className="flex gap-1 mt-1.5">
                <button
                  onClick={() => approveCandidate(c.id, c.workspace_id)}
                  className="px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-500"
                >
                  确认
                </button>
                <button
                  onClick={() => rejectCandidate(c.id)}
                  className="px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="p-3 border-t border-border">
        <span className="text-xs text-muted-foreground">v0.1.0</span>
      </div>

      <DeleteConfirmDialog
        open={deleteTargetId !== null}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />
    </aside>
  )
}