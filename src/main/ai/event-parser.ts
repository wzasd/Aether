import type { AIEvent, UsageInfo } from './types'

export class EventParser {
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

  private parseAssistant(data: any): AIEvent | null {
    const content: any[] = data.message?.content
    if (!Array.isArray(content) || content.length === 0) return null
    const block = content[0]
    switch (block.type) {
      case 'text':
        return { type: 'text_delta', id: data.uuid || '', delta: block.text || '' }
      case 'thinking':
        return { type: 'thinking_delta', delta: block.thinking || '' }
      case 'tool_use':
        return {
          type: 'tool_start',
          toolCallId: block.id || '',
          toolName: block.name || '',
          toolInput: typeof block.input === 'string' ? block.input : JSON.stringify(block.input)
        }
      default:
        return null
    }
  }

  private parseUser(data: any): AIEvent | null {
    const content: any[] = data.message?.content
    if (!Array.isArray(content) || content.length === 0) return null
    const block = content[0]
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        toolCallId: block.tool_use_id || '',
        success: !block.is_error,
        result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
      }
    }
    return null
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
}
