import { getDb } from '../core/db'

interface MemoryItem {
  title: string
  content: string
  kind: string
  category: string | null
}

export interface InjectionResult {
  prompt: string
  count: number
  estimatedTokens: number
}

const MAX_ITEMS = 8
const MAX_TOKENS = 1500

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

function dedupe(items: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Build an injection prompt by searching project_memory_items via FTS
 * against keywords extracted from the user's message (first ~100 chars).
 * Returns empty prompt if the conversation has no workspace.
 *
 * Design note: This is the MAIN-PROCESS lightweight injection path.
 * It runs on every message in orchestrator.sendUserMessage(), doing a fast
 * FTS lookup + 3 most-recent items inline in the message content.
 *
 * The RENDERER-SIDE path (chatStore.buildMemoryContext) does full context
 * building: reads .bytro/project-memory.md, memory palace items, latest
 * conversation summary, and agent profile — then prepends them as XML-like
 * tagged blocks. That path only runs for orchestrator-bound messages.
 *
 * The two paths are intentionally different: main-side is always-on and
 * cheap; renderer-side is comprehensive but heavier.
 */
export function buildInjectionPrompt(
  userMessage: string,
  workspaceId: string | null
): InjectionResult {
  if (!workspaceId) return { prompt: '', count: 0, estimatedTokens: 0 }

  const db = getDb()
  const queryText = userMessage.slice(0, 100)

  // FTS search: match user message keywords against memory_fts
  let ftsResults: Array<{ title: string; content: string; kind: string; category: string | null }> = []
  try {
    ftsResults = db
      .prepare(
        `SELECT title, content, kind, category
         FROM memory_fts
         JOIN project_memory_items ON project_memory_items.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ? AND project_memory_items.workspace_id = ? AND project_memory_items.status = 'active'
         ORDER BY rank
         LIMIT ?`
      )
      .all(queryText, workspaceId, 5) as Array<{ title: string; content: string; kind: string; category: string | null }>
  } catch {
    // FTS5 syntax error from special characters in user input — fall back to recent-only
  }

  // Always-on: top 3 most recently updated items
  const recentItems = db
    .prepare(
      `SELECT title, content, kind, category
       FROM project_memory_items
       WHERE workspace_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 3`
    )
    .all(workspaceId) as MemoryItem[]

  const combined = dedupe([...ftsResults, ...recentItems]).slice(0, MAX_ITEMS)

  if (combined.length === 0) return { prompt: '', count: 0, estimatedTokens: 0 }

  // Build prompt, tracking token budget
  const blocks: string[] = ['[PROJECT CONTEXT]\nThe following project knowledge is relevant to your current task:']
  let tokens = estimateTokens(blocks[0])
  let count = 0

  for (const item of combined) {
    const category = (item.category && item.category !== 'general') ? item.category : item.kind
    const kindLabel = category ? `[${category}]` : ''
    const block = `\n### ${kindLabel} ${item.title}\n${item.content.slice(0, 400)}`
    const blockTokens = estimateTokens(block)
    if (tokens + blockTokens > MAX_TOKENS) break
    blocks.push(block)
    tokens += blockTokens
    count++
  }

  return { prompt: blocks.join('\n'), count, estimatedTokens: tokens }
}
