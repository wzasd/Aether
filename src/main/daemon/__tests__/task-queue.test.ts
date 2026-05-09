import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskQueue, type EnqueueTaskParams } from '../task-queue'

// Build a fresh in-memory mock DB per test
function makeMockDb() {
  const tables = new Map<string, Array<Record<string, unknown>>>()

  function getTable(name: string): Array<Record<string, unknown>> {
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }

  return {
    prepare: vi.fn((sql: string) => {
      return {
        run: vi.fn((...args: unknown[]) => {
          // CREATE TABLE / CREATE INDEX — no-op for mock
          if (sql.trim().toUpperCase().startsWith('CREATE')) {
            return { changes: 0 }
          }

          // INSERT
          if (sql.trim().toUpperCase().startsWith('INSERT')) {
            const table = getTable('agent_task_queue')
            const row: Record<string, unknown> = {}
            // Parse column names from SQL for mapping
            const colMatch = sql.match(/\(([^)]+)\)/)
            const cols = colMatch
              ? colMatch[1].split(',').map((c) => c.trim().split(/\s+/)[0])
              : []
            cols.forEach((col, i) => {
              row[col] = args[i]
            })
            table.push(row)
            return { changes: 1, lastInsertRowid: table.length }
          }

          // UPDATE
          if (sql.trim().toUpperCase().startsWith('UPDATE')) {
            const table = getTable('agent_task_queue')
            // Simple WHERE id = ? or WHERE conversation_id = ? AND status = ?
            const idIdx = sql.indexOf('WHERE id = ?')
            const convIdx = sql.indexOf('WHERE conversation_id = ?')

            if (idIdx >= 0) {
              const id = args[args.length - 1] as string
              const target = table.find((r) => r.id === id)
              if (target) {
                // Apply SET clauses from args (all except last = id)
                if (sql.includes('SET status = ')) {
                  const statusArg = args.find((a) =>
                    ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'].includes(a as string)
                  )
                  if (statusArg) target.status = statusArg
                }
                if (sql.includes('claimed_at = ?')) {
                  const claimedAt = args.find((a) => typeof a === 'number')
                  if (claimedAt) target.claimed_at = claimedAt
                }
                if (sql.includes('completed_at = ?')) {
                  const completedAt = args.find((a) => typeof a === 'number')
                  if (completedAt) target.completed_at = completedAt
                }
                if (sql.includes('result = ?')) {
                  const result = args.find((a) => typeof a === 'string' && a !== id)
                  if (result) target.result = result
                }
                if (sql.includes('error = ?')) {
                  const error = args.find((a) => typeof a === 'string' && a !== id)
                  if (error) target.error = error
                }
              }
              return { changes: target ? 1 : 0 }
            }

            if (convIdx >= 0) {
              const conversationId = args[args.length - 2] as string
              const statusFilter = args[args.length - 1] as string
              let changed = 0
              for (const row of table) {
                if (row.conversation_id === conversationId && row.status === statusFilter) {
                  row.status = 'cancelled'
                  changed++
                }
              }
              return { changes: changed }
            }

            return { changes: 0 }
          }

          return { changes: 0 }
        }),
        get: vi.fn((...args: unknown[]) => {
          const table = getTable('agent_task_queue')

          // COUNT(*) queries
          if (sql.includes('COUNT(*)')) {
            const agentIdx = sql.indexOf('agent_profile_id = ?')
            const statusIdx = sql.indexOf('status')
            if (agentIdx >= 0) {
              const agentId = args[0] as string
              const statusList = sql.match(/IN \(([^)]+)\)/)
              let count = 0
              for (const row of table) {
                if (row.agent_profile_id === agentId) {
                  if (statusList) {
                    const statuses = statusList[1].split(',').map((s) => s.trim().replace(/'/g, ''))
                    if (statuses.includes(row.status as string)) count++
                  } else if (statusIdx >= 0) {
                    const statusMatch = sql.match(/status = '([^']+)'/)
                    if (statusMatch && row.status === statusMatch[1]) count++
                  } else {
                    count++
                  }
                }
              }
              return { count }
            }
          }

          // SELECT * with WHERE id = ?
          if (sql.includes('WHERE id = ?')) {
            const id = args[0] as string
            return table.find((r) => r.id === id) ?? undefined
          }

          return undefined
        }),
        all: vi.fn((...args: unknown[]) => {
          const table = getTable('agent_task_queue')

          // SELECT * WHERE agent_profile_id = ? AND status IN (...)
          if (sql.includes('agent_profile_id = ?')) {
            const agentId = args[0] as string
            let filtered = table.filter((r) => r.agent_profile_id === agentId)
            if (sql.includes('status IN')) {
              const statusMatch = sql.match(/IN \(([^)]+)\)/)
              if (statusMatch) {
                const statuses = statusMatch[1].split(',').map((s) => s.trim().replace(/'/g, ''))
                filtered = filtered.filter((r) => statuses.includes(r.status as string))
              }
            } else if (sql.includes("status = 'pending'")) {
              filtered = filtered.filter((r) => r.status === 'pending')
            }
            // ORDER BY created_at ASC
            filtered.sort((a, b) => (a.created_at as number) - (b.created_at as number))
            return filtered
          }

          // SELECT * WHERE conversation_id = ?
          if (sql.includes('conversation_id = ?')) {
            const conversationId = args[0] as string
            const filtered = table
              .filter((r) => r.conversation_id === conversationId)
              .sort((a, b) => (a.created_at as number) - (b.created_at as number))
            return filtered
          }

          return []
        }),
      }
    }),
  }
}

