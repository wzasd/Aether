import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateSecrets, incrementMigrationVerifiedCount, cleanupBackup } from '../secrets-migration'
import type { SecretsBackend } from '../secrets-backend'

// Mock SecretsBackend implementations for testing
class MockSourceBackend implements SecretsBackend {
  readonly backendName = 'electron-safeStorage' as const

  encrypt(value: string): Buffer {
    return Buffer.from(`SRC:${value}`)
  }

  decrypt(encrypted: Buffer): string {
    const str = encrypted.toString('utf8')
    if (!str.startsWith('SRC:')) {
      throw new Error('MockSourceBackend: cannot decrypt non-source data')
    }
    return str.slice(4)
  }

  isAvailable(): boolean {
    return true
  }
}

class MockTargetBackend implements SecretsBackend {
  readonly backendName = 'key-file' as const

  encrypt(value: string): Buffer {
    return Buffer.from(`TGT:${value}`)
  }

  decrypt(encrypted: Buffer): string {
    const str = encrypted.toString('utf8')
    if (!str.startsWith('TGT:')) {
      throw new Error('MockTargetBackend: cannot decrypt non-target data')
    }
    return str.slice(4)
  }

  isAvailable(): boolean {
    return true
  }
}

// In-memory mock database that simulates SQLite operations
function createMockDb() {
  const secretsTable = new Map<string, { id: string; provider_id: string; encrypted_value: string; encryption_backend: string }>()
  const migrationState: { status: string; rows_migrated: number; migration_verified_count: number } = {
    status: 'pending',
    rows_migrated: 0,
    migration_verified_count: 0,
  }
  const backupTable = new Map<string, { id: string; provider_id: string; encrypted_value: string; encryption_backend: string }>()
  let backupExists = true

  const db = {
    prepare: vi.fn((sql: string) => {
      const upper = sql.trim().toUpperCase()

      return {
        run: vi.fn((...args: unknown[]) => {
          // INSERT INTO secrets_migration_state (with ON CONFLICT)
          if (upper.includes('INSERT') && sql.includes('secrets_migration_state') && sql.includes('ON CONFLICT')) {
            // INSERT ... ON CONFLICT DO UPDATE pattern
            // Determine status from the SQL string (hardcoded as 'completed' or 'partial')
            if (sql.includes("'completed'")) {
              migrationState.status = 'completed'
            } else if (sql.includes("'partial'")) {
              migrationState.status = 'partial'
            } else if (sql.includes("'in_progress'")) {
              migrationState.status = 'in_progress'
            }
            // The numeric args are rows_migrated values
            const rowsMigrated = args[0] as number
            migrationState.rows_migrated = rowsMigrated
            migrationState.migration_verified_count = 0
            return { changes: 1 }
          }

          // Simple INSERT INTO secrets_migration_state
          if (upper.includes('INSERT') && sql.includes('secrets_migration_state')) {
            migrationState.status = (args[1] as string) ?? 'in_progress'
            return { changes: 1 }
          }

          // UPDATE secrets_migration_state
          if (upper.includes('UPDATE') && sql.includes('secrets_migration_state')) {
            if (sql.includes('migration_verified_count')) {
              // Handle both parameterized (=? with args) and hardcoded (=0) SQL
              if (args.length > 0) {
                migrationState.migration_verified_count = args[0] as number
              } else {
                // Hardcoded value in SQL — extract it
                const match = sql.match(/migration_verified_count\s*=\s*(\d+)/)
                migrationState.migration_verified_count = match ? parseInt(match[1]!, 10) : 0
              }
            }
            if (sql.includes('status')) {
              migrationState.status = args[0] as string
            }
            if (sql.includes('rows_migrated') && args.length > 0) {
              migrationState.rows_migrated = args[0] as number
            }
            return { changes: 1 }
          }

          // UPDATE secrets (migration re-encryption)
          if (upper.includes('UPDATE') && sql.includes('secrets') && !sql.includes('migration_state') && !sql.includes('backup')) {
            const id = args[args.length - 1] as string
            const row = secretsTable.get(id)
            if (row) {
              row.encrypted_value = args[0] as string
              row.encryption_backend = args[1] as string
            }
            return { changes: row ? 1 : 0 }
          }

          // INSERT OR IGNORE INTO secrets_backup
          if (upper.includes('INSERT') && sql.includes('secrets_backup')) {
            const id = args[0] as string
            if (!backupTable.has(id)) {
              backupTable.set(id, {
                id: args[0] as string,
                provider_id: args[1] as string,
                encrypted_value: args[2] as string,
                encryption_backend: args[3] as string,
              })
            }
            return { changes: 1 }
          }

          return { changes: 0 }
        }),

        get: vi.fn((...args: unknown[]) => {
          // SELECT from secrets_migration_state
          if (sql.includes('secrets_migration_state')) {
            return migrationState.status !== 'pending' ? migrationState : null
          }

          // SELECT from secrets
          if (sql.includes('secrets') && sql.includes('encryption_backend')) {
            const providerId = args[0] as string
            for (const row of Array.from(secretsTable.values())) {
              if (row.provider_id === providerId) return row
            }
            return undefined
          }

          return undefined
        }),

        all: vi.fn((...args: unknown[]) => {
          // SELECT unmigrated secrets
          if (sql.includes('secrets') && sql.includes('encryption_backend = ?')) {
            const backendName = args[0] as string
            return Array.from(secretsTable.values()).filter(
              (r) => r.encryption_backend === backendName
            )
          }
          return []
        }),
      }
    }),

    exec: vi.fn((sql: string) => {
      if (sql.includes('DROP TABLE') && sql.includes('secrets_backup')) {
        backupTable.clear()
        backupExists = false
      }
    }),

    // db.transaction() — returns the function as-is (synchronous execution)
    transaction: vi.fn((fn: () => void) => {
      return () => fn()
    }),

    // Helper methods for test setup
    _insertSecret(providerId: string, encryptedValue: string, backend: string) {
      secretsTable.set(`cred:${providerId}`, {
        id: `cred:${providerId}`,
        provider_id: providerId,
        encrypted_value: encryptedValue,
        encryption_backend: backend,
      })
    },

    _getSecret(providerId: string) {
      return secretsTable.get(`cred:${providerId}`)
    },

    _getMigrationState() {
      return migrationState
    },

    _backupExists() {
      return backupExists
    },

    _getBackupCount() {
      return backupTable.size
    },
  }

  return db
}

