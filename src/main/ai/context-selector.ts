import { getDb } from '../core/db'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname, relative } from 'path'
import type { ContextStrategy } from './a2a-types'
import type { MemoryCategory } from '../ipc/memory-palace'

export interface FileChangeEntry {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
}

/** A documentation file index entry — filename + summary, no full content. */
export interface DocIndexEntry {
  /** Relative path from workspace root (e.g. "docs/architecture/ADR-017.md"). */
  path: string
  /** First meaningful line or truncated preview of the doc. */
  summary: string
  /** Number of associated memory items (linked via sourceDoc). */
  memoryCount: number
}

export interface AgentContextPacket {
  task: {
    fromAgentName: string | null
    toAgentName: string
    instruction: string
  }
  taskState: {
    goal: string
    completed: string[]
    pending: string[]
    decisions: string[]
    blockers: string[]
  }
  relevantMessages: Array<{
    messageId: string
    agentProfileId: string | null
    content: string
    reason: string
  }>
  projectMemories: Array<{
    title: string
    content: string
    category: string
  }>
  projectDocs: DocIndexEntry[]
  recentFileChanges: FileChangeEntry[]
  agentRoster: Array<{ name: string; role: string }>
}

export interface ContextSelectorOptions {
  conversationId: string
  fromAgentName: string | null
  fromAgentProfileId?: string | null
  fromAgentOutput?: string
  toAgentName: string
  toAgentRole: string
  instruction: string
  tokenBudget?: number
  strategy?: ContextStrategy
  /** Workspace root directory — used for scanning docs/ directory. */
  workingDir?: string
}

interface CandidateMessage {
  id: string
  agentProfileId: string | null
  content: string
  createdAt: number
}

interface ScoredMessage {
  messageId: string
  agentProfileId: string | null
  content: string
  reason: string
  score: number
}

const DEFAULT_TOKEN_BUDGET = 8000
const MESSAGE_BUDGET_RATIO = 0.65
const MEMORY_BUDGET_RATIO = 0.2
/** Budget ratio for project docs index — lightweight, just filenames + summaries. */
const DOCS_BUDGET_RATIO = 0.05

// ─── Memory Category Injection Strategy ──────────────────────────────────────
// Different categories have different importance and should be injected in order.
// Higher priority categories are included first when token budget is limited.

const CATEGORY_INJECTION_ORDER: MemoryCategory[] = [
  'core',          // Project identity — always needed
  'antipatterns',  // Pitfalls — high value, prevents mistakes
  'conventions',   // Coding conventions — guides implementation
  'decisions',     // Architecture decisions — contextual relevance
  'architecture'   // Architecture descriptions — broad context
]

// Default auto-approve status by category.
// core/antipatterns auto-activate (low risk of harm).
// conventions/decisions/architecture require human confirmation (draft).
export const DEFAULT_STATUS_BY_CATEGORY: Record<MemoryCategory, 'draft' | 'active'> = {
  core: 'active',
  antipatterns: 'active',
  conventions: 'draft',
  decisions: 'draft',
  architecture: 'draft'
}

// Role-specific content patterns for filtering
const ROLE_FILTER_PATTERNS: Record<string, RegExp[]> = {
  planning: [
    /目标|决策|约束|scope|方案|计划|架构|设计|选择/i,
    /goal|decision|constraint|scope|plan|architecture|design|choose/i
  ],
  implementation: [
    /文件|路径|API|函数|组件|模块|接口|src\/|import|export|class\s|function\s|const\s/i,
    /file|path|function|component|module|api\s|endpoint/i
  ],
  review: [
    /变更|风险|测试|问题|安全|性能|review|bug|fix|error|漏洞/i,
    /change|risk|test|issue|security|performance|bug|fix|error/i
  ]
}

function tokenize(text: string): string[] {
  const tokens: string[] = []

  // Split Chinese characters individually
  const chineseChars = text.match(/[一-鿿]/g) ?? []
  tokens.push(...chineseChars)

  // Split English/CJK words (2+ chars)
  const words = text.match(/[a-zA-Z_][a-zA-Z0-9_]{1,}/g) ?? []
  tokens.push(...words.map((w) => w.toLowerCase()))

  // Split paths like src/components/Foo
  const paths = text.match(/[\w/.-]+/g) ?? []
  tokens.push(
    ...paths
      .filter((p) => p.includes('/'))
      .flatMap((p) => p.split('/'))
      .filter((s) => s.length > 0)
  )

  return dedupe(tokens)
}

