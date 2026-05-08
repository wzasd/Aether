import { useChatStore } from '../stores/chatStore'

export function HomePage() {
  const openNewTaskDialog = useChatStore((s) => s.openNewTaskDialog)

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <h1 className="text-xl font-bold text-foreground">Bytro</h1>
      <p className="text-[13px] text-muted-foreground">AI-Native Development Workspace</p>
      <button
        onClick={openNewTaskDialog}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-[13px]"
      >
        Start New Chat
      </button>
    </div>
  )
}
