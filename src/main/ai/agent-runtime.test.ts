import { describe, expect, it } from 'vitest'
import { assessOpenFloorRelevance } from './agent-runtime'

describe('assessOpenFloorRelevance', () => {
  it('defaults to participation for broad Open Floor topics', () => {
    const result = assessOpenFloorRelevance({
      topic: '大家自由讨论一下这个功能怎么设计',
      myCapabilities: ['architecture'],
      myInterests: '当需要技术方案设计、架构决策、跨模块接口设计时参与。'
    })

    expect(result.score).toBeGreaterThanOrEqual(0.3)
  })

  it('matches Chinese topic phrases against longer whenToUse text', () => {
    const result = assessOpenFloorRelevance({
      topic: '实现代码',
      myCapabilities: ['implementation'],
      myInterests: '所有任务的起点。负责理解需求、制定方案、实现代码、协调团队。'
    })

    expect(result.score).toBeGreaterThan(0.3)
  })

  it('boosts score when capability matches topic', () => {
    const result = assessOpenFloorRelevance({
      topic: 'architecture review',
      myCapabilities: ['architecture'],
      myInterests: ''
    })

    expect(result.score).toBeGreaterThanOrEqual(0.75)
  })
})
