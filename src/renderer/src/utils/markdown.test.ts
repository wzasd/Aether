import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks, parseInlineSpans } from './markdown'
import type { MarkdownBlock, InlineSpan } from './markdown'

describe('parseMarkdownBlocks', () => {
  it('parses h1 heading', () => {
    const blocks = parseMarkdownBlocks('# Title')
    expect(blocks).toEqual<MarkdownBlock[]>([{ type: 'h1', content: 'Title' }])
  })

  it('parses h2 heading', () => {
    const blocks = parseMarkdownBlocks('## Section')
    expect(blocks).toEqual<MarkdownBlock[]>([{ type: 'h2', content: 'Section' }])
  })

  it('parses list item', () => {
    const blocks = parseMarkdownBlocks('- item one')
    expect(blocks).toEqual<MarkdownBlock[]>([{ type: 'li', content: 'item one' }])
  })

  it('parses paragraph', () => {
    const blocks = parseMarkdownBlocks('plain text')
    expect(blocks).toEqual<MarkdownBlock[]>([{ type: 'p', content: 'plain text' }])
  })

  it('parses blank line', () => {
    const blocks = parseMarkdownBlocks('')
    expect(blocks).toEqual<MarkdownBlock[]>([{ type: 'blank', content: '' }])
  })

  it('parses mixed content', () => {
    const blocks = parseMarkdownBlocks('# Title\n\n## Section\n- item\nplain text\n\n## Another')
    expect(blocks).toHaveLength(7)
    expect(blocks[0]).toEqual({ type: 'h1', content: 'Title' })
    expect(blocks[1]).toEqual({ type: 'blank', content: '' })
    expect(blocks[2]).toEqual({ type: 'h2', content: 'Section' })
    expect(blocks[3]).toEqual({ type: 'li', content: 'item' })
    expect(blocks[4]).toEqual({ type: 'p', content: 'plain text' })
    expect(blocks[5]).toEqual({ type: 'blank', content: '' })
    expect(blocks[6]).toEqual({ type: 'h2', content: 'Another' })
  })

  it('treats ### as paragraph (not h3)', () => {
    const blocks = parseMarkdownBlocks('### not a heading')
    expect(blocks[0]).toEqual({ type: 'p', content: '### not a heading' })
  })

  it('handles text starting with # that is not heading', () => {
    const blocks = parseMarkdownBlocks('#not heading')
    expect(blocks[0]).toEqual({ type: 'p', content: '#not heading' })
  })

  it('handles dash not followed by space as paragraph', () => {
    const blocks = parseMarkdownBlocks('-not a list')
    expect(blocks[0]).toEqual({ type: 'p', content: '-not a list' })
  })

  it('returns empty array for empty string with no trailing newline', () => {
    // "" split('\n') = [""], which produces a blank block
    const blocks = parseMarkdownBlocks('')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'blank', content: '' })
  })
})

describe('parseInlineSpans', () => {
  it('returns plain text for string without formatting', () => {
    const spans = parseInlineSpans('hello world')
    expect(spans).toEqual<InlineSpan[]>([{ type: 'text', text: 'hello world' }])
  })

  it('parses bold text', () => {
    const spans = parseInlineSpans('this is **bold** text')
    expect(spans).toEqual<InlineSpan[]>([
      { type: 'text', text: 'this is ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' text' }
    ])
  })

  it('parses inline code', () => {
    const spans = parseInlineSpans('use `const` keyword')
    expect(spans).toEqual<InlineSpan[]>([
      { type: 'text', text: 'use ' },
      { type: 'code', text: 'const' },
      { type: 'text', text: ' keyword' }
    ])
  })

  it('parses mixed bold and code', () => {
    const spans = parseInlineSpans('**important** and `code` together')
    expect(spans).toEqual<InlineSpan[]>([
      { type: 'bold', text: 'important' },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' together' }
    ])
  })

  it('handles empty string', () => {
    const spans = parseInlineSpans('')
    expect(spans).toEqual([])
  })

  it('handles text with only formatting markers', () => {
    const spans = parseInlineSpans('**a**`b`**c**')
    expect(spans).toEqual<InlineSpan[]>([
      { type: 'bold', text: 'a' },
      { type: 'code', text: 'b' },
      { type: 'bold', text: 'c' }
    ])
  })

  it('handles adjacent bold and code without space', () => {
    const spans = parseInlineSpans('**bold**`code`')
    expect(spans).toEqual<InlineSpan[]>([
      { type: 'bold', text: 'bold' },
      { type: 'code', text: 'code' }
    ])
  })

  it('handles backtick inside bold', () => {
    const spans = parseInlineSpans('**use `foo` function**')
    // **use `foo` function** — the **...** captures first, then within it, `foo` is not separately parsed
    // because the regex matches **...** first (greedy) and skips inner backticks
    expect(spans).toEqual<InlineSpan[]>([
      { type: 'bold', text: 'use `foo` function' }
    ])
  })
})
