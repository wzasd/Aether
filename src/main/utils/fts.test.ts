import { describe, expect, it } from 'vitest'
import { buildFtsQuery } from './fts'

describe('buildFtsQuery', () => {
  it('quotes plain tokens and joins them with OR', () => {
    expect(buildFtsQuery('hello world')).toBe('"hello" OR "world"')
  })

  it('drops unsupported FTS syntax characters', () => {
    expect(buildFtsQuery('"foo" OR bar*')).toBe('"foo" OR "OR" OR "bar"')
  })

  it('supports CJK tokens', () => {
    expect(buildFtsQuery('搜索 对话')).toBe('"搜索" OR "对话"')
  })

  it('limits token count', () => {
    expect(buildFtsQuery('a b c', 2)).toBe('"a" OR "b"')
  })

  it('returns empty string when there are no searchable tokens', () => {
    expect(buildFtsQuery('!*()')).toBe('')
  })
})
