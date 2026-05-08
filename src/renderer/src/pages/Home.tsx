import { useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useNavigate } from 'react-router-dom'
import { NewTaskDialog } from '../components/NewTaskDialog'

export function HomePage() {
  const createConversation = useChatStore((s) => s.createConversation)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const navigate = useNavigate()
  const [newTaskOpen, setNewTaskOpen] = useState(false)

  const handleNewTaskSelect = (mode: 'solo' | 'team', teamId?: string, taskId?: string) => {
    setNewTaskOpen(false)
    void createConversation({
      title: mode === 'team' ? 'Team Session' : 'New Task',
      workspace_id: currentWorkspaceId ?? undefined,
      is_draft: 1,
      team_id: teamId,
      task_id: taskId
    }).then((conv) => {
      if (conv?.id) navigate(`/chat/${conv.id}`)
    })
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <h1 className="text-xl font-bold text-foreground">Bytro</h1>
      <p className="text-[13px] text-muted-foreground">AI-Native Development Workspace</p>
      <button
        onClick={() => setNewTaskOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-[13px]"
      >
        Start New Chat
      </button>

      <NewTaskDialog
        open={newTaskOpen}
        onSelect={handleNewTaskSelect}
        onCancel={() => setNewTaskOpen(false)}
      />
    </div>
  )
}
