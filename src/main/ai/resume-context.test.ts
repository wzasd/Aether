import { describe, it, expect } from 'vitest'
import {
  generateResumeContext,
  hasResumeContext,
  DEFAULT_RESUME_TOKEN_BUDGET,
  ELASTIC_RESUME_TOKEN_BUDGET,
} from './resume-context'
import type { A2ATask } from './a2a-types'

function makeTask(overrides: Partial<A2ATask> = {}): A2ATask {
  return {
    id: 'task-1',
    conversationId: 'conv-1',
    fromProfileId: null,
    toProfileId: 'agent-1',
    message: '请审查这段代码',
    contextSnapshot: '',
    status: 'completed',
    depth: 0,
    chain: ['user'],
    executionMode: 'serial',
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

describe('generateResumeContext', () => {
  it('generates a structured summary for a completed task', () => {
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: '代码审查完成，发现 3 个问题。',
      terminalError: null,
      userMessage: '请审查这段代码',
    })

    expect(ctx).toContain('- 状态: 已完成')
    expect(ctx).toContain('- 用户请求: 请审查这段代码')
    expect(ctx).toContain('- 主要工作: 代码审查完成，发现 3 个问题。')
  })

  it('includes user request truncated to 200 chars', () => {
    const longMessage = 'a'.repeat(500)
    const ctx = generateResumeContext({
      task: makeTask({ message: longMessage }),
      accumulatedOutput: 'done',
      terminalError: null,
      userMessage: longMessage,
    })

    expect(ctx).toContain('- 用户请求: ' + 'a'.repeat(200) + '…')
  })

  it('marks failed status when terminalError is present', () => {
    const ctx = generateResumeContext({
      task: makeTask({ status: 'failed' }),
      accumulatedOutput: '',
      terminalError: 'API key invalid',
      userMessage: '请审查这段代码',
    })

    expect(ctx).toContain('- 状态: 失败（运行中断）')
    expect(ctx).toContain('- 错误信息: API key invalid')
  })

  it('extracts key decisions by keyword matching', () => {
    const output = `
经过分析，我决定重构这个函数。
另外，我拒绝使用全局变量。
最终确认采用方案 B。
    `.trim()

    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: output,
      terminalError: null,
      userMessage: '请审查这段代码',
    })

    expect(ctx).toContain('- 关键决策:')
    expect(ctx).toContain('我决定重构这个函数')
    expect(ctx).toContain('我拒绝使用全局变量')
    expect(ctx).toContain('确认采用方案 B')
  })

  it('includes unfinished items for non-completed tasks', () => {
    const ctx = generateResumeContext({
      task: makeTask({ status: 'working' }),
      accumulatedOutput: '正在处理中...',
      terminalError: null,
      userMessage: '请审查这段代码',
    })

    expect(ctx).toContain('- 未完成事项:')
    expect(ctx).toContain('主任务尚未完成')
  })

  it('limits decisions to max 5 items', () => {
    const output = Array.from({ length: 10 }, (_, i) => `决定 ${i + 1}`).join('\n')
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: output,
      terminalError: null,
      userMessage: 'test',
    })

    // Extract only the decision section
    const decisionSection = ctx.split('- 关键决策:')[1]?.split('\n-')[0] || ''
    const bulletMatches = decisionSection.match(/  - /g)
    expect(bulletMatches?.length).toBe(5)
  })

  it('truncates decisions to 120 chars each', () => {
    const longDecision = '决定 ' + 'x'.repeat(200)
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: longDecision,
      terminalError: null,
      userMessage: 'test',
    })

    // Extract only the decision section
    const decisionSection = ctx.split('- 关键决策:')[1]?.split('\n-')[0] || ''
    // d.slice(0, 120) includes '决定 ' (3 chars) + 117 x's = 120 chars total
    expect(decisionSection).toContain('决定 ' + 'x'.repeat(117) + '…')
  })

  it('shows empty output fallback', () => {
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: '',
      terminalError: null,
      userMessage: 'test',
    })

    expect(ctx).toContain('- 主要工作:（无文本输出）')
    expect(ctx).not.toContain('- 关键决策:')
  })

  it('handles English decision keywords', () => {
    const output = 'I decided to fix the bug. We should implement caching.'
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: output,
      terminalError: null,
      userMessage: 'test',
    })

    expect(ctx).toContain('- 关键决策:')
    expect(ctx).toContain('fix the bug')
    expect(ctx).toContain('implement caching')
  })

  it('adds done/completed/skip keywords', () => {
    const output = 'Review completed. I will skip the test update. 放弃重构。'
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: output,
      terminalError: null,
      userMessage: 'test',
    })

    expect(ctx).toContain('Review completed')
    expect(ctx).toContain('skip the test update')
    expect(ctx).toContain('放弃重构')
  })
})

describe('hasResumeContext', () => {
  it('returns true when marker is present', () => {
    expect(hasResumeContext('some text ## 上一轮上下文摘要 more')).toBe(true)
  })

  it('returns false when marker is absent', () => {
    expect(hasResumeContext('some normal text')).toBe(false)
  })
})

describe('token budget truncation', () => {
  it('does not truncate within default budget', () => {
    const shortOutput = 'a'.repeat(100)
    const ctx = generateResumeContext({
      task: makeTask(),
      accumulatedOutput: shortOutput,
      terminalError: null,
      userMessage: 'test',
    })

    expect(ctx.length).toBeLessThan(DEFAULT_RESUME_TOKEN_BUDGET * 3)
    expect(ctx).not.toContain('[上下文摘要已截断…]')
  })

  it('allows elastic budget for unfinished items', () => {
    const longOutput = '决定 '.repeat(50) + '\n' + '未完成事项'.repeat(20)
    const task = makeTask({ status: 'working' })
    const ctx = generateResumeContext(
      {
        task,
        accumulatedOutput: longOutput,
        terminalError: null,
        userMessage: 'test',
      },
      { tokenBudget: 50, elasticBudget: 100 }
    )

    // Should be longer than strict budget but not exceed elastic
    expect(ctx.length).toBeGreaterThan(50 * 3)
    expect(ctx.length).toBeLessThanOrEqual(100 * 3 + 50)
  })

  it('hard-truncates beyond elastic budget', () => {
    const hugeOutput = 'x'.repeat(10000)
    const ctx = generateResumeContext(
      {
        task: makeTask(),
        accumulatedOutput: hugeOutput,
        terminalError: null,
        userMessage: 'test',
      },
      { tokenBudget: 10, elasticBudget: 20 }
    )

    expect(ctx.length).toBeLessThanOrEqual(20 * 3 + 50)
    expect(ctx).toContain('[上下文摘要已截断…]')
  })
})