vi.mock('../core/db', () => {
  function makeMockDb() {
    const table: Array<Record<string, unknown>> = []
    return {
      prepare: (sql: string) => {
        return {
          run: (...args: unknown[]) => {
            const upper = sql.trim().toUpperCase()
            if (upper.startsWith('CREATE')) return { changes: 0 }

            if (upper.startsWith('INSERT')) {
              const colMatch = sql.match(/\(([^)]+)\)/)
              const cols = colMatch
                ? colMatch[1].split(',').map((c) => c.trim().split(/\s+/)[0])
                : []
              const row: Record<string, unknown> = {}
              cols.forEach((col, i) => { row[col] = args[i] })
              table.push(row)
              return { changes: 1, lastInsertRowid: table.length }
            }

            if (upper.startsWith('UPDATE')) {
              const idIdx = sql.indexOf('WHERE id = ?')
              const convIdx = sql.indexOf('WHERE conversation_id = ?')

              if (idIdx >= 0) {
                const id = args[args.length - 1] as string
                const target = table.find((r) => r.id === id)
                if (target) {
                  if (sql.includes('SET status = ')) {
                    const sArg = args.find((a) =>
                      ['pending','claimed','running','completed','failed','cancelled'].includes(a as string)
                    )
                    if (sArg) target.status = sArg
                  }
                  if (sql.includes('claimed_at = ?')) {
                    const v = args.find((a) => typeof a === 'number')
                    if (v) target.claimed_at = v
                  }
                  if (sql.includes('completed_at = ?')) {
                    const v = args.find((a) => typeof a === 'number')
                    if (v) target.completed_at = v
                  }
                  if (sql.includes('result = ?')) {
                    const v = args.find((a) => typeof a === 'string' && a !== id)
                    if (v) target.result = v
                  }
                  if (sql.includes('error = ?')) {
                    const v = args.find((a) => typeof a === 'string' && a !== id)
                    if (v) target.error = v
                  }
                }
                return { changes: target ? 1 : 0 }
              }

              if (convIdx >= 0) {
                const cid = args[args.length - 2] as string
                const statusFilter = args[args.length - 1] as string
                let changed = 0
                for (const row of table) {
                  if (row.conversation_id === cid && row.status === statusFilter) {
                    row.status = 'cancelled'
                    changed++
                  }
                }
                return { changes: changed }
              }

              return { changes: 0 }
            }

            return { changes: 0 }
          },
          get: (...args: unknown[]) => {
            if (sql.includes('COUNT(*)')) {
              const agentIdx = sql.indexOf('agent_profile_id = ?')
              const statusIdx = sql.indexOf('status')
              if (agentIdx >= 0) {
                const agentId = args[0] as string
                const statusList = sql.match(/IN \(([^)]+)\)/)
                let count = 0
                for (const row of table) {
                  if (row.agent_profile_id === agentId) {
                    if (statusList) {
                      const statuses = statusList[1].split(',').map((s) => s.trim().replace(/'/g, ''))
                      if (statuses.includes(row.status as string)) count++
                    } else if (statusIdx >= 0) {
                      const m = sql.match(/status = '([^']+)'/)
                      if (m && row.status === m[1]) count++
                    } else {
                      count++
                    }
                  }
                }
                return { count }
              }
            }
            if (sql.includes('WHERE id = ?')) {
              const id = args[0] as string
              return table.find((r) => r.id === id) ?? undefined
            }
            return undefined
          },
          all: (...args: unknown[]) => {
            if (sql.includes('agent_profile_id = ?')) {
              const agentId = args[0] as string
              let filtered = table.filter((r) => r.agent_profile_id === agentId)
              if (sql.includes('status IN')) {
                const m = sql.match(/IN \(([^)]+)\)/)
                if (m) {
                  const statuses = m[1].split(',').map((s) => s.trim().replace(/'/g, ''))
                  filtered = filtered.filter((r) => statuses.includes(r.status as string))
                }
              } else if (sql.includes("status = 'pending'")) {
                filtered = filtered.filter((r) => r.status === 'pending')
              }
              filtered.sort((a, b) => (a.created_at as number) - (b.created_at as number))
              return filtered
            }
            if (sql.includes('conversation_id = ?')) {
              const cid = args[0] as string
              return table
                .filter((r) => r.conversation_id === cid)
                .sort((a, b) => (a.created_at as number) - (b.created_at as number))
            }
            return []
          },
        }
      },
    }
  }
  return { getDb: () => makeMockDb() }
})