function extractKeywords(instruction: string, toAgentRole: string): string[] {
  const tokens = tokenize(instruction)
  const roleTokens = tokenize(toAgentRole)
  return dedupe([...tokens, ...roleTokens])
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

function roleKeywordFilter(content: string, role: string): boolean {
  const patterns = ROLE_FILTER_PATTERNS[role]
  if (!patterns) return true
  return patterns.some((re) => re.test(content))
}

function keywordOverlapScore(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const contentLower = content.toLowerCase()
  let hits = 0
  for (const kw of keywords) {
    if (contentLower.includes(kw.toLowerCase())) hits++
  }
  return hits / keywords.length
}

function recencyScore(createdAt: number, newestTime: number): number {
  if (newestTime <= 0) return 0
  const ageSeconds = newestTime - createdAt
  // Exponential decay: 5 min half-life
  const halfLife = 300
  return Math.pow(0.5, ageSeconds / halfLife)
}

function roleMatchScore(agentRole: string | null, toAgentRole: string): number {
  if (!agentRole) return 0.3
  if (agentRole === toAgentRole) return 0.8

  const compatMap: Record<string, string[]> = {
    planning: ['planning'],
    implementation: ['implementation', 'coder'],
    review: ['review', 'reviewer'],
    coder: ['implementation', 'coder'],
    reviewer: ['review', 'reviewer']
  }

  const compat = compatMap[toAgentRole] ?? [toAgentRole]
  return compat.includes(agentRole) ? 0.5 : 0.1
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function loadRecentMessages(conversationId: string): CandidateMessage[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, agent_profile_id, content, created_at
       FROM messages
       WHERE conversation_id = ? AND role = 'assistant' AND content IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .all(conversationId) as Array<{
    id: string
    agent_profile_id: string | null
    content: string
    created_at: number
  }>
  return rows.map((r) => ({
    id: r.id,
    agentProfileId: r.agent_profile_id,
    content: r.content,
    createdAt: r.created_at
  }))
}

function loadProjectMemories(
  workspaceId: string,
  keywords: string[] = [],
  toAgentRole: string = ''
): Array<{ title: string; content: string; category: string }> {
  const db = getDb()

  // Load all active memories with category, then apply category-aware filtering
  const allMemories = db
    .prepare(
      `SELECT title, content, COALESCE(NULLIF(category, 'general'), kind) AS category
       FROM project_memory_items
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY updated_at DESC`
    )
    .all(workspaceId) as Array<{ title: string; content: string; category: string }>

  // Sort by category injection priority — core/antipatterns first
  const categoryOrderIndex = new Map(
    CATEGORY_INJECTION_ORDER.map((cat, idx) => [cat, idx])
  )
  const defaultIndex = CATEGORY_INJECTION_ORDER.length

  const sorted = [...allMemories].sort((a, b) => {
    const aIdx = categoryOrderIndex.get(a.category as MemoryCategory) ?? defaultIndex
    const bIdx = categoryOrderIndex.get(b.category as MemoryCategory) ?? defaultIndex
    // Within same priority, boost memories that match keywords or role
    if (aIdx !== bIdx) return aIdx - bIdx
    const aScore = keywordOverlapScore(a.content, keywords) + (roleKeywordFilter(a.content, toAgentRole) ? 0.1 : 0)
    const bScore = keywordOverlapScore(b.content, keywords) + (roleKeywordFilter(b.content, toAgentRole) ? 0.1 : 0)
    return bScore - aScore
  })

  return sorted
}

// ─── Project Docs Index ────────────────────────────────────────────────────────
// Scan docs/ directory for documentation files and build a lightweight index.
// Each entry is just filename + first-line summary + memory count.
// Full content is NOT injected — Agent reads docs on demand.

/** File extensions considered as project documentation. */
const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc'])

/** Maximum characters for a single doc summary line. */
const DOC_SUMMARY_MAX_LENGTH = 120

/** Maximum directory depth for doc scanning. */
const DOC_MAX_DEPTH = 2

/** Maximum number of doc entries to include. */
const DOC_MAX_ENTRIES = 20

function loadProjectDocs(
  workspaceId: string,
  workingDir?: string
): DocIndexEntry[] {
  // 1. Count memory items per sourceDoc from DB
  const db = getDb()
  const memoryCounts = new Map<string, number>()
  const countRows = db
    .prepare(
      `SELECT source_doc, COUNT(*) AS cnt
       FROM project_memory_items
       WHERE workspace_id = ? AND source_doc IS NOT NULL AND status = 'active'
       GROUP BY source_doc`
    )
    .all(workspaceId) as Array<{ source_doc: string; cnt: number }>

  for (const row of countRows) {
    memoryCounts.set(row.source_doc, row.cnt)
  }

  // 2. Scan docs/ directory if workingDir is available
  if (!workingDir) {
    // Fallback: only return docs that have associated memories
    return Array.from(memoryCounts.entries())
      .map(([docPath, cnt]) => ({ path: docPath, summary: '', memoryCount: cnt }))
      .sort((a, b) => b.memoryCount - a.memoryCount)
      .slice(0, DOC_MAX_ENTRIES)
  }

  const docsDir = join(workingDir, 'docs')
  const entries: DocIndexEntry[] = []

  try {
    walkDocDir(docsDir, workingDir, 0, entries, memoryCounts)
  } catch {
    // docs/ directory doesn't exist or isn't readable — return memory-linked docs only
    memoryCounts.forEach((cnt, docPath) => {
      entries.push({ path: docPath, summary: '', memoryCount: cnt })
    })
  }

  // Sort: docs with memories first, then alphabetically
  entries.sort((a, b) => {
    if (a.memoryCount !== b.memoryCount) return b.memoryCount - a.memoryCount
    return a.path.localeCompare(b.path)
  })

  return entries.slice(0, DOC_MAX_ENTRIES)
}

function walkDocDir(
  dir: string,
  workspaceRoot: string,
  depth: number,
  entries: DocIndexEntry[],
  memoryCounts: Map<string, number>
): void {
  if (depth > DOC_MAX_DEPTH) return

  let items: string[]
  try {
    items = readdirSync(dir)
  } catch {
    return
  }

  for (const item of items) {
    // Skip hidden files and node_modules
    if (item.startsWith('.') || item === 'node_modules') continue

    const fullPath = join(dir, item)
    let stat
    try { stat = statSync(fullPath) } catch { continue }

    if (stat.isDirectory()) {
      walkDocDir(fullPath, workspaceRoot, depth + 1, entries, memoryCounts)
    } else if (stat.isFile() && DOC_EXTENSIONS.has(extname(item).toLowerCase())) {
      const relPath = relative(workspaceRoot, fullPath)
      const summary = extractDocSummary(fullPath)
      const memoryCount = memoryCounts.get(relPath) ?? 0
      entries.push({ path: relPath, summary, memoryCount })
    }
  }
}

/** Extract first meaningful line from a doc file as summary. */
function extractDocSummary(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf8')
    const lines = content.split('\n')
    // Skip blank lines and YAML frontmatter
    let inFrontmatter = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '---') {
        inFrontmatter = !inFrontmatter
        continue
      }
      if (inFrontmatter) continue
      if (!trimmed) continue
      // Skip markdown heading markers for the summary text
      const text = trimmed.replace(/^#+\s*/, '')
      if (text.length > 0) {
        return text.length > DOC_SUMMARY_MAX_LENGTH
          ? text.slice(0, DOC_SUMMARY_MAX_LENGTH) + '...'
          : text
      }
    }
    return ''
  } catch {
    return ''
  }
}

