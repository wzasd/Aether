import { HashRouter, Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatPage } from './pages/Chat'
import { HomePage } from './pages/Home'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useChatStore } from './stores/chatStore'
import { useEffect } from 'react'

function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces)
  const loadConversations = useChatStore((s) => s.loadConversations)

  useEffect(() => {
    loadWorkspaces()
    loadConversations()
  }, [loadWorkspaces, loadConversations])

  return (
    <HashRouter>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

export default App