/**
 * IPC Handler Registration — DEPRECATED
 *
 * All IPC handlers below have been migrated to HTTP endpoints in
 * `src/main/daemon/renderer-api-routes/`. This file is kept during
 * Phase 3f (renderer-side HTTP migration) and will be removed once
 * the renderer no longer depends on ipcRenderer.invoke().
 *
 * ADR-016: Renderer API Server + SSE
 * Phase 3d status: 100% complete (136/136 handlers migrated)
 */

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
import { registerLogsIpc } from './logs'
import { registerDaemonIpc } from './daemon'
import { registerActionCardIpc } from './action-card'

/** @deprecated IPC handlers superseded by HTTP endpoints. Kept for Phase 3f renderer migration. */
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
  registerLogsIpc()
  registerDaemonIpc()
  registerActionCardIpc()
}
