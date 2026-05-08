import { describe, it, expect, beforeEach } from 'vitest'
import { KimiOutputParser } from '../kimi-output-parser'

const FIXTURE_THINK_AND_TEXT = JSON.stringify({
  role: 'assistant',
  content: [
    { type: 'think', think: 'Let me analyze the problem carefully.' },
    { type: 'text', text: 'Here is my solution.' }
  ]
})

const FIXTURE_TOOL_CALL = JSON.stringify({
  role: 'assistant',
  content: [{ type: 'text', text: "I'll run a command" }],
  tool_calls: [
    {
      type: 'function',
      id: 'tool_abc',
      function: { name: 'Shell', arguments: '{"command":"ls -la"}' }
    }
  ]
})

const FIXTURE_TOOL_RESULT = JSON.stringify({
  role: 'tool',
  content: [{ type: 'text', text: 'total 48\ndrwxr-xr-x ...' }],
  tool_call_id: 'tool_abc'
})

describe('KimiOutputParser', () => {
  let parser: KimiOutputParser

  beforeEach(() => {
    parser = new KimiOutputParser()
  })

  it('emits thinking_delta events for think blocks', () => {
    const events = parser.parseLine(FIXTURE_THINK_AND_TEXT)
    const thinkEvents = events.filter((e) => e.type === 'thinking_delta')
    expect(thinkEvents.length).toBeGreaterThanOrEqual(1)
    const reconstructed = thinkEvents
      .map((e) => ('delta' in e ? e.delta : ''))
      .join('')
    expect(reconstructed).toBe('Let me analyze the problem carefully.')
  })

  it('emits text_delta events for text blocks', () => {
    const events = parser.parseLine(FIXTURE_THINK_AND_TEXT)
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents.length).toBeGreaterThanOrEqual(1)
    const reconstructed = textEvents
      .map((e) => ('delta' in e ? e.delta : ''))
      .join('')
    expect(reconstructed).toBe('Here is my solution.')
  })

  it('emits thinking before text within the same message', () => {
    const events = parser.parseLine(FIXTURE_THINK_AND_TEXT)
    const firstThink = events.findIndex((e) => e.type === 'thinking_delta')
    const firstText = events.findIndex((e) => e.type === 'text_delta')
    expect(firstThink).toBeLessThan(firstText)
  })

  it('emits tool_start for tool_calls', () => {
    const events = parser.parseLine(FIXTURE_TOOL_CALL)
    const toolStart = events.find((e) => e.type === 'tool_start')
    expect(toolStart).toBeDefined()
    expect('toolCallId' in toolStart! && toolStart.toolCallId).toBe('tool_abc')
    expect('toolName' in toolStart! && toolStart.toolName).toBe('Shell')
    expect('toolInput' in toolStart! && toolStart.toolInput).toBe('{"command":"ls -la"}')
  })

  it('emits tool_start in addition to text deltas', () => {
    const events = parser.parseLine(FIXTURE_TOOL_CALL)
    expect(events.some((e) => e.type === 'text_delta')).toBe(true)
    expect(events.some((e) => e.type === 'tool_start')).toBe(true)
  })

  it('emits tool_result for role:tool messages', () => {
    const events = parser.parseLine(FIXTURE_TOOL_RESULT)
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect('toolCallId' in toolResult! && toolResult.toolCallId).toBe('tool_abc')
    expect('result' in toolResult! && toolResult.result).toBe('total 48\ndrwxr-xr-x ...')
    expect('success' in toolResult! && toolResult.success).toBe(true)
  })

  it('splits long think text into chunks of ≤100 chars', () => {
    const longThink = 'x'.repeat(250)
    const line = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'think', think: longThink }]
    })
    const events = parser.parseLine(line)
    const thinkEvents = events.filter((e) => e.type === 'thinking_delta')
    expect(thinkEvents).toHaveLength(3) // 100 + 100 + 50
    const reconstructed = thinkEvents
      .map((e) => ('delta' in e ? e.delta : ''))
      .join('')
    expect(reconstructed).toBe(longThink)
  })

  it('splits long text into chunks of ≤50 chars', () => {
    const longText = 'y'.repeat(120)
    const line = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: longText }]
    })
    const events = parser.parseLine(line)
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents).toHaveLength(3) // 50 + 50 + 20
    for (const e of textEvents) {
      expect('delta' in e && e.delta.length).toBeLessThanOrEqual(50)
    }
  })

  it('ignores malformed JSON', () => {
    expect(parser.parseLine('not json')).toHaveLength(0)
  })

  it('ignores empty lines', () => {
    expect(parser.parseLine('')).toHaveLength(0)
  })

  it('consume always returns empty array', () => {
    expect(parser.consume('data')).toHaveLength(0)
  })

  it('flush emits complete + done with accumulated fullText', () => {
    parser.parseLine(FIXTURE_THINK_AND_TEXT)
    const flushEvents = parser.flush()
    const complete = flushEvents.find((e) => e.type === 'complete')
    const done = flushEvents.find((e) => e.type === 'done')
    expect(complete).toBeDefined()
    expect('fullText' in complete! && complete.fullText).toBe('Here is my solution.')
    expect(done).toBeDefined()
  })

  it('flush returns empty when no text was accumulated', () => {
    expect(parser.flush()).toHaveLength(0)
  })

  it('beginTurn resets fullText so flush returns empty', () => {
    parser.parseLine(FIXTURE_THINK_AND_TEXT)
    parser.beginTurn()
    expect(parser.flush()).toHaveLength(0)
  })
})
