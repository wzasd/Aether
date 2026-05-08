export interface MarkdownBlock {
  type: 'h1' | 'h2' | 'li' | 'p' | 'blank'
  content: string
}

export interface InlineSpan {
  type: 'text' | 'bold' | 'code'
  text: string
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split('\n')
  const blocks: MarkdownBlock[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', content: line.slice(3) })
    } else if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', content: line.slice(2) })
    } else if (line.startsWith('- ')) {
      blocks.push({ type: 'li', content: line.slice(2) })
    } else if (line === '') {
      blocks.push({ type: 'blank', content: '' })
    } else {
      blocks.push({ type: 'p', content: line })
    }
  }

  return blocks
}

export function parseInlineSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  const re = /(\*\*(.+?)\*\*|`(.+?)`)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      spans.push({ type: 'text', text: text.slice(last, match.index) })
    }
    if (match[0].startsWith('**')) {
      spans.push({ type: 'bold', text: match[2] })
    } else {
      spans.push({ type: 'code', text: match[3] })
    }
    last = match.index + match[0].length
  }

  if (last < text.length) {
    spans.push({ type: 'text', text: text.slice(last) })
  }

  return spans
}