function loadRecentFileChanges(conversationId: string): FileChangeEntry[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT DISTINCT path, status, additions, deletions
       FROM file_changes WHERE conversation_id = ?
       ORDER BY updated_at DESC LIMIT 10`
    )
    .all(conversationId) as Array<{ path: string; status: string; additions: number; deletions: number }>
  const validStatuses = new Set(['added', 'modified', 'deleted'])
  return rows.map((r) => ({
    path: r.path,
    status: validStatuses.has(r.status) ? (r.status as 'added' | 'modified' | 'deleted') : 'modified',
    additions: r.additions,
    deletions: r.deletions
  }))
}

function loadLatestSummary(conversationId: string): {
  summary: string
  completedItems: string[]
  pendingItems: string[]
  decisions: string[]
  blockers: string[]
} | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT summary, completed_items, pending_items, risks, next_steps
       FROM conversation_summaries
       WHERE conversation_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(conversationId) as {
    summary: string
    completed_items: string | null
    pending_items: string | null
    risks: string | null
    next_steps: string | null
  } | undefined
  if (!row) return null

  let completedItems: string[] = []
  let pendingItems: string[] = []
  let decisions: string[] = []
  let blockers: string[] = []
  if (row.completed_items) {
    try { completedItems = JSON.parse(row.completed_items) } catch { /* ignore */ }
  }
  if (row.pending_items) {
    try { pendingItems = JSON.parse(row.pending_items) } catch { /* ignore */ }
  }
  if (row.risks) {
    try { const risks = JSON.parse(row.risks); blockers = Array.isArray(risks) ? risks : [risks] } catch { blockers = row.risks ? [row.risks] : [] }
  }
  if (row.next_steps) {
    try { const steps = JSON.parse(row.next_steps); decisions = Array.isArray(steps) ? steps : [steps] } catch { decisions = row.next_steps ? [row.next_steps] : [] }
  }

  return {
    summary: row.summary,
    completedItems,
    pendingItems,
    decisions,
    blockers
  }
}

function getWorkspaceId(conversationId: string): string | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT workspace_id FROM conversations WHERE id = ?`)
    .get(conversationId) as { workspace_id: string | null } | undefined
  return row?.workspace_id ?? null
}

