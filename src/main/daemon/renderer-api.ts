/**
 * Renderer API Server — HTTP server for renderer↔daemon communication.
 *
 * Replaces Electron IPC (ipcMain.handle) with HTTP API endpoints,
 * enabling daemon to run independently of Electron.
 *
 * ADR-016: Renderer API Server + SSE
 *
 * Design principles (aligned with Slock):
 * - Fixed port (5175, configurable) — renderer knows at build time
 * - Session cookie auth (per-user, 7-day TTL)
 * - JSON response format (structured data for UI)
 * - SSE push channel (replaces webContents.send)
 * - Independent from Bridge API (separate server, separate auth)
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { writeObservabilityEvent } from '../core/logging'
import { runtimeRegistry } from './runtime-registry'
import { taskQueue } from './task-queue'
import * as conversationRoutes from './renderer-api-routes/conversations'
import * as agentRoutes from './renderer-api-routes/agents'
import * as taskRoutes from './renderer-api-routes/tasks'
import * as workspaceRoutes from './renderer-api-routes/workspaces'
import * as teamRoutes from './renderer-api-routes/teams'
import * as actionCardRoutes from './renderer-api-routes/action-cards'
import * as systemRoutes from './renderer-api-routes/system'
import * as providerRoutes from './renderer-api-routes/provider'
import * as logsRoutes from './renderer-api-routes/logs'
import * as dialogRoutes from './renderer-api-routes/dialog'
import * as fileRoutes from './renderer-api-routes/file'
import * as terminalRoutes from './renderer-api-routes/terminal'
import * as changeRoutes from './renderer-api-routes/change'
import * as memoryRoutes from './renderer-api-routes/memory'
import * as palaceRoutes from './renderer-api-routes/memory-palace'
import * as todoRoutes from './renderer-api-routes/todo'
import * as usageRoutes from './renderer-api-routes/usage'
import * as chatRoutes from './renderer-api-routes/chat'
import * as orchestratorRoutes from './renderer-api-routes/orchestrator'
import * as mcpRoutes from './renderer-api-routes/mcp'

// ─── Daemon Interface (avoids circular import) ────────────────────────────────

/** Minimal daemon interface for Renderer API endpoint wiring.
 *  Avoids circular dependency between renderer-api ↔ daemon. */
export interface DaemonAccess {
  isRunning(): boolean
  onUserMessage(conversationId: string, message: string, context: Array<{ role: string; content: string }>): Promise<void>
  abortConversation(conversationId: string): void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RENDERER_PORT = parseInt(process.env.BYTRO_RENDERER_API_PORT || '5175', 10)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours (renewed on each successful request)
const REQUEST_TIMEOUT_MS = 30_000 // 30 seconds
const RENDERER_ALLOWED_ORIGINS = new Set([
  'file://',           // Electron renderer
  'http://localhost:5173', // Vite dev server
  process.env.BYTRO_RENDERER_ORIGIN ?? '', // Custom origin (e.g. production web app)
])

// ─── Session Registry ────────────────────────────────────────────────────────

interface SessionEntry {
  readonly sessionId: string
  createdAt: number
  lastActivityAt: number
}

const sessionRegistry = new Map<string, SessionEntry>()

function cleanupExpiredSessions(): void {
  const now = Date.now()
  sessionRegistry.forEach((entry, cookie) => {
    if (now - entry.lastActivityAt > SESSION_TTL_MS) {
      sessionRegistry.delete(cookie)
    }
  })
}

// Run cleanup every 6 hours
setInterval(cleanupExpiredSessions, 6 * 60 * 60 * 1000)

// ─── SSE Broadcaster ──────────────────────────────────────────────────────────

interface SSEClient {
  readonly id: string
  response: ServerResponse
  connectedAt: number
}

const sseClients = new Map<string, SSEClient>()
const SSE_HEARTBEAT_INTERVAL_MS = 15_000 // 15 seconds

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function startSSEHeartbeat(): void {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    const now = Date.now()
    sseClients.forEach((client) => {
      const alive = !client.response.writableEnded && !client.response.destroyed
      if (!alive) {
        sseClients.delete(client.id)
        writeObservabilityEvent('renderer_api:sse_client_dropped', { clientId: client.id, ageMs: now - client.connectedAt })
        return
      }
      client.response.write(': heartbeat\n\n')
    })
  }, SSE_HEARTBEAT_INTERVAL_MS)
}

function stopSSEHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function broadcastSSE(event: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const message = `event: ${event}\ndata: ${payload}\n\n`

  sseClients.forEach((client) => {
    const alive = !client.response.writableEnded && !client.response.destroyed
    if (alive) {
      client.response.write(message)
    }
  })
}

function addSSEClient(id: string, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  })
  res.write(': connected\n\n') // Initial comment to establish connection

  sseClients.set(id, { id, response: res, connectedAt: Date.now() })

  res.on('close', () => {
    sseClients.delete(id)
  })
}

// ─── Renderer API Server ────────────────────────────────────────────────────

export class RendererApiServer {
  private server: Server | null = null
  private port: number | null = null
  private daemon: DaemonAccess | null = null

  /** Inject the Daemon instance for wiring endpoints to daemon methods */
  setDaemon(daemon: DaemonAccess): void {
    this.daemon = daemon
  }

  /**
   * Start the HTTP server on a fixed port (default 5175).
   * Returns the actual port (may differ if configured).
   */
  async start(port = DEFAULT_RENDERER_PORT): Promise<number> {
    if (this.server) return this.port!

    this.server = createServer((req, res) => this.handleRequest(req, res))

    return new Promise<number>((resolve, reject) => {
      this.server!.listen(port, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port
          startSSEHeartbeat()
          writeObservabilityEvent('renderer_api:started', { port: this.port })
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

    stopSSEHeartbeat()

    // Close all SSE connections
    sseClients.forEach((client) => {
      const alive = !client.response.writableEnded && !client.response.destroyed
      if (alive) {
        client.response.end()
      }
    })
    sseClients.clear()

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

  /** Get the API URL for renderer to connect */
  getApiUrl(): string | null {
    if (!this.port) return null
    return `http://127.0.0.1:${this.port}`
  }

  /**
   * Broadcast an SSE event to all connected renderer clients.
   * Replaces webContents.send() — same event types, different transport.
   */
  broadcast(event: string, data: unknown): void {
    broadcastSSE(event, data)
  }

  // ─── Request Handler ─────────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS preflight — respond immediately for OPTIONS
    if (req.method === 'OPTIONS') {
      const origin = req.headers['origin']
      if (origin && RENDERER_ALLOWED_ORIGINS.has(origin)) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cookie',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        })
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Origin not allowed' }))
      }
      return
    }

    // Set CORS headers for actual requests (if origin matches)
    const origin = req.headers['origin']
    if (origin && RENDERER_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    // Request timeout
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Request timeout' }))
      }
      req.destroy()
    }, REQUEST_TIMEOUT_MS)

    res.on('close', () => clearTimeout(timeoutId))

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port ?? 0}`)

    // SSE endpoint — no auth required (local-only, single-user)
    if (url.pathname === '/api/events' && req.method === 'GET') {
      clearTimeout(timeoutId)
      const clientId = randomUUID()
      addSSEClient(clientId, res)
      writeObservabilityEvent('renderer_api:sse_connected', { clientId })
      return
    }

    // Auth check for all other endpoints
    const authResult = this.authenticateRequest(req)
    if (!authResult.valid) {
      clearTimeout(timeoutId)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'reason' in authResult ? authResult.reason : 'Unauthorized' }))
      return
    }

    try {
      const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
        ? await this.readBody(req)
        : null

      const route = `${req.method} ${url.pathname}`
      switch (route) {
        // ─── Auth ────────────────────────────────────────────────────────
        case 'POST /api/auth/session':
          await this.handleCreateSession(res)
          break

        // ─── Daemon Status ───────────────────────────────────────────────
        case 'GET /api/daemon/status':
          await this.handleGetDaemonStatus(res)
          break
        case 'GET /api/daemon/heartbeat':
          await this.handleGetHeartbeat(res)
          break
        case 'GET /api/daemon/token-usage':
          await this.handleGetTokenUsage(url, res)
          break
        case 'GET /api/daemon/agent-activity':
          await this.handleGetAgentActivity(url, res)
          break

        // ─── Conversations ──────────────────────────────────────────────
        case 'GET /api/conversations':
          await conversationRoutes.handleListConversations(url, res)
          break
        case 'GET /api/conversations/:id':
          // Dynamic route — handled below
          break
        case 'POST /api/conversations':
          await conversationRoutes.handleCreateConversation(body, res)
          break
        case 'GET /api/conversations/search':
          await conversationRoutes.handleSearchConversations(url, res)
          break

        // ─── Messages ───────────────────────────────────────────────────
        case 'POST /api/messages':
          await this.handleCreateMessage(body, res)
          break

        // ─── Agents ─────────────────────────────────────────────────────
        case 'GET /api/agents':
          await agentRoutes.handleListAgents(url, res)
          break
        case 'POST /api/agents':
          await agentRoutes.handleCreateAgent(body, res)
          break
        case 'POST /api/agents/seed-defaults':
          await agentRoutes.handleSeedAgentDefaults(res)
          break

        // ─── Tasks ──────────────────────────────────────────────────────
        case 'GET /api/tasks':
          await taskRoutes.handleListTasks(url, res)
          break
        case 'POST /api/tasks':
          await taskRoutes.handleCreateTask(body, res)
          break

        // ─── Workspaces ─────────────────────────────────────────────────
        case 'GET /api/workspaces':
          await workspaceRoutes.handleListWorkspaces(res)
          break
        case 'POST /api/workspaces':
          await workspaceRoutes.handleCreateWorkspace(body, res)
          break

        // ─── Teams ──────────────────────────────────────────────────────
        case 'GET /api/teams':
          await teamRoutes.handleListTeams(res)
          break
        case 'POST /api/teams':
          await teamRoutes.handleCreateTeam(body, res)
          break

        // ─── Action Cards ───────────────────────────────────────────────
        case 'GET /api/action-cards':
          await actionCardRoutes.handleListActionCards(url, res)
          break
        case 'POST /api/action-cards':
          await actionCardRoutes.handleCreateActionCard(body, res)
          break

        // ─── System ─────────────────────────────────────────────────────
        case 'GET /api/system/version':
          await systemRoutes.handleGetVersion(res)
          break
        case 'POST /api/system/show-window':
          await systemRoutes.handleShowWindow(res)
          break
        case 'POST /api/system/hide-window':
          await systemRoutes.handleHideWindow(res)
          break
        case 'POST /api/system/open-external':
          await systemRoutes.handleOpenExternal(body, res)
          break
        case 'GET /api/system/paths':
          await systemRoutes.handleGetPaths(res)
          break
        case 'GET /api/system/update':
          await systemRoutes.handleCheckUpdate(res)
          break

        // ─── Providers ──────────────────────────────────────────────────
        case 'GET /api/providers':
          await providerRoutes.handleListProviders(res)
          break
        case 'POST /api/providers/detect':
          await providerRoutes.handleDetectAllProviders(res)
          break
        case 'POST /api/providers/configure':
          await providerRoutes.handleConfigureProvider(body, res)
          break
        case 'POST /api/providers/api-key':
          await providerRoutes.handleSetProviderApiKey(body, res)
          break
        case 'POST /api/providers/has-api-key':
          await providerRoutes.handleHasProviderApiKey(body, res)
          break
        case 'POST /api/providers/test-connection':
          await providerRoutes.handleTestProviderConnection(body, res)
          break
        case 'POST /api/providers/refresh-models':
          await providerRoutes.handleRefreshProviderModels(body, res)
          break

        // ─── Logs ───────────────────────────────────────────────────────
        case 'GET /api/logs/directory':
          await logsRoutes.handleGetLogDirectory(res)
          break
        case 'GET /api/logs/files':
          await logsRoutes.handleListLogFiles(res)
          break
        case 'POST /api/logs/read':
          await logsRoutes.handleReadLogs(body, res)
          break

        // ─── Dialog ─────────────────────────────────────────────────────
        case 'POST /api/dialog/open-directory':
          await dialogRoutes.handleOpenDirectory(res)
          break

        // ─── Files ──────────────────────────────────────────────────────
        case 'GET /api/files':
          await fileRoutes.handleListFiles(url, res)
          break
        case 'GET /api/files/read':
          await fileRoutes.handleReadFile(url, res)
          break
        case 'POST /api/files/write':
          await fileRoutes.handleWriteFile(body, res)
          break
        case 'POST /api/files/create':
          await fileRoutes.handleCreateFile(body, res)
          break
        case 'POST /api/files/mkdir':
          await fileRoutes.handleCreateDirectory(body, res)
          break
        case 'POST /api/files/rename':
          await fileRoutes.handleRenameFile(body, res)
          break
        case 'POST /api/files/delete':
          await fileRoutes.handleDeleteFile(body, res)
          break

        // ─── Terminal ───────────────────────────────────────────────────
        case 'POST /api/terminal/create':
          await terminalRoutes.handleCreateTerminal(body, res)
          break
        case 'POST /api/terminal/write':
          await terminalRoutes.handleWriteTerminal(body, res)
          break
        case 'POST /api/terminal/resize':
          await terminalRoutes.handleResizeTerminal(body, res)
          break
        case 'POST /api/terminal/kill':
          await terminalRoutes.handleKillTerminal(body, res)
          break

        // ─── Changes ────────────────────────────────────────────────────
        case 'POST /api/changes':
          await changeRoutes.handleRecordChange(body, res)
          break
        case 'GET /api/changes':
          await changeRoutes.handleListChanges(url, res)
          break
        case 'GET /api/changes/detail':
          await changeRoutes.handleGetChange(url, res)
          break

        // ─── Memory (Phase 1C) ──────────────────────────────────────────
        case 'POST /api/memory/recall':
          await memoryRoutes.handleMemoryRecall(body, res)
          break
        case 'GET /api/memory/project':
          await memoryRoutes.handleReadProjectMemory(url, res)
          break
        case 'PUT /api/memory/project':
          await memoryRoutes.handleWriteProjectMemory(body, res)
          break
        case 'POST /api/memory/project/append':
          await memoryRoutes.handleAppendProjectMemory(body, res)
          break
        case 'POST /api/memory/candidates':
          await memoryRoutes.handleCreateCandidate(body, res)
          break
        case 'GET /api/memory/candidates':
          await memoryRoutes.handleListCandidates(url, res)
          break
        case 'GET /api/memory/project/items':
          await memoryRoutes.handleListProjectItems(url, res)
          break
        case 'GET /api/memory/markers':
          await memoryRoutes.handleListMarkers(url, res)
          break
        case 'POST /api/memory/agent-sessions':
          await memoryRoutes.handleCreateAgentSession(body, res)
          break
        case 'GET /api/memory/agent-sessions':
          await memoryRoutes.handleListAgentSessions(url, res)
          break
        case 'GET /api/memory/summaries/latest':
          await memoryRoutes.handleGetLatestSummary(url, res)
          break
        case 'POST /api/memory/summaries':
          await memoryRoutes.handleCreateSummary(body, res)
          break
        case 'POST /api/conversations/export':
          await conversationRoutes.handleExportConversation(body, res)
          break

        // ─── Memory Palace (Phase 3c) ───────────────────────────────────
        case 'GET /api/memory-palace':
          await palaceRoutes.handleListPalaces(url, res)
          break
        case 'POST /api/memory-palace':
          await palaceRoutes.handleCreatePalace(body, res)
          break
        case 'GET /api/memory-palace/export':
          await palaceRoutes.handleExportPalace(url, res)
          break
        case 'POST /api/memory-palace/import':
          await palaceRoutes.handleImportPalace(body, res)
          break

        // ─── Todo (Phase 3c) ────────────────────────────────────────────
        case 'GET /api/todos':
          await todoRoutes.handleListTodos(url, res)
          break
        case 'POST /api/todos/sync':
          await todoRoutes.handleSyncTodos(body, res)
          break

        // ─── Usage (Phase 3c) ───────────────────────────────────────────
        case 'POST /api/usage':
          await usageRoutes.handleCreateUsage(body, res)
          break
        case 'GET /api/usage':
          await usageRoutes.handleListUsage(url, res)
          break
        case 'GET /api/usage/summary':
          await usageRoutes.handleUsageSummary(url, res)
          break
        case 'GET /api/usage/total-cost':
          await usageRoutes.handleUsageTotalCost(url, res)
          break
        case 'GET /api/usage/by-provider':
          await usageRoutes.handleUsageByProvider(url, res)
          break
        case 'GET /api/usage/by-agent':
          await usageRoutes.handleUsageByAgent(url, res)
          break

        // ─── Chat (Phase 3d Batch 4) ────────────────────────────────────
        case 'POST /api/chat/sessions':
          await chatRoutes.handleStartSession(body, res)
          break

        // ─── Orchestrator (Phase 3d Batch 4) ────────────────────────────
        case 'POST /api/orchestrator/messages':
          await orchestratorRoutes.handleSendOrchestratorMessage(body, res)
          break
        case 'POST /api/orchestrator/abort':
          await orchestratorRoutes.handleAbortOrchestrator(body, res)
          break
        case 'POST /api/orchestrator/permission':
          await orchestratorRoutes.handleOrchestratorPermission(body, res)
          break
        case 'POST /api/orchestrator/question':
          await orchestratorRoutes.handleOrchestratorQuestion(body, res)
          break
        case 'POST /api/orchestrator/stop-open-floor':
          await orchestratorRoutes.handleStopOpenFloor(body, res)
          break

        // ─── MCP (Phase 1C) ─────────────────────────────────────────────
        case 'GET /api/mcp/servers':
          await mcpRoutes.handleListMcpServers(res)
          break
        case 'POST /api/mcp/servers':
          await mcpRoutes.handleAddMcpServer(body, res)
          break
        case 'GET /api/mcp/discover':
          await mcpRoutes.handleDiscoverProjectMcp(url, res)
          break
        case 'GET /api/mcp/project/enabled':
          await mcpRoutes.handleGetProjectMcpEnabled(res)
          break
        case 'PUT /api/mcp/project/enabled':
          await mcpRoutes.handleSetProjectMcpEnabled(body, res)
          break
        case 'GET /api/mcp/marketplace/urls':
          await mcpRoutes.handleGetMarketplaceUrls(res)
          break
        case 'POST /api/mcp/marketplace/urls':
          await mcpRoutes.handleAddMarketplaceUrl(body, res)
          break
        case 'POST /api/mcp/marketplace/urls/reset':
          await mcpRoutes.handleResetMarketplaceUrls(res)
          break

        default:
          // Dynamic route matching for /api/conversations/:id and similar
          if (url.pathname.match(/^\/api\/conversations\/[^/]+\/abort$/)) {
            // POST /api/conversations/:id/abort — abort all tasks for a conversation
            const parts = url.pathname.split('/')
            const id = parts[3]!
            if (req.method === 'POST') {
              await this.handleAbortConversation(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Conversations sub-routes ──────────────────────────────────
          else if (url.pathname.match(/^\/api\/conversations\/[^/]+\/promote-draft$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await conversationRoutes.handlePromoteDraftConversation(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/conversations\/[^/]+\/status$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'PATCH') {
              await conversationRoutes.handleUpdateConversationStatus(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/conversations\/[^/]+\/increment-agent-count$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await conversationRoutes.handleIncrementAgentCount(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/conversations\/[^/]+\/auto-title$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await conversationRoutes.handleAutoTitle(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/conversations\/[^/]+\/set-title$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await conversationRoutes.handleSetTitle(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/conversations\/[^/]+$/)) {
            const id = url.pathname.split('/').pop()!
            if (req.method === 'GET') {
              await conversationRoutes.handleGetConversation(id, res)
            } else if (req.method === 'PATCH') {
              await conversationRoutes.handleUpdateConversation(id, body, res)
            } else if (req.method === 'DELETE') {
              await conversationRoutes.handleDeleteConversation(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Agents dynamic routes ─────────────────────────────────────
          else if (url.pathname.match(/^\/api\/agents\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'PATCH') {
              await agentRoutes.handleUpdateAgent(id, body, res)
            } else if (req.method === 'DELETE') {
              await agentRoutes.handleDeleteAgent(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Tasks dynamic routes ──────────────────────────────────────
          else if (url.pathname.match(/^\/api\/tasks\/[^/]+\/events$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'GET') {
              await taskRoutes.handleListTaskEvents(url, id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/tasks\/[^/]+\/status$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'PATCH') {
              await taskRoutes.handleUpdateTaskStatus(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/tasks\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'GET') {
              await taskRoutes.handleGetTask(id, res)
            } else if (req.method === 'DELETE') {
              await taskRoutes.handleDeleteTask(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Workspaces dynamic routes ─────────────────────────────────
          else if (url.pathname.match(/^\/api\/workspaces\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'GET') {
              await workspaceRoutes.handleGetWorkspace(id, res)
            } else if (req.method === 'PATCH') {
              await workspaceRoutes.handleUpdateWorkspace(id, body, res)
            } else if (req.method === 'DELETE') {
              await workspaceRoutes.handleDeleteWorkspace(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Teams dynamic routes ──────────────────────────────────────
          else if (url.pathname.match(/^\/api\/teams\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'GET') {
              await teamRoutes.handleGetTeam(id, res)
            } else if (req.method === 'PATCH') {
              await teamRoutes.handleUpdateTeam(id, body, res)
            } else if (req.method === 'DELETE') {
              await teamRoutes.handleDeleteTeam(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Action Cards dynamic routes ───────────────────────────────
          else if (url.pathname.match(/^\/api\/action-cards\/[^/]+\/approve$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await actionCardRoutes.handleApproveActionCard(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/action-cards\/[^/]+\/reject$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await actionCardRoutes.handleRejectActionCard(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/action-cards\/[^/]+\/execute$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'POST') {
              await actionCardRoutes.handleExecuteActionCard(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Memory dynamic routes (Phase 1C) ──────────────────────────
          else if (url.pathname.match(/^\/api\/memory\/agent\/[^/]+$/)) {
            const agentId = extractPathSegment(url.pathname, 4)
            if (req.method === 'GET') {
              await memoryRoutes.handleReadAgentMemory(url, agentId, res)
            } else if (req.method === 'PUT') {
              await memoryRoutes.handleWriteAgentMemory(body, agentId, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/candidates\/[^/]+\/status$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'PATCH') {
              await memoryRoutes.handleUpdateCandidateStatus(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/candidates\/[^/]+\/materialize$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await memoryRoutes.handleMaterializeCandidate(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/project\/items\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 5)
            if (req.method === 'DELETE') {
              await memoryRoutes.handleDeleteProjectItem(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/markers\/[^/]+$/)) {
            const name = extractPathSegment(url.pathname, 4)
            if (req.method === 'GET') {
              await memoryRoutes.handleReadMarker(url, name, res)
            } else if (req.method === 'PUT') {
              await memoryRoutes.handleWriteMarker(body, name, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/agent-sessions\/[^/]+\/end$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await memoryRoutes.handleEndAgentSession(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/agent-sessions\/external\/[^/]+\/end$/)) {
            const externalId = extractPathSegment(url.pathname, 5)
            if (req.method === 'POST') {
              await memoryRoutes.handleEndAgentSessionByExternalId(externalId, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/memory\/agent-profiles\/[^/]+$/)) {
            const agentId = extractPathSegment(url.pathname, 4)
            if (req.method === 'GET') {
              await memoryRoutes.handleGetAgentProfile(url, agentId, res)
            } else if (req.method === 'PUT') {
              await memoryRoutes.handleUpsertAgentProfile(body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Chat dynamic routes (Phase 3d Batch 4) ─────────────────────
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/messages$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await chatRoutes.handleSendMessage(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/permission$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await chatRoutes.handleRespondPermission(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/question$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await chatRoutes.handleRespondQuestion(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/abort$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await chatRoutes.handleAbortChat(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/models$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'GET') {
              await chatRoutes.handleGetAvailableModels(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/model$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'PUT') {
              await chatRoutes.handleSetModel(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+\/config$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'GET') {
              await chatRoutes.handleGetConfigOptions(id, res)
            } else if (req.method === 'PUT') {
              await chatRoutes.handleSetConfigOption(id, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/chat\/sessions\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 4)
            if (req.method === 'DELETE') {
              await chatRoutes.handleEndSession(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Orchestrator dynamic routes (Phase 3d Batch 4) ─────────────
          else if (url.pathname.match(/^\/api\/orchestrator\/tasks$/)) {
            if (req.method === 'GET') {
              await orchestratorRoutes.handleGetActiveTasks(url, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/orchestrator\/graph$/)) {
            if (req.method === 'GET') {
              await orchestratorRoutes.handleGetActiveGraph(url, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── Memory Palace dynamic routes (Phase 1C) ────────────────────
          else if (url.pathname.match(/^\/api\/memory-palace\/[^/]+$/)) {
            const id = extractPathSegment(url.pathname, 3)
            if (req.method === 'PUT') {
              await palaceRoutes.handleUpdatePalace(id, body, res)
            } else if (req.method === 'DELETE') {
              await palaceRoutes.handleDeletePalace(id, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          // ─── MCP dynamic routes (Phase 1C) ──────────────────────────────
          else if (url.pathname.match(/^\/api\/mcp\/servers\/[^/]+$/)) {
            const name = extractPathSegment(url.pathname, 4)
            if (req.method === 'PUT') {
              await mcpRoutes.handleUpdateMcpServer(name, body, res)
            } else if (req.method === 'DELETE') {
              await mcpRoutes.handleRemoveMcpServer(name, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/mcp\/servers\/[^/]+\/toggle$/)) {
            const name = extractPathSegment(url.pathname, 4)
            if (req.method === 'PATCH') {
              await mcpRoutes.handleToggleMcpServer(name, body, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/mcp\/servers\/[^/]+\/test$/)) {
            const name = extractPathSegment(url.pathname, 4)
            if (req.method === 'POST') {
              await mcpRoutes.handleTestMcpConnection(name, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else if (url.pathname.match(/^\/api\/mcp\/marketplace\/urls\/[^/]+$/)) {
            const encodedUrl = url.pathname.split('/').pop()!
            if (req.method === 'DELETE') {
              await mcpRoutes.handleRemoveMarketplaceUrl(encodedUrl, res)
            } else {
              res.writeHead(405, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
            }
          }
          else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: `Unknown route: ${route}` }))
          }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      const routeStr = `${req.method} ${url.pathname}`
      writeObservabilityEvent('renderer_api:error', { route: routeStr, error })
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error }))
      }
    }
  }

  // ─── Auth ────────────────────────────────────────────────────────────────

  private authenticateRequest(req: IncomingMessage): { valid: true } | { valid: false; reason: string } {
    // SSE endpoint already handled above — no auth needed
    const cookieHeader = req.headers['cookie']
    if (!cookieHeader || typeof cookieHeader !== 'string') {
      return { valid: false, reason: 'Missing session cookie' }
    }

    // Parse cookies — find bytro_session
    const cookies = cookieHeader.split(';').map((c) => c.trim())
    const sessionCookie = cookies.find((c) => c.startsWith('bytro_session='))
    if (!sessionCookie) {
      return { valid: false, reason: 'Missing bytro_session cookie' }
    }

    const token = sessionCookie.slice('bytro_session='.length)
    const entry = sessionRegistry.get(token)
    if (!entry) {
      return { valid: false, reason: 'Invalid session cookie' }
    }

    if (Date.now() - entry.lastActivityAt > SESSION_TTL_MS) {
      sessionRegistry.delete(token)
      return { valid: false, reason: 'Session expired' }
    }

    // Auto-renew: extend session TTL on each successful request
    entry.lastActivityAt = Date.now()

    return { valid: true }
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

  private async handleCreateSession(res: ServerResponse): Promise<void> {
    const sessionId = randomUUID()
    const cookieToken = randomUUID()

    sessionRegistry.set(cookieToken, {
      sessionId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    })

    // Set session cookie
    res.setHeader('Set-Cookie', `bytro_session=${cookieToken}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}; Path=/api`)

    writeObservabilityEvent('renderer_api:session_created', { sessionId })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, sessionId }))
  }

  private async handleGetDaemonStatus(res: ServerResponse): Promise<void> {
    const activeRuntimes = runtimeRegistry.getAllActive()
    const pendingTasks = taskQueue.countAllPending()

    // Aggregate agent statuses from runtime registry
    const agents = activeRuntimes.map((r) => ({
      profileId: r.profile.id,
      name: r.profile.name,
      role: r.profile.role,
      isActive: r.isActive,
      isProcessing: r.isProcessing,
      claimedTasks: r.claimedTasks.size,
      pendingMessages: r.pendingMessages.length,
    }))

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      status: this.daemon?.isRunning() ? 'running' : 'stopped',
      activeAgents: activeRuntimes.length,
      pendingTasks,
      agents,
    }))
  }

  private async handleGetHeartbeat(res: ServerResponse): Promise<void> {
    const activeRuntimes = runtimeRegistry.getAllActive()
    const pendingTasks = taskQueue.countAllPending()

    // Count tasks by status from DB
    const db = getDb()
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM agent_task_queue
      WHERE status IN ('pending', 'claimed', 'running', 'completed', 'failed')
      GROUP BY status
    `).all() as Array<{ status: string; count: number }>

    const taskCounts = statusCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count
      return acc
    }, {})

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      activeRuntimes: activeRuntimes.length,
      pendingTasks,
      taskCounts,
      timestamp: Date.now(),
    }))
  }

  private async handleGetTokenUsage(url: URL, res: ServerResponse): Promise<void> {
    const days = clampInt(url.searchParams.get('days'), 7, 1, 90)

    const db = getDb()
    const sinceEpoch = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60)

    // Query token_usage table if it exists, otherwise return empty
    let usage: unknown[] = []
    try {
      usage = db.prepare(`
        SELECT * FROM token_usage
        WHERE created_at >= ?
        ORDER BY created_at DESC
        LIMIT 1000
      `).all(sinceEpoch)
    } catch {
      // Table may not exist yet — return empty
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, days, usage }))
  }

  private async handleGetAgentActivity(url: URL, res: ServerResponse): Promise<void> {
    const profileId = url.searchParams.get('profileId')
    const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100)

    if (!profileId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'profileId is required' }))
      return
    }

    // Get agent status from runtime registry
    const resident = runtimeRegistry.get(profileId)
    const agentStatus = resident
      ? {
          profileId: resident.profile.id,
          name: resident.profile.name,
          role: resident.profile.role,
          isActive: resident.isActive,
          isProcessing: resident.isProcessing,
          claimedTasks: resident.claimedTasks.size,
          pendingMessages: resident.pendingMessages.length,
        }
      : null

    // Get recent tasks for this agent
    const db = getDb()
    const recentTasks = db.prepare(`
      SELECT id, conversation_id, status, message, created_at, completed_at, result, error
      FROM agent_task_queue
      WHERE agent_profile_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(profileId, limit)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, profileId, agentStatus, recentTasks }))
  }

  private async handleCreateMessage(body: unknown, res: ServerResponse): Promise<void> {
    const data = body as Record<string, unknown> | null
    if (!data?.conversation_id || !data?.content) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'conversation_id and content are required' }))
      return
    }

    const conversationId = data.conversation_id as string
    const content = data.content as string

    // Persist message to DB
    const db = getDb()
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, data.role ?? 'user', content, now)

    // Dispatch to daemon for agent processing
    if (this.daemon && this.daemon.isRunning()) {
      const context = Array.isArray(data.context)
        ? data.context as Array<{ role: string; content: string }>
        : []
      this.daemon.onUserMessage(conversationId, content, context).catch((err) => {
        console.error('[RendererApi] daemon.onUserMessage failed:', err)
      })
    }

    // Broadcast new message via SSE
    this.broadcast('message:new', { conversationId, messageId: id })

    res.writeHead(201, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, id }))
  }

  private async handleAbortConversation(conversationId: string, res: ServerResponse): Promise<void> {
    if (!this.daemon || !this.daemon.isRunning()) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'Daemon not running' }))
      return
    }

    this.daemon.abortConversation(conversationId)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, conversationId }))
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function extractPathSegment(pathname: string, index: number): string {
  const segment = pathname.split('/')[index]
  if (!segment) throw new Error(`Invalid path: ${pathname} (missing segment at index ${index})`)
  return segment
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let serverInstance: RendererApiServer | null = null

export function getRendererApiServer(): RendererApiServer {
  if (!serverInstance) {
    serverInstance = new RendererApiServer()
  }
  return serverInstance
}
