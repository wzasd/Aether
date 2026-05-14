import { describe, expect, it, vi, beforeEach } from 'vitest'
import { A2AMemoryDistiller, type ChainMemoryDistillate } from './a2a-memory-distiller'
import { createCandidate, createProjectMemoryItem } from '../core/memory-index'

vi.mock('../core/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ workspace_id: 'ws-1' })),
      all: vi.fn(() => []),
    })),
  })),
}))

vi.mock('../core/memory-index', () => ({
  createCandidate: vi.fn(),
  createProjectMemoryItem: vi.fn(),
}))

describe('A2AMemoryDistiller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists distilled items directly to Memory Palace with category status and audit candidates', async () => {
    const distiller = new A2AMemoryDistiller()
    const distillate: ChainMemoryDistillate = {
      conversationId: 'conv-1',
      agentChain: ['coder', 'reviewer'],
      taskCount: 2,
      maxDepth: 1,
      decisionPoints: [{
        agentsInvolved: ['coder', 'reviewer'],
        decision: '使用事件驱动触发记忆蒸馏',
        rationale: '对 agent 无感且解耦',
        suggestedCategory: 'decisions',
        confidence: 0.65,
      }],
      conventions: [{
        pattern: '先完成 typecheck 再提交',
        appliesTo: ['coder'],
        suggestedCategory: 'conventions',
        confidence: 0.6,
      }],
      failures: [{
        agent: 'reviewer',
        issue: '遗漏状态映射',
        remediation: '按 DEFAULT_STATUS_BY_CATEGORY 写入',
        suggestedCategory: 'antipatterns',
        confidence: 0.8,
      }],
    }

    const count = await distiller.persistToMemoryPalace(distillate)

    expect(count).toBe(4)
    expect(createProjectMemoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws-1',
        category: 'architecture',
        status: 'draft',
        source_doc: 'conversation:conv-1',
      })
    )
    expect(createProjectMemoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'antipatterns',
        status: 'active',
      })
    )
    expect(createProjectMemoryItem).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'decisions',
        status: 'draft',
      })
    )
    expect(createCandidate).toHaveBeenCalledTimes(4)
    expect(createCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws-1',
        status: 'materialized',
        source_conversation_id: 'conv-1',
      })
    )
  })
})