function loadAgentRoster(workspaceId: string): Array<{ name: string; role: string }> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT name, role FROM agent_profile_configs
       WHERE workspace_id = ? AND is_enabled = 1
       ORDER BY role, name`
    )
    .all(workspaceId) as Array<{ name: string; role: string }>
  return rows
}

// ─── HandoffStrategy ──────────────────────────────────────────────────────────
// For agent→agent delegation: unconditionally include fromAgent's last output
// + file changes. No keyword scoring — the handoff IS the context.

interface ConversationTurn {
  role: 'user' | 'assistant'
  agentProfileId: string | null
  content: string
  createdAt: number
}

function loadLastAgentOutput(conversationId: string, agentProfileId: string): string | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT content FROM messages
       WHERE conversation_id = ? AND role = 'assistant' AND agent_profile_id = ? AND content IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(conversationId, agentProfileId) as { content: string } | undefined
  return row?.content ?? null
}

export function buildHandoffContext(opts: ContextSelectorOptions): string {
  const { conversationId, fromAgentName, fromAgentProfileId, fromAgentOutput, toAgentName, instruction } = opts

  const sections: string[] = []

  // Prefer the live output passed in over the DB (avoids async persistence race)
  if (fromAgentOutput || fromAgentProfileId) {
    const output = fromAgentOutput ?? (fromAgentProfileId ? loadLastAgentOutput(conversationId, fromAgentProfileId) : null)
    if (output) {
      sections.push(`[HANDOFF FROM @${fromAgentName ?? 'Agent'}]`)
      sections.push(output.slice(0, 3000))
    }
  }

  // File changes — always useful for reviewer/implementation agents
  const fileChanges = loadRecentFileChanges(conversationId)
  if (fileChanges.length > 0) {
    sections.push('')
    sections.push(`[CHANGED FILES (${fileChanges.length})]`)
    for (const f of fileChanges) {
      sections.push(`- ${f.path} [${f.status}] +${f.additions} -${f.deletions}`)
    }
  }

  // Project memory (concise)
  const workspaceId = getWorkspaceId(conversationId)
  if (workspaceId) {
    const memories = loadProjectMemories(workspaceId).slice(0, 3)
    if (memories.length > 0) {
      sections.push('')
      sections.push('[PROJECT MEMORY]')
      for (const m of memories) {
        sections.push(`### ${m.title}`)
        sections.push(m.content.slice(0, 300))
      }
    }
  }

  if (sections.length > 0) {
    sections.push('')
    sections.push(`[YOUR TASK — @${toAgentName}]`)
    sections.push(instruction)
    return sections.join('\n')
  }

  return ''
}

// ─── ConversationStrategy ─────────────────────────────────────────────────────
// For primary agent (depth=0): reconstruct real user/assistant turns so the
// agent sees a proper conversation history, not a scored static blob.

