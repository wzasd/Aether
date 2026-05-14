/**
 * Bridge API Server — HTTP server embedded in daemon process.
 *
 * Provides the API that chat-bridge sidecar processes call to
 * read/write messages, claim tasks, and list conversations.
 *
 * Per-agent Bearer token authentication ensures each bridge
 * can only access data for its own agent profile.
 *
 * ADR-015: Chat Bridge MCP Sidecar
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { writeObservabilityEvent } from '../core/logging'

// ─── Auth Token Registry ─────────────────────────────────────────────────────

const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const REQUEST_TIMEOUT_MS = 30_000 // 30 seconds

interface AuthEntry {
  readonly profileId: string
  readonly conversationId: string
  readonly createdAt: number
}

const authRegistry = new Map<string, AuthEntry>()

/** Clean up expired auth tokens */
function cleanupExpiredTokens(): void {
  const now = Date.now()
  authRegistry.forEach((entry, token) => {
    if (now - entry.createdAt > AUTH_TOKEN_TTL_MS) {
      authRegistry.delete(token)
    }
  })
}

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000)

// ─── API Request / Response Types ────────────────────────────────────────────

interface SendMessageRequest {
  readonly conversationId: string
  readonly content: string
  readonly parentMessageId?: string
  readonly idempotencyKey?: string
}

interface CheckMessagesRequest {
  readonly afterSeq?: number
}

interface ReadHistoryRequest {
  readonly conversationId: string
  readonly limit?: number
  readonly beforeSeq?: number
  readonly afterSeq?: number
  readonly aroundSeq?: number
}

interface SearchMessagesRequest {
  readonly query: string
  readonly conversationId?: string
}

interface ClaimTaskRequest {
  readonly conversationId: string
  readonly taskId: string
}

interface UpdateTaskRequest {
  readonly taskId: string
  readonly status: string
  readonly result?: string
}

interface AckMessagesRequest {
  readonly seqs: readonly number[]
}

// ─── Bridge API Server ───────────────────────────────────────────────────────

export class BridgeApiServer {
  private server: Server | null = null
  private port: number | null = null

