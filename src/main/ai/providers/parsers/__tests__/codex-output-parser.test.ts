import { describe, it, expect, beforeEach } from 'vitest'
import { CodexOutputParser } from '../codex-output-parser'

const FIXTURE_LINES = [
  '{"type":"thread.started","thread_id":"thread_abc123"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"msg_001","type":"agent_message","text":"Hello, I can help with that."}}',
  '{"type":"turn.completed","usage":{"input_tokens":26527,"output_tokens":14}}'
]

describe('CodexOutputParser', () => {
  let parser: CodexOutputParser

  beforeEach(() => {
    parser = new CodexOutputParser()
  })

  it('ignores thread.started lines (no events)', () => {
    const events = parser.parseLine(FIXTURE_LINES[0])
    expect(events).toHaveLength(0)
  })

  it('ignores turn.started lines (no events)', () => {
    const events = parser.parseLine(FIXTURE_LINES[1])
    expect(events).toHaveLength(0)
  })

  it('splits item.completed text into text_delta chunks', () => {
    parser.parseLine(FIXTURE_LINES[0]) // set thread_id
    const events = parser.parseLine(FIXTURE_LINES[2])
    const deltas = events.filter((e) => e.type === 'text_delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    const reconstructed = deltas.map((e) => ('delta' in e ? e.delta : '')).join('')
    expect(reconstructed).toBe('Hello, I can help with that.')
  })

  it('emits correct number of chunks for 50-char split', () => {
    // text is 28 chars → 1 chunk
    const events = parser.parseLine(FIXTURE_LINES[2])
    const deltas = events.filter((e) => e.type === 'text_delta')
    expect(deltas).toHaveLength(1)
  })

  it('splits long text into multiple chunks of ≤50 chars each', () => {
    const longText = 'a'.repeat(130)
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'msg_long', type: 'agent_message', text: longText }
    })
    const events = parser.parseLine(line)
    const deltas = events.filter((e) => e.type === 'text_delta')
    expect(deltas).toHaveLength(3) // 50 + 50 + 30
    for (const d of deltas) {
      expect('delta' in d && d.delta.length).toBeLessThanOrEqual(50)
    }
    const reconstructed = deltas.map((e) => ('delta' in e ? e.delta : '')).join('')
    expect(reconstructed).toBe(longText)
  })

  it('emits complete + done on turn.completed with accumulated fullText', () => {
    FIXTURE_LINES.slice(0, 3).forEach((l) => parser.parseLine(l))
    const events = parser.parseLine(FIXTURE_LINES[3])
    const complete = events.find((e) => e.type === 'complete')
    const done = events.find((e) => e.type === 'done')
    expect(complete).toBeDefined()
    expect('fullText' in complete! && complete.fullText).toBe('Hello, I can help with that.')
    expect('usage' in complete! && complete.usage).toEqual({
      inputTokens: 26527,
      outputTokens: 14
    })
    expect(done).toBeDefined()
  })

  it('resets fullText after turn.completed', () => {
    FIXTURE_LINES.slice(0, 3).forEach((l) => parser.parseLine(l))
    parser.parseLine(FIXTURE_LINES[3])
    // After a completed turn, fullText should be reset
    expect(parser.flush()).toHaveLength(0)
  })

  it('emits complete without usage when turn.completed has no usage field', () => {
    const line = JSON.stringify({ type: 'turn.completed' })
    const events = parser.parseLine(line)
    const complete = events.find((e) => e.type === 'complete')
    expect(complete).toBeDefined()
    expect('usage' in complete! && complete.usage).toBeUndefined()
  })

  it('ignores non-agent_message item types', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'x', type: 'system_event', text: 'irrelevant' }
    })
    const events = parser.parseLine(line)
    expect(events).toHaveLength(0)
  })

  it('ignores malformed JSON lines', () => {
    const events = parser.parseLine('not valid json {{')
    expect(events).toHaveLength(0)
  })

  it('ignores empty lines', () => {
    expect(parser.parseLine('')).toHaveLength(0)
    expect(parser.parseLine('   ')).toHaveLength(0)
  })

  it('consume always returns empty array (no PTY support)', () => {
    expect(parser.consume('some data')).toHaveLength(0)
  })
})
