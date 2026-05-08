import type { AIEvent } from '../../types'
import type { OutputParser } from './output-parser'

interface KimiContentBlock {
  type: 'think' | 'text'
  think?: string
  text?: string
}

interface KimiToolCall {
  type: string
  id: string
  function: { name: string; arguments: string }
}

interface KimiMessage {
  role: 'assistant' | 'tool'
  content?: KimiContentBlock[]
  tool_calls?: KimiToolCall[]
  tool_call_id?: string
}

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

export class KimiOutputParser implements OutputParser {
  private messageId = ''
  private lineCount = 0
  private fullText = ''

  parseLine(line: string): AIEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let parsed: KimiMessage
    try {
      parsed = JSON.parse(trimmed) as KimiMessage
    } catch {
      return []
    }

    this.lineCount++
    if (!this.messageId) {
      this.messageId = `kimi-${Date.now()}-${this.lineCount}`
    }

    return this.parseMessage(parsed)
  }

  consume(_data: string): AIEvent[] {
    return []
  }

  flush(): AIEvent[] {
    if (!this.fullText) return []
    const events: AIEvent[] = [
      {
        type: 'complete',
        id: this.messageId,
        fullText: this.fullText
      },
      { type: 'done', id: this.messageId }
    ]
    this.fullText = ''
    return events
  }

  beginTurn(): void {
    this.messageId = ''
    this.lineCount = 0
    this.fullText = ''
  }

  resolveInteraction(): void {}
  cancelTurn(): void {}

  parseMessage(msg: KimiMessage): AIEvent[] {
    const events: AIEvent[] = []

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'think' && block.think) {
          splitIntoChunks(block.think, 100).forEach((delta) =>
            events.push({ type: 'thinking_delta', delta })
          )
        } else if (block.type === 'text' && block.text) {
          this.fullText += block.text
          splitIntoChunks(block.text, 50).forEach((delta) =>
            events.push({ type: 'text_delta', id: this.messageId, delta })
          )
        }
      }

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          events.push({
            type: 'tool_start',
            toolCallId: tc.id,
            toolName: tc.function.name,
            toolInput: tc.function.arguments
          })
        }
      }
    } else if (msg.role === 'tool') {
      events.push({
        type: 'tool_result',
        toolCallId: msg.tool_call_id ?? '',
        success: true,
        result: msg.content?.[0]?.text ?? ''
      })
    }

    return events
  }
}
