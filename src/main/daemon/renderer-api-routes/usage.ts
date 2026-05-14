/**
 * Renderer API Routes — Usage endpoints
 *
 * Migrates 6 IPC handlers from ipc/conversation.ts to HTTP endpoints.
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../../core/db.js'
import { estimateCost } from '../../ai/pricing'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function validateRange(range?: { from?: number; to?: number }): string | null {
  if (!range) return null
  if (range.from !== undefined && (typeof range.from !== 'number' || range.from < 0)) {
    return 'Invalid range: from must be a non-negative number'
  }
  if (range.to !== undefined && (typeof range.to !== 'number' || range.to < 0)) {
    return 'Invalid range: to must be a non-negative number'
  }
  if (range.from !== undefined && range.to !== undefined && range.from > range.to) {
    return 'Invalid range: from must be <= to'
  }
  return null
}

function clampInt(val: string | null, def: number, min: number, max: number): number {
  const n = val === null ? NaN : parseInt(val, 10)
  if (Number.isNaN(n)) return def
  return Math.max(min, Math.min(max, n))
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** POST /api/usage — Create usage record */
export async function handleCreateUsage(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as {
    conversation_id?: string
    model?: string
    input_tokens?: number
    output_tokens?: number
    cache_read_tokens?: number
    cache_creation_tokens?: number
    cost_usd?: number
    provider_id?: string
  } | null

  if (!data?.conversation_id || typeof data.conversation_id !== 'string') {
    return jsonResponse(res, 400, { ok: false, error: 'conversation_id is required' })
  }
  if (typeof data.model !== 'string' || data.model.length === 0) {
    return jsonResponse(res, 400, { ok: false, error: 'model is required' })
  }
  if (typeof data.input_tokens !== 'number' || data.input_tokens < 0 || !Number.isFinite(data.input_tokens)) {
    return jsonResponse(res, 400, { ok: false, error: 'input_tokens must be a non-negative number' })
  }
  if (typeof data.output_tokens !== 'number' || data.output_tokens < 0 || !Number.isFinite(data.output_tokens)) {
    return jsonResponse(res, 400, { ok: false, error: 'output_tokens must be a non-negative number' })
  }
  if (data.cache_read_tokens !== undefined && (typeof data.cache_read_tokens !== 'number' || data.cache_read_tokens < 0 || !Number.isFinite(data.cache_read_tokens))) {
    return jsonResponse(res, 400, { ok: false, error: 'cache_read_tokens must be a non-negative number' })
  }
  if (data.cache_creation_tokens !== undefined && (typeof data.cache_creation_tokens !== 'number' || data.cache_creation_tokens < 0 || !Number.isFinite(data.cache_creation_tokens))) {
    return jsonResponse(res, 400, { ok: false, error: 'cache_creation_tokens must be a non-negative number' })
  }
  if (data.provider_id !== undefined && typeof data.provider_id !== 'string') {
    return jsonResponse(res, 400, { ok: false, error: 'provider_id must be a string' })
  }
  if (data.cost_usd !== undefined && (typeof data.cost_usd !== 'number' || !Number.isFinite(data.cost_usd))) {
    return jsonResponse(res, 400, { ok: false, error: 'cost_usd must be a number' })
  }

  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const costUsd = data.cost_usd ?? estimateCost(
    data.model,
    data.input_tokens,
    data.output_tokens,
    data.cache_read_tokens,
    data.cache_creation_tokens
  )

  db.prepare(
    'INSERT INTO conversation_usage (id, conversation_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, provider_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.conversation_id,
    data.model,
    data.input_tokens,
    data.output_tokens,
    data.cache_read_tokens ?? 0,
    data.cache_creation_tokens ?? 0,
    costUsd,
    data.provider_id ?? null,
    now
  )

  return jsonResponse(res, 201, { ok: true, id, costUsd })
}

