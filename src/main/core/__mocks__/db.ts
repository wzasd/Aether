import { vi } from 'vitest'

const table: Array<Record<string, unknown>> = []

export function resetMockDb(): void {
  table.length = 0
}

function extractHardcodedStatus(sql: string): string | undefined {
  const m = sql.match(/SET\s+status\s*=\s*'([^']+)'/i)
  return m ? m[1] : undefined
}

export const getDb = vi.fn(() => ({
  prepare: vi.fn((sql: string) => {
    const upper = sql.trim().toUpperCase()
    return {
      run: vi.fn((...args: unknown[]) => {
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
          const idWhere = sql.match(/WHERE\s+id\s*=\s*\?/i)
          if (idWhere) {
            const id = args[args.length - 1] as string
            const target = table.find((r) => r.id === id)
            if (target) {
              const hardcodedStatus = extractHardcodedStatus(sql)
              if (hardcodedStatus) target.status = hardcodedStatus
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

          const convWhere = sql.match(/WHERE\s+conversation_id\s*=\s*\?/i)
          if (convWhere) {
            const cid = args[0] as string
            // Look for status filter ONLY in the WHERE clause
            const wherePart = sql.slice(sql.toUpperCase().indexOf('WHERE'))
            const statusMatch = wherePart.match(/status\s*=\s*'([^']+)'/)
            const statusFilter = statusMatch ? statusMatch[1] : undefined
            let changed = 0
            for (const row of table) {
              if (row.conversation_id === cid && (!statusFilter || row.status === statusFilter)) {
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
        if (upper.startsWith('UPDATE') && sql.includes('RETURNING')) {
          const agentMatch = sql.match(/agent_profile_id\s*=\s*\?/)
          if (agentMatch) {
            const agentId = args[args.length - 1] as string
            const pending = table.filter((r) =>
              r.agent_profile_id === agentId && r.status === 'pending'
            ).sort((a, b) => (a.created_at as number) - (b.created_at as number))
            const target = pending[0]
            if (target) {
              target.status = 'claimed'
              const claimedAt = args.find((a) => typeof a === 'number')
              if (claimedAt) target.claimed_at = claimedAt
              return target
            }
          }
          return undefined
        }

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
      }),
      all: vi.fn((...args: unknown[]) => {
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
      }),
    }
  }),
}))

export const initDatabase = vi.fn()
export const closeDatabase = vi.fn()
