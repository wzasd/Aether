/**
 * Renderer API Routes — Chat endpoints
 *
 * Migrates 10 IPC handlers from ipc/chat.ts to HTTP endpoints.
 * Replaces webContents.send('ai:event') with SSE broadcaster.
 *
 * ADR-016: Renderer API Server
 */

import type { ServerResponse } from 'http'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { aiEngine } from '../../ai/engine'
import { providerRegistry } from '../../ai/provider-registry'
import type { PermissionMode } from '../../ai/types'
import type { SessionConfig } from '../../ai/provider'
import type { AIEvent } from '../../ai/types'
import { sseBroadcaster } from '../sse-broadcaster'

// ─── Constants ────────────────────────────────────────────────────────────────

const PERMISSION_MODES = new Set(['manual', 'autoEdit', 'plan', 'fullAuto'])
const MAX_MESSAGE_LENGTH = 200_000

// ─── Session Event Handlers ───────────────────────────────────────────────────

const sessionHandlers = new Map<string, (event: AIEvent) => void>()

function cleanupSessionHandler(sessionId: string): void {
  const existing = sessionHandlers.get(sessionId)
  if (!existing) return
  aiEngine.offEvent(sessionId, existing)
  sessionHandlers.delete(sessionId)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}`)
  }
  return value
}

function assertSessionId(value: unknown): string {
  const sessionId = assertString(value, 'session id').trim()
  if (!sessionId) {
    throw new Error('Invalid session id')
  }
  return sessionId
}

function assertContent(value: unknown, field: string): string {
  const content = assertString(value, field)
  if (!content.trim()) {
    throw new Error(`Invalid ${field}`)
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`${field} is too long`)
  }
  return content
}

function normalizeWorkingDir(value: unknown): string {
  const workingDir = typeof value === 'string' ? value.trim() : ''
  if (!workingDir) return ''

  const resolved = resolve(workingDir)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error('Invalid working directory')
  }
  return resolved
}

function validateSessionConfig(config: SessionConfig): SessionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid session config')
  }

  const providerType = config.providerType || 'claude'
  const provider = providerRegistry.get(providerType)
  if (!provider) {
    throw new Error(`Invalid provider: ${providerType}`)
  }

  const defaultModel = provider.meta.models[0]?.id ?? ''
  const model = (typeof config.model === 'string' && config.model) ? config.model : defaultModel

  if (!PERMISSION_MODES.has(config.permissionMode)) {
    throw new Error('Invalid permission mode')
  }

  const sessionId = config.sessionId === undefined ? undefined : assertSessionId(config.sessionId)

  return {
    providerType,
    model,
    permissionMode: config.permissionMode as PermissionMode,
    workingDir: normalizeWorkingDir(config.workingDir),
    sessionId
  }
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** POST /api/chat/sessions — Start new session */
export async function handleStartSession(body: unknown, res: ServerResponse): Promise<void> {
  const config = body as SessionConfig | null
  if (!config) {
    return jsonResponse(res, 400, { ok: false, error: 'Session config is required' })
  }

  try {
    const session = await aiEngine.startSession(validateSessionConfig(config))

    cleanupSessionHandler(session.id)

    const forwardEvent = (aiEvent: AIEvent): void => {
      sseBroadcaster.broadcast('ai:event', { ...aiEvent, sessionId: session.id })

      if (aiEvent.type === 'done') {
        cleanupSessionHandler(session.id)
      }
    }

    aiEngine.onEvent(session.id, forwardEvent)
    sessionHandlers.set(session.id, forwardEvent)

    return jsonResponse(res, 201, { ok: true, session })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/chat/sessions/:id/messages — Send message */
export async function handleSendMessage(sessionId: string, body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { content?: string } | null
    if (!data?.content) {
      return jsonResponse(res, 400, { ok: false, error: 'content is required' })
    }
    aiEngine.sendMessage(assertSessionId(sessionId), assertContent(data.content, 'message content'))
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/chat/sessions/:id/permission — Respond to permission request */
export async function handleRespondPermission(sessionId: string, body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { approved?: boolean } | null
    if (data?.approved === undefined || typeof data.approved !== 'boolean') {
      return jsonResponse(res, 400, { ok: false, error: 'approved (boolean) is required' })
    }
    aiEngine.respondPermission(assertSessionId(sessionId), data.approved)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/chat/sessions/:id/question — Respond to question */
export async function handleRespondQuestion(sessionId: string, body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { answer?: string } | null
    if (!data?.answer) {
      return jsonResponse(res, 400, { ok: false, error: 'answer is required' })
    }
    aiEngine.respondQuestion(assertSessionId(sessionId), assertContent(data.answer, 'question answer'))
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** POST /api/chat/sessions/:id/abort — Abort session */
export async function handleAbortChat(sessionId: string, res: ServerResponse): Promise<void> {
  try {
    aiEngine.abort(assertSessionId(sessionId))
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** DELETE /api/chat/sessions/:id — End session */
export async function handleEndSession(sessionId: string, res: ServerResponse): Promise<void> {
  try {
    const id = assertSessionId(sessionId)
    aiEngine.endSession(id)
    cleanupSessionHandler(id)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** GET /api/chat/sessions/:id/models — Get available models */
export async function handleGetAvailableModels(sessionId: string, res: ServerResponse): Promise<void> {
  try {
    const models = await aiEngine.getAvailableModels(assertSessionId(sessionId))
    return jsonResponse(res, 200, { ok: true, data: models })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** PUT /api/chat/sessions/:id/model — Set model */
export async function handleSetModel(sessionId: string, body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { modelId?: string } | null
    if (!data?.modelId || typeof data.modelId !== 'string') {
      return jsonResponse(res, 400, { ok: false, error: 'modelId is required' })
    }
    await aiEngine.setModel(assertSessionId(sessionId), data.modelId)
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** GET /api/chat/sessions/:id/config — Get config options */
export async function handleGetConfigOptions(sessionId: string, res: ServerResponse): Promise<void> {
  try {
    const options = await aiEngine.getConfigOptions(assertSessionId(sessionId))
    return jsonResponse(res, 200, { ok: true, data: options ?? [] })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}

/** PUT /api/chat/sessions/:id/config — Set config option */
export async function handleSetConfigOption(sessionId: string, body: unknown, res: ServerResponse): Promise<void> {
  try {
    const data = body as { optionId?: string; value?: string } | null
    if (!data?.optionId || typeof data.optionId !== 'string') {
      return jsonResponse(res, 400, { ok: false, error: 'optionId is required' })
    }
    if (data.value === undefined || typeof data.value !== 'string') {
      return jsonResponse(res, 400, { ok: false, error: 'value is required' })
    }
    await aiEngine.setConfigOption(
      assertSessionId(sessionId),
      data.optionId,
      data.value
    )
    return jsonResponse(res, 200, { ok: true })
  } catch (err) {
    return jsonResponse(res, 400, { ok: false, error: (err as Error).message })
  }
}
