import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, fstatSync, readSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { inspect } from 'node:util'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string
  level: LogLevel
  source: string
  message: string
  meta?: unknown
  raw?: string
}

export interface LogFileInfo {
  source: string
  fileName: string
  path: string
  size: number
  updatedAt: number
}

export interface LogReadOptions {
  source?: string
  limit?: number
  level?: LogLevel | LogLevel[]
  query?: string
  since?: number
  until?: number
  tailBytes?: number
}

export interface LogReadResult {
  entries: LogEntry[]
  file: LogFileInfo | null
  truncated: boolean
  bytesRead: number
}

export type RuntimeTerminationReason = 'completed' | 'aborted' | 'crashed' | 'zombie' | 'disposed'

export type ObservabilityEventName =
  | 'runtime:started'
  | 'runtime:terminated'
  | 'runtime:session_id_rejected'
  | 'runtime:binary_resolved'
  | 'runtime:binary_not_found'
  | 'runtime:model_resolved'
  | 'runtime:models_listed'
  | 'runtime:process_spawned'
  | 'runtime:process_stderr'
  | 'runtime:process_stdin'
  | 'runtime.progress.stalled'
  | 'runtime.stall_cleared'
  | 'provider:error'
  | 'permission:requested'
  | 'permission:granted'
  | 'permission:denied'
  | 'permission:abandoned'
  | 'task:enqueued'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'feedback:created'
  | 'intent:dispatched'
  | 'open_floor:completed'
  | 'open_floor:stopped'
  | 'open_floor:round_converged'
  | 'open_floor:round_completed'
  | 'memory_distill:completed'
  | 'memory_distill:failed'
  | 'action_card:create_failed'
  | 'bridge_api:started'
  | 'bridge_api:error'
  | 'bridge_api:message_sent'
  | 'bridge_api:task_claimed'
  | 'bridge_api:task_updated'
  | 'chat_bridge:started'
  | 'chat_bridge:tool_error'
  | 'bridge_config:namespace_conflict'
  | 'bridge_config:generated'
  | 'bridge_config:cleaned_up'
  | 'renderer_api:started'
  | 'renderer_api:error'
  | 'renderer_api:session_created'
  | 'renderer_api:sse_connected'
  | 'renderer_api:mcp_server_added'
  | 'renderer_api:mcp_server_removed'
  | 'renderer_api:palace_created'
  | 'renderer_api:palace_deleted'
  | 'renderer_api:memory_candidate_created'
  | 'renderer_api:memory_item_deleted'
  | 'renderer_api:memory_candidate_materialized'
  | 'renderer_api:sse_client_dropped'
  | 'daemon_core:started'
  | 'daemon_core:stopped'
  | 'daemon_entry:started'
  | 'daemon_entry:shutdown'
  | 'secrets_migration:completed'
  | 'secrets_migration:partial'
  | 'secrets_migration:row_failed'
  | 'secrets_migration:backup_cleaned'

export interface ObservabilityEventPayload {
  conversationId?: string
  taskId?: string
  profileId?: string
  runtimeKey?: string
  requestId?: string
  reason?: RuntimeTerminationReason | string
  error?: string
  [key: string]: unknown
}

const DEFAULT_SOURCE = 'app'
const DEFAULT_LIMIT = 300
const MAX_LIMIT = 2_000
const DEFAULT_TAIL_BYTES = 512 * 1024
const MAX_TAIL_BYTES = 5 * 1024 * 1024
const SOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i

let consoleBridgeInstalled = false

