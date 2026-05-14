/**
 * secrets-migration.ts — One-time migration of secrets from safeStorage → KeyFile.
 *
 * ADR-018 Phase 3c: Re-encrypts all secrets from ElectronSafeStorageBackend
 * to KeyFileSecretsBackend, enabling headless/CLI mode.
 *
 * Safety guarantees:
 * - Idempotent: can be safely re-run, skips already-migrated rows
 * - Backup: copies pre-migration encrypted values to secrets_backup table
 * - Crash recovery: tracks progress in secrets_migration_state (pending → in_progress → completed)
 * - Startup counter: backup auto-cleaned after 5 successful daemon startups
 *
 * Trigger: daemon.ts in-process mode only (requires Electron for safeStorage.decryptString)
 */

import type { Database } from 'better-sqlite3'
import type { SecretsBackend } from './secrets-backend'
import { writeObservabilityEvent } from './logging'

export interface MigrationResult {
  /** Total secrets that needed migration */
  readonly totalRows: number
  /** Successfully migrated rows */
  readonly rowsMigrated: number
  /** Rows skipped (already migrated) */
  readonly rowsSkipped: number
  /** Rows that failed to migrate */
  readonly rowsFailed: number
  /** Whether the migration completed successfully */
  readonly success: boolean
}

interface SecretRow {
  readonly id: string
  readonly provider_id: string
  readonly encrypted_value: string
  readonly encryption_backend: string
}

interface MigrationState {
  readonly status: string
  readonly rows_migrated: number
  readonly migration_verified_count: number
}

const BACKUP_CLEANUP_THRESHOLD = 5

/**
 * Run the secrets migration from sourceBackend → targetBackend.
 *
 * @param db - The database instance
 * @param sourceBackend - The backend that encrypted the existing secrets (e.g. ElectronSafeStorage)
 * @param targetBackend - The backend to re-encrypt with (e.g. KeyFileSecrets)
 * @returns MigrationResult with counts and success status
 */
export function migrateSecrets(
  db: Database,
  sourceBackend: SecretsBackend,
  targetBackend: SecretsBackend
): MigrationResult {
  // Check migration state — skip if already completed
  const state = getMigrationState(db)
  if (state?.status === 'completed') {
    return {
      totalRows: 0,
      rowsMigrated: 0,
      rowsSkipped: 0,
      rowsFailed: 0,
      success: true,
    }
  }

  // Treat 'partial' as 'in_progress' — retry failed rows on next startup
  // (no special handling needed — the query below finds all unmigrated rows)

  // Find all secrets that still use the source backend
  const unmigratedRows = db.prepare(
    `SELECT id, provider_id, encrypted_value, encryption_backend
     FROM secrets
     WHERE encryption_backend = ?`
  ).all(sourceBackend.backendName) as SecretRow[]

  if (unmigratedRows.length === 0) {
    // No secrets to migrate — mark as completed
    markMigrationCompleted(db, 0)
    return {
      totalRows: 0,
      rowsMigrated: 0,
      rowsSkipped: 0,
      rowsFailed: 0,
      success: true,
    }
  }

  // Mark migration as in_progress
  markMigrationStarted(db)

  // Backup all rows before migration
  backupSecrets(db, unmigratedRows)

  // Migrate each row
  let rowsMigrated = 0
  let rowsFailed = 0

  const updateStmt = db.prepare(
    `UPDATE secrets
     SET encrypted_value = ?, encryption_backend = ?, updated_at = datetime('now')
     WHERE id = ?`
  )

  for (const row of unmigratedRows) {
    try {
      // Decrypt with source backend
      const decrypted = sourceBackend.decrypt(Buffer.from(row.encrypted_value, 'base64'))

      // Re-encrypt with target backend
      const reEncrypted = targetBackend.encrypt(decrypted)

      // Update the row
      updateStmt.run(reEncrypted.toString('base64'), targetBackend.backendName, row.id)
      rowsMigrated++
    } catch (err) {
      rowsFailed++
      writeObservabilityEvent('secrets_migration:row_failed', {
        id: row.id,
        providerId: row.provider_id,
        error: String(err),
      })
    }
  }

  // Mark migration as completed or partial depending on failures
  if (rowsFailed > 0) {
    markMigrationPartial(db, rowsMigrated, rowsFailed)
  } else {
    markMigrationCompleted(db, rowsMigrated)
  }

  writeObservabilityEvent('secrets_migration:completed', {
    totalRows: unmigratedRows.length,
    rowsMigrated,
    rowsFailed,
  })

  return {
    totalRows: unmigratedRows.length,
    rowsMigrated,
    rowsSkipped: 0,
    rowsFailed,
    success: rowsFailed === 0,
  }
}

