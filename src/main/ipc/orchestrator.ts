import { ipcMain } from 'electron'
import { orchestrator } from '../ai/orchestrator'
import type { SessionConfig } from '../ai/provider'
import type { ExecutionMode, CollaborationMode } from '../ai/a2a-types'
import type { PermissionMode } from '../ai/types'
import { providerRegistry } from '../ai/provider-registry'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'

const PERMISSION_MODES = new Set(['manual', 'autoEdit', 'plan', 'fullAuto', 'trusted'])
const EXECUTION_MODES = new Set<ExecutionMode>(['serial', 'parallel'])
const COLLABORATION_MODES = new Set<CollaborationMode>(['orchestrated', 'open_floor'])
const MAX_CONTENT_LENGTH = 200_000

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

  // Optional task-level runtime overrides
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

export function registerOrchestratorIpc(): void {
  ipcMain.handle('orchestrator:sendMessage', async (event, payload: unknown) => {
    const { conversationId, profileId, content, sessionConfig, executionMode, overrides, initialMentions, collaborationMode } = validatePayload(payload)
    await orchestrator.sendUserMessage(
      conversationId,
      profileId,
      content,
      sessionConfig,
      executionMode,
      event.sender,
      overrides,
      initialMentions,
      collaborationMode
    )
  })

  ipcMain.handle('orchestrator:abort', (_event, conversationId: string) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      throw new Error('Invalid conversationId')
    }
    orchestrator.abort(conversationId)
  })

  ipcMain.handle('orchestrator:respondPermission', (_event, conversationId: string, approved: boolean, profileId?: string, taskId?: string) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) throw new Error('Invalid conversationId')
    if (typeof approved !== 'boolean') throw new Error('Invalid approved')
    orchestrator.respondPermission(conversationId, approved, profileId ?? 'default', taskId)
  })

  ipcMain.handle('orchestrator:respondQuestion', (_event, conversationId: string, answer: string, profileId?: string, taskId?: string) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) throw new Error('Invalid conversationId')
    if (typeof answer !== 'string') throw new Error('Invalid answer')
    orchestrator.respondQuestion(conversationId, answer, profileId ?? 'default', taskId)
  })

  ipcMain.handle('orchestrator:getActiveTasks', (_event, conversationId: string) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      throw new Error('Invalid conversationId')
    }
    return orchestrator.getActiveTasks(conversationId)
  })

  ipcMain.handle('orchestrator:stopOpenFloor', (_event, conversationId: string) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      throw new Error('Invalid conversationId')
    }
    orchestrator.stopOpenFloor(conversationId)
  })

  ipcMain.handle('task:getActiveGraph', (_event, conversationId: string) => {
    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      throw new Error('Invalid conversationId')
    }
    return orchestrator.getActiveGraph(conversationId)
  })
}
