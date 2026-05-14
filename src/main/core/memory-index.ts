import { getDb } from './db.js'
import { buildFtsQuery } from '../utils/fts.js'

const GLOBAL_WORKSPACE_ID = '__global__'

export type MemoryScope = 'project' | 'conversation' | 'all'

function normalizeWorkspaceId(workspaceId?: string | null): string {
  return workspaceId || GLOBAL_WORKSPACE_ID
}

// --- Memory Candidates ---

export function createCandidate(data: {
  id: string
  workspace_id: string
  kind: string
  title: string
  content: string
  source_conversation_id?: string
  source_message_id?: string
  confidence: string
  status: string
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO memory_candidates (id, workspace_id, kind, title, content, source_conversation_id, source_message_id, confidence, status)
    VALUES (@id, @workspace_id, @kind, @title, @content, @source_conversation_id, @source_message_id, @confidence, @status)
  `).run(data)
}

export function updateCandidateStatus(id: string, status: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE memory_candidates SET status = ?, updated_at = unixepoch() WHERE id = ?
  `).run(status, id)
}

export function getCandidatesByWorkspace(workspaceId: string, status?: string): any[] {
  const db = getDb()
  if (status) {
    return db.prepare('SELECT * FROM memory_candidates WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC').all(workspaceId, status)
  }
  return db.prepare('SELECT * FROM memory_candidates WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId)
}

export function getCandidateById(id: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM memory_candidates WHERE id = ?').get(id)
}

// --- Project Memory Items ---

export function createProjectMemoryItem(data: {
  id: string
  workspace_id: string
  kind: string
  category?: string
  title: string
  content: string
  status: string
  source_path?: string
  source_hash?: string
  source_doc?: string
  tags?: string[]
}): void {
  const db = getDb()
  const category = data.category ?? data.kind
  const tags = JSON.stringify(data.tags ?? [])
  const sourceDoc = data.source_doc ?? null
  db.prepare(`
    INSERT INTO project_memory_items (id, workspace_id, kind, category, title, content, status, source_path, source_hash, tags, source_doc)
    VALUES (@id, @workspace_id, @kind, @category, @title, @content, @status, @source_path, @source_hash, @tags, @source_doc)
  `).run({
    ...data,
    category,
    tags,
    source_doc: sourceDoc
  })
}

export function materializeCandidateToProjectMemory(candidateId: string, projectItemId: string): any | undefined {
  const db = getDb()
  const candidate = getCandidateById(candidateId)
  if (!candidate) return undefined

  const existing = db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(projectItemId)
  if (!existing) {
    createProjectMemoryItem({
      id: projectItemId,
      workspace_id: candidate.workspace_id,
      kind: candidate.kind,
      title: candidate.title,
      content: candidate.content,
      status: 'active'
    })
  }
  updateCandidateStatus(candidateId, 'materialized')
  return candidate
}

export function getProjectMemoryByWorkspace(workspaceId: string): any[] {
  const db = getDb()
  return db.prepare('SELECT * FROM project_memory_items WHERE workspace_id = ? ORDER BY kind, created_at DESC').all(workspaceId)
}

export function getProjectMemoryItemById(id: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM project_memory_items WHERE id = ?').get(id)
}

export function deleteProjectMemoryItem(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM project_memory_items WHERE id = ?').run(id)
}

// --- Conversation Summaries ---

export function createConversationSummary(data: {
  id: string
  conversation_id: string
  summary: string
  completed_items?: string
  pending_items?: string
  changed_files?: string
  risks?: string
  next_steps?: string
  from_message_id?: string
  to_message_id?: string
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO conversation_summaries (id, conversation_id, summary, completed_items, pending_items, changed_files, risks, next_steps, from_message_id, to_message_id)
    VALUES (@id, @conversation_id, @summary, @completed_items, @pending_items, @changed_files, @risks, @next_steps, @from_message_id, @to_message_id)
  `).run(data)
}

export function getLatestSummary(conversationId: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conversationId)
}

// --- Agent Sessions ---

export function createAgentSession(data: {
  id: string
  workspace_id: string
  conversation_id: string
  agent_id: string
  provider: string
  external_session_id?: string
  seq?: number
  status: string
}): any {
  const db = getDb()
  const seq = data.seq ?? (
    (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM agent_sessions WHERE conversation_id = ? AND agent_id = ?')
      .get(data.conversation_id, data.agent_id) as { nextSeq: number }).nextSeq
  )
  db.prepare(`
    INSERT INTO agent_sessions (id, workspace_id, conversation_id, agent_id, provider, external_session_id, seq, status)
    VALUES (@id, @workspace_id, @conversation_id, @agent_id, @provider, @external_session_id, @seq, @status)
  `).run({ ...data, seq })
  return db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(data.id)
}

export function endAgentSession(id: string): void {
  const db = getDb()
  db.prepare('UPDATE agent_sessions SET status = ?, ended_at = unixepoch() WHERE id = ?').run('ended', id)
}

export function endAgentSessionByExternalId(externalSessionId: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE agent_sessions
    SET status = ?, ended_at = unixepoch()
    WHERE external_session_id = ? AND status = ?
  `).run('ended', externalSessionId, 'active')
}

export function getActiveAgentSession(conversationId: string, agentId: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM agent_sessions WHERE conversation_id = ? AND agent_id = ? AND status = ? ORDER BY seq DESC LIMIT 1').get(conversationId, agentId, 'active')
}

// --- Agent Profiles ---

export function upsertAgentProfile(data: {
  id: string
  workspace_id?: string
  agent_id: string
  content: string
  source_path?: string
  source_hash?: string
}): void {
  const db = getDb()
  const workspace_id = normalizeWorkspaceId(data.workspace_id)
  db.prepare(`
    INSERT INTO agent_profile_cache (id, workspace_id, agent_id, content, source_path, source_hash)
    VALUES (@id, @workspace_id, @agent_id, @content, @source_path, @source_hash)
    ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
      content = @content,
      source_path = @source_path,
      source_hash = @source_hash,
      updated_at = unixepoch()
  `).run({ ...data, workspace_id })
}

export function getAgentProfile(workspaceId: string | null, agentId: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM agent_profile_cache WHERE workspace_id = ? AND agent_id = ?')
    .get(normalizeWorkspaceId(workspaceId), agentId)
}

// --- Recall (FTS search) ---

export function recallMemory(query: string, options: {
  scope?: MemoryScope
  workspaceId?: string
  conversationId?: string
  limit?: number
}): any[] {
  const db = getDb()
  const limit = options.limit || 10
  const scope = options.scope || 'all'
  const ftsQuery = buildFtsQuery(query)

  if (scope === 'conversation' && options.conversationId) {
    const summaries = ftsQuery
      ? db.prepare(`
          SELECT cs.* FROM conversation_summaries_fts ft
          JOIN conversation_summaries cs ON ft.rowid = cs.rowid
          WHERE conversation_summaries_fts MATCH ?
            AND cs.conversation_id = ?
          ORDER BY rank
          LIMIT ?
        `).all(ftsQuery, options.conversationId, limit)
      : db.prepare(`
          SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
        `).all(options.conversationId, limit)
    return summaries
  }

  // FTS on project memory
  const projectResults = ftsQuery
    ? options.workspaceId
      ? db.prepare(`
        SELECT pmi.* FROM memory_fts ft
        JOIN project_memory_items pmi ON ft.rowid = pmi.rowid
        WHERE memory_fts MATCH ?
          AND pmi.workspace_id = ?
        ORDER BY rank
        LIMIT ?
        `).all(ftsQuery, options.workspaceId, limit)
      : db.prepare(`
        SELECT pmi.* FROM memory_fts ft
        JOIN project_memory_items pmi ON ft.rowid = pmi.rowid
        WHERE memory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        `).all(ftsQuery, limit)
    : options.workspaceId
      ? db.prepare('SELECT * FROM project_memory_items WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?').all(options.workspaceId, limit)
      : db.prepare('SELECT * FROM project_memory_items ORDER BY updated_at DESC LIMIT ?').all(limit)

  if (scope === 'project' || !options.conversationId) {
    return projectResults
  }

  // Hybrid: combine project memory + conversation summary
  const summaries = ftsQuery
    ? db.prepare(`
        SELECT cs.* FROM conversation_summaries_fts ft
        JOIN conversation_summaries cs ON ft.rowid = cs.rowid
        WHERE conversation_summaries_fts MATCH ?
          AND cs.conversation_id = ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, options.conversationId, limit)
    : []

  return [...projectResults, ...summaries].slice(0, limit)
}
