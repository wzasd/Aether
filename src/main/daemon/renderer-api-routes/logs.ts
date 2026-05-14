/**
 * Logs route handlers for Renderer API.
 */

import type { ServerResponse } from 'http'
import { getLogDirectory, listLogFiles, readLogs, type LogLevel, type LogReadOptions } from '../../core/logging'

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

export async function handleGetLogDirectory(res: ServerResponse): Promise<void> {
  const dir = getLogDirectory()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, directory: dir }))
}

export async function handleListLogFiles(res: ServerResponse): Promise<void> {
  const files = listLogFiles()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, files }))
}

export async function handleReadLogs(body: unknown, res: ServerResponse): Promise<void> {
  try {
    const options = validateReadPayload(body)
    const logs = readLogs(options)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, logs }))
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(err) }))
  }
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
    tailBytes: typeof input.tailBytes === 'number' ? input.tailBytes : undefined,
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
