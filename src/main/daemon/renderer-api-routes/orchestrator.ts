/**
 * Renderer API Routes — Orchestrator endpoints
 *
 * Migrates 7 IPC handlers from ipc/orchestrator.ts to HTTP endpoints.
 * Uses SSE WebContents adapter to bridge events without Electron dependency.
 *
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { orchestrator } from '../../ai/orchestrator'
import type { SessionConfig } from '../../ai/provider'
import type { ExecutionMode, CollaborationMode } from '../../ai/a2a-types'
import type { PermissionMode } from '../../ai/types'
import { providerRegistry } from '../../ai/provider-registry'
import { createSSEWebContentsAdapter } from '../webcontents-adapter'

// ─── Constants ────────────────────────────────────────────────────────────────

const PERMISSION_MODES = new Set(['manual', 'autoEdit', 'plan', 'fullAuto', 'trusted'])
const EXECUTION_MODES = new Set<ExecutionMode>(['serial', 'parallel'])
const COLLABORATION_MODES = new Set<CollaborationMode>(['orchestrated', 'open_floor'])
const MAX_CONTENT_LENGTH = 200_000

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function validatePayload(payload: unknown): {
  conversationId: string
  profileId: string | null
  content: string
  sessionConfig: SessionConfig
  executionMode: ExecutionMode
  overrides?: { providerType?: string; model?: string }
  initialMentions?: string
  collaborationMode?: CollaborationMode
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid payload')
  }
  const p = payload as Record<string, unknown>

  const conversationId = p.conversationId
  if (typeof conversationId !== 'string' || !conversationId.trim()) {
    throw new Error('Invalid conversationId')
  }

  const profileId = p.profileId === null ? null : (typeof p.profileId === 'string' ? p.profileId : null)

  const content = p.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('Invalid content')
  if (content.length > MAX_CONTENT_LENGTH) throw new Error('Content too long')

  const sc = p.sessionConfig
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) throw new Error('Invalid sessionConfig')
  const cfg = sc as Record<string, unknown>

  const providerType = (typeof cfg.providerType === 'string' && cfg.providerType) ? cfg.providerType : 'claude'
  const provider = providerRegistry.get(providerType)
  if (!provider) throw new Error(`Invalid provider: ${providerType}`)

  const defaultModel = provider.meta.models[0]?.id ?? ''
  const model = (typeof cfg.model === 'string' && cfg.model) ? cfg.model : defaultModel

  if (!PERMISSION_MODES.has(cfg.permissionMode as string)) throw new Error('Invalid permissionMode')

  const workingDir = typeof cfg.workingDir === 'string' ? cfg.workingDir.trim() : ''
  const resolvedDir = workingDir ? resolve(workingDir) : ''
  if (resolvedDir && (!existsSync(resolvedDir) || !statSync(resolvedDir).isDirectory())) {
    throw new Error('Invalid workingDir')
  }

  const sessionConfig: SessionConfig = {
    providerType,
    model,
    permissionMode: cfg.permissionMode as PermissionMode,
    workingDir: resolvedDir,
    sessionId: typeof cfg.sessionId === 'string' ? cfg.sessionId : undefined
  }

  const executionMode = (p.executionMode as ExecutionMode) ?? 'serial'
  if (!EXECUTION_MODES.has(executionMode)) throw new Error('Invalid executionMode')

  const overrides = p.overrides
  let validatedOverrides: { providerType?: string; model?: string } | undefined
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    const ov = overrides as Record<string, unknown>
    validatedOverrides = {}
    if (typeof ov.providerType === 'string' && ov.providerType) {
      const ovProvider = providerRegistry.get(ov.providerType)
      if (!ovProvider) throw new Error(`Invalid override provider: ${ov.providerType}`)
      validatedOverrides.providerType = ov.providerType
    }
    if (typeof ov.model === 'string' && ov.model) {
      validatedOverrides.model = ov.model
    }
  }

  const initialMentions = typeof p.initialMentions === 'string' ? p.initialMentions.slice(0, 20_000) : undefined

  const collaborationMode: CollaborationMode | undefined =
    typeof p.collaborationMode === 'string' && COLLABORATION_MODES.has(p.collaborationMode as CollaborationMode)
      ? (p.collaborationMode as CollaborationMode)
      : undefined

  return { conversationId, profileId, content, sessionConfig, executionMode, overrides: validatedOverrides, initialMentions, collaborationMode }
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** POST /api/orchestrator/messages — Send user message via orchestrator */
export async function handleSendOrchestratorMessage(body: unknown, res: ServerResponse): Promise<void> {
  try {
    const { conversationId, profileId, content, sessionConfig, executionMode, overrides, initialMentions, collaborationMode } = validatePayload(body)
    const wc = createSSEWebContentsAdapter()
    await orchestrator.sendUserMessage(
      conversationId,
      profileId,
      content,
      sessionConfig,
      executionMode,
      wc as unknown as import('electron').WebContents,
      overrides,
      initialMentions,
      collaborationMode
    )
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/orchestrator/abort — Abort orchestrator for conversation */
export async function handleAbortOrchestrator(body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { conversationId?: string } | null
    if (!data?.conversationId || typeof data.conversationId !== 'string' || !data.conversationId.trim()) {
      return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
    }
    orchestrator.abort(data.conversationId)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/orchestrator/permission — Respond to permission request */
export async function handleOrchestratorPermission(body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { conversationId?: string; approved?: boolean; profileId?: string; taskId?: string } | null
    if (!data?.conversationId || typeof data.conversationId !== 'string' || !data.conversationId.trim()) {
      return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
    }
    if (data.approved === undefined || typeof data.approved !== 'boolean') {
      return jsonResponse(res, 400, { ok: false, error: 'approved (boolean) is required' })
    }
    orchestrator.respondPermission(data.conversationId, data.approved, data.profileId ?? 'default', data.taskId)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/orchestrator/question — Respond to question */
export async function handleOrchestratorQuestion(body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { conversationId?: string; answer?: string; profileId?: string; taskId?: string } | null
    if (!data?.conversationId || typeof data.conversationId !== 'string' || !data.conversationId.trim()) {
      return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
    }
    if (data.answer === undefined || typeof data.answer !== 'string') {
      return jsonResponse(res, 400, { ok: false, error: 'answer is required' })
    }
    orchestrator.respondQuestion(data.conversationId, data.answer, data.profileId ?? 'default', data.taskId)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** GET /api/orchestrator/tasks?conversationId= — Get active tasks */
export async function handleGetActiveTasks(url: URL, res: ServerResponse): Promise<void> {
  try {
    const conversationId = url.searchParams.get('conversationId')
    if (!conversationId || !conversationId.trim()) {
      return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
    }
    const tasks = orchestrator.getActiveTasks(conversationId)
    return jsonResponse(res, 200, { ok: true, data: tasks })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/orchestrator/stop-open-floor — Stop open floor */
export async function handleStopOpenFloor(body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { conversationId?: string } | null
    if (!data?.conversationId || typeof data.conversationId !== 'string' || !data.conversationId.trim()) {
      return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
    }
    orchestrator.stopOpenFloor(data.conversationId)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** GET /api/orchestrator/graph?conversationId= — Get active task graph */
export async function handleGetActiveGraph(url: URL, res: ServerResponse): Promise<void> {
  try {
    const conversationId = url.searchParams.get('conversationId')
    if (!conversationId || !conversationId.trim()) {
      return jsonResponse(res, 400, { ok: false, error: 'conversationId is required' })
    }
    const graph = orchestrator.getActiveGraph(conversationId)
    return jsonResponse(res, 200, { ok: true, data: graph })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}
