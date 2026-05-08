import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { WorkspaceShell } from './components/workspace/WorkspaceShell'
import { TaskRail } from './components/workspace/TaskRail'
import { SharedConversation } from './components/workspace/SharedConversation'
import { WorkspaceArea } from './components/workspace/WorkspaceArea'
import { ChatPage } from './pages/Chat'
import { HomePage } from './pages/Home'
import { ErrorBoundary } from './components/ErrorBoundary'
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
  const showSidePanel = useUIStore((s) => s.showSidePanel)
  const setShowSidePanel = useUIStore((s) => s.setShowSidePanel)
  const collapseWorkspace = useUIStore((s) => s.setWorkspaceCollapsed)
  const navigate = useNavigate()

  const [settingsTrigger, setSettingsTrigger] = useState(0)
  const [viewChangesTrigger, setViewChangesTrigger] = useState(0)
  const [memoryTrigger, setMemoryTrigger] = useState(0)

  useKeyboardShortcuts(
    () => setSettingsTrigger((v) => v + 1),
    () => setMemoryTrigger((v) => v + 1),
  )

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    loadConversations(currentWorkspaceId ?? undefined)
  }, [loadConversations, currentWorkspaceId])

  return (
    <WorkspaceShell
      taskRail={({ collapseTaskRail }) => (
        <TaskRail
          onToggleCollapse={collapseTaskRail}
          onNewConversation={() => {
            void createConversation({ title: 'New Task', workspace_id: currentWorkspaceId ?? undefined, is_draft: 1 }).then((conv: any) => {
              if (conv?.id) {
                navigate(`/chat/${conv.id}`)
              }
            })
          }}
          onSelectConversation={(id) => navigate(`/chat/${id}`)}
          onOpenMemory={() => setMemoryTrigger((v) => v + 1)}
        />
      )}
      sharedConversation={
        <SharedConversation onOpenSettings={() => setSettingsTrigger((v) => v + 1)}>
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
          openTrackChangesTrigger={viewChangesTrigger}
          openMemoryTrigger={memoryTrigger}
        />
      }
    />
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
