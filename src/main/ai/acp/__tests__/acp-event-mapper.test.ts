import { describe, it, expect } from 'vitest'
import type { PermissionRequestEvent, ToolResultEvent } from '../../types'
import {
  acpSessionUpdateToEvents,
  makeCompleteEvent,
  makeDoneEvent,
  makeErrorEvent,
  makePermissionRequestEvent,
} from '../acp-event-mapper'

// ─── acpSessionUpdateToEvents ──────────────────────────────────────────────

describe('acpSessionUpdateToEvents', () => {
  const sid = 'bytro-session-1'

  it('returns empty array when update is missing', () => {
    expect(acpSessionUpdateToEvents({}, sid)).toEqual([])
  })

  it('returns empty array for unknown sessionUpdate types', () => {
    const params = { update: { sessionUpdate: 'usage_update', tokens: { input: 100, output: 50 } } }
    expect(acpSessionUpdateToEvents(params, sid)).toEqual([])
  })

  describe('agent_message_chunk', () => {
    it('maps text content to text_delta event', () => {
      const params = {
        sessionId: 'acp-sid',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello world' },
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([{ type: 'text_delta', id: sid, delta: 'Hello world' }])
    })

    it('skips non-text content (e.g. tool_use blocks)', () => {
      const params = {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'tool_use', id: 't1', name: 'Bash' },
        },
      }
      expect(acpSessionUpdateToEvents(params, sid)).toEqual([])
    })

    it('skips text content with empty string', () => {
      const params = {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '' },
        },
      }
      expect(acpSessionUpdateToEvents(params, sid)).toEqual([])
    })
  })

  describe('agent_thought_chunk', () => {
    it('maps to thinking_delta event', () => {
      const params = {
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { text: 'Let me think about this...' },
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([{ type: 'thinking_delta', delta: 'Let me think about this...' }])
    })

    it('skips empty thought text', () => {
      const params = {
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { text: '' },
        },
      }
      expect(acpSessionUpdateToEvents(params, sid)).toEqual([])
    })
  })

  describe('tool_call', () => {
    it('maps pending status to tool_start', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc1',
          title: 'Bash',
          status: 'pending',
          kind: 'bash',
          rawInput: { command: 'ls' },
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        {
          type: 'tool_start',
          toolCallId: 'tc1',
          toolName: 'Bash',
          toolInput: '{"command":"ls"}',
        },
      ])
    })

    it('maps in_progress status to tool_start', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc2',
          title: 'Read',
          status: 'in_progress',
          kind: 'read',
          rawInput: { file_path: '/foo.txt' },
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolCallId: 'tc2',
        toolName: 'Read',
      })
    })

    it('maps completed status to tool_result with success:true', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc3',
          title: 'Bash',
          status: 'completed',
          kind: 'bash',
          content: [
            { type: 'content', content: { type: 'text', text: 'file1.txt\nfile2.txt' } },
          ],
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        {
          type: 'tool_result',
          toolCallId: 'tc3',
          success: true,
          result: 'file1.txt\nfile2.txt',
        },
      ])
    })

    it('maps failed status to tool_result with success:false', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc4',
          title: 'WebFetch',
          status: 'failed',
          kind: 'fetch',
          content: [
            { type: 'content', content: { type: 'text', text: 'Connection refused' } },
          ],
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        {
          type: 'tool_result',
          toolCallId: 'tc4',
          success: false,
          result: 'Connection refused',
        },
      ])
    })

    it('handles missing content in completed tool_call', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc5',
          title: 'Bash',
          status: 'completed',
          kind: 'bash',
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        { type: 'tool_result', toolCallId: 'tc5', success: true, result: '' },
      ])
    })

    it('defaults rawInput to {} when missing', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc6',
          title: 'Glob',
          status: 'pending',
          kind: 'search',
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events[0]).toMatchObject({ toolInput: '{}' })
    })
  })

  describe('tool_call_update', () => {
    it('maps completed update to tool_result', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc7',
          status: 'completed',
          content: [
            { type: 'content', content: { type: 'text', text: 'Output here' } },
          ],
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        { type: 'tool_result', toolCallId: 'tc7', success: true, result: 'Output here' },
      ])
    })

    it('maps in_progress update to tool_result with success:false', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc8',
          status: 'in_progress',
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        { type: 'tool_result', toolCallId: 'tc8', success: false, result: '' },
      ])
    })

    it('joins multiple content items with newlines', () => {
      const params = {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc9',
          status: 'completed',
          content: [
            { type: 'content', content: { type: 'text', text: 'Line 1' } },
            { type: 'diff', content: { type: 'text', text: 'diff content' } },
            { type: 'content', content: { type: 'text', text: 'Line 3' } },
          ],
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect((events[0] as ToolResultEvent).result).toBe('Line 1\nLine 3')
    })
  })

  describe('plan', () => {
    it('maps plan entries to todo_updated', () => {
      const params = {
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'Add login page', status: 'pending' },
            { content: 'Add dashboard', status: 'completed' },
          ],
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([
        {
          type: 'todo_updated',
          todos: [
            { content: 'Add login page', status: 'pending' },
            { content: 'Add dashboard', status: 'completed' },
          ],
        },
      ])
    })

    it('handles empty entries array', () => {
      const params = { update: { sessionUpdate: 'plan', entries: [] } }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toEqual([{ type: 'todo_updated', todos: [] }])
    })
  })

  describe('multiple events', () => {
    it('returns only the first matched event type', () => {
      // A single session update maps to exactly one event case (switch fall-through)
      const params = {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hi' },
        },
      }
      const events = acpSessionUpdateToEvents(params, sid)
      expect(events).toHaveLength(1)
    })
  })
})