  /**
   * Start the HTTP server on a random port (127.0.0.1:0).
   * Returns the actual port assigned by the OS.
   */
  async start(): Promise<number> {
    if (this.server) return this.port!

    this.server = createServer((req, res) => this.handleRequest(req, res))

    return new Promise<number>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port
          writeObservabilityEvent('bridge_api:started', { port: this.port })
          resolve(this.port)
        } else {
          reject(new Error('Failed to get server port'))
        }
      })
      this.server!.on('error', reject)
    })
  }

  /** Stop the HTTP server */
  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.port = null
        resolve()
      })
    })
  }

  /** Get the server port (null if not started) */
  getPort(): number | null {
    return this.port
  }

  /**
   * Issue an auth token for a specific agent profile + conversation.
   * Returns the token that the bridge sidecar will use in Bearer auth.
   */
  issueAuthToken(profileId: string, conversationId: string): string {
    const token = randomUUID()
    authRegistry.set(token, {
      profileId,
      conversationId,
      createdAt: Date.now(),
    })
    return token
  }

  /** Revoke an auth token */
  revokeAuthToken(token: string): void {
    authRegistry.delete(token)
  }

  /** Get the API URL for bridges to connect to */
  getApiUrl(): string | null {
    if (!this.port) return null
    return `http://127.0.0.1:${this.port}`
  }

  // ─── Request Handler ─────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Request timeout — abort if handler takes too long
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Request timeout' }))
      }
      req.destroy()
    }, REQUEST_TIMEOUT_MS)

    // Clear timeout when response finishes naturally
    res.on('close', () => clearTimeout(timeoutId))

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port ?? 0}`)

    // Auth check for all non-OPTIONS requests
    const authResult = this.authenticateRequest(req)
    if (!authResult.valid) {
      clearTimeout(timeoutId)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'reason' in authResult ? authResult.reason : 'Unauthorized' }))
      return
    }

    const profileId = authResult.profileId
    const conversationId = authResult.conversationId

    try {
      const body = req.method === 'POST' ? await this.readBody(req) : null

      // Route dispatch
      const route = `${req.method} ${url.pathname}`
      switch (route) {
        case 'POST /message/send':
          await this.handleSendMessage(body as SendMessageRequest, profileId, conversationId, res)
          break
        case 'GET /message/check':
          await this.handleCheckMessages(url, profileId, conversationId, res)
          break
        case 'GET /message/read':
          await this.handleReadHistory(url, profileId, conversationId, res)
          break
        case 'GET /message/search':
          await this.handleSearchMessages(url, profileId, conversationId, res)
          break
        case 'POST /task/claim':
          await this.handleClaimTask(body as ClaimTaskRequest, profileId, conversationId, res)
          break
        case 'POST /task/update':
          await this.handleUpdateTask(body as UpdateTaskRequest, profileId, conversationId, res)
          break
        case 'GET /channel/list':
          await this.handleListChannels(profileId, res)
          break
        case 'POST /message/ack':
          await this.handleAckMessages(body as AckMessagesRequest, profileId, conversationId, res)
          break
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: `Unknown route: ${route}` }))
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const routeStr = `${req.method} ${url.pathname}`
      writeObservabilityEvent('bridge_api:error', { route: routeStr, error, profileId })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error }))
      }
    }
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  private authenticateRequest(req: IncomingMessage): { valid: true; profileId: string; conversationId: string } | { valid: false; reason: string } {
    const authHeader = req.headers['authorization']
    if (!authHeader || typeof authHeader !== 'string') {
      return { valid: false, reason: 'Missing Authorization header' }
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
    const entry = authRegistry.get(token)
    if (!entry) {
      return { valid: false, reason: 'Invalid auth token' }
    }

    return { valid: true, profileId: entry.profileId, conversationId: entry.conversationId }
  }

  // ─── Body Reader ─────────────────────────────────────────────────────────

  private async readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        try {
          resolve(raw.length > 0 ? JSON.parse(raw) : {})
        } catch {
          reject(new Error('Invalid JSON body'))
        }
      })
      req.on('error', reject)
    })
  }

  // ─── Route Handlers ──────────────────────────────────────────────────────

  private async handleSendMessage(
    body: SendMessageRequest,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    if (!body?.content || typeof body.content !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'content is required' }))
      return
    }

    // Validate conversationId matches auth scope
    if (body.conversationId !== conversationId) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'conversationId does not match auth scope' }))
      return
    }

    const db = getDb()
    const idempotencyKey = body.idempotencyKey ?? randomUUID()

    // Idempotency check
    const existing = db.prepare(
      'SELECT id FROM messages WHERE idempotency_key = ?'
    ).get(idempotencyKey) as { id: string } | undefined

    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, messageId: existing.id, idempotencyKey, alreadySent: true }))
      return
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, agent_profile_id, idempotency_key, created_at)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?)
    `).run(id, conversationId, body.content, profileId, idempotencyKey, now)

    writeObservabilityEvent('bridge_api:message_sent', {
      conversationId,
      profileId,
      messageId: id,
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, messageId: id, idempotencyKey }))
  }

  private async handleCheckMessages(
    url: URL,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    const afterSeqParam = url.searchParams.get('afterSeq')
    let afterSeq: number

    if (afterSeqParam !== null) {
      afterSeq = parseInt(afterSeqParam, 10)
    } else {
      // Default: read from message_ack_state so we skip already-acked messages
      const db = getDb()
      const ackRow = db.prepare(
        'SELECT last_seen_seq FROM message_ack_state WHERE conversation_id = ? AND profile_id = ?'
      ).get(conversationId, profileId) as { last_seen_seq: number } | undefined
      afterSeq = ackRow?.last_seen_seq ?? 0
    }

    const db = getDb()

    const rows = db.prepare(
      `SELECT id, seq, role, content, created_at
       FROM messages
       WHERE conversation_id = ? AND seq > ?
       ORDER BY seq ASC LIMIT 50`
    ).all(conversationId, afterSeq) as Array<{
      id: string
      seq: number
      role: string
      content: string
      created_at: number
    }>

    // Format as human-readable text (ADR-015: prose format for LLM)
    const formatted = rows.map((r) =>
      `[seq=${r.seq} msg=${r.id.slice(0, 8)} time=${new Date(r.created_at * 1000).toISOString().slice(0, 19)} type=${r.role}] ${r.content}`
    ).join('\n')

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(formatted || 'No new messages.')
  }

  private async handleReadHistory(
    url: URL,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    const convId = url.searchParams.get('conversationId') ?? conversationId
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)
    const beforeSeq = url.searchParams.get('beforeSeq')
    const afterSeq = url.searchParams.get('afterSeq')
    const aroundSeq = url.searchParams.get('aroundSeq')

    const db = getDb()

    let rows: Array<{
      id: string
      seq: number
      role: string
      content: string
      created_at: number
    }>

    if (aroundSeq) {
      // Centered read: get messages around a specific seq
      const center = parseInt(aroundSeq, 10)
      const halfLimit = Math.floor(limit / 2)
      rows = db.prepare(
        `SELECT id, seq, role, content, created_at
         FROM messages
         WHERE conversation_id = ? AND seq BETWEEN ? AND ?
         ORDER BY seq ASC LIMIT ?`
      ).all(convId, center - halfLimit, center + halfLimit, limit) as typeof rows
    } else if (beforeSeq) {
      rows = db.prepare(
        `SELECT id, seq, role, content, created_at
         FROM messages
         WHERE conversation_id = ? AND seq < ?
         ORDER BY seq DESC LIMIT ?`
      ).all(convId, parseInt(beforeSeq, 10), limit) as typeof rows
      rows = rows.reverse() // Return in ascending order
    } else if (afterSeq) {
      rows = db.prepare(
        `SELECT id, seq, role, content, created_at
         FROM messages
         WHERE conversation_id = ? AND seq > ?
         ORDER BY seq ASC LIMIT ?`
      ).all(convId, parseInt(afterSeq, 10), limit) as typeof rows
    } else {
      rows = db.prepare(
        `SELECT id, seq, role, content, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY seq ASC LIMIT ?`
      ).all(convId, limit) as typeof rows
    }

    // Format as human-readable text
    const formatted = rows.map((r) =>
      `[seq=${r.seq} msg=${r.id.slice(0, 8)} time=${new Date(r.created_at * 1000).toISOString().slice(0, 19)} type=${r.role}] ${r.content}`
    ).join('\n')

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(formatted || 'No messages found.')
  }

  private async handleSearchMessages(
    url: URL,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    const query = url.searchParams.get('query')
    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'query parameter is required' }))
      return
    }

    const convId = url.searchParams.get('conversationId') ?? conversationId
    const db = getDb()

    // Use FTS5 if available, otherwise LIKE fallback
    let rows: Array<{ id: string; seq: number; role: string; content: string; created_at: number }>

    try {
      rows = db.prepare(
        `SELECT m.id, m.seq, m.role, m.content, m.created_at
         FROM messages_fts f
         JOIN messages m ON m.id = f.id
         WHERE f.content MATCH ? AND m.conversation_id = ?
         ORDER BY m.seq ASC LIMIT 50`
      ).all(query, convId) as typeof rows
    } catch {
      // FTS5 not available, use LIKE fallback
      const escapedQuery = query.replace(/[%_]/g, '\\$&')
      rows = db.prepare(
        `SELECT id, seq, role, content, created_at
         FROM messages
         WHERE conversation_id = ? AND content LIKE ? ESCAPE '\\'
         ORDER BY seq ASC LIMIT 50`
      ).all(convId, `%${escapedQuery}%`) as typeof rows
    }

    const formatted = rows.map((r) =>
      `[seq=${r.seq} msg=${r.id.slice(0, 8)} time=${new Date(r.created_at * 1000).toISOString().slice(0, 19)} type=${r.role}] ${r.content}`
    ).join('\n')

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(formatted || 'No matching messages found.')
  }

  private async handleClaimTask(
    body: ClaimTaskRequest,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    if (!body?.taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'taskId is required' }))
      return
    }

    const db = getDb()

    // CAS claim: check + update in a single transaction to prevent TOCTOU race
    const claimTransaction = db.transaction(() => {
      const task = db.prepare(
        'SELECT id, status, agent_profile_id FROM agent_task_queue WHERE id = ? AND conversation_id = ?'
      ).get(body.taskId, conversationId) as { id: string; status: string; agent_profile_id: string | null } | undefined

      if (!task) {
        return { outcome: 'not_found' as const }
      }

      if (task.status !== 'pending') {
        return { outcome: 'wrong_status' as const, status: task.status }
      }

      if (task.agent_profile_id && task.agent_profile_id !== profileId) {
        return { outcome: 'already_claimed' as const, claimedBy: task.agent_profile_id }
      }

      const result = db.prepare(
        "UPDATE agent_task_queue SET status = 'claimed', agent_profile_id = ?, claimed_at = ?, updated_at = unixepoch() WHERE id = ? AND status = 'pending'"
      ).run(profileId, Date.now(), body.taskId)

      if (result.changes === 0) {
        return { outcome: 'race_lost' as const }
      }

      return { outcome: 'claimed' as const }
    })

    const claimResult = claimTransaction()

    switch (claimResult.outcome) {
      case 'not_found':
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Task not found' }))
        return
      case 'wrong_status':
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: `Task has status '${claimResult.status}', expected 'pending'` }))
        return
      case 'already_claimed':
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Task already claimed by another agent' }))
        return
      case 'race_lost':
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Task was claimed by another agent during this request' }))
        return
      case 'claimed':
        writeObservabilityEvent('bridge_api:task_claimed', {
          conversationId,
          profileId,
          taskId: body.taskId,
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, taskId: body.taskId, status: 'claimed' }))
    }
  }

  private async handleUpdateTask(
    body: UpdateTaskRequest,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    if (!body?.taskId || !body?.status) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'taskId and status are required' }))
      return
    }

    const validStatuses = ['completed', 'failed', 'running']
    if (!validStatuses.includes(body.status)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: `Invalid status '${body.status}', expected one of: ${validStatuses.join(', ')}` }))
      return
    }

    const db = getDb()

    // Verify task ownership
    const task = db.prepare(
      'SELECT id, status, agent_profile_id FROM agent_task_queue WHERE id = ?'
    ).get(body.taskId) as { id: string; status: string; agent_profile_id: string | null } | undefined

    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Task not found' }))
      return
    }

    if (task.agent_profile_id !== profileId) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Not authorized to update this task' }))
      return
    }

    db.prepare(
      `UPDATE agent_task_queue SET status = ?, result = ?, updated_at = unixepoch() WHERE id = ?`
    ).run(body.status, body.result ?? null, body.taskId)

    writeObservabilityEvent('bridge_api:task_updated', {
      taskId: body.taskId,
      status: body.status,
      profileId,
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, taskId: body.taskId, status: body.status }))
  }

  private async handleListChannels(
    profileId: string,
    res: ServerResponse
  ): Promise<void> {
    const db = getDb()

    // List conversations where this agent has tasks
    const conversations = db.prepare(
      `SELECT DISTINCT c.id, c.title, c.workspace_id
       FROM conversations c
       JOIN agent_task_queue t ON t.conversation_id = c.id
       WHERE t.agent_profile_id = ?
       ORDER BY c.created_at DESC LIMIT 50`
    ).all(profileId) as Array<{ id: string; title: string | null; workspace_id: string }>

    const formatted = conversations.map((c) =>
      `conv:${c.id} — ${c.title ?? 'Untitled'} (workspace: ${c.workspace_id})`
    ).join('\n')

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(formatted || 'No conversations found.')
  }

  private async handleAckMessages(
    body: AckMessagesRequest,
    profileId: string,
    conversationId: string,
    res: ServerResponse
  ): Promise<void> {
    if (!body?.seqs || !Array.isArray(body.seqs)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'seqs array is required' }))
      return
    }

    // Fire-and-forget ack: daemon records the last seen seq for this agent
    // This is used for deduplication — next check_messages won't return these seqs
    const db = getDb()
    const maxSeq = body.seqs.length > 0 ? body.seqs.reduce((a, b) => (a > b ? a : b), 0) : 0

    // Update or insert the agent's last seen seq for this conversation
    const existing = db.prepare(
      'SELECT profile_id FROM message_ack_state WHERE conversation_id = ? AND profile_id = ?'
    ).get(conversationId, profileId) as { profile_id: string } | undefined

    if (existing) {
      db.prepare(
        'UPDATE message_ack_state SET last_seen_seq = ?, updated_at = unixepoch() WHERE conversation_id = ? AND profile_id = ?'
      ).run(maxSeq, conversationId, profileId)
    } else {
      db.prepare(
        'INSERT INTO message_ack_state (conversation_id, profile_id, last_seen_seq, created_at, updated_at) VALUES (?, ?, ?, unixepoch(), unixepoch())'
      ).run(conversationId, profileId, maxSeq)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, acked: body.seqs.length }))
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let serverInstance: BridgeApiServer | null = null

export function getBridgeApiServer(): BridgeApiServer {
  if (!serverInstance) {
    serverInstance = new BridgeApiServer()
  }
  return serverInstance
}