describe('secrets-migration', () => {
  let db: ReturnType<typeof createMockDb>
  let sourceBackend: MockSourceBackend
  let targetBackend: MockTargetBackend

  beforeEach(() => {
    db = createMockDb()
    sourceBackend = new MockSourceBackend()
    targetBackend = new MockTargetBackend()
  })

  describe('migrateSecrets', () => {
    it('migrates all secrets from source to target backend', () => {
      // Insert 3 secrets encrypted with source backend
      db._insertSecret('provider-1', sourceBackend.encrypt('api-key-1').toString('base64'), 'electron-safeStorage')
      db._insertSecret('provider-2', sourceBackend.encrypt('api-key-2').toString('base64'), 'electron-safeStorage')
      db._insertSecret('provider-3', sourceBackend.encrypt('api-key-3').toString('base64'), 'electron-safeStorage')

      const result = migrateSecrets(db as never, sourceBackend, targetBackend)

      expect(result.success).toBe(true)
      expect(result.totalRows).toBe(3)
      expect(result.rowsMigrated).toBe(3)
      expect(result.rowsFailed).toBe(0)

      // Verify all secrets now use target backend
      expect(db._getSecret('provider-1')!.encryption_backend).toBe('key-file')
      expect(db._getSecret('provider-2')!.encryption_backend).toBe('key-file')
      expect(db._getSecret('provider-3')!.encryption_backend).toBe('key-file')

      // Verify migration state is completed
      expect(db._getMigrationState().status).toBe('completed')
    })

    it('skips already-migrated secrets', () => {
      db._insertSecret('provider-1', sourceBackend.encrypt('api-key-1').toString('base64'), 'electron-safeStorage')
      db._insertSecret('provider-2', targetBackend.encrypt('api-key-2').toString('base64'), 'key-file')

      const result = migrateSecrets(db as never, sourceBackend, targetBackend)

      expect(result.success).toBe(true)
      expect(result.totalRows).toBe(1) // Only 1 unmigrated row
      expect(result.rowsMigrated).toBe(1)

      // The already-migrated secret is unchanged
      expect(db._getSecret('provider-2')!.encryption_backend).toBe('key-file')
    })

    it('is idempotent — skips if migration already completed', () => {
      // Mark migration as completed
      db._getMigrationState().status = 'completed'

      const result = migrateSecrets(db as never, sourceBackend, targetBackend)

      expect(result.totalRows).toBe(0)
      expect(result.rowsMigrated).toBe(0)
      expect(result.success).toBe(true)
    })

    it('returns success with 0 rows when no secrets exist', () => {
      const result = migrateSecrets(db as never, sourceBackend, targetBackend)

      expect(result.success).toBe(true)
      expect(result.totalRows).toBe(0)
      expect(result.rowsMigrated).toBe(0)

      // Migration state should be marked as completed
      expect(db._getMigrationState().status).toBe('completed')
    })

    it('creates backup before migration', () => {
      db._insertSecret('provider-1', sourceBackend.encrypt('api-key-1').toString('base64'), 'electron-safeStorage')

      migrateSecrets(db as never, sourceBackend, targetBackend)

      // Verify backup exists (INSERT OR IGNORE was called)
      expect(db._getBackupCount()).toBe(1)
    })

    it('handles decryption failure gracefully', () => {
      // Insert a secret with corrupted encrypted value (not SRC: prefixed)
      db._insertSecret('provider-bad', 'corrupted-value', 'electron-safeStorage')
      db._insertSecret('provider-good', sourceBackend.encrypt('good-key').toString('base64'), 'electron-safeStorage')

      const result = migrateSecrets(db as never, sourceBackend, targetBackend)

      expect(result.rowsFailed).toBe(1)
      expect(result.rowsMigrated).toBe(1)
      expect(result.totalRows).toBe(2)

      // The good secret should be migrated
      expect(db._getSecret('provider-good')!.encryption_backend).toBe('key-file')

      // The bad secret should remain with source backend
      expect(db._getSecret('provider-bad')!.encryption_backend).toBe('electron-safeStorage')
    })

    it('marks migration as partial when some rows fail', () => {
      // Insert a secret with corrupted encrypted value
      db._insertSecret('provider-bad', 'corrupted-value', 'electron-safeStorage')
      db._insertSecret('provider-good', sourceBackend.encrypt('good-key').toString('base64'), 'electron-safeStorage')

      migrateSecrets(db as never, sourceBackend, targetBackend)

      // Migration state should be 'partial', not 'completed'
      expect(db._getMigrationState().status).toBe('partial')
    })

    it('retries failed rows when migration state is partial', () => {
      // First run: one bad, one good
      db._insertSecret('provider-bad', 'corrupted-value', 'electron-safeStorage')
      db._insertSecret('provider-good', sourceBackend.encrypt('good-key').toString('base64'), 'electron-safeStorage')

      const result1 = migrateSecrets(db as never, sourceBackend, targetBackend)
      expect(result1.rowsFailed).toBe(1)
      expect(db._getMigrationState().status).toBe('partial')

      // Fix the bad secret (simulate external fix)
      db._getSecret('provider-bad')!.encrypted_value = sourceBackend.encrypt('fixed-key').toString('base64')

      // Second run: should retry the previously-failed row
      const result2 = migrateSecrets(db as never, sourceBackend, targetBackend)
      expect(result2.rowsMigrated).toBe(1)
      expect(result2.rowsFailed).toBe(0)
      expect(db._getMigrationState().status).toBe('completed')
    })

    it('marks migration as completed after successful migration', () => {
      db._insertSecret('provider-1', sourceBackend.encrypt('api-key-1').toString('base64'), 'electron-safeStorage')

      migrateSecrets(db as never, sourceBackend, targetBackend)

      expect(db._getMigrationState().status).toBe('completed')
      expect(db._getMigrationState().rows_migrated).toBe(1)
    })
  })

  describe('incrementMigrationVerifiedCount', () => {
    it('increments verified count on each call', () => {
      db._getMigrationState().status = 'completed'
      db._getMigrationState().rows_migrated = 3
      db._getMigrationState().migration_verified_count = 0

      incrementMigrationVerifiedCount(db as never)

      expect(db._getMigrationState().migration_verified_count).toBe(1)
    })

    it('does nothing if migration is not completed', () => {
      db._getMigrationState().status = 'pending'

      incrementMigrationVerifiedCount(db as never)

      expect(db._getMigrationState().migration_verified_count).toBe(0)
    })
  })

  describe('cleanupBackup', () => {
    it('drops the secrets_backup table and resets verified count', () => {
      db._getMigrationState().migration_verified_count = 5

      cleanupBackup(db as never)

      expect(db._backupExists()).toBe(false)
      expect(db._getMigrationState().migration_verified_count).toBe(0)
    })
  })
})