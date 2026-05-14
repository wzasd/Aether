/**
 * Unit tests for memory:activate and memory:bulk_activate executors.
 *
 * Uses a mock DB (Map) instead of better-sqlite3 to avoid native module
 * compatibility issues with vitest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock DB ─────────────────────────────────────────────────────────────────

interface MockMemoryItem {
  id: string
  status: string
  title?: string
  content?: string
}

const memoryItems = new Map<string, MockMemoryItem>()

const mockDb = {
  prepare(_sql: string) {
    return {
      get: vi.fn((...args: unknown[]) => {
        const sql = _sql.trim()
        if (sql.startsWith('SELECT id, status') || sql.startsWith('SELECT status')) {
          const id = args[0] as string
          const item = memoryItems.get(id)
          return item ? { id: item.id, status: item.status } : undefined
        }
        return undefined
      }),
      all: vi.fn((...args: unknown[]) => {
        const sql = _sql.trim()
        if (sql.startsWith('SELECT id, status')) {
          // Extract IDs from IN clause args
          return args
            .map((id) => {
              const item = memoryItems.get(id as string)
              return item ? { id: item.id, status: item.status } : undefined
            })
            .filter(Boolean) as Array<{ id: string; status: string }>
        }
        return []
      }),
      run: vi.fn((...args: unknown[]) => {
        const sql = _sql.trim()
        if (sql.startsWith("UPDATE project_memory_items SET status = 'active'")) {
          // Extract IDs from WHERE IN clause
          const ids = args as string[]
          for (const id of ids) {
            const item = memoryItems.get(id)
            if (item && item.status === 'draft') {
              item.status = 'active'
            }
          }
          return { changes: ids.length }
        }
        if (sql.startsWith("UPDATE project_memory_items SET status = 'rejected'")) {
          const ids = args as string[]
          for (const id of ids) {
            const item = memoryItems.get(id)
            if (item && item.status === 'draft') {
              item.status = 'rejected'
            }
          }
          return { changes: ids.length }
        }
        return { changes: 0 }
      }),
    }
  },
}

vi.mock('../../../core/db', () => ({
  getDb: () => mockDb,
}))

// ─── Import after mock ───────────────────────────────────────────────────────

import { memoryActivateExecutor } from '../memory-activate-executor'
import { memoryBulkActivateExecutor } from '../memory-bulk-activate-executor'

// ─── memory:activate ─────────────────────────────────────────────────────────

describe('memoryActivateExecutor', () => {
  beforeEach(() => {
    memoryItems.clear()
  })

  describe('validate', () => {
    it('returns valid for existing draft item', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      const result = await memoryActivateExecutor.validate(
        { memoryItemId: 'item-1' },
        'card-1'
      )
      expect(result.valid).toBe(true)
    })

    it('returns valid for already-active item (idempotent)', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'active' })
      const result = await memoryActivateExecutor.validate(
        { memoryItemId: 'item-1' },
        'card-1'
      )
      expect(result.valid).toBe(true)
    })

    it('returns invalid when item does not exist', async () => {
      const result = await memoryActivateExecutor.validate(
        { memoryItemId: 'nonexistent' },
        'card-1'
      )
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('no longer exists')
    })

    it('returns invalid when item has non-draft/non-active status', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'rejected' })
      const result = await memoryActivateExecutor.validate(
        { memoryItemId: 'item-1' },
        'card-1'
      )
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("has status 'rejected'")
    })

    it('returns invalid when memoryItemId is missing', async () => {
      const result = await memoryActivateExecutor.validate({}, 'card-1')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('missing or invalid')
    })
  })

  describe('execute', () => {
    it('transitions draft to active', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      const result = await memoryActivateExecutor.execute(
        { memoryItemId: 'item-1' },
        'card-1'
      )
      expect(result.success).toBe(true)
      expect(result.result).toEqual({ memoryItemId: 'item-1', status: 'active' })
      expect(memoryItems.get('item-1')?.status).toBe('active')
    })

    it('returns success for already-active item (idempotent)', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'active' })
      const result = await memoryActivateExecutor.execute(
        { memoryItemId: 'item-1' },
        'card-1'
      )
      expect(result.success).toBe(true)
      expect(result.result).toEqual({
        memoryItemId: 'item-1',
        status: 'active',
        alreadyActive: true,
      })
    })

    it('returns failure when item does not exist', async () => {
      const result = await memoryActivateExecutor.execute(
        { memoryItemId: 'nonexistent' },
        'card-1'
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('reject', () => {
    it('transitions draft to rejected', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      await memoryActivateExecutor.reject({ memoryItemId: 'item-1' }, 'card-1')
      expect(memoryItems.get('item-1')?.status).toBe('rejected')
    })

    it('does not transition already-active item', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'active' })
      await memoryActivateExecutor.reject({ memoryItemId: 'item-1' }, 'card-1')
      expect(memoryItems.get('item-1')?.status).toBe('active')
    })

    it('does not throw when item does not exist', async () => {
      await expect(
        memoryActivateExecutor.reject({ memoryItemId: 'nonexistent' }, 'card-1')
      ).resolves.toBeUndefined()
    })

    it('does not transition already-rejected item', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'rejected' })
      await memoryActivateExecutor.reject({ memoryItemId: 'item-1' }, 'card-1')
      expect(memoryItems.get('item-1')?.status).toBe('rejected')
    })
  })
})

// ─── memory:bulk_activate ────────────────────────────────────────────────────

describe('memoryBulkActivateExecutor', () => {
  beforeEach(() => {
    memoryItems.clear()
  })

  describe('validate', () => {
    it('returns valid when at least one draft item exists', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      memoryItems.set('item-2', { id: 'item-2', status: 'active' })
      const result = await memoryBulkActivateExecutor.validate(
        { memoryItemIds: ['item-1', 'item-2', 'item-3'] },
        'card-1'
      )
      expect(result.valid).toBe(true)
    })

    it('returns valid when all items are already active', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'active' })
      const result = await memoryBulkActivateExecutor.validate(
        { memoryItemIds: ['item-1'] },
        'card-1'
      )
      expect(result.valid).toBe(true)
    })

    it('returns invalid when no items exist', async () => {
      const result = await memoryBulkActivateExecutor.validate(
        { memoryItemIds: ['nonexistent'] },
        'card-1'
      )
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('None of the specified')
    })

    it('returns invalid when all items are in non-activatable state', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'rejected' })
      const result = await memoryBulkActivateExecutor.validate(
        { memoryItemIds: ['item-1'] },
        'card-1'
      )
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('non-activatable')
    })

    it('returns invalid when memoryItemIds is empty', async () => {
      const result = await memoryBulkActivateExecutor.validate(
        { memoryItemIds: [] },
        'card-1'
      )
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('non-empty array')
    })

    it('returns invalid when memoryItemIds is not an array', async () => {
      const result = await memoryBulkActivateExecutor.validate(
        { memoryItemIds: 'not-array' },
        'card-1'
      )
      expect(result.valid).toBe(false)
    })
  })

  describe('execute', () => {
    it('activates all draft items', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      memoryItems.set('item-2', { id: 'item-2', status: 'draft' })
      const result = await memoryBulkActivateExecutor.execute(
        { memoryItemIds: ['item-1', 'item-2'] },
        'card-1'
      )
      expect(result.success).toBe(true)
      expect(result.result).toEqual({
        activated: 2,
        alreadyActive: 0,
        total: 2,
      })
      expect(memoryItems.get('item-1')?.status).toBe('active')
      expect(memoryItems.get('item-2')?.status).toBe('active')
    })

    it('skips already-active items', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      memoryItems.set('item-2', { id: 'item-2', status: 'active' })
      const result = await memoryBulkActivateExecutor.execute(
        { memoryItemIds: ['item-1', 'item-2'] },
        'card-1'
      )
      expect(result.success).toBe(true)
      expect(result.result).toEqual({
        activated: 1,
        alreadyActive: 1,
        total: 2,
      })
    })

    it('returns failure when no items found', async () => {
      const result = await memoryBulkActivateExecutor.execute(
        { memoryItemIds: ['nonexistent'] },
        'card-1'
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('No memory items found')
    })
  })

  describe('reject', () => {
    it('transitions all draft items to rejected', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      memoryItems.set('item-2', { id: 'item-2', status: 'draft' })
      await memoryBulkActivateExecutor.reject(
        { memoryItemIds: ['item-1', 'item-2'] },
        'card-1'
      )
      expect(memoryItems.get('item-1')?.status).toBe('rejected')
      expect(memoryItems.get('item-2')?.status).toBe('rejected')
    })

    it('does not transition already-active items', async () => {
      memoryItems.set('item-1', { id: 'item-1', status: 'draft' })
      memoryItems.set('item-2', { id: 'item-2', status: 'active' })
      await memoryBulkActivateExecutor.reject(
        { memoryItemIds: ['item-1', 'item-2'] },
        'card-1'
      )
      expect(memoryItems.get('item-1')?.status).toBe('rejected')
      expect(memoryItems.get('item-2')?.status).toBe('active')
    })
  })
})
