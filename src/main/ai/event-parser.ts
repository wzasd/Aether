import type { AIEvent, UsageInfo } from './types'

export class EventParser {
  private toolNamesById = new Map<string, string>()
  private toolInputBuffers = new Map<number, { toolCallId: string; toolName: string; buffer: string }>()

  parseLine(line: string): AIEvent | AIEvent[] | null {
    if (!line.trim()) return null
    try {
      const data = JSON.parse(line)
      switch (data.type) {
        case 'system':
          if (data.subtype === 'init') return this.parseInit(data)
          return this.parseHook(data)
        case 'assistant':
          return this.parseAssistant(data)
        case 'stream_event':
          return this.parseStreamEvent(data)
        case 'user':
          return this.parseUser(data)
        case 'result':
          return this.parseResult(data)
        default:
          return null
      }
    } catch {
      return null
    }
  }

  private parseInit(data: any): AIEvent {
    return {
      type: 'system_init',
      sessionId: data.session_id,
      tools: data.tools
    } as any
  }

  private parseHook(data: any): AIEvent | null {
    const hookName: string = data.hook_name || ''
    if (hookName.includes('Subagent') || hookName.includes('Agent')) {
      if (data.subtype === 'hook_started' || hookName.includes('Start')) {
        return {
          type: 'subagent_started',
          agentId: data.uuid || data.session_id,
          agentType: 'subagent',
          name: hookName
        } as any
      }
      if (data.subtype === 'hook_response' || hookName.includes('Stop')) {
        return {
          type: 'subagent_completed',
          agentId: data.uuid || data.session_id,
          result: data.output ? String(data.output).slice(0, 200) : undefined
        } as any
      }
    }
    return null
  }

  private parseAssistant(data: any): AIEvent | AIEvent[] | null {
    const content: any[] = data.message?.content
    if (!Array.isArray(content) || content.length === 0) return null
    const events: AIEvent[] = []

    for (const block of content) {
      const event = this.parseAssistantBlock(block, data.uuid || '')
      if (!event) continue
      if (Array.isArray(event)) {
        events.push(...event)
      } else {
        events.push(event)
      }
    }

    return events.length === 0 ? null : events
  }

  private parseUser(data: any): AIEvent | AIEvent[] | null {
    const content: any[] = data.message?.content
    if (!Array.isArray(content) || content.length === 0) return null
    const events: AIEvent[] = []

    for (const block of content) {
      if (block.type !== 'tool_result') continue

      const toolCallId = block.tool_use_id || ''
      const rawResult = this.stringifyContent(block.content)
      events.push({
        type: 'tool_result',
        toolCallId,
        success: !block.is_error,
        result: rawResult
      })

      const toolName = this.toolNamesById.get(toolCallId)
      if (toolName === 'TodoWrite') {
        const todos = this.parseTodoPayload(block.content)
        if (todos) {
          events.push({
            type: 'todo_updated',
            todos
          } as AIEvent)
        }
      }
    }

    return events.length === 0 ? null : events
  }

  private parseResult(data: any): AIEvent[] | null {
    const events: AIEvent[] = []
    if (data.subtype === 'success') {
      events.push({
        type: 'complete',
        id: data.session_id || '',
        fullText: typeof data.result === 'string' ? data.result : '',
        usage: this.extractUsage(data),
        costUsd: data.total_cost_usd
      })
      events.push({ type: 'done', id: data.session_id || '' })
    } else if (data.subtype?.startsWith('error')) {
      events.push({ type: 'error', error: data.error || data.subtype })
      events.push({ type: 'done', id: data.session_id || '' })
    } else {
      events.push({ type: 'done', id: data.session_id || '' })
    }
    return events as any
  }

  private extractUsage(data: any): UsageInfo | undefined {
    const raw = data.usage
    if (!raw) return undefined
    return {
      inputTokens: raw.input_tokens || 0,
      outputTokens: raw.output_tokens || 0,
      cacheReadTokens: raw.cache_read_input_tokens || undefined,
      cacheCreationTokens: raw.cache_creation_input_tokens || undefined
    }
  }

  private parseAssistantBlock(block: any, messageId: string): AIEvent | AIEvent[] | null {
    switch (block.type) {
      case 'text':
        return { type: 'text_delta', id: messageId, delta: block.text || '' }
      case 'thinking':
        return { type: 'thinking_delta', delta: block.thinking || '' }
      case 'tool_use': {
        const toolCallId = block.id || ''
        const toolName = block.name || ''
        if (toolCallId) {
          this.toolNamesById.set(toolCallId, toolName)
        }
        return {
          type: 'tool_start',
          toolCallId,
          toolName,
          toolInput: typeof block.input === 'string' ? block.input : JSON.stringify(block.input)
        }
      }
      default:
        return null
    }
  }

  private parseStreamEvent(data: any): AIEvent | AIEvent[] | null {
    const event = data.event
    if (!event || typeof event !== 'object') return null

    if (event.type === 'content_block_start') {
      const block = event.content_block
      if (block?.type === 'tool_use' && typeof event.index === 'number') {
        this.toolInputBuffers.set(event.index, {
          toolCallId: block.id || '',
          toolName: block.name || '',
          buffer: ''
        })
      }
      return this.parseAssistantBlock(event.content_block, data.uuid || '')
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta?.type === 'text_delta') {
        return { type: 'text_delta', id: data.uuid || '', delta: delta.text || '' }
      }
      if (delta?.type === 'thinking_delta') {
        return { type: 'thinking_delta', delta: delta.thinking || '' }
      }
      if (delta?.type === 'input_json_delta' && typeof event.index === 'number') {
        const entry = this.toolInputBuffers.get(event.index)
        if (entry && delta.partial_json) {
          entry.buffer += delta.partial_json
          try {
            const parsed = JSON.parse(entry.buffer)
            return {
              type: 'tool_start',
              toolCallId: entry.toolCallId,
              toolName: entry.toolName,
              toolInput: typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
            } as AIEvent
          } catch {
            // partial JSON, wait for more deltas
          }
        }
      }
    }

    return null
  }

  private stringifyContent(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
            return item.text
          }
          return JSON.stringify(item)
        })
        .join('\n')
    }
    return JSON.stringify(content)
  }

  private parseTodoPayload(content: unknown):
    | Array<{ content: string; status: string; activeForm?: string }>
    | null {
    const candidates: unknown[] = []

    if (Array.isArray(content)) {
      candidates.push(...content)
    } else {
      candidates.push(content)
    }

    for (const candidate of candidates) {
      let value: unknown = candidate

      if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
        value = value.text
      }

      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          continue
        }
      }

      if (Array.isArray(value)) {
        const todos = value
          .filter((item) => item && typeof item === 'object' && 'content' in item && 'status' in item)
          .map((item: any) => ({
            content: String(item.content),
            status: String(item.status),
            activeForm: item.activeForm ? String(item.activeForm) : undefined
          }))
        if (todos.length > 0) {
          return todos
        }
      }

      if (value && typeof value === 'object' && Array.isArray((value as any).todos)) {
        const todos = (value as any).todos
          .filter((item: any) => item && typeof item === 'object' && item.content && item.status)
          .map((item: any) => ({
            content: String(item.content),
            status: String(item.status),
            activeForm: item.activeForm ? String(item.activeForm) : undefined
          }))
        if (todos.length > 0) {
          return todos
        }
      }
    }

    return null
  }
}