function loadConversationTurns(conversationId: string, limit: number): ConversationTurn[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT role, agent_profile_id, content, created_at
       FROM messages
       WHERE conversation_id = ? AND role IN ('user', 'assistant') AND content IS NOT NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(conversationId, limit) as Array<{
    role: string
    agent_profile_id: string | null
    content: string
    created_at: number
  }>
  // Reverse to chronological order
  return rows
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      agentProfileId: r.agent_profile_id,
      content: r.content,
      createdAt: r.created_at
    }))
    .reverse()
}

export function buildConversationContext(conversationId: string, tokenBudget: number): string {
  // ~60% of budget for history turns
  const historyBudget = Math.floor(tokenBudget * 0.6)
  const turns = loadConversationTurns(conversationId, 40)
  if (turns.length === 0) return ''

  const included: string[] = []
  let used = 0

  // Walk from most recent backward to fill budget, then reverse for display
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    const label = t.role === 'user' ? 'User' : `@${getAgentName(t.agentProfileId)}`
    const line = `${label}: ${t.content.slice(0, 1500)}`
    const cost = estimateTokens(line)
    if (used + cost > historyBudget) break
    included.unshift(line)
    used += cost
  }

  if (included.length === 0) return ''

  return ['[CONVERSATION HISTORY]', ...included].join('\n')
}

// ─── SummaryStrategy ─────────────────────────────────────────────────────────
// For @All read-only: just goal + pending state, no message history.

export function buildSummaryContext(conversationId: string, toAgentName: string, instruction: string): string {
  const summary = loadLatestSummary(conversationId)
  if (!summary) return ''

  const sections: string[] = ['[CURRENT STATE]']
  if (summary.summary) sections.push(`Goal: ${summary.summary.slice(0, 300)}`)
  if (summary.completedItems.length > 0) {
    sections.push('Completed:')
    for (const item of summary.completedItems) sections.push(`- ${item}`)
  }
  if (summary.pendingItems.length > 0) {
    sections.push('Pending:')
    for (const item of summary.pendingItems) sections.push(`- ${item}`)
  }
  sections.push('')
  sections.push(`[READ-ONLY TASK — @${toAgentName}]`)
  sections.push(instruction)
  return sections.join('\n')
}

export function buildContextPacket(opts: ContextSelectorOptions): AgentContextPacket {
  const { conversationId, fromAgentName, toAgentName, toAgentRole, instruction } = opts
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET

  const packet: AgentContextPacket = {
    task: { fromAgentName, toAgentName, instruction },
    taskState: { goal: '', completed: [], pending: [], decisions: [], blockers: [] },
    relevantMessages: [],
    projectMemories: [],
    projectDocs: [],
    recentFileChanges: [],
    agentRoster: []
  }

  // 1. Extract keywords
  const keywords = extractKeywords(instruction, toAgentRole)

  // 2. Collect candidate messages
  const candidates = loadRecentMessages(conversationId)
  if (candidates.length > 0) {
    const newestTime = candidates[0]?.createdAt ?? 0

    // 3-4. Score and filter
    const scored: ScoredMessage[] = []
    for (const msg of candidates) {
      if (!msg.content) continue

      // Role filter
      if (!roleKeywordFilter(msg.content, toAgentRole)) continue

      const kwScore = keywordOverlapScore(msg.content, keywords)
      const recScore = recencyScore(msg.createdAt, newestTime)
      const roleScore = roleMatchScore(
        getAgentRole(msg.agentProfileId),
        toAgentRole
      )

      const score = kwScore * 0.5 + recScore * 0.2 + roleScore * 0.2

      // Only include messages with meaningful relevance
      if (score > 0.05) {
        scored.push({
          messageId: msg.id,
          agentProfileId: msg.agentProfileId,
          content: msg.content.slice(0, 1200),
          reason: buildReason(kwScore, recScore, roleScore),
          score
        })
      }
    }

    // Sort by score DESC
    scored.sort((a, b) => b.score - a.score)

    // 5. Truncate by token budget (messages get 60% of budget)
    const messageBudget = Math.floor(tokenBudget * MESSAGE_BUDGET_RATIO)
    let usedTokens = 0
    for (const s of scored) {
      usedTokens += estimateTokens(s.content)
      if (usedTokens > messageBudget) break
      packet.relevantMessages.push({
        messageId: s.messageId,
        agentProfileId: s.agentProfileId,
        content: s.content,
        reason: s.reason
      })
    }
  }

  // 6. Load project memories — category-aware injection with keyword boosting
  const workspaceId = getWorkspaceId(conversationId)
  if (workspaceId) {
    const memories = loadProjectMemories(workspaceId, keywords, toAgentRole)
    const memoryBudget = Math.floor(tokenBudget * MEMORY_BUDGET_RATIO)
    let memTokens = 0
    for (const m of memories) {
      memTokens += estimateTokens(m.content)
      if (memTokens > memoryBudget) break
      packet.projectMemories.push(m)
    }
  }

  // 7. Load recent file changes (upgraded to structured entries)
  packet.recentFileChanges = loadRecentFileChanges(conversationId)

  // 8. Populate taskState from latest conversation summary
  const summary = loadLatestSummary(conversationId)
  if (summary) {
    packet.taskState.goal = summary.summary.slice(0, 200)
    packet.taskState.completed = summary.completedItems
    packet.taskState.pending = summary.pendingItems
    packet.taskState.decisions = summary.decisions
    packet.taskState.blockers = summary.blockers
  }

  // 9. Load agent roster for this workspace
  if (workspaceId) {
    packet.agentRoster = loadAgentRoster(workspaceId)
  }

  // 10. Load project docs index — lightweight filenames + summaries
  if (workspaceId) {
    const docsBudget = Math.floor(tokenBudget * DOCS_BUDGET_RATIO)
    const allDocs = loadProjectDocs(workspaceId, opts.workingDir)
    let docsTokens = 0
    for (const doc of allDocs) {
      const line = doc.summary
        ? `${doc.path} — ${doc.summary}${doc.memoryCount > 0 ? ` (${doc.memoryCount} memories)` : ''}`
        : `${doc.path}${doc.memoryCount > 0 ? ` (${doc.memoryCount} memories)` : ''}`
      docsTokens += estimateTokens(line)
      if (docsTokens > docsBudget) break
      packet.projectDocs.push(doc)
    }
  }

  return packet
}

