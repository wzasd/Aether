import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentProfile, Observation, ObservationTool } from '../../ai/a2a-types'
import type { SessionConfig } from '../../ai/provider'

const mockObservations = new Map<string, (obs: Observation) => Promise<{ reply?: string; relevanceScore: number }>>()

vi.mock('../../ai/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((profile: AgentProfile) => ({
    profile,
    start: vi.fn(async () => ({ id: `session-${profile.id}` })),
    onObservation: vi.fn(async (obs: Observation) => {
      const handler = mockObservations.get(profile.id)
      return handler ? await handler(obs) : { reply: `${profile.name} reply`, relevanceScore: 0.8 }
    }),
    abort: vi.fn(),
    dispose: vi.fn(async () => {}),
  })),
}))

// In-memory mock DB that actually tracks state
const mockDbState: {
  tables: Map<string, Array<Record<string, unknown>>>
  sequences: Map<string, number>
} = {
  tables: new Map(),
  sequences: new Map(),
}

function resetMockDb(): void {
  mockDbState.tables.clear()
  mockDbState.sequences.clear()
}

function mockPrepare(sql: string) {
  const lower = sql.toLowerCase().replace(/\s+/g, ' ')
  
  return {
    run: vi.fn((...args: unknown[]) => {
      if (lower.includes('insert into')) {
        const tableMatch = lower.match(/insert into\s+(\w+)/)
        const table = tableMatch ? tableMatch[1] : 'unknown'
        const row: Record<string, unknown> = {}
        
        // Simple parameter binding: ? placeholders
        let argIdx = 0
        const colMatch = lower.match(/\(([^)]+)\)/)
        if (colMatch) {
          const cols = colMatch[1].split(',').map(c => c.trim())
          cols.forEach((col, i) => {
            if (col !== '?' && i < args.length) {
              row[col] = args[i]
            }
          })
        }
        
        const rows = mockDbState.tables.get(table) ?? []
        rows.push(row)
        mockDbState.tables.set(table, rows)
        return { changes: 1, lastInsertRowid: rows.length }
      }
      
      if (lower.includes('update')) {
        const tableMatch = lower.match(/update\s+(\w+)/)
        const table = tableMatch ? tableMatch[1] : 'unknown'
        const rows = mockDbState.tables.get(table) ?? []
        
        // Parse SET clauses — handle both ? placeholders and hardcoded values
        const setMatch = lower.match(/set\s+(.+?)(?:where|returning|$)/)
        const updates: Record<string, unknown> = {}
        if (setMatch) {
          const setParts = setMatch[1].split(',')
          setParts.forEach((part) => {
            const colMatch = part.match(/(\w+)\s*=\s*\?/)
            if (colMatch) {
              const argIdx = updates['__argIdx__'] as number ?? 0
              if (argIdx < args.length) {
                updates[colMatch[1]] = args[argIdx]
                updates['__argIdx__'] = argIdx + 1
              }
            } else {
              const hardcodedMatch = part.match(/(\w+)\s*=\s*'([^']+)'/)
              if (hardcodedMatch) {
                updates[hardcodedMatch[1]] = hardcodedMatch[2]
              }
            }
          })
          delete updates['__argIdx__']
        }
        
        // Find and update matching rows
        let updatedCount = 0
        let updatedRow: Record<string, unknown> | null = null
        
        for (const row of rows) {
          let matches = true
          
          // Simple WHERE parsing for common patterns
          if (lower.includes('where')) {
            if (lower.includes('id = ?')) {
              // id is always the last parameter in TaskQueue methods
              matches = row['id'] === args[args.length - 1]
            }
            if (lower.includes('agent_profile_id = ?')) {
              const idx = setMatch ? setMatch[1].split(',').length : 0
              matches = row['agent_profile_id'] === args[idx]
            }
          }
          
          if (matches) {
            Object.assign(row, updates)
            updatedCount++
            updatedRow = row
          }
        }
        
        // Handle RETURNING
        if (lower.includes('returning')) {
          return updatedRow ?? undefined
        }
        
        return { changes: updatedCount }
      }
      
      if (lower.includes('delete')) {
        const tableMatch = lower.match(/from\s+(\w+)/)
        const table = tableMatch ? tableMatch[1] : 'unknown'
        mockDbState.tables.set(table, [])
        return { changes: 0 }
      }
      
      return { changes: 0 }
    }),
    
    get: vi.fn((...args: unknown[]) => {
      // Handle UPDATE ... RETURNING * (SQLite claim pattern)
      if (lower.includes('update') && lower.includes('returning')) {
        const agentMatch = lower.match(/agent_profile_id\s*=\s*\?/)
        if (agentMatch) {
          const table = 'agent_task_queue'
          const agentId = args[args.length - 1] as string
          const rows = mockDbState.tables.get(table) ?? []
          const pending = rows.filter((r) =>
            r['agent_profile_id'] === agentId && r['status'] === 'pending'
          ).sort((a, b) => (a['created_at'] as number) - (b['created_at'] as number))
          const target = pending[0]
          if (target) {
            target['status'] = 'claimed'
            const claimedAt = args.find((a) => typeof a === 'number')
            if (claimedAt) target['claimed_at'] = claimedAt
            return target
          }
        }
        return undefined
      }

      if (lower.includes('count(*)')) {
        const tableMatch = lower.match(/from\s+(\w+)/)
        const table = tableMatch ? tableMatch[1] : 'unknown'
        const rows = mockDbState.tables.get(table) ?? []
        
        // Simple WHERE matching
        let count = rows.length
        if (lower.includes('where')) {
          count = rows.filter(row => {
            // Very basic filtering for common patterns
            if (lower.includes('agent_profile_id = ?') && args[0] !== undefined) {
              return row['agent_profile_id'] === args[0]
            }
            if (lower.includes('conversation_id = ?') && args[0] !== undefined) {
              return row['conversation_id'] === args[0]
            }
            if (lower.includes('status = ?') && args[0] !== undefined) {
              return row['status'] === args[0]
            }
            if (lower.includes('id = ?') && args[0] !== undefined) {
              return row['id'] === args[0]
            }
            return true
          }).length
        }
        return { count }
      }
      
      // Single row select
      const tableMatch = lower.match(/from\s+(\w+)/)
      const table = tableMatch ? tableMatch[1] : 'unknown'
      const rows = mockDbState.tables.get(table) ?? []
      
      // Find matching row
      for (const row of rows) {
        if (lower.includes('id = ?') && args[0] !== undefined && row['id'] === args[0]) {
          return row
        }
        if (lower.includes('agent_profile_id = ?') && args[0] !== undefined && row['agent_profile_id'] === args[0]) {
          return row
        }
      }
      return undefined
    }),
    
    all: vi.fn((...args: unknown[]) => {
      const tableMatch = lower.match(/from\s+(\w+)/)
      const table = tableMatch ? tableMatch[1] : 'unknown'
      let rows = mockDbState.tables.get(table) ?? []
      
      // Apply simple WHERE filtering
      if (lower.includes('where')) {
        rows = rows.filter(row => {
          if (lower.includes('conversation_id = ?') && args[0] !== undefined) {
            return row['conversation_id'] === args[0]
          }
          if (lower.includes('agent_profile_id = ?') && args[0] !== undefined) {
            return row['agent_profile_id'] === args[0]
          }
          if (lower.includes('status = ?') && args[0] !== undefined) {
            return row['status'] === args[0]
          }
          if (lower.includes('status in') && args[0] !== undefined) {
            const statuses = (args[0] as string).split(',').map(s => s.trim().replace(/'/g, ''))
            return statuses.includes(row['status'] as string)
          }
          return true
        })
      }
      
      // Apply ORDER BY
      if (lower.includes('order by')) {
        const orderMatch = lower.match(/order by\s+(\w+)/)
        if (orderMatch) {
          const col = orderMatch[1]
          rows = [...rows].sort((a, b) => {
            const aVal = a[col] as number | string | undefined
            const bVal = b[col] as number | string | undefined
            if (typeof aVal === 'number' && typeof bVal === 'number') {
              return aVal - bVal
            }
            return String(aVal).localeCompare(String(bVal))
          })
        }
      }
      
      // Apply LIMIT
      if (lower.includes('limit')) {
        const limitMatch = lower.match(/limit\s+(\d+)/)
        if (limitMatch) {
          rows = rows.slice(0, parseInt(limitMatch[1]))
        }
      }
      
      return rows
    }),
  }
}

