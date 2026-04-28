import { registerSystemIpc } from './system'
import { registerWorkspaceIpc } from './workspace'
import { registerConversationIpc } from './conversation'

export function registerIpcHandlers(): void {
  registerSystemIpc()
  registerWorkspaceIpc()
  registerConversationIpc()
}
