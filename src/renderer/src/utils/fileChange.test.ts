import { describe, expect, it } from 'vitest'
import { normalizeToolName, isFileOperationTool, countLines, extractFileChange } from './fileChange'

describe('normalizeToolName', () => {
  it('returns the last segment for MCP-namespaced tool names', () => {
    expect(normalizeToolName('mcp__tool__Write')).toBe('Write')
  })

  it('handles two-segment names', () => {
    expect(normalizeToolName('server__Edit')).toBe('Edit')
  })

  it('returns the name unchanged when no double underscores', () => {
    expect(normalizeToolName('Write')).toBe('Write')
  })
})

describe('isFileOperationTool', () => {
  it('recognizes Write, Edit, Delete as file operation tools', () => {
    expect(isFileOperationTool('Write')).toBe(true)
    expect(isFileOperationTool('Edit')).toBe(true)
    expect(isFileOperationTool('Delete')).toBe(true)
  })

  it('recognizes MCP-namespaced file operation tools', () => {
    expect(isFileOperationTool('mcp__server__Write')).toBe(true)
    expect(isFileOperationTool('mcp__fs__Edit')).toBe(true)
  })

  it('returns false for non-file tools', () => {
    expect(isFileOperationTool('Bash')).toBe(false)
    expect(isFileOperationTool('Read')).toBe(false)
    expect(isFileOperationTool('WebSearch')).toBe(false)
  })
})

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('returns 1 for a single line', () => {
    expect(countLines('single')).toBe(1)
  })

  it('counts newlines correctly', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })
})

describe('extractFileChange', () => {
  it('returns null for non-file-operation tools', () => {
    expect(extractFileChange('Bash', JSON.stringify({ command: 'ls' }))).toBeNull()
  })

  it('extracts Write change with added status and line count', () => {
    const input = JSON.stringify({ file_path: '/src/foo.ts', content: 'line1\nline2\nline3' })
    expect(extractFileChange('Write', input)).toEqual({
      path: '/src/foo.ts',
      status: 'added',
      additions: 3,
      deletions: 0,
      diff_text: '+line1\n+line2\n+line3'
    })
  })

  it('extracts Write change using path field as fallback', () => {
    const input = JSON.stringify({ path: '/src/foo.ts', content: 'x' })
    const result = extractFileChange('Write', input)
    expect(result?.path).toBe('/src/foo.ts')
  })

  it('extracts Edit change with modified status and line counts', () => {
    const input = JSON.stringify({
      file_path: '/src/bar.ts',
      old_string: 'old1\nold2',
      new_string: 'new1\nnew2\nnew3'
    })
    expect(extractFileChange('Edit', input)).toEqual({
      path: '/src/bar.ts',
      status: 'modified',
      additions: 3,
      deletions: 2,
      diff_text: '-old1\n-old2\n+new1\n+new2\n+new3'
    })
  })

  it('extracts Delete change with deleted status', () => {
    const input = JSON.stringify({ file_path: '/src/baz.ts' })
    expect(extractFileChange('Delete', input)).toEqual({
      path: '/src/baz.ts',
      status: 'deleted',
      additions: 0,
      deletions: 0,
      diff_text: null
    })
  })

  it('handles MCP-namespaced tool names', () => {
    const input = JSON.stringify({ file_path: '/x.ts', content: 'x' })
    expect(extractFileChange('mcp__fs__Write', input)).toEqual({
      path: '/x.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
      diff_text: '+x'
    })
  })

  it('returns null when file_path and path are both missing', () => {
    expect(extractFileChange('Write', JSON.stringify({ content: 'x' }))).toBeNull()
  })

  it('returns null for invalid JSON input', () => {
    expect(extractFileChange('Write', 'not-json')).toBeNull()
  })
})