vi.mock('../../core/db', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => mockPrepare(sql)),
  })),
}))

vi.mock('../../core/logging', () => ({
  writeObservabilityEvent: vi.fn(),
}))

import { RuntimeRegistry } from '../runtime-registry'
import { bus } from '../event-bus'
import { taskQueue } from '../task-queue'

const profiles: AgentProfile[] = [
  {
    id: 'coder',
    workspaceId: null,
    name: 'Coder',
    role: 'coder',
    model: 'test-model',
    description: null,
    systemPrompt: null,
    isEnabled: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'reviewer',
    workspaceId: null,
    name: 'Reviewer',
    role: 'reviewer',
    model: 'test-model',
    description: null,
    systemPrompt: null,
    isEnabled: true,
    sortOrder: 1,
    createdAt: 0,
    updatedAt: 0,
  },
]

const config: SessionConfig = {
  providerType: 'test-provider',
  model: 'test-model',
  workingDir: '/tmp/bytro-test',
  permissionMode: 'trusted',
}

describe('RuntimeRegistry', () => {
  let registry: RuntimeRegistry

  beforeEach(() => {
    registry = new RuntimeRegistry()
    mockObservations.clear()
    bus.clear()
    resetMockDb()
    // Clear task queue table — our mock db is fresh per module import,
    // but let's also clear bus subscribers that registry may have added
  })

  it('initializes only enabled profiles', async () => {
    const disabledProfile: AgentProfile = {
      ...profiles[0],
      id: 'disabled-agent',
      name: 'Disabled',
      isEnabled: false,
    }

    await registry.initialize([...profiles, disabledProfile], config)

    expect(registry.get('coder')).toBeDefined()
    expect(registry.get('reviewer')).toBeDefined()
    expect(registry.get('disabled-agent')).toBeUndefined()
  })

  it('starts all resident runtimes', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const active = registry.getAllActive()
    expect(active).toHaveLength(2)
    expect(active.every((r) => r.isActive)).toBe(true)
  })

  it('get returns undefined for unknown profile', () => {
    expect(registry.get('unknown')).toBeUndefined()
  })

  it('getAllActive returns only active runtimes', async () => {
    await registry.initialize(profiles, config)
    expect(registry.getAllActive()).toHaveLength(0)

    await registry.startAll()
    expect(registry.getAllActive()).toHaveLength(2)
  })

  it('claimAndExecute completes a task and publishes reply', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const replyHandler = vi.fn()
    bus.subscribe('message:reply', replyHandler)

    // Enqueue a task
    const task = taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'implement auth',
    })

    mockObservations.set('coder', async () => ({
      reply: 'Use OAuth2 with PKCE',
      relevanceScore: 0.9,
    }))

    await registry.claimAndExecute('coder')

    expect(replyHandler).toHaveBeenCalledTimes(1)
    expect(replyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message:reply',
        actorId: 'coder',
        payload: expect.objectContaining({
          content: 'Use OAuth2 with PKCE',
          relevanceScore: 0.9,
        }),
      })
    )
  })

  it('claimAndExecute handles NO_REPLY from agent', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const replyHandler = vi.fn()
    bus.subscribe('message:reply', replyHandler)

    taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'reviewer',
      message: 'review this code',
    })

    mockObservations.set('reviewer', async () => ({
      reply: undefined,
      relevanceScore: 0.2,
    }))

    await registry.claimAndExecute('reviewer')

    // No message:reply should be published for NO_REPLY
    expect(replyHandler).not.toHaveBeenCalled()
  })

  it('claimAndExecute handles agent observation errors gracefully', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const thinkingHandler = vi.fn()
    bus.subscribe('agent:thinking', thinkingHandler)

    taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'crash me',
    })

    mockObservations.set('coder', async () => {
      throw new Error('Simulated LLM failure')
    })

    // Should not throw
    await expect(registry.claimAndExecute('coder')).resolves.not.toThrow()

    // Task should be marked failed in DB (checked via getConversationTasks)
    const tasks = taskQueue.getConversationTasks('conv-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('failed')
    expect(tasks[0].error).toBe('Simulated LLM failure')
  })

  it('publishes agent:thinking before executing', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    const thinkingHandler = vi.fn()
    bus.subscribe('agent:thinking', thinkingHandler)

    taskQueue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'do something',
    })

    await registry.claimAndExecute('coder')

    expect(thinkingHandler).toHaveBeenCalledTimes(1)
    expect(thinkingHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent:thinking',
        actorId: 'coder',
        payload: expect.objectContaining({
          agentName: 'Coder',
          agentRole: 'coder',
        }),
      })
    )
  })

  it('enqueues follow-up tasks when other agents reply', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    // Simulate another agent replying
    bus.publish({
      type: 'message:reply',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'reviewer',
      payload: {
        agentName: 'Reviewer',
        content: 'I think we should use JWT instead',
      },
    })

    // Coder should have a follow-up task enqueued
    const pending = taskQueue.countPending('coder')
    expect(pending).toBeGreaterThanOrEqual(1)
  })

  it('does not enqueue follow-up for own replies', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    // Clear any initial state
    const initialPending = taskQueue.countPending('coder')

    // Coder replies — coder should not get a follow-up to itself
    bus.publish({
      type: 'message:reply',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'coder',
      payload: {
        agentName: 'Coder',
        content: 'My own reply',
      },
    })

    // Pending count should not increase (or increase only by initial state)
    const afterPending = taskQueue.countPending('coder')
    expect(afterPending).toBe(initialPending)
  })

  it('stops all runtimes on stopAll', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()
    expect(registry.getAllActive()).toHaveLength(2)

    await registry.stopAll()

    expect(registry.getAllActive()).toHaveLength(0)
  })

  it('ignores claimAndExecute for unknown or inactive profiles', async () => {
    // Not initialized
    await expect(registry.claimAndExecute('unknown')).resolves.not.toThrow()

    // Initialize but don't start
    await registry.initialize(profiles, config)
    await expect(registry.claimAndExecute('coder')).resolves.not.toThrow()
  })

  // ─── Tool Injection (Path B) ──────────────────────────────────────

  it('passes readMessages tool to onObservation (Path B)', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    let capturedTools: ObservationTool[] | undefined
    mockObservations.set('coder', async (obs) => {
      capturedTools = obs.tools
      return { reply: 'ok', relevanceScore: 0.9 }
    })

    taskQueue.enqueue({
      conversationId: 'conv-tool-1',
      agentProfileId: 'coder',
      message: 'test tool injection',
    })

    await registry.claimAndExecute('coder')

    expect(capturedTools).toBeDefined()
    expect(capturedTools).toHaveLength(1)
    expect(capturedTools![0].name).toBe('readMessages')
    expect(capturedTools![0].parameters.limit).toEqual({
      type: 'number',
      description: expect.stringContaining('50'),
    })
  })

  it('readMessages tool executes getConversationHistory', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    let capturedTools: ObservationTool[] | undefined
    mockObservations.set('coder', async (obs) => {
      capturedTools = obs.tools
      return { reply: 'history test reply', relevanceScore: 0.9 }
    })

    taskQueue.enqueue({
      conversationId: 'conv-hist-1',
      agentProfileId: 'coder',
      message: 'unique marker 42a7b',
    })

    await registry.claimAndExecute('coder')

    expect(capturedTools).toBeDefined()
    expect(capturedTools).toHaveLength(1)
    const readMsgs = capturedTools![0]
    expect(readMsgs.name).toBe('readMessages')

    // Execute tool — should return history containing the enqueued message
    const result = await readMsgs.execute({ limit: 50 })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('unique marker 42a7b')
  })

  it('readMessages tool returns history as string', async () => {
    await registry.initialize(profiles, config)
    await registry.startAll()

    let capturedTools: ObservationTool[] | undefined
    mockObservations.set('coder', async (obs) => {
      capturedTools = obs.tools
      return { reply: 'ok', relevanceScore: 0.9 }
    })

    taskQueue.enqueue({
      conversationId: 'conv-limit',
      agentProfileId: 'coder',
      message: 'test limit marker',
    })

    await registry.claimAndExecute('coder')

    expect(capturedTools).toBeDefined()
    const readMsgs = capturedTools![0]

    // Tool executes without error and returns conversation data
    const result = await readMsgs.execute({ limit: 50 })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('test limit marker')
  })
})
