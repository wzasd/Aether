import { registerSystemIpc } from './system'
import { registerWorkspaceIpc } from './workspace'
import { registerConversationIpc } from './conversation'
import { registerChatIpc } from './chat'
import { registerDialogIpc } from './dialog'
import { registerMemoryIpc } from './memory'
import { registerTaskIpc } from './task'
import { registerFileIpc } from './file'
import { registerChangeIpc } from './change'
import { registerMemoryPalaceIpc } from './memory-palace'
import { registerAgentIpc } from './agent'
import { registerTerminalIpc } from './terminal'
import { registerOrchestratorIpc } from './orchestrator'
import { registerUpdateIpc } from './update'
import { registerMcpIpc } from './mcp'
import { registerTeamIpc } from './team'

export function registerIpcHandlers(): void {
  registerSystemIpc()
  registerWorkspaceIpc()
  registerConversationIpc()
  registerChatIpc()
  registerDialogIpc()
  registerMemoryIpc()
  registerTaskIpc()
  registerFileIpc()
  registerChangeIpc()
  registerMemoryPalaceIpc()
  registerAgentIpc()
  registerTerminalIpc()
  registerOrchestratorIpc()
  registerUpdateIpc()
  registerMcpIpc()
  registerTeamIpc()
}
