/**
 * Renderer API Routes — Memory endpoints
 *
 * Migrates 23 IPC handlers from ipc/memory.ts to HTTP endpoints.
 * All underlying services (memIdx, memFs) are pure TypeScript,
 * zero Electron dependency — migration is direct.
 *
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import * as memIdx from '../../core/memory-index.js'
import * as memFs from '../../core/memory-fs.js'
import { getDb } from '../../core/db.js'
import type { MemoryScope } from '../../core/memory-index.js'
import { writeObservabilityEvent } from '../../core/logging'

// ─── Types ────────────────────────────────────────────────────────────────────

type RecallOptions = {
  scope?: MemoryScope
  workspaceId?: string
  conversationId?: string
  limit?: number
}

const MEMORY_SCOPES = new Set<MemoryScope>(['project', 'conversation', 'all'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatProjectMemoryEntry(candidate: Record<string, unknown>): string {
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

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** POST /api/memory/recall — Semantic search */
export async function handleMemoryRecall(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { query?: string; scope?: string; workspaceId?: string; conversationId?: string; limit?: number } | null
  if (!data?.query) {
    return jsonResponse(res, 400, { ok: false, error: 'query is required' })
  }

  const result = memIdx.recallMemory(data.query, normalizeRecallOptions({
    scope: data.scope,
    workspaceId: data.workspaceId,
    conversationId: data.conversationId,
    limit: data.limit,
  }))
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** GET /api/memory/project — Read project memory */
export async function handleReadProjectMemory(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const result = memFs.readProjectMemory(getWorkspacePath(workspaceId))
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** PUT /api/memory/project — Write project memory */
export async function handleWriteProjectMemory(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { workspaceId?: string; content?: string } | null
  if (!data?.workspaceId || data.content === undefined) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId and content are required' })
  }

  const result = memFs.writeProjectMemory(getWorkspacePath(data.workspaceId), data.content)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** POST /api/memory/project/append — Append to project memory */
export async function handleAppendProjectMemory(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { workspaceId?: string; section?: string; entry?: string } | null
  if (!data?.workspaceId || !data.section || !data.entry) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId, section, and entry are required' })
  }

  const result = memFs.appendProjectMemory(getWorkspacePath(data.workspaceId), data.section, data.entry)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** GET /api/memory/agent/:agentId — Read agent memory */
export async function handleReadAgentMemory(url: URL, agentId: string, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const result = memFs.readAgentMemory(getWorkspacePath(workspaceId), agentId)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** PUT /api/memory/agent/:agentId — Write agent memory */
export async function handleWriteAgentMemory(body: unknown, agentId: string, res: ServerResponse): Promise<void> {
  const data = body as { workspaceId?: string; content?: string } | null
  if (!data?.workspaceId || data.content === undefined) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId and content are required' })
  }

  const result = memFs.writeAgentMemory(getWorkspacePath(data.workspaceId), agentId, data.content)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** POST /api/memory/candidates — Create memory candidate */
export async function handleCreateCandidate(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    workspace_id?: string; kind?: string; title?: string; content?: string;
    source_conversation_id?: string; source_message_id?: string; confidence?: string
  } | null
  if (!data?.workspace_id || !data.kind || !data.title || !data.content || !data.confidence) {
    return jsonResponse(res, 400, { ok: false, error: 'workspace_id, kind, title, content, and confidence are required' })
  }

  const id = randomUUID()
  memIdx.createCandidate({
    id,
    workspace_id: data.workspace_id,
    kind: data.kind,
    title: data.title,
    content: data.content,
    confidence: data.confidence,
    status: 'captured',
    source_conversation_id: data.source_conversation_id,
    source_message_id: data.source_message_id,
  })
  writeObservabilityEvent('renderer_api:memory_candidate_created', { id, workspace_id: data.workspace_id })
  return jsonResponse(res, 201, { ok: true, id })
}

/** PATCH /api/memory/candidates/:id/status — Update candidate status */
export async function handleUpdateCandidateStatus(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const data = body as { status?: string } | null
  if (!data?.status) {
    return jsonResponse(res, 400, { ok: false, error: 'status is required' })
  }

  memIdx.updateCandidateStatus(id, data.status)
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** GET /api/memory/candidates — List candidates */
export async function handleListCandidates(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const status = url.searchParams.get('status') ?? undefined
  const result = memIdx.getCandidatesByWorkspace(workspaceId, status)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** GET /api/memory/project/items — List project memory items */
export async function handleListProjectItems(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const result = memIdx.getProjectMemoryByWorkspace(workspaceId)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** DELETE /api/memory/project/items/:id — Delete project item */
export async function handleDeleteProjectItem(id: string, res: ServerResponse): Promise<void> {
  const item = memIdx.getProjectMemoryItemById(id)
  if (!item) {
    return jsonResponse(res, 200, { ok: true, success: true })
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
  writeObservabilityEvent('renderer_api:memory_item_deleted', { id })
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** GET /api/memory/markers — List markers */
export async function handleListMarkers(url: URL, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const result = memFs.listMarkers(getWorkspacePath(workspaceId))
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** GET /api/memory/markers/:name — Read marker */
export async function handleReadMarker(url: URL, name: string, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId is required' })
  }

  const result = memFs.readMarker(getWorkspacePath(workspaceId), name)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** PUT /api/memory/markers/:name — Write marker */
export async function handleWriteMarker(body: unknown, name: string, res: ServerResponse): Promise<void> {
  const data = body as { workspaceId?: string; content?: string } | null
  if (!data?.workspaceId || data.content === undefined) {
    return jsonResponse(res, 400, { ok: false, error: 'workspaceId and content are required' })
  }

  const result = memFs.writeMarker(getWorkspacePath(data.workspaceId), name, data.content)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** POST /api/memory/candidates/:id/materialize — Materialize candidate */
export async function handleMaterializeCandidate(id: string, res: ServerResponse): Promise<void> {
  const candidate = memIdx.getCandidateById(id)
  if (!candidate) {
    return jsonResponse(res, 404, { ok: false, error: 'Candidate not found' })
  }

  const projectItemId = randomUUID()
  const workspacePath = getWorkspacePath(candidate.workspace_id)
  await memFs.appendProjectMemory(workspacePath, candidate.kind, formatProjectMemoryEntry(candidate as unknown as Record<string, unknown>))
  memIdx.materializeCandidateToProjectMemory(id, projectItemId)
  writeObservabilityEvent('renderer_api:memory_candidate_materialized', { id, projectItemId })
  return jsonResponse(res, 200, { ok: true, id: projectItemId })
}

/** POST /api/memory/agent-sessions — Create agent session */
export async function handleCreateAgentSession(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    workspace_id?: string; conversation_id?: string; agent_id?: string;
    provider?: string; external_session_id?: string; seq?: number; status?: string
  } | null
  if (!data?.workspace_id || !data.conversation_id || !data.agent_id || !data.provider || !data.status) {
    return jsonResponse(res, 400, { ok: false, error: 'workspace_id, conversation_id, agent_id, provider, and status are required' })
  }

  const id = randomUUID()
  const result = memIdx.createAgentSession({
    id,
    workspace_id: data.workspace_id,
    conversation_id: data.conversation_id,
    agent_id: data.agent_id,
    provider: data.provider,
    status: data.status,
    external_session_id: data.external_session_id,
    seq: data.seq,
  })
  return jsonResponse(res, 201, { ok: true, data: result })
}

/** POST /api/memory/agent-sessions/:id/end — End agent session */
export async function handleEndAgentSession(id: string, res: ServerResponse): Promise<void> {
  memIdx.endAgentSession(id)
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** POST /api/memory/agent-sessions/external/:id/end — End by external ID */
export async function handleEndAgentSessionByExternalId(externalId: string, res: ServerResponse): Promise<void> {
  memIdx.endAgentSessionByExternalId(externalId)
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** GET /api/memory/agent-sessions — List agent sessions */
export async function handleListAgentSessions(url: URL, res: ServerResponse): Promise<void> {
  const conversationId = url.searchParams.get('conversationId')
  if (!conversationId) {
    return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
  }

  const db = getDb()
  const result = db.prepare('SELECT * FROM agent_sessions WHERE conversation_id = ? ORDER BY seq ASC').all(conversationId)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** GET /api/memory/summaries/latest — Get latest summary */
export async function handleGetLatestSummary(url: URL, res: ServerResponse): Promise<void> {
  const conversationId = url.searchParams.get('conversationId')
  if (!conversationId) {
    return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
  }

  const result = memIdx.getLatestSummary(conversationId)
  return jsonResponse(res, 200, { ok: true, data: result })
}

/** POST /api/memory/summaries — Create summary */
export async function handleCreateSummary(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    conversation_id?: string; summary?: string; completed_items?: string;
    pending_items?: string; changed_files?: string; risks?: string;
    next_steps?: string; from_message_id?: string; to_message_id?: string
  } | null
  if (!data?.conversation_id || !data.summary) {
    return jsonResponse(res, 400, { ok: false, error: 'conversation_id and summary are required' })
  }

  const id = randomUUID()
  memIdx.createConversationSummary({
    id,
    conversation_id: data.conversation_id,
    summary: data.summary,
    completed_items: data.completed_items,
    pending_items: data.pending_items,
    changed_files: data.changed_files,
    risks: data.risks,
    next_steps: data.next_steps,
    from_message_id: data.from_message_id,
    to_message_id: data.to_message_id,
  })
  return jsonResponse(res, 201, { ok: true, id })
}

/** PUT /api/memory/agent-profiles/:agentId — Upsert agent profile */
export async function handleUpsertAgentProfile(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    workspace_id?: string; agent_id?: string; content?: string;
    source_path?: string; source_hash?: string
  } | null
  if (!data?.agent_id || !data.content) {
    return jsonResponse(res, 400, { ok: false, error: 'agent_id and content are required' })
  }

  const id = randomUUID()
  memIdx.upsertAgentProfile({
    id,
    workspace_id: data.workspace_id,
    agent_id: data.agent_id,
    content: data.content,
    source_path: data.source_path,
    source_hash: data.source_hash,
  })
  return jsonResponse(res, 200, { ok: true, success: true })
}

/** GET /api/memory/agent-profiles/:agentId — Get agent profile */
export async function handleGetAgentProfile(url: URL, agentId: string, res: ServerResponse): Promise<void> {
  const workspaceId = url.searchParams.get('workspaceId')
  const result = memIdx.getAgentProfile(workspaceId, agentId)
  return jsonResponse(res, 200, { ok: true, data: result })
}
