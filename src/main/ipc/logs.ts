import { ipcMain } from 'electron'
import { getLogDirectory, listLogFiles, readLogs, type LogLevel, type LogReadOptions } from '../core/logging'

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

export function registerLogsIpc(): void {
  ipcMain.handle('logs:getDirectory', () => getLogDirectory())
  ipcMain.handle('logs:list', () => listLogFiles())
  ipcMain.handle('logs:read', (_event, payload: unknown) => readLogs(validateReadPayload(payload)))
}

function validateReadPayload(payload: unknown): LogReadOptions {
  if (payload === undefined || payload === null) return {}
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid log read options')
  }

  const input = payload as Record<string, unknown>
  return {
    source: typeof input.source === 'string' ? input.source : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    level: validateLevels(input.level),
    query: typeof input.query === 'string' ? input.query : undefined,
    since: typeof input.since === 'number' ? input.since : undefined,
    until: typeof input.until === 'number' ? input.until : undefined,
    tailBytes: typeof input.tailBytes === 'number' ? input.tailBytes : undefined
  }
}

function validateLevels(value: unknown): LogLevel | LogLevel[] | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    if (!LOG_LEVELS.has(value as LogLevel)) throw new Error('Invalid log level')
    return value as LogLevel
  }
  if (Array.isArray(value)) {
    const levels = value.map((item) => {
      if (typeof item !== 'string' || !LOG_LEVELS.has(item as LogLevel)) {
        throw new Error('Invalid log level')
      }
      return item as LogLevel
    })
    return levels
  }
  throw new Error('Invalid log level')
}