describe('TaskQueue', () => {
  let queue: TaskQueue

  beforeEach(() => {
    vi.clearAllMocks()
    queue = new TaskQueue()
  })

  it('enqueues a task and returns it with pending status', () => {
    const task = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'hello',
    })

    expect(task.conversationId).toBe('conv-1')
    expect(task.agentProfileId).toBe('coder')
    expect(task.message).toBe('hello')
    expect(task.status).toBe('pending')
    expect(task.id).toBeDefined()
    expect(task.createdAt).toBeGreaterThan(0)
  })

  it('claims the oldest pending task for an agent', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'first' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'second' })

    const result = queue.claim('coder', 2)

    expect(result.reason).toBe('claimed')
    expect(result.task).not.toBeNull()
    expect(result.task!.message).toBe('first')
    expect(result.task!.status).toBe('claimed')
  })

  it('returns no_tasks when no pending tasks exist', () => {
    const result = queue.claim('coder', 2)
    expect(result.reason).toBe('no_tasks')
    expect(result.task).toBeNull()
  })

  it('returns no_capacity when agent is at max concurrent tasks', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 2' })

    queue.claim('coder', 1) // claim first, now at capacity
    const result = queue.claim('coder', 1) // should be no_capacity

    expect(result.reason).toBe('no_capacity')
    expect(result.task).toBeNull()
  })

  it('marks a task as running', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    queue.start(claimResult.task!.id)

    const tasks = queue.getAgentActiveTasks('coder')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('running')
  })

  it('marks a task as completed with result', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    queue.complete(claimResult.task!.id, 'completed result')

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('completed')
    expect(tasks[0].result).toBe('completed result')
    expect(tasks[0].completedAt).toBeGreaterThan(0)
  })

  it('marks a task as failed with error', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task' })
    const claimResult = queue.claim('coder', 2)

    queue.fail(claimResult.task!.id, 'something went wrong')

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('failed')
    expect(tasks[0].error).toBe('something went wrong')
  })

  it('cancels all pending tasks for a conversation', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'reviewer', message: 'task 2' })
    queue.enqueue({ conversationId: 'conv-2', agentProfileId: 'coder', message: 'task 3' })

    const cancelled = queue.cancelPending('conv-1')

    expect(cancelled).toBe(2)
    const conv1Tasks = queue.getConversationTasks('conv-1')
    expect(conv1Tasks.every((t) => t.status === 'cancelled')).toBe(true)
    const conv2Tasks = queue.getConversationTasks('conv-2')
    expect(conv2Tasks.every((t) => t.status === 'pending')).toBe(true)
  })

  it('counts pending tasks per agent', () => {
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 1' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'coder', message: 'task 2' })
    queue.enqueue({ conversationId: 'conv-1', agentProfileId: 'reviewer', message: 'task 3' })

    expect(queue.countPending('coder')).toBe(2)
    expect(queue.countPending('reviewer')).toBe(1)
    expect(queue.countPending('nonexistent')).toBe(0)
  })

  it('isolates tasks between conversations', () => {
    queue.enqueue({ conversationId: 'conv-a', agentProfileId: 'coder', message: 'a' })
    queue.enqueue({ conversationId: 'conv-b', agentProfileId: 'coder', message: 'b' })

    const tasksA = queue.getConversationTasks('conv-a')
    const tasksB = queue.getConversationTasks('conv-b')

    expect(tasksA).toHaveLength(1)
    expect(tasksB).toHaveLength(1)
    expect(tasksA[0].message).toBe('a')
    expect(tasksB[0].message).toBe('b')
  })

  it('stores and retrieves context as JSON', () => {
    const context = [{ role: 'user', content: 'hello' }]
    const task = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'task',
      context,
    })

    const tasks = queue.getConversationTasks('conv-1')
    expect(tasks[0].context).toBe(JSON.stringify(context))
  })

  it('supports task depth and parent task linking', () => {
    const parent = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'parent',
    })

    const child = queue.enqueue({
      conversationId: 'conv-1',
      agentProfileId: 'coder',
      message: 'child',
      depth: 1,
      parentTaskId: parent.id,
    })

    const tasks = queue.getConversationTasks('conv-1')
    const childTask = tasks.find((t) => t.id === child.id)
    expect(childTask!.depth).toBe(1)
    expect(childTask!.parentTaskId).toBe(parent.id)
  })
})
