import { registerSystemIpc } from './system'
import { registerWorkspaceIpc } from './workspace'
import { registerConversationIpc } from './conversation'
import { registerChatIpc } from './chat'
import { registerDialogIpc } from './dialog'
import { registerMemoryIpc } from './memory'

export function registerIpcHandlers(): void {
  registerSystemIpc()
  registerWorkspaceIpc()
  registerConversationIpc()
  registerChatIpc()
  registerDialogIpc()
  registerMemoryIpc()
}