function getAgentRole(agentProfileId: string | null): string | null {
  if (!agentProfileId) return null
  const db = getDb()
  const row = db
    .prepare(`SELECT role FROM agent_profile_configs WHERE id = ?`)
    .get(agentProfileId) as { role: string } | undefined
  return row?.role ?? null
}

/** Resolve agent profile ID to human-readable name, with in-process cache.
 *  Falls back to the raw profileId when the DB is not available (e.g. in unit tests). */
const agentNameCache = new Map<string, string>()
function getAgentName(agentProfileId: string | null): string {
  if (!agentProfileId) return 'Assistant'
  const cached = agentNameCache.get(agentProfileId)
  if (cached) return cached
  try {
    const db = getDb()
    const row = db
      .prepare('SELECT name FROM agent_profile_configs WHERE id = ?')
      .get(agentProfileId) as { name: string } | undefined
    const name = row?.name ?? agentProfileId
    agentNameCache.set(agentProfileId, name)
    return name
  } catch {
    // DB not initialized (unit tests) — fall back to raw ID
    return agentProfileId
  }
}

function buildReason(kwScore: number, recScore: number, roleScore: number): string {
  const parts: string[] = []
  if (kwScore > 0.3) parts.push('关键词匹配')
  if (recScore > 0.5) parts.push('最近消息')
  if (roleScore > 0.5) parts.push('角色相关')
  return parts.join(', ') || '低相关'
}

function renderTaskSection(
  task: AgentContextPacket['task']
): string {
  const fromLabel = task.fromAgentName ? `@${task.fromAgentName}` : 'User'
  const sections: string[] = [
    '[TASK HANDOFF]',
    `From: ${fromLabel}`,
    `To: @${task.toAgentName}`,
    `Instruction: ${task.instruction}`
  ]
  return sections.join('\n')
}

function renderProgressSection(
  taskState: AgentContextPacket['taskState'],
  fileChanges: FileChangeEntry[]
): string | null {
  const hasProgress = taskState.goal || taskState.completed.length > 0
  const hasFiles = fileChanges.length > 0
  if (!hasProgress && !hasFiles) return null

  const sections: string[] = ['[TASK PROGRESS]']

  if (taskState.goal) {
    sections.push(`Goal: ${taskState.goal}`)
  }

  if (taskState.completed.length > 0) {
    sections.push('Completed:')
    for (const item of taskState.completed) {
      sections.push(`- ${item}`)
    }
  }

  if (taskState.pending.length > 0) {
    sections.push('Pending:')
    for (const item of taskState.pending) {
      sections.push(`- ${item}`)
    }
  }

  if (hasFiles) {
    const statusLabel: Record<string, string> = { added: 'added', modified: 'modified', deleted: 'deleted' }
    sections.push(`\nChanged Files (${fileChanges.length}):`)
    for (const f of fileChanges) {
      const label = statusLabel[f.status] || f.status
      sections.push(`- ${f.path} [${label}] +${f.additions} -${f.deletions}`)
    }
  }

  return sections.join('\n')
}

