import type { Conversation, Message } from '../ipc/conversation'

export interface ExportOptions {
  includeThinking: boolean
  includeToolCalls: boolean
  includeSystemMessages: boolean
  includeUsage: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeThinking: false,
  includeToolCalls: true,
  includeSystemMessages: false,
  includeUsage: true,
}

interface UsageRecord {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  model: string
}

interface ParsedToolCall {
  name: string
  input: Record<string, unknown>
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function parseToolCalls(raw: string | null): ParsedToolCall[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function truncateInput(obj: Record<string, unknown>): string {
  const json = JSON.stringify(obj)
  if (json.length <= 120) return escapeTableCell(json)
  return escapeTableCell(json.slice(0, 117) + '...')
}

export function buildMarkdownExport(
  conv: Conversation,
  messages: Message[],
  usageRecords: UsageRecord[],
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): string {
  const lines: string[] = []

  lines.push(`# ${conv.title || 'Untitled'}`)
  lines.push('')

  const metaParts: string[] = []
  if (conv.model) metaParts.push(`Model: ${conv.model}`)
  metaParts.push(`Date: ${formatTimestamp(conv.created_at)}`)

  if (options.includeUsage && usageRecords.length > 0) {
    const totalInput = usageRecords.reduce((s, r) => s + r.input_tokens, 0)
    const totalOutput = usageRecords.reduce((s, r) => s + r.output_tokens, 0)
    metaParts.push(`Input: ${formatTokens(totalInput)} tokens`)
    metaParts.push(`Output: ${formatTokens(totalOutput)} tokens`)
  }

  metaParts.push(`Messages: ${messages.length}`)

  lines.push(`> ${metaParts.join(' | ')}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const msg of messages) {
    if (msg.role === 'system' && !options.includeSystemMessages) continue

    if (msg.role === 'user') {
      lines.push('## User')
      lines.push('')
      if (msg.content) lines.push(msg.content)
      lines.push('')
      lines.push('---')
      lines.push('')
      continue
    }

    if (msg.role === 'system') {
      lines.push('## System')
      lines.push('')
      if (msg.content) lines.push(msg.content)
      lines.push('')
      lines.push('---')
      lines.push('')
      continue
    }

    // Assistant
    const modelLabel = conv.model ? ` (${conv.model})` : ''
    lines.push(`## Assistant${modelLabel}`)
    lines.push('')

    // Thinking
    if (options.includeThinking && msg.thinking) {
      lines.push('<details>')
      lines.push('<summary>Thinking</summary>')
      lines.push('')
      lines.push(msg.thinking)
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }

    // Tool calls
    if (options.includeToolCalls && msg.tool_calls) {
      const toolCalls = parseToolCalls(msg.tool_calls)
      if (toolCalls.length > 0) {
        lines.push('### Tool Calls')
        lines.push('')
        lines.push('| Tool | Input |')
        lines.push('|------|-------|')
        for (const tc of toolCalls) {
          lines.push(`| ${escapeTableCell(tc.name)} | ${truncateInput(tc.input)} |`)
        }
        lines.push('')
      }
    }

    // Content
    if (msg.content) {
      lines.push(msg.content)
      lines.push('')
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

export function buildJsonExport(
  conv: Conversation,
  messages: Message[],
  usageRecords: UsageRecord[],
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): string {
  const filteredMessages = messages
    .filter((m) => {
      if (m.role === 'system' && !options.includeSystemMessages) return false
      return true
    })
    .map((m) => {
      const msg: Record<string, unknown> = {
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      }

      if (options.includeThinking && m.thinking) {
        msg.thinking = m.thinking
      }

      if (options.includeToolCalls && m.tool_calls) {
        try {
          msg.tool_calls = JSON.parse(m.tool_calls)
        } catch {
          msg.tool_calls = m.tool_calls
        }
      }

      if (m.tool_results) {
        try {
          msg.tool_results = JSON.parse(m.tool_results)
        } catch {
          msg.tool_results = m.tool_results
        }
      }

      if (options.includeUsage && m.usage) {
        try {
          msg.usage = JSON.parse(m.usage)
        } catch {
          msg.usage = m.usage
        }
      }

      return msg
    })

  const totalInput = usageRecords.reduce((s, r) => s + r.input_tokens, 0)
  const totalOutput = usageRecords.reduce((s, r) => s + r.output_tokens, 0)

  const doc = {
    title: conv.title || 'Untitled',
    model: conv.model,
    provider: conv.provider,
    status: conv.status,
    mode: conv.mode,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: usageRecords.reduce((s, r) => s + (r.cache_read_tokens ?? 0), 0),
      cacheCreationTokens: usageRecords.reduce((s, r) => s + (r.cache_creation_tokens ?? 0), 0),
    },
    messages: filteredMessages,
  }

  return JSON.stringify(doc, null, 2)
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9一-鿿 _-]/g, '').slice(0, 80) || 'export'
}
