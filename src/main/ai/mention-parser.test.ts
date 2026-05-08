import { describe, it, expect } from 'vitest'
import { parseMentions, hasMentions, stripMentionSegments } from './mention-parser'

const KNOWN = ['Coder', 'Planner', 'Reviewer']

describe('parseMentions', () => {
  it('returns empty array when text is empty', () => {
    expect(parseMentions('', KNOWN)).toEqual([])
  })

  it('returns empty array when knownAgentNames is empty', () => {
    expect(parseMentions('@Coder: do something', [])).toEqual([])
  })

  it('parses a single mention at line start', () => {
    const result = parseMentions('@Coder: write a function', KNOWN)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ agentName: 'Coder', taskContent: 'write a function' })
  })

  it('parses a single mention with space-delimited task content', () => {
    const result = parseMentions('@Coder write a function', KNOWN)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ agentName: 'Coder', taskContent: 'write a function' })
  })

  it('parses a single mention with a Chinese colon delimiter', () => {
    const result = parseMentions('@Coder：写一个函数', KNOWN)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ agentName: 'Coder', taskContent: '写一个函数' })
  })

  it('parses a single mention after whitespace', () => {
    const result = parseMentions('hey there @Coder: fix the bug', KNOWN)
    expect(result).toHaveLength(1)
    expect(result[0].agentName).toBe('Coder')
    expect(result[0].taskContent).toBe('fix the bug')
  })

  it('parses multiple mentions', () => {
    const text = '@Planner: plan the feature\n@Coder: implement it'
    const result = parseMentions(text, KNOWN)
    expect(result).toHaveLength(2)
    expect(result[0].agentName).toBe('Planner')
    expect(result[1].agentName).toBe('Coder')
  })

  it('parses multiple space-delimited mentions', () => {
    const text = '@Planner plan the feature\n@Coder implement it'
    const result = parseMentions(text, KNOWN)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ agentName: 'Planner', taskContent: 'plan the feature' })
    expect(result[1]).toEqual({ agentName: 'Coder', taskContent: 'implement it' })
  })

  it('is case-insensitive for agent names', () => {
    const result = parseMentions('@coder: lowercase mention', KNOWN)
    expect(result).toHaveLength(1)
    expect(result[0].agentName).toBe('Coder')
  })

  it('ignores mentions for unknown agents', () => {
    const result = parseMentions('@Unknown: do something', KNOWN)
    expect(result).toEqual([])
  })

  it('trims whitespace from task content', () => {
    const result = parseMentions('@Reviewer:   lots of whitespace   ', KNOWN)
    expect(result[0].taskContent).toBe('lots of whitespace')
  })

  it('preserves multiline task content', () => {
    const text = '@Coder: line one\nline two\nline three'
    const result = parseMentions(text, KNOWN)
    expect(result).toHaveLength(1)
    expect(result[0].taskContent).toContain('line one')
    expect(result[0].taskContent).toContain('line two')
  })

  it('ignores @mention embedded in a word (no preceding space)', () => {
    // "hello@Coder:" — no space before @
    const result = parseMentions('hello@Coder: do something', KNOWN)
    expect(result).toEqual([])
  })

  it('does not capture empty task content', () => {
    const result = parseMentions('@Coder: ', KNOWN)
    expect(result).toEqual([])
  })
})

describe('hasMentions', () => {
  it('returns true when a mention is present', () => {
    expect(hasMentions('@Coder: do it', KNOWN)).toBe(true)
  })

  it('returns true for space-delimited mentions', () => {
    expect(hasMentions('@Coder do it', KNOWN)).toBe(true)
  })

  it('returns false when no mentions present', () => {
    expect(hasMentions('no mentions here', KNOWN)).toBe(false)
  })
})

describe('stripMentionSegments', () => {
  it('removes colon-delimited mention tasks from primary content', () => {
    expect(stripMentionSegments('primary text @Coder: delegated task')).toBe('primary text')
  })

  it('removes space-delimited mention tasks from primary content', () => {
    expect(stripMentionSegments('@Coder delegated task')).toBe('')
  })

  it('removes multiple mention task segments', () => {
    expect(stripMentionSegments('primary @Planner plan it @Coder build it')).toBe('primary')
  })
})