function renderMemorySection(
  memories: Array<{ title: string; content: string; category: string }>
): string | null {
  if (memories.length === 0) return null

  // Group memories by category for structured display
  const categoryLabels: Record<string, string> = {
    core: 'Core Facts',
    antipatterns: 'Pitfalls & Lessons',
    conventions: 'Conventions',
    decisions: 'Decisions',
    architecture: 'Architecture'
  }

  const grouped = new Map<string, Array<{ title: string; content: string }>>()
  for (const mem of memories) {
    const cat = mem.category || 'general'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push({ title: mem.title, content: mem.content })
  }

  const sections: string[] = ['[PROJECT MEMORY]']

  // Render in category priority order
  for (const cat of CATEGORY_INJECTION_ORDER) {
    const items = grouped.get(cat)
    if (!items || items.length === 0) continue
    const label = categoryLabels[cat] ?? cat
    sections.push(`\n## ${label}`)
    for (const item of items) {
      sections.push(`### ${item.title}`)
      sections.push(item.content.slice(0, 500))
    }
    grouped.delete(cat)
  }

  // Render any remaining categories not in the priority list
  grouped.forEach((items, cat) => {
    const label = categoryLabels[cat] ?? cat
    sections.push(`\n## ${label}`)
    for (const item of items) {
      sections.push(`### ${item.title}`)
      sections.push(item.content.slice(0, 500))
    }
  })

  return sections.join('\n')
}

function renderAgentRosterSection(
  roster: Array<{ name: string; role: string }>
): string | null {
  if (roster.length === 0) return null

  const sections: string[] = ['[AGENT ROSTER]']
  for (const agent of roster) {
    sections.push(`- @${agent.name} (${agent.role})`)
  }

  return sections.join('\n')
}

function renderProjectDocsSection(docs: DocIndexEntry[]): string | null {
  if (docs.length === 0) return null

  const sections: string[] = ['[PROJECT DOCS]']
  for (const doc of docs) {
    const memoryTag = doc.memoryCount > 0 ? ` (${doc.memoryCount} memories)` : ''
    if (doc.summary) {
      sections.push(`- ${doc.path}${memoryTag} — ${doc.summary}`)
    } else {
      sections.push(`- ${doc.path}${memoryTag}`)
    }
  }
  sections.push('Use readMessages or file tools to access full content when needed.')

  return sections.join('\n')
}

export function renderContextPacket(packet: AgentContextPacket): string {
  const sections: string[] = []

  // Section 1: Task Handoff (always present)
  sections.push(renderTaskSection(packet.task))

  // Section 2: Task Progress (only if there's data)
  const progressSection = renderProgressSection(packet.taskState, packet.recentFileChanges)
  if (progressSection) {
    sections.push('')
    sections.push(progressSection)
  }

  // Section 3: Relevant Messages (only if present)
  if (packet.relevantMessages.length > 0) {
    sections.push('')
    sections.push('[RELEVANT CONTEXT]')
    for (const msg of packet.relevantMessages) {
      const agentLabel = `[@${getAgentName(msg.agentProfileId)}]`
      const teaser = msg.content.slice(0, 300)
      sections.push(`${agentLabel} ${teaser}`)
    }
  }

  // Section 4: Project Memory (only if present)
  const memorySection = renderMemorySection(packet.projectMemories)
  if (memorySection) {
    sections.push('')
    sections.push(memorySection)
  }

  // Section 5: Project Docs Index (only if present)
  const docsSection = renderProjectDocsSection(packet.projectDocs)
  if (docsSection) {
    sections.push('')
    sections.push(docsSection)
  }

  // Section 6: Agent Roster (only if present)
  const rosterSection = renderAgentRosterSection(packet.agentRoster)
  if (rosterSection) {
    sections.push('')
    sections.push(rosterSection)
  }

  return sections.join('\n')
}
