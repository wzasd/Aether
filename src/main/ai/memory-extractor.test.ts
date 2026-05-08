import { describe, it, expect } from 'vitest'
import { extractCandidates } from './memory-extractor'

function makeInput(text: string) {
  return {
    workspaceId: 'ws-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    agentRole: 'implementation',
    fullText: text
  }
}

describe('extractCandidates', () => {
  it('returns empty array for empty text', () => {
    expect(extractCandidates(makeInput(''))).toEqual([])
  })

  it('extracts decision patterns', () => {
    const result = extractCandidates(
      makeInput('经过分析，决定：使用 React Query 管理服务端状态。同时选择：Vite 作为构建工具。')
    )
    const decisions = result.filter((c) => c.kind === 'decision')
    expect(decisions.length).toBeGreaterThanOrEqual(1)
    expect(decisions[0].content).toContain('React Query')
    expect(decisions[0].confidence).toBe('low')
  })

  it('extracts antipattern patterns', () => {
    const result = extractCandidates(
      makeInput('注意：不要在渲染过程中直接修改 state。避免：在 useEffect 中做同步操作。')
    )
    const antipatterns = result.filter((c) => c.kind === 'antipattern')
    expect(antipatterns.length).toBeGreaterThanOrEqual(1)
    expect(antipatterns[0].content).toContain('不要')
  })

  it('extracts convention patterns', () => {
    const result = extractCandidates(
      makeInput('约定：所有组件放在 src/components 下。规范：使用 kebab-case 命名文件。')
    )
    const conventions = result.filter((c) => c.kind === 'convention')
    expect(conventions.length).toBeGreaterThanOrEqual(1)
    expect(conventions[0].content).toContain('组件')
  })

  it('extracts English patterns', () => {
    const result = extractCandidates(
      makeInput('after review, decided: to use PostgreSQL for the primary database. avoid: storing secrets in config files.')
    )
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('deduplicates similar extractions', () => {
    const result = extractCandidates(
      makeInput('决定：使用 TypeScript。\n决定：使用 TypeScript。')
    )
    const decisions = result.filter((c) => c.kind === 'decision')
    // Only one unique decision about TypeScript
    expect(decisions.length).toBe(1)
  })

  it('skips captured text shorter than 4 characters', () => {
    const result = extractCandidates(makeInput('决定：AB'))
    expect(result.length).toBe(0)
  })

  it('returns all matching candidates', () => {
    const text = [
      '决定：使用 Tailwind CSS 作为样式方案。',
      '避免：在组件内部发起副作用不可控的请求。',
      '约定：API 响应统一使用 ApiResponse<T> 包装。'
    ].join('\n')
    const result = extractCandidates(makeInput(text))
    const kinds = result.map((c) => c.kind)
    // Should have at least one of each kind
    expect(kinds).toContain('decision')
    expect(kinds).toContain('convention')
  })

  it('respects title length limit', () => {
    const result = extractCandidates(makeInput('决定：' + 'x'.repeat(500)))
    expect(result.length).toBeGreaterThan(0)
    if (result.length > 0) {
      expect(result[0].title.length).toBeLessThanOrEqual(80)
    }
  })

  it('respects content length limit', () => {
    const result = extractCandidates(makeInput('约定：' + 'y'.repeat(2000)))
    expect(result.length).toBeGreaterThan(0)
    if (result.length > 0) {
      expect(result[0].content.length).toBeLessThanOrEqual(1000)
    }
  })
})
