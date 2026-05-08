import type { AIEvent } from '../../types'
import type { OutputParser } from './output-parser'

interface OpenCodePart {
  id: string
  messageID: string
  sessionID: string
  type: string
  text?: string
  tool?: string
  callID?: string
  state?: {
    status: string
    input: Record<string, unknown>
    output: string
  }
  reason?: string
  tokens?: {
    total: number
    input: number
    output: number
    reasoning: number
    cache: { write: number; read: number }
  }
  cost?: number
  time?: { start: number; end: number }
}

interface OpenCodeEvent {
  type: string
  sessionID: string
  timestamp?: number
  part?: OpenCodePart
  error?: { data?: { message?: string } }
}

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

export class OpenCodeOutputParser implements OutputParser {
  private messageId = ''
  private fullText = ''
  private _sessionId = ''

  get sessionId(): string {
    return this._sessionId
  }

  parseLine(line: string): AIEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let parsed: OpenCodeEvent
    try {
      parsed = JSON.parse(trimmed) as OpenCodeEvent
    } catch {
      return []
    }

    if (parsed.sessionID) {
      this._sessionId = parsed.sessionID
    }

    if (parsed.type === 'error') {
      const message = parsed.error?.data?.message || 'OpenCode error'
      return [{ type: 'error', error: message }]
    }

    if (parsed.type === 'step_start') {
      this.messageId = parsed.part?.messageID || ''
      return []
    }

    if (parsed.type === 'text' && parsed.part?.text) {
      this.fullText += parsed.part.text
      return splitIntoChunks(parsed.part.text, 50).map((delta) => ({
        type: 'text_delta' as const,
        id: this.messageId,
        delta
      }))
    }

    if (parsed.type === 'tool_use' && parsed.part) {
      const events: AIEvent[] = []
      events.push({
        type: 'tool_start',
        toolCallId: parsed.part.callID || parsed.part.id,
        toolName: parsed.part.tool || 'unknown',
        toolInput: JSON.stringify(parsed.part.state?.input || {})
      })
      const output = parsed.part.state?.output || ''
      events.push({
        type: 'tool_result',
        toolCallId: parsed.part.callID || parsed.part.id,
        success: parsed.part.state?.status === 'completed',
        result: output
      })
      return events
    }

    if (parsed.type === 'step_finish' && parsed.part?.reason === 'stop') {
      const events: AIEvent[] = []
      if (this.fullText) {
        const usage = parsed.part.tokens
          ? {
              inputTokens: parsed.part.tokens.input,
              outputTokens: parsed.part.tokens.output,
              cacheReadTokens: parsed.part.tokens.cache.read,
              cacheCreationTokens: parsed.part.tokens.cache.write
            }
          : undefined
        events.push({
          type: 'complete',
          id: this.messageId,
          fullText: this.fullText,
          usage,
          costUsd: parsed.part.cost
        })
      }
      events.push({ type: 'done', id: this.messageId })
      this.fullText = ''
      return events
    }

    return []
  }

  consume(_data: string): AIEvent[] {
    return []
  }

  flush(): AIEvent[] {
    return []
  }

  beginTurn(): void {
    this.messageId = ''
    this.fullText = ''
  }

  resolveInteraction(): void {}
  cancelTurn(): void {}
}
