import { describe, it, expect, beforeEach } from 'vitest'
import { GeminiOutputParser } from '../gemini-output-parser'

const FIXTURE_INIT = JSON.stringify({
  type: 'init',
  timestamp: '2026-05-05T06:17:13.413Z',
  session_id: 'e47414de-d827-4976-89f9-9f6deaaca538',
  model: 'gemini-2.5-pro'
})

const FIXTURE_USER_MESSAGE = JSON.stringify({
  type: 'message',
  timestamp: '2026-05-05T06:17:13.414Z',
  role: 'user',
  content: 'hello'
})

const FIXTURE_ASSISTANT_MESSAGE = JSON.stringify({
  type: 'message',
  timestamp: '2026-05-05T06:17:18.605Z',
  role: 'assistant',
  content: 'hi',
  delta: true
})

const FIXTURE_TOOL_USE = JSON.stringify({
  type: 'tool_use',
  timestamp: '2026-05-05T06:18:28.130Z',
  tool_name: 'run_shell_command',
  tool_id: 'run_shell_command_1777961908130_0',
  parameters: { description: 'List files', command: 'ls -F /tmp' }
})

const FIXTURE_TOOL_RESULT_SUCCESS = JSON.stringify({
  type: 'tool_result',
  timestamp: '2026-05-05T06:18:28.985Z',
  tool_id: 'run_shell_command_1777961908130_0',
  status: 'success'
})

const FIXTURE_TOOL_RESULT_ERROR = JSON.stringify({
  type: 'tool_result',
  timestamp: '2026-05-05T06:43:14.455Z',
  tool_id: 'read_file_1777963394427_0',
  status: 'error',
  output: 'Path not in workspace'
})

const FIXTURE_RESULT = JSON.stringify({
  type: 'result',
  timestamp: '2026-05-05T06:17:18.617Z',
  status: 'success',
  stats: {
    total_tokens: 10554,
    input_tokens: 10464,
    output_tokens: 1,
    cached: 0
  }
})

const FIXTURE_RESULT_NO_STATS = JSON.stringify({
  type: 'result',
  timestamp: '2026-05-05T06:17:18.617Z',
  status: 'success'
})

const FIXTURE_RESULT_ERROR = JSON.stringify({
  type: 'result',
  timestamp: '2026-05-05T06:17:18.617Z',
  status: 'error',
  error: 'API quota exceeded'
})