// ─── makeCompleteEvent ─────────────────────────────────────────────────────

describe('makeCompleteEvent', () => {
  it('returns complete event with full text', () => {
    const event = makeCompleteEvent('sid-1', 'Full response text')
    expect(event).toEqual({ type: 'complete', id: 'sid-1', fullText: 'Full response text' })
  })

  it('accepts empty full text', () => {
    const event = makeCompleteEvent('sid-2', '')
    expect(event).toEqual({ type: 'complete', id: 'sid-2', fullText: '' })
  })
})

// ─── makeDoneEvent ─────────────────────────────────────────────────────────

describe('makeDoneEvent', () => {
  it('returns done event', () => {
    expect(makeDoneEvent('sid-3')).toEqual({ type: 'done', id: 'sid-3' })
  })
})

// ─── makeErrorEvent ────────────────────────────────────────────────────────

describe('makeErrorEvent', () => {
  it('returns error event with message', () => {
    expect(makeErrorEvent('Something went wrong')).toEqual({
      type: 'error',
      error: 'Something went wrong',
    })
  })
})

// ─── makePermissionRequestEvent ────────────────────────────────────────────

describe('makePermissionRequestEvent', () => {
  it('maps toolCall params to permission_request', () => {
    const params = {
      toolCall: {
        toolCallId: 'tc10',
        title: 'Bash',
        rawInput: { command: 'rm -rf /' },
      },
    }
    const event = makePermissionRequestEvent(params, 'sid-4') as PermissionRequestEvent
    expect(event.type).toBe('permission_request')
    expect(event.id).toBe('sid-4')
    expect(event.toolName).toBe('Bash')
    expect(JSON.parse(event.toolInput)).toEqual({ command: 'rm -rf /' })
    expect(typeof event.confirmId).toBe('string')
    expect(event.confirmId.length).toBeGreaterThan(0)
  })

  it('defaults toolName to tool_call when title is missing', () => {
    const params = { toolCall: { toolCallId: 'tc11', rawInput: {} } }
    const event = makePermissionRequestEvent(params, 'sid-5') as PermissionRequestEvent
    expect(event.toolName).toBe('tool_call')
  })

  it('defaults toolCallId to a random UUID when missing', () => {
    const params = { toolCall: { title: 'Bash' } }
    const event = makePermissionRequestEvent(params, 'sid-6') as PermissionRequestEvent
    // PermissionRequestEvent doesn't carry toolCallId — confirmId is the generated one
    expect(typeof event.confirmId).toBe('string')
  })

  it('handles missing toolCall entirely', () => {
    const event = makePermissionRequestEvent({}, 'sid-7') as PermissionRequestEvent
    expect(event.type).toBe('permission_request')
    expect(event.toolName).toBe('tool_call')
    expect(event.toolInput).toBe('')
    expect(typeof event.confirmId).toBe('string')
  })

  it('generates unique confirmIds for successive calls', () => {
    const e1 = makePermissionRequestEvent({ toolCall: { title: 'A' } }, 'sid') as PermissionRequestEvent
    const e2 = makePermissionRequestEvent({ toolCall: { title: 'B' } }, 'sid') as PermissionRequestEvent
    expect(e1.confirmId).not.toBe(e2.confirmId)
  })
})