/** GET /api/usage?conversationId= — List usage records for a conversation */
export async function handleListUsage(url: URL, res: ServerResponse): Promise<void> {
  const conversationId = url.searchParams.get('conversationId')
  if (!conversationId) {
    return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
  }

  const db = getDb()
  const rows = db.prepare('SELECT * FROM conversation_usage WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId)
  return jsonResponse(res, 200, { ok: true, data: rows })
}

/** GET /api/usage/summary?from=&to= — Daily aggregation, optional date range */
export async function handleUsageSummary(url: URL, res: ServerResponse): Promise<void> {
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  const range = {
    from: fromParam ? parseInt(fromParam, 10) : undefined,
    to: toParam ? parseInt(toParam, 10) : undefined
  }

  const rangeError = validateRange(range)
  if (rangeError) {
    return jsonResponse(res, 400, { ok: false, error: rangeError })
  }

  const db = getDb()
  let rows: unknown[]

  try {
    if (range.from !== undefined && range.to !== undefined) {
      rows = db.prepare(
        "SELECT * FROM usage_daily WHERE day BETWEEN date(?, 'unixepoch', 'localtime') AND date(?, 'unixepoch', 'localtime') ORDER BY day DESC"
      ).all(range.from, range.to)
    } else if (range.from !== undefined) {
      rows = db.prepare(
        "SELECT * FROM usage_daily WHERE day >= date(?, 'unixepoch', 'localtime') ORDER BY day DESC"
      ).all(range.from)
    } else {
      rows = db.prepare('SELECT * FROM usage_daily ORDER BY day DESC LIMIT 90').all()
    }
  } catch (err) {
    // View may not exist yet on fresh DBs
    console.warn('[usage] summary query failed (view may not exist):', err)
    rows = []
  }

  return jsonResponse(res, 200, { ok: true, data: rows })
}

/** GET /api/usage/total-cost?from=&to= — Total cost (optional date range) */
export async function handleUsageTotalCost(url: URL, res: ServerResponse): Promise<void> {
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  const range = {
    from: fromParam ? parseInt(fromParam, 10) : undefined,
    to: toParam ? parseInt(toParam, 10) : undefined
  }

  const rangeError = validateRange(range)
  if (rangeError) {
    return jsonResponse(res, 400, { ok: false, error: rangeError })
  }

  const db = getDb()
  let total = 0

  try {
    if (range.from !== undefined && range.to !== undefined) {
      const row = db.prepare(
        "SELECT COALESCE(SUM(total_cost), 0) AS total FROM usage_daily WHERE day BETWEEN date(?, 'unixepoch', 'localtime') AND date(?, 'unixepoch', 'localtime')"
      ).get(range.from, range.to) as { total: number }
      total = row.total
    } else if (range.from !== undefined) {
      const row = db.prepare(
        "SELECT COALESCE(SUM(total_cost), 0) AS total FROM usage_daily WHERE day >= date(?, 'unixepoch', 'localtime')"
      ).get(range.from) as { total: number }
      total = row.total
    } else {
      const row = db.prepare('SELECT COALESCE(SUM(total_cost), 0) AS total FROM usage_daily').get() as { total: number }
      total = row.total
    }
  } catch (err) {
    // View may not exist yet on fresh DBs
    console.warn('[usage] total-cost query failed (view may not exist):', err)
    total = 0
  }

  return jsonResponse(res, 200, { ok: true, total })
}

/** GET /api/usage/by-provider?days= — Per-provider token aggregation */
export async function handleUsageByProvider(url: URL, res: ServerResponse): Promise<void> {
  const days = clampInt(url.searchParams.get('days'), 7, 1, 365)

  const db = getDb()
  const from = Math.floor(Date.now() / 1000) - (days * 86400)

  const rows = db.prepare(
    `SELECT
       COALESCE(provider_id, 'unknown') AS provider_id,
       SUM(input_tokens)               AS total_input_tokens,
       SUM(output_tokens)              AS total_output_tokens,
       SUM(cost_usd)                   AS total_cost_usd,
       COUNT(*)                        AS total_calls
     FROM conversation_usage
     WHERE created_at >= ?
     GROUP BY provider_id`
  ).all(from) as Array<{
    provider_id: string
    total_input_tokens: number
    total_output_tokens: number
    total_cost_usd: number
    total_calls: number
  }>

  return jsonResponse(res, 200, { ok: true, days, data: rows })
}

/** GET /api/usage/by-agent?days= — Per-agent token aggregation */
export async function handleUsageByAgent(url: URL, res: ServerResponse): Promise<void> {
  const days = clampInt(url.searchParams.get('days'), 7, 1, 365)

  const db = getDb()
  const from = Math.floor(Date.now() / 1000) - (days * 86400)

  const rows = db.prepare(
    `SELECT
       COALESCE(c.agent_profile_id, 'unknown') AS agent_profile_id,
       SUM(cu.input_tokens)                    AS total_input_tokens,
       SUM(cu.output_tokens)                   AS total_output_tokens,
       SUM(cu.cost_usd)                        AS total_cost_usd,
       COUNT(*)                                 AS total_calls
     FROM conversation_usage cu
     JOIN conversations c ON c.id = cu.conversation_id
     WHERE cu.created_at >= ?
     GROUP BY c.agent_profile_id`
  ).all(from) as Array<{
    agent_profile_id: string
    total_input_tokens: number
    total_output_tokens: number
    total_cost_usd: number
    total_calls: number
  }>

  return jsonResponse(res, 200, { ok: true, days, data: rows })
}
