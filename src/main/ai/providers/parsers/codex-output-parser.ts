import type { AIEvent } from '../../types'
import type { OutputParser } from './output-parser'

interface CodexItem {
  id: string
  type: string
  text?: string
}

interface CodexLine {
  type: string
  thread_id?: string
  item?: CodexItem
  usage?: { input_tokens?: number; output_tokens?: number }
}

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

export class CodexOutputParser implements OutputParser {
  private messageId = ''
  private fullText = ''

  parseLine(line: string): AIEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []

    let parsed: CodexLine
    try {
      parsed = JSON.parse(trimmed) as CodexLine
    } catch {
      return []
    }

    if (parsed.type === 'thread.started') {
      this.messageId = parsed.thread_id || ''
      return []
    }

    if (parsed.type === 'item.completed' && parsed.item) {
      return this.parseItem(parsed.item)
    }

    if (parsed.type === 'turn.completed') {
      const events: AIEvent[] = []
      events.push({
        type: 'complete',
        id: this.messageId,
        fullText: this.fullText,
        usage: parsed.usage
          ? {
              inputTokens: parsed.usage.input_tokens ?? 0,
              outputTokens: parsed.usage.output_tokens ?? 0
            }
          : undefined
      })
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

  beginTurn(): void {}
  resolveInteraction(): void {}
  cancelTurn(): void {}

  private parseItem(item: CodexItem): AIEvent[] {
    if (item.type !== 'agent_message' || !item.text) return []
    this.fullText += item.text
    const chunks = splitIntoChunks(item.text, 50)
    return chunks.map((delta) => ({
      type: 'text_delta' as const,
      id: item.id,
      delta
    }))
  }
}
