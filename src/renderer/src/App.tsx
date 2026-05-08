import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { WorkspaceShell } from './components/workspace/WorkspaceShell'
import { TaskRail } from './components/workspace/TaskRail'
import { SharedConversation } from './components/workspace/SharedConversation'
import { WorkspaceArea } from './components/workspace/WorkspaceArea'
import { ChatPage } from './pages/Chat'
import { HomePage } from './pages/Home'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NewTaskDialog } from './components/NewTaskDialog'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useChatStore } from './stores/chatStore'
import { useUIStore } from './stores/uiStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useEffect, useState } from 'react'

function AppContent() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const createConversation = useChatStore((s) => s.createConversation)
  const setPendingCollaborationMode = useChatStore((s) => s.setPendingCollaborationMode)
  const newTaskDialogOpen = useChatStore((s) => s.newTaskDialogOpen)
  const openNewTaskDialog = useChatStore((s) => s.openNewTaskDialog)
  const closeNewTaskDialog = useChatStore((s) => s.closeNewTaskDialog)
  const showSidePanel = useUIStore((s) => s.showSidePanel)
  const setShowSidePanel = useUIStore((s) => s.setShowSidePanel)
  const collapseWorkspace = useUIStore((s) => s.setWorkspaceCollapsed)
  const navigate = useNavigate()

  const [settingsTrigger, setSettingsTrigger] = useState(0)
  const [agentSettingsTrigger, setAgentSettingsTrigger] = useState(0)
  const [viewChangesTrigger, setViewChangesTrigger] = useState(0)
  const [memoryTrigger, setMemoryTrigger] = useState(0)

  // Canonical new-chat flow — all entry points converge here
  const handleNewChatSelect = (collaborationMode?: 'orchestrated' | 'open_floor', taskId?: string) => {
    closeNewTaskDialog()
    void createConversation({
      title: 'New Chat',
      workspace_id: currentWorkspaceId ?? undefined,
      task_id: taskId
    }).then((conv) => {
      if (conv?.id) {
        if (collaborationMode) setPendingCollaborationMode(conv.id, collaborationMode)
        navigate(`/chat/${conv.id}`)
      }
    })
  }

  useKeyboardShortcuts(
    () => setSettingsTrigger((v) => v + 1),
    () => setMemoryTrigger((v) => v + 1),
    () => openNewTaskDialog(),
  )

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    loadConversations(currentWorkspaceId ?? undefined)
  }, [loadConversations, currentWorkspaceId])

  return (
    <>
      <WorkspaceShell
        taskRail={({ collapseTaskRail }) => (
          <TaskRail
            onToggleCollapse={collapseTaskRail}
            onNewConversation={openNewTaskDialog}
            onSelectConversation={(id) => navigate(`/chat/${id}`)}
            onOpenMemory={() => setMemoryTrigger((v) => v + 1)}
          />
        )}
        sharedConversation={
          <SharedConversation
            onOpenSettings={() => setSettingsTrigger((v) => v + 1)}
            onOpenAgentSettings={() => setAgentSettingsTrigger((v) => v + 1)}
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/chat/:id" element={<ChatPage />} />
            </Routes>
          </SharedConversation>
        }
        workspaceArea={
          <WorkspaceArea
            showSidePanel={showSidePanel}
            onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
            onToggleBottomPanel={() => useUIStore.getState().toggleBottomPanel()}
            onCollapseWorkspace={() => collapseWorkspace(true)}
            openSettingsTrigger={settingsTrigger}
            openAgentSettingsTrigger={agentSettingsTrigger}
            openTrackChangesTrigger={viewChangesTrigger}
            openMemoryTrigger={memoryTrigger}
          />
        }
      />

      {/* Canonical NewTaskDialog — single entry point for all "New" buttons */}
      <NewTaskDialog
        open={newTaskDialogOpen}
        onSelect={handleNewChatSelect}
        onCancel={closeNewTaskDialog}
      />
    </>
  )
}

function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </HashRouter>
  )
}

export default App
