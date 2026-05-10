import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { ipcMain } from 'electron'
import { aiEngine } from '../ai/engine'
import { providerRegistry } from '../ai/provider-registry'
import type { PermissionMode } from '../ai/types'
import type { SessionConfig } from '../ai/provider'
import type { AIEvent } from '../ai/types'

const PERMISSION_MODES = new Set(['manual', 'autoEdit', 'plan', 'fullAuto'])
const MAX_MESSAGE_LENGTH = 200_000

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

export function registerChatIpc(): void {
  const sessionHandlers = new Map<string, (event: AIEvent) => void>()

  const cleanupSessionHandler = (sessionId: string): void => {
    const existing = sessionHandlers.get(sessionId)
    if (!existing) return
    aiEngine.offEvent(sessionId, existing)
    sessionHandlers.delete(sessionId)
  }

  // 启动新会话
  ipcMain.handle('chat:startSession', async (event, config: SessionConfig) => {
    console.log('[chat:startSession] called with providerType:', config?.providerType)
    const session = await aiEngine.startSession(validateSessionConfig(config))
    console.log('[chat:startSession] session created:', session.id)

    cleanupSessionHandler(session.id)

    const forwardEvent = (aiEvent: AIEvent): void => {
      if (event.sender.isDestroyed()) {
        cleanupSessionHandler(session.id)
        return
      }

      event.sender.send('ai:event', { ...aiEvent, sessionId: session.id })

      if (aiEvent.type === 'done') {
        cleanupSessionHandler(session.id)
      }
    }

    aiEngine.onEvent(session.id, forwardEvent)
    sessionHandlers.set(session.id, forwardEvent)

    return session
  })

  // 发送消息
  ipcMain.handle('chat:sendMessage', async (_, sessionId: string, content: string) => {
    console.log('[chat:sendMessage] sessionId:', sessionId, 'contentLen:', content?.length)
    aiEngine.sendMessage(assertSessionId(sessionId), assertContent(content, 'message content'))
    console.log('[chat:sendMessage] message sent to provider')
  })

  // 响应权限确认
  ipcMain.handle('chat:respondPermission', async (_, sessionId: string, approved: boolean) => {
    if (typeof approved !== 'boolean') {
      throw new Error('Invalid permission response')
    }
    aiEngine.respondPermission(assertSessionId(sessionId), approved)
  })

  // 响应用户提问
  ipcMain.handle('chat:respondQuestion', async (_, sessionId: string, answer: string) => {
    aiEngine.respondQuestion(assertSessionId(sessionId), assertContent(answer, 'question answer'))
  })

  // 中断会话
  ipcMain.handle('chat:abort', async (_, sessionId: string) => {
    aiEngine.abort(assertSessionId(sessionId))
  })

  // 结束会话
  ipcMain.handle('chat:endSession', async (_, sessionId: string) => {
    aiEngine.endSession(assertSessionId(sessionId))
    cleanupSessionHandler(sessionId)
  })

  // ─── Dynamic model & config ────────────────────────────────────────────

  ipcMain.handle('chat:getAvailableModels', async (_, sessionId: string) => {
    return aiEngine.getAvailableModels(assertSessionId(sessionId))
  })

  ipcMain.handle('chat:setModel', async (_, sessionId: string, modelId: string) => {
    const normalized = assertString(modelId, 'model id')
    await aiEngine.setModel(assertSessionId(sessionId), normalized)
  })

  ipcMain.handle('chat:getConfigOptions', async (_, sessionId: string) => {
    return aiEngine.getConfigOptions(assertSessionId(sessionId)) ?? []
  })

  ipcMain.handle('chat:setConfigOption', async (_, sessionId: string, optionId: string, value: string) => {
    await aiEngine.setConfigOption(
      assertSessionId(sessionId),
      assertString(optionId, 'config option id'),
      assertString(value, 'config option value'),
    )
  })
}
