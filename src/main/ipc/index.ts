import { registerSystemIpc } from './system'
import { registerWorkspaceIpc } from './workspace'
import { registerConversationIpc } from './conversation'
import { registerChatIpc } from './chat'

export function registerIpcHandlers(): void {
  registerSystemIpc()
  registerWorkspaceIpc()
  registerConversationIpc()
  registerChatIpc()
}
