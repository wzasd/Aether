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
  private toolCallNames: string[] = []
  private _sessionId = ''
  private completeEmitted = false

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
      const toolName = parsed.part.tool || 'unknown'
      const toolInput = parsed.part.state?.input || {}
      // Track tool call names for fallback complete event (Layer 1 fix)
      this.toolCallNames.push(toolName)

      const events: AIEvent[] = []
      events.push({
        type: 'tool_start',
        toolCallId: parsed.part.callID || parsed.part.id,
        toolName,
        toolInput: JSON.stringify(toolInput)
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

    if (parsed.type === 'step_finish') {
      const events: AIEvent[] = []
      const reason = parsed.part?.reason || 'stop'
      const usage = parsed.part?.tokens
        ? {
            inputTokens: parsed.part.tokens.input,
            outputTokens: parsed.part.tokens.output,
            cacheReadTokens: parsed.part.tokens.cache.read,
            cacheCreationTokens: parsed.part.tokens.cache.write
          }
        : undefined

      if (reason === 'stop' || reason === 'end-turn') {
        // Terminal step: agent finished its turn (aligned with Slock behavior)
        if (this.fullText) {
          events.push({
            type: 'complete',
            id: this.messageId,
            fullText: this.fullText,
            usage,
            costUsd: parsed.part?.cost
          })
        } else if (this.toolCallNames.length > 0) {
          // Layer 1 fallback: pure tool calls, no text → emit complete with tool summary
          const toolSummary = this.toolCallNames
            .map((name, i) => `${i + 1}. ${name}`)
            .join('\n')
          events.push({
            type: 'complete',
            id: this.messageId,
            fullText: `[工具调用完成]\n${toolSummary}`,
            usage,
            costUsd: parsed.part?.cost
          })
        }
        this.completeEmitted = true
        events.push({ type: 'done', id: this.messageId })
      } else if (reason === 'tool-calls') {
        // Intermediate step: agent will continue with more tool calls.
        // Persist any accumulated text before resetting for the next step,
        // otherwise multi-step text is lost (only last step survives).
        if (this.fullText) {
          events.push({
            type: 'complete',
            id: this.messageId,
            fullText: this.fullText,
            usage,
            costUsd: parsed.part?.cost
          })
        } else if (this.toolCallNames.length > 0) {
          const toolSummary = this.toolCallNames
            .map((name, i) => `${i + 1}. ${name}`)
            .join('\n')
          events.push({
            type: 'complete',
            id: this.messageId,
            fullText: `[工具调用完成]\n${toolSummary}`,
            usage,
            costUsd: parsed.part?.cost
          })
        }
        // Don't emit 'done' — the agent will produce another step after this.
      }

      // Reset per-step state for the next step
      this.fullText = ''
      this.toolCallNames = []
      return events
    }

    return []
  }

  consume(_data: string): AIEvent[] {
    return []
  }

  flush(): AIEvent[] {
    // Fallback: if OpenCode exits cleanly without emitting step_finish
    // (e.g. v1.14.45 in --format json --pure mode), we still need to
    // emit complete so the message is persisted. Without this, streaming
    // text renders briefly then disappears when 'done' clears it.
    if (this.completeEmitted) return []

    const events: AIEvent[] = []
    if (this.fullText) {
      events.push({
        type: 'complete',
        id: this.messageId,
        fullText: this.fullText
      })
    } else if (this.toolCallNames.length > 0) {
      const toolSummary = this.toolCallNames
        .map((name, i) => `${i + 1}. ${name}`)
        .join('\n')
      events.push({
        type: 'complete',
        id: this.messageId,
        fullText: `[工具调用完成]\n${toolSummary}`
      })
    }
    // Always emit 'done' in flush to signal turn end (matches step_finish behavior).
    // BaseCLIProvider / CursorProvider guards against duplicate 'done' via doneEmitted flag.
    events.push({ type: 'done', id: this.messageId })
    // Reset state after flush
    this.fullText = ''
    this.toolCallNames = []
    this.completeEmitted = true
    return events
  }

  beginTurn(): void {
    this.messageId = ''
    this.fullText = ''
    this.toolCallNames = []
    this.completeEmitted = false
  }

  resolveInteraction(): void {}
  cancelTurn(): void {}
}
