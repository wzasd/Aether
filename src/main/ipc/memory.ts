import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as memIdx from '../core/memory-index.js'
import * as memFs from '../core/memory-fs.js'
import { getDb } from '../core/db.js'

export function registerMemoryIpc(): void {
  // Recall: FTS search
  ipcMain.handle('memory:recall', (_event, query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) => {
    return memIdx.recallMemory(query, options)
  })

  // Project memory: read from file
  ipcMain.handle('memory:readProjectMemory', (_event, workspacePath: string) => {
    return memFs.readProjectMemory(workspacePath)
  })

  // Project memory: write to file
  ipcMain.handle('memory:writeProjectMemory', (_event, workspacePath: string, content: string) => {
    return memFs.writeProjectMemory(workspacePath, content)
  })

  // Project memory: append entry to section
  ipcMain.handle('memory:appendProjectMemory', (_event, workspacePath: string, section: string, entry: string) => {
    return memFs.appendProjectMemory(workspacePath, section, entry)
  })

  // Agent memory: read from file
  ipcMain.handle('memory:readAgentMemory', (_event, workspacePath: string, agentId: string) => {
    return memFs.readAgentMemory(workspacePath, agentId)
  })

  // Agent memory: write to file
  ipcMain.handle('memory:writeAgentMemory', (_event, workspacePath: string, agentId: string, content: string) => {
    return memFs.writeAgentMemory(workspacePath, agentId, content)
  })

  // Candidate: create
  ipcMain.handle('memory:createCandidate', (_event, data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }) => {
    const id = randomUUID()
    memIdx.createCandidate({ ...data, id, status: 'captured' })
    return { id }
  })

  // Candidate: update status
  ipcMain.handle('memory:updateCandidateStatus', (_event, id: string, status: string) => {
    memIdx.updateCandidateStatus(id, status)
    return { success: true }
  })

  // Candidate: list by workspace + optional status
  ipcMain.handle('memory:listCandidates', (_event, workspaceId: string, status?: string) => {
    return memIdx.getCandidatesByWorkspace(workspaceId, status)
  })

  // Project memory items: list
  ipcMain.handle('memory:listProjectItems', (_event, workspaceId: string) => {
    return memIdx.getProjectMemoryByWorkspace(workspaceId)
  })

  // Project memory items: create (after candidate approved)
  ipcMain.handle('memory:createProjectItem', (_event, data: { workspace_id: string; kind: string; title: string; content: string; source_path?: string; source_hash?: string }) => {
    const id = randomUUID()
    memIdx.createProjectMemoryItem({ ...data, id, status: 'active' })
    return { id }
  })

  // Agent session: create
  ipcMain.handle('memory:createAgentSession', (_event, data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq: number; status: string }) => {
    const id = randomUUID()
    memIdx.createAgentSession({ ...data, id })
    return { id }
  })

  // Agent session: end
  ipcMain.handle('memory:endAgentSession', (_event, id: string) => {
    memIdx.endAgentSession(id)
    return { success: true }
  })

  // Agent session: list by conversation
  ipcMain.handle('memory:listAgentSessions', (_event, conversationId: string) => {
    const db = getDb()
    return db.prepare('SELECT * FROM agent_sessions WHERE conversation_id = ? ORDER BY seq ASC').all(conversationId)
  })

  // Conversation summary: get latest
  ipcMain.handle('memory:getLatestSummary', (_event, conversationId: string) => {
    return memIdx.getLatestSummary(conversationId)
  })

  // Conversation summary: create
  ipcMain.handle('memory:createSummary', (_event, data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }) => {
    const id = randomUUID()
    memIdx.createConversationSummary({ ...data, id })
    return { id }
  })

  // Agent profile: upsert
  ipcMain.handle('memory:upsertAgentProfile', (_event, data: { workspace_id?: string; agent_id: string; content: string; source_path?: string; source_hash?: string }) => {
    const id = randomUUID()
    memIdx.upsertAgentProfile({ ...data, id })
    return { success: true }
  })

  // Agent profile: get
  ipcMain.handle('memory:getAgentProfile', (_event, workspaceId: string | null, agentId: string) => {
    return memIdx.getAgentProfile(workspaceId, agentId)
  })
}
