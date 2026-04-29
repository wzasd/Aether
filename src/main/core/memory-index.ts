import { getDb } from './db.js'
import type { Database } from 'better-sqlite3'

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
  title: string
  content: string
  status: string
  source_path?: string
  source_hash?: string
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO project_memory_items (id, workspace_id, kind, title, content, status, source_path, source_hash)
    VALUES (@id, @workspace_id, @kind, @title, @content, @status, @source_path, @source_hash)
  `).run(data)
}

export function getProjectMemoryByWorkspace(workspaceId: string): any[] {
  const db = getDb()
  return db.prepare('SELECT * FROM project_memory_items WHERE workspace_id = ? ORDER BY kind, created_at DESC').all(workspaceId)
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
  seq: number
  status: string
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO agent_sessions (id, workspace_id, conversation_id, agent_id, provider, external_session_id, seq, status)
    VALUES (@id, @workspace_id, @conversation_id, @agent_id, @provider, @external_session_id, @seq, @status)
  `).run(data)
}

export function endAgentSession(id: string): void {
  const db = getDb()
  db.prepare('UPDATE agent_sessions SET status = ?, ended_at = unixepoch() WHERE id = ?').run('ended', id)
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
  db.prepare(`
    INSERT INTO agent_profiles (id, workspace_id, agent_id, content, source_path, source_hash)
    VALUES (@id, @workspace_id, @agent_id, @content, @source_path, @source_hash)
    ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
      content = @content,
      source_path = @source_path,
      source_hash = @source_hash,
      updated_at = unixepoch()
  `).run(data)
}

export function getAgentProfile(workspaceId: string | null, agentId: string): any | undefined {
  const db = getDb()
  if (workspaceId) {
    return db.prepare('SELECT * FROM agent_profiles WHERE workspace_id = ? AND agent_id = ?').get(workspaceId, agentId)
  }
  return db.prepare('SELECT * FROM agent_profiles WHERE workspace_id IS NULL AND agent_id = ?').get(agentId)
}

// --- Recall (FTS search) ---

export function recallMemory(query: string, options: {
  scope?: 'project' | 'conversation' | 'all'
  workspaceId?: string
  conversationId?: string
  limit?: number
}): any[] {
  const db = getDb()
  const limit = options.limit || 10

  if (options.scope === 'conversation' && options.conversationId) {
    const summaries = db.prepare(`
      SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(options.conversationId, limit)
    return summaries
  }

  // FTS on project memory
  const ftsQuery = query.replace(/"/g, '""')
  const results = db.prepare(`
    SELECT pmi.* FROM memory_fts ft
    JOIN project_memory_items pmi ON ft.rowid = pmi.rowid
    WHERE memory_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(`"${ftsQuery}"`, limit)

  if (options.scope === 'project' || !options.conversationId) {
    return results
  }

  // Hybrid: combine project memory + conversation summary
  const summary = getLatestSummary(options.conversationId)
  if (summary) {
    return [...results, summary]
  }
  return results
}
