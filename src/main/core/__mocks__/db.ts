import { vi } from 'vitest'

export const getDb = vi.fn(() => ({
  prepare: vi.fn(() => ({
    run: vi.fn(() => ({ changes: 0 })),
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
  })),
}))

export const initDatabase = vi.fn()
export const closeDatabase = vi.fn()