export function getLogDirectory(): string {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function normalizeLogSource(source?: string): string {
  const normalized = (source || DEFAULT_SOURCE).trim()
  if (!SOURCE_PATTERN.test(normalized)) {
    throw new Error('Invalid log source')
  }
  return normalized
}

export function getLogFilePath(source?: string): string {
  const normalized = normalizeLogSource(source)
  const dir = getLogDirectory()
  const filePath = resolve(dir, `${normalized}.log`)
  const prefix = `${resolve(dir)}${sep}`
  if (!filePath.startsWith(prefix) || basename(filePath) !== `${normalized}.log`) {
    throw new Error('Invalid log source path')
  }
  return filePath
}

export function listLogFiles(): LogFileInfo[] {
  const dir = getLogDirectory()
  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith('.log'))
    .filter((fileName) => SOURCE_PATTERN.test(fileName.slice(0, -4)))
    .map((fileName) => {
      const source = fileName.slice(0, -4)
      const path = join(dir, fileName)
      const stats = statSync(path)
      return {
        source,
        fileName,
        path,
        size: stats.size,
        updatedAt: Math.floor(stats.mtimeMs)
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createLogger(source = DEFAULT_SOURCE): Record<LogLevel, (message: string, meta?: unknown) => void> {
  const normalized = normalizeLogSource(source)
  return {
    debug: (message, meta) => writeLog(normalized, 'debug', message, meta),
    info: (message, meta) => writeLog(normalized, 'info', message, meta),
    warn: (message, meta) => writeLog(normalized, 'warn', message, meta),
    error: (message, meta) => writeLog(normalized, 'error', message, meta)
  }
}

export function writeLog(source: string, level: LogLevel, message: string, meta?: unknown): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    source: normalizeLogSource(source),
    message,
    ...(meta === undefined ? {} : { meta: sanitizeMeta(meta) })
  }
  try {
    appendFileSync(getLogFilePath(entry.source), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[logging] failed to write ${entry.source}.log: ${reason}\n`)
  }
}

export function writeObservabilityEvent(
  event: ObservabilityEventName,
  payload: ObservabilityEventPayload = {},
  level = inferObservabilityLevel(event, payload)
): void {
  const source = event.split(':', 1)[0]
  writeLog(source, level, event, {
    event,
    ...payload
  })
}

export function installConsoleLogBridge(source = DEFAULT_SOURCE): void {
  if (consoleBridgeInstalled) return
  consoleBridgeInstalled = true

  const logger = createLogger(source)
  const original = {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  console.debug = (...args: unknown[]): void => {
    original.debug(...args)
    logger.debug(formatConsoleArgs(args))
  }
  console.info = (...args: unknown[]): void => {
    original.info(...args)
    logger.info(formatConsoleArgs(args))
  }
  console.log = (...args: unknown[]): void => {
    original.log(...args)
    logger.info(formatConsoleArgs(args))
  }
  console.warn = (...args: unknown[]): void => {
    original.warn(...args)
    logger.warn(formatConsoleArgs(args))
  }
  console.error = (...args: unknown[]): void => {
    original.error(...args)
    logger.error(formatConsoleArgs(args))
  }
}

export function readLogs(options: LogReadOptions = {}): LogReadResult {
  const source = normalizeLogSource(options.source)
  const filePath = getLogFilePath(source)
  const file = getLogFileInfo(source)
  if (!existsSync(filePath) || !file) {
    return { entries: [], file: null, truncated: false, bytesRead: 0 }
  }

  const tailBytes = clampNumber(options.tailBytes, DEFAULT_TAIL_BYTES, 1, MAX_TAIL_BYTES)
  const limit = clampNumber(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
  const { content, bytesRead, truncated } = readTail(filePath, tailBytes)
  const allowedLevels = normalizeLevels(options.level)
  const query = options.query?.trim().toLowerCase()
  const since = typeof options.since === 'number' ? options.since : undefined
  const until = typeof options.until === 'number' ? options.until : undefined

  const entries = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseLogLine(line, source))
    .filter((entry) => {
      if (allowedLevels && !allowedLevels.has(entry.level)) return false
      const time = Date.parse(entry.ts)
      if (since !== undefined && Number.isFinite(time) && time < since) return false
      if (until !== undefined && Number.isFinite(time) && time > until) return false
      if (query && !entryMatches(entry, query)) return false
      return true
    })

  return {
    entries: entries.slice(Math.max(0, entries.length - limit)),
    file,
    truncated,
    bytesRead
  }
}

function getLogFileInfo(source: string): LogFileInfo | null {
  const filePath = getLogFilePath(source)
  if (!existsSync(filePath)) return null
  const stats = statSync(filePath)
  return {
    source,
    fileName: basename(filePath),
    path: filePath,
    size: stats.size,
    updatedAt: Math.floor(stats.mtimeMs)
  }
}

function readTail(filePath: string, maxBytes: number): { content: string; bytesRead: number; truncated: boolean } {
  const fd = openSync(filePath, 'r')
  try {
    const stats = fstatSync(fd)
    const bytesRead = Math.min(stats.size, maxBytes)
    const start = Math.max(0, stats.size - bytesRead)
    const buffer = Buffer.alloc(bytesRead)
    readSync(fd, buffer, 0, bytesRead, start)
    let content = buffer.toString('utf8')
    const truncated = start > 0
    if (truncated) {
      const firstNewline = content.indexOf('\n')
      content = firstNewline >= 0 ? content.slice(firstNewline + 1) : ''
    }
    return { content, bytesRead, truncated }
  } finally {
    closeSync(fd)
  }
}

function parseLogLine(line: string, source: string): LogEntry {
  try {
    const parsed = JSON.parse(line) as Partial<LogEntry>
    return {
      ts: typeof parsed.ts === 'string' ? parsed.ts : new Date(0).toISOString(),
      level: isLogLevel(parsed.level) ? parsed.level : 'info',
      source: typeof parsed.source === 'string' ? parsed.source : source,
      message: typeof parsed.message === 'string' ? parsed.message : line,
      ...(parsed.meta === undefined ? {} : { meta: parsed.meta }),
      raw: line
    }
  } catch {
    return {
      ts: new Date(0).toISOString(),
      level: 'info',
      source,
      message: line,
      raw: line
    }
  }
}

function normalizeLevels(level?: LogLevel | LogLevel[]): Set<LogLevel> | null {
  if (!level) return null
  const levels = Array.isArray(level) ? level : [level]
  return new Set(levels.filter(isLogLevel))
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}

function inferObservabilityLevel(event: ObservabilityEventName, payload: ObservabilityEventPayload): LogLevel {
  if (event === 'task:failed' || event === 'runtime:binary_not_found') return 'error'
  if (event === 'permission:abandoned' || event === 'runtime:process_stderr') return 'warn'
  if (event === 'runtime:terminated') {
    if (payload.reason === 'crashed' || payload.reason === 'zombie') return 'error'
    if (payload.reason === 'aborted' || payload.reason === 'disposed') return 'warn'
  }
  if (event === 'runtime:process_stdin') return 'debug'
  return 'info'
}

function entryMatches(entry: LogEntry, query: string): boolean {
  if (entry.message.toLowerCase().includes(query)) return true
  if (entry.raw?.toLowerCase().includes(query)) return true
  if (entry.meta !== undefined && JSON.stringify(entry.meta).toLowerCase().includes(query)) return true
  return false
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function formatConsoleArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`
    }
    if (typeof arg === 'string') return arg
    return inspect(arg, { depth: 5, breakLength: 120 })
  }).join(' ')
}

function sanitizeMeta(meta: unknown): unknown {
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack
    }
  }
  try {
    JSON.stringify(meta)
    return meta
  } catch {
    return inspect(meta, { depth: 5, breakLength: 120 })
  }
}
