import { randomUUID } from 'crypto'
import type { AIEvent } from '../types'
import type { AcpSessionUpdateKind, AcpToolCallContentItem } from './acp-types'

// Maps a single ACP session/update params object to zero or more AIEvents.
// The ACP session update comes in as:
//   { sessionId, update: { sessionUpdate: '...', ... } }
// We forward to the appropriate AIEvent type for Bytro's renderer.

export function acpSessionUpdateToEvents(
  params: Record<string, unknown>,
  bytroSessionId: string
): AIEvent[] {
  const update = params.update as AcpSessionUpdateKind | undefined
  if (!update) return []

  const events: AIEvent[] = []

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      if (update.content.type === 'text' && update.content.text) {
        events.push({
          type: 'text_delta',
          id: bytroSessionId,
          delta: update.content.text,
        })
      }
      break
    }

    case 'agent_thought_chunk': {
      if (update.content.text) {
        events.push({
          type: 'thinking_delta',
          delta: update.content.text,
        })
      }
      break
    }

    case 'tool_call': {
      // status 'pending' or 'in_progress' → tool_start
      if (update.status === 'pending' || update.status === 'in_progress') {
        events.push({
          type: 'tool_start',
          toolCallId: update.toolCallId,
          toolName: update.title,
          toolInput: JSON.stringify(update.rawInput ?? {}),
        })
      }
      // status 'completed' → tool_result
      if (update.status === 'completed') {
        const resultText = extractToolResultText(update.content)
        events.push({
          type: 'tool_result',
          toolCallId: update.toolCallId,
          success: true,
          result: resultText,
        })
      }
      if (update.status === 'failed') {
        const resultText = extractToolResultText(update.content)
        events.push({
          type: 'tool_result',
          toolCallId: update.toolCallId,
          success: false,
          result: resultText,
        })
      }
      break
    }

    case 'tool_call_update': {
      const resultText = extractToolResultText(update.content)
      events.push({
        type: 'tool_result',
        toolCallId: update.toolCallId,
        success: update.status === 'completed',
        result: resultText,
      })
      break
    }

    case 'plan': {
      events.push({
        type: 'todo_updated',
        todos: update.entries.map((e) => ({ content: e.content, status: e.status })),
      })
      break
    }

    case 'config_option_update': {
      events.push({
        type: 'config_option_update',
        configOptions: (update as unknown as { configOptions: Array<Record<string, unknown>> }).configOptions?.map((o) => ({
          id: String(o.id ?? ''),
          name: typeof o.name === 'string' ? o.name : undefined,
          label: typeof o.label === 'string' ? o.label : undefined,
          category: typeof o.category === 'string' ? o.category : undefined,
          type: String(o.type ?? 'select'),
          currentValue: typeof o.value === 'string' ? o.value : typeof o.currentValue === 'string' ? o.currentValue : undefined,
          options: Array.isArray(o.options) ? (o.options as Array<Record<string, unknown>>).map((v) => ({
            value: String(v.value ?? ''),
            name: typeof v.name === 'string' ? v.name : undefined,
          })) : undefined,
        })),
      })
      break
    }

    // usage_update, available_commands_update, user_message_chunk
    // are internal housekeeping — no AIEvent emitted
    default:
      break
  }

  return events
}

// Called when session/prompt response returns with stopReason === 'end_turn'
export function makeCompleteEvent(bytroSessionId: string, fullText: string): AIEvent {
  return {
    type: 'complete',
    id: bytroSessionId,
    fullText,
  }
}

export function makeDoneEvent(bytroSessionId: string): AIEvent {
  return { type: 'done', id: bytroSessionId }
}

export function makeErrorEvent(message: string): AIEvent {
  return { type: 'error', error: message }
}

export function makePermissionRequestEvent(
  params: Record<string, unknown>,
  bytroSessionId: string
): AIEvent {
  const toolCall = params.toolCall as Record<string, unknown> | undefined
  const toolCallId = typeof toolCall?.toolCallId === 'string' ? toolCall.toolCallId : randomUUID()
  const title = typeof toolCall?.title === 'string' ? toolCall.title : 'tool_call'
  const rawInput = (toolCall?.rawInput && typeof toolCall.rawInput === 'object')
    ? JSON.stringify(toolCall.rawInput)
    : ''

  return {
    type: 'permission_request',
    confirmId: randomUUID(),
    id: bytroSessionId,
    toolName: title,
    toolInput: rawInput,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractToolResultText(
  content: Array<AcpToolCallContentItem | { type: 'content'; content: { type: 'text'; text: string } }> | undefined
): string {
  if (!content) return ''
  return content
    .filter((c): c is { type: 'content'; content: { type: 'text'; text: string } } =>
      c.type === 'content' && typeof (c as { content?: { text?: string } }).content?.text === 'string'
    )
    .map((c) => c.content.text)
    .join('\n')
}
