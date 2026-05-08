import { randomUUID } from 'crypto'
import type { AIEvent } from '../../types'
import type { OutputParser } from './output-parser'

const TEXT_CHUNK_SIZE = 50

interface GeminiInit {
  type: 'init'
  timestamp: string
  session_id: string
  model?: string
}

interface GeminiMessage {
  type: 'message'
  timestamp: string
  role: 'user' | 'assistant'
  content: string
  delta?: boolean
}

interface GeminiToolUse {
  type: 'tool_use'
  timestamp: string
  tool_name: string
  tool_id: string
  parameters: Record<string, unknown>
}

interface GeminiToolResult {
  type: 'tool_result'
  timestamp: string
  tool_id: string
  status: 'success' | 'error'
  output?: string
}

interface GeminiResult {
  type: 'result'
  timestamp: string
  status: 'success' | 'error'
  stats?: {
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
    cached?: number
  }
  error?: string
}

type GeminiLine =
  | GeminiInit
  | GeminiMessage
  | GeminiToolUse
  | GeminiToolResult
  | GeminiResult

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

export class GeminiOutputParser implements OutputParser {
  private sessionId = ''
  private messageId = ''
  private fullText = ''

  parseLine(line: string): AIEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let parsed: GeminiLine
    try {
      parsed = JSON.parse(trimmed) as GeminiLine
    } catch {
      return []
    }

    switch (parsed.type) {
      case 'init':
        this.sessionId = parsed.session_id
        return [{ type: 'system_init', sessionId: parsed.session_id }]

      case 'message': {
        if (parsed.role !== 'assistant') return []
        const content = parsed.content ?? ''
        if (!content) return []
        this.fullText += content
        return chunkText(content, TEXT_CHUNK_SIZE).map((delta) => ({
          type: 'text_delta',
          id: this.messageId,
          delta
        }))
      }

      case 'tool_use':
        return [
          {
            type: 'tool_start',
            toolCallId: parsed.tool_id,
            toolName: parsed.tool_name,
            toolInput: JSON.stringify(parsed.parameters ?? {})
          }
        ]

      case 'tool_result':
        return [
          {
            type: 'tool_result',
            toolCallId: parsed.tool_id,
            success: parsed.status === 'success',
            result: parsed.output ?? ''
          }
        ]

      case 'result': {
        if (parsed.status === 'error') {
          this.fullText = ''
          return [{ type: 'error', error: parsed.error ?? 'Gemini CLI error' }]
        }
        const savedText = this.fullText
        this.fullText = ''
        const completeEvent: AIEvent = {
          type: 'complete',
          id: this.sessionId,
          fullText: savedText
        }
        if (parsed.stats) {
          completeEvent.usage = {
            inputTokens: parsed.stats.input_tokens ?? 0,
            outputTokens: parsed.stats.output_tokens ?? 0,
            cacheReadTokens: parsed.stats.cached ?? 0
          }
        }
        return [completeEvent, { type: 'done', id: this.sessionId }]
      }

      default:
        return []
    }
  }

  consume(_data: string): AIEvent[] {
    return []
  }

  flush(): AIEvent[] {
    if (!this.fullText) return []
    const savedText = this.fullText
    this.fullText = ''
    return [
      { type: 'complete', id: this.sessionId, fullText: savedText },
      { type: 'done', id: this.sessionId }
    ]
  }

  beginTurn(): void {
    this.messageId = randomUUID()
    this.fullText = ''
  }

  resolveInteraction(): void {}
  cancelTurn(): void {}
}
