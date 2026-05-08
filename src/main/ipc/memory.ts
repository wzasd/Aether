import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as memIdx from '../core/memory-index.js'
import * as memFs from '../core/memory-fs.js'
import { getDb } from '../core/db.js'
import type { MemoryScope } from '../core/memory-index.js'

type RecallOptions = {
  scope?: MemoryScope
  workspaceId?: string
  conversationId?: string
  limit?: number
}

const MEMORY_SCOPES = new Set<MemoryScope>(['project', 'conversation', 'all'])

function normalizeRecallOptions(options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number } = {}): RecallOptions {
  if (options.scope && !MEMORY_SCOPES.has(options.scope as MemoryScope)) {
    throw new Error(`Invalid memory scope: ${options.scope}`)
  }
  return {
    ...options,
    scope: options.scope as MemoryScope | undefined
  }
}

function getWorkspacePath(workspaceId: string): string {
  const db = getDb()
  const workspace = db.prepare('SELECT repo_path FROM workspaces WHERE id = ?').get(workspaceId) as { repo_path: string | null } | undefined
  if (!workspace?.repo_path) {
    throw new Error('Workspace has no repository path')
  }
  return workspace.repo_path
}

function formatProjectMemoryEntry(candidate: any): string {
  return [
    `### ${candidate.title}`,
    '',
    `Status: active`,
    `Kind: ${candidate.kind}`,
    `Confidence: ${candidate.confidence}`,
    candidate.source_conversation_id ? `Source Conversation: ${candidate.source_conversation_id}` : null,
    candidate.source_message_id ? `Source Message: ${candidate.source_message_id}` : null,
    '',
    candidate.content,
    ''
  ].filter((line) => line !== null).join('\n')
}

export function registerMemoryIpc(): void {
  // Recall: FTS search
  ipcMain.handle('memory:recall', (_event, query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) => {
    return memIdx.recallMemory(query, normalizeRecallOptions(options))
  })

  // Project memory: read from file
  ipcMain.handle('memory:readProjectMemory', (_event, workspaceId: string) => {
    return memFs.readProjectMemory(getWorkspacePath(workspaceId))
  })

  // Project memory: write to file
  ipcMain.handle('memory:writeProjectMemory', (_event, workspaceId: string, content: string) => {
    return memFs.writeProjectMemory(getWorkspacePath(workspaceId), content)
  })

  // Project memory: append entry to section
  ipcMain.handle('memory:appendProjectMemory', (_event, workspaceId: string, section: string, entry: string) => {
    return memFs.appendProjectMemory(getWorkspacePath(workspaceId), section, entry)
  })

  // Agent memory: read from file
  ipcMain.handle('memory:readAgentMemory', (_event, workspaceId: string, agentId: string) => {
    return memFs.readAgentMemory(getWorkspacePath(workspaceId), agentId)
  })

  // Agent memory: write to file
  ipcMain.handle('memory:writeAgentMemory', (_event, workspaceId: string, agentId: string, content: string) => {
    return memFs.writeAgentMemory(getWorkspacePath(workspaceId), agentId, content)
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

  // Project memory items: delete
  ipcMain.handle('memory:deleteProjectItem', async (_event, id: string) => {
    const item = memIdx.getProjectMemoryItemById(id)
    if (!item) {
      return { success: true }
    }

    const workspacePath = getWorkspacePath(item.workspace_id)
    const removedFromSource = await memFs.removeProjectMemoryEntry(workspacePath, item)
    if (!removedFromSource) {
      await memFs.appendProjectMemoryDeletion(workspacePath, {
        id: item.id,
        kind: item.kind,
        title: item.title
      })
    }

    memIdx.deleteProjectMemoryItem(id)
    return { success: true }
  })

  // Markers: list
  ipcMain.handle('memory:listMarkers', (_event, workspaceId: string) => {
    return memFs.listMarkers(getWorkspacePath(workspaceId))
  })

  // Markers: read
  ipcMain.handle('memory:readMarker', (_event, workspaceId: string, name: string) => {
    return memFs.readMarker(getWorkspacePath(workspaceId), name)
  })

  // Markers: write
  ipcMain.handle('memory:writeMarker', (_event, workspaceId: string, name: string, content: string) => {
    return memFs.writeMarker(getWorkspacePath(workspaceId), name, content)
  })

  // Candidate: approve + materialize to durable project memory file + read model
  ipcMain.handle('memory:materializeCandidate', async (_event, id: string) => {
    const candidate = memIdx.getCandidateById(id)
    if (!candidate) {
      throw new Error('Candidate not found')
    }

    const projectItemId = randomUUID()
    const workspacePath = getWorkspacePath(candidate.workspace_id)
    await memFs.appendProjectMemory(workspacePath, candidate.kind, formatProjectMemoryEntry(candidate))
    memIdx.materializeCandidateToProjectMemory(id, projectItemId)
    return { id: projectItemId }
  })

  // Agent session: create
  ipcMain.handle('memory:createAgentSession', (_event, data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq?: number; status: string }) => {
    const id = randomUUID()
    return memIdx.createAgentSession({ ...data, id })
  })

  // Agent session: end
  ipcMain.handle('memory:endAgentSession', (_event, id: string) => {
    memIdx.endAgentSession(id)
    return { success: true }
  })

  ipcMain.handle('memory:endAgentSessionByExternalId', (_event, externalSessionId: string) => {
    memIdx.endAgentSessionByExternalId(externalSessionId)
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