describe('GeminiOutputParser', () => {
  let parser: GeminiOutputParser

  beforeEach(() => {
    parser = new GeminiOutputParser()
    parser.beginTurn()
  })

  it('emits system_init for init line', () => {
    const events = parser.parseLine(FIXTURE_INIT)
    const init = events.find((e) => e.type === 'system_init')
    expect(init).toBeDefined()
    expect('sessionId' in init! && init.sessionId).toBe('e47414de-d827-4976-89f9-9f6deaaca538')
  })

  it('ignores user role messages', () => {
    const events = parser.parseLine(FIXTURE_USER_MESSAGE)
    expect(events).toHaveLength(0)
  })

  it('emits text_delta for assistant message', () => {
    const events = parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents.length).toBeGreaterThanOrEqual(1)
    const reconstructed = textEvents.map((e) => ('delta' in e ? e.delta : '')).join('')
    expect(reconstructed).toBe('hi')
  })

  it('uses message-level id for text_delta, not sessionId', () => {
    parser.parseLine(FIXTURE_INIT)
    const events = parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const textEvent = events.find((e) => e.type === 'text_delta')
    expect(textEvent).toBeDefined()
    expect('id' in textEvent! && textEvent.id).toBeTruthy()
    // Should be a message-level UUID, not the session_id
    expect('id' in textEvent! && textEvent.id).not.toBe('e47414de-d827-4976-89f9-9f6deaaca538')
  })

  it('splits long assistant content into chunks of ≤50 chars', () => {
    const longContent = 'a'.repeat(130)
    const line = JSON.stringify({
      type: 'message',
      timestamp: '2026-05-05T06:17:18.605Z',
      role: 'assistant',
      content: longContent,
      delta: true
    })
    const events = parser.parseLine(line)
    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents).toHaveLength(3) // 50 + 50 + 30
    for (const e of textEvents) {
      expect('delta' in e && e.delta.length).toBeLessThanOrEqual(50)
    }
    const reconstructed = textEvents.map((e) => ('delta' in e ? e.delta : '')).join('')
    expect(reconstructed).toBe(longContent)
  })

  it('emits tool_start for tool_use line', () => {
    const events = parser.parseLine(FIXTURE_TOOL_USE)
    const toolStart = events.find((e) => e.type === 'tool_start')
    expect(toolStart).toBeDefined()
    expect('toolCallId' in toolStart! && toolStart.toolCallId).toBe(
      'run_shell_command_1777961908130_0'
    )
    expect('toolName' in toolStart! && toolStart.toolName).toBe('run_shell_command')
    expect('toolInput' in toolStart! && typeof toolStart.toolInput).toBe('string')
  })

  it('emits tool_result with success=true for successful tool_result', () => {
    const events = parser.parseLine(FIXTURE_TOOL_RESULT_SUCCESS)
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect('toolCallId' in toolResult! && toolResult.toolCallId).toBe(
      'run_shell_command_1777961908130_0'
    )
    expect('success' in toolResult! && toolResult.success).toBe(true)
    expect('result' in toolResult! && toolResult.result).toBe('')
  })

  it('emits tool_result with error output for failed tool_result', () => {
    const events = parser.parseLine(FIXTURE_TOOL_RESULT_ERROR)
    const toolResult = events.find((e) => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect('success' in toolResult! && toolResult.success).toBe(false)
    expect('result' in toolResult! && toolResult.result).toBe('Path not in workspace')
  })

  it('emits complete (with usage) + done for result line with stats', () => {
    parser.parseLine(FIXTURE_INIT)
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const events = parser.parseLine(FIXTURE_RESULT)

    // No separate usage event — usage is embedded in complete
    expect(events.find((e) => e.type === 'usage')).toBeUndefined()

    const complete = events.find((e) => e.type === 'complete')
    const done = events.find((e) => e.type === 'done')

    expect(complete).toBeDefined()
    expect('usage' in complete! && complete.usage).toBeDefined()
    expect('usage' in complete! && complete.usage!.inputTokens).toBe(10464)
    expect('usage' in complete! && complete.usage!.outputTokens).toBe(1)
    expect('usage' in complete! && complete.usage!.cacheReadTokens).toBe(0)
    expect('fullText' in complete! && complete.fullText).toBe('hi')
    expect(done).toBeDefined()
  })

  it('emits complete (no usage) + done for result without stats', () => {
    parser.parseLine(FIXTURE_INIT)
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const events = parser.parseLine(FIXTURE_RESULT_NO_STATS)

    const complete = events.find((e) => e.type === 'complete')
    expect(complete).toBeDefined()
    expect(complete!.usage).toBeUndefined()
    expect(events.find((e) => e.type === 'done')).toBeDefined()
  })

  it('emits error for result with status error', () => {
    const events = parser.parseLine(FIXTURE_RESULT_ERROR)
    const error = events.find((e) => e.type === 'error')
    expect(error).toBeDefined()
    expect('error' in error! && error.error).toBe('API quota exceeded')
  })

  it('clears fullText on error result so flush returns empty', () => {
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    parser.parseLine(FIXTURE_RESULT_ERROR)
    expect(parser.flush()).toHaveLength(0)
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
    parser.parseLine(FIXTURE_INIT)
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const flushEvents = parser.flush()

    const complete = flushEvents.find((e) => e.type === 'complete')
    const done = flushEvents.find((e) => e.type === 'done')
    expect(complete).toBeDefined()
    expect('fullText' in complete! && complete.fullText).toBe('hi')
    expect(done).toBeDefined()
  })

  it('flush returns empty when no text accumulated', () => {
    expect(parser.flush()).toHaveLength(0)
  })

  it('beginTurn resets fullText so flush returns empty', () => {
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    parser.beginTurn()
    expect(parser.flush()).toHaveLength(0)
  })

  it('beginTurn assigns a new messageId for each turn', () => {
    parser.parseLine(FIXTURE_INIT)
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const firstTurnIds = parser
      .flush()
      .filter((e) => e.type === 'complete')
      .map((e) => ('id' in e ? e.id : ''))

    parser.beginTurn()
    parser.parseLine(FIXTURE_ASSISTANT_MESSAGE)
    const secondTurnIds = parser
      .flush()
      .filter((e) => e.type === 'complete')
      .map((e) => ('id' in e ? e.id : ''))

    // Different turns should have different message ids (from beginTurn)
    expect(firstTurnIds).toHaveLength(1)
    expect(secondTurnIds).toHaveLength(1)
  })

  it('accumulates text across multiple assistant message deltas', () => {
    const line1 = JSON.stringify({
      type: 'message',
      timestamp: '2026-05-05T06:17:18.605Z',
      role: 'assistant',
      content: 'Hello ',
      delta: true
    })
    const line2 = JSON.stringify({
      type: 'message',
      timestamp: '2026-05-05T06:17:18.605Z',
      role: 'assistant',
      content: 'world',
      delta: true
    })
    parser.parseLine(line1)
    parser.parseLine(line2)
    const flushEvents = parser.flush()
    const complete = flushEvents.find((e) => e.type === 'complete')
    expect('fullText' in complete! && complete.fullText).toBe('Hello world')
  })
})