/**
 * Increment the migration verified counter on each daemon startup.
 * Auto-cleans the backup table when counter reaches threshold.
 */
export function incrementMigrationVerifiedCount(db: Database): void {
  const state = getMigrationState(db)
  if (!state || state.status !== 'completed') return

  const newCount = state.migration_verified_count + 1

  db.prepare(
    `UPDATE secrets_migration_state
     SET migration_verified_count = ?
     WHERE id = 1`
  ).run(newCount)

  if (newCount >= BACKUP_CLEANUP_THRESHOLD) {
    cleanupBackup(db)
  }
}

/**
 * Manually clean up the secrets_backup table.
 * Called by `bytro-daemon --cleanup-secrets-backup` or auto after threshold.
 */
export function cleanupBackup(db: Database): void {
  db.exec('DROP TABLE IF EXISTS secrets_backup')

  // Reset the verified counter
  db.prepare(
    `UPDATE secrets_migration_state
     SET migration_verified_count = 0
     WHERE id = 1`
  ).run()

  writeObservabilityEvent('secrets_migration:backup_cleaned', {})
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getMigrationState(db: Database): MigrationState | null {
  return db.prepare(
    'SELECT status, rows_migrated, migration_verified_count FROM secrets_migration_state WHERE id = 1'
  ).get() as MigrationState | null
}

function markMigrationStarted(db: Database): void {
  db.prepare(
    `INSERT INTO secrets_migration_state (id, status, migration_started_at, rows_migrated)
     VALUES (1, 'in_progress', unixepoch(), 0)
     ON CONFLICT(id) DO UPDATE SET
       status = 'in_progress',
       migration_started_at = unixepoch()`
  ).run()
}

function markMigrationCompleted(db: Database, rowsMigrated: number): void {
  db.prepare(
    `INSERT INTO secrets_migration_state (id, status, migration_completed_at, rows_migrated, migration_verified_count)
     VALUES (1, 'completed', unixepoch(), ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       status = 'completed',
       migration_completed_at = unixepoch(),
       rows_migrated = ?,
       migration_verified_count = 0`
  ).run(rowsMigrated, rowsMigrated)
}

function markMigrationPartial(db: Database, rowsMigrated: number, rowsFailed: number): void {
  // Mark as 'partial' — not all rows migrated, will retry on next startup
  db.prepare(
    `INSERT INTO secrets_migration_state (id, status, migration_started_at, rows_migrated, migration_verified_count)
     VALUES (1, 'partial', unixepoch(), ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       status = 'partial',
       migration_started_at = unixepoch(),
       rows_migrated = ?`
  ).run(rowsMigrated, rowsMigrated)

  writeObservabilityEvent('secrets_migration:partial', {
    rowsMigrated,
    rowsFailed,
  })
}

function backupSecrets(db: Database, rows: SecretRow[]): void {
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO secrets_backup (id, provider_id, encrypted_value, encryption_backend)
     VALUES (?, ?, ?, ?)`
  )

  const backupTransaction = db.transaction(() => {
    for (const row of rows) {
      insertStmt.run(row.id, row.provider_id, row.encrypted_value, row.encryption_backend)
    }
  })

  backupTransaction()
}
