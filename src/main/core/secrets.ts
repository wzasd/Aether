/**
 * Secrets — DB CRUD for encrypted secrets, using SecretsBackend for encryption.
 *
 * Replaces direct safeStorage calls with the SecretsBackend interface,
 * enabling headless/CLI mode after migration (ADR-018 Phase 3c).
 *
 * The encryption_backend column tracks which backend encrypted each secret,
 * supporting gradual migration from electron-safeStorage → key-file.
 *
 * Transition plan:
 * - Phase 3c: `initSecretsStore(backend)` sets the singleton backend
 * - Phase 3d: IPC handlers → HTTP endpoints will use createSecretsStore() directly
 * - Phase 3e: Remove legacy `Secrets` singleton object
 */

import type { SecretsBackend, SecretsBackendName } from './secrets-backend'
import { getDb } from './db'

// ---------------------------------------------------------------------------
// SecretsStore interface (new, injectable)
// ---------------------------------------------------------------------------

export interface SecretsStore {
  /** Encrypt and persist a secret value */
  set(providerId: string, value: string): void
  /** Decrypt and retrieve a secret value (null if not found) */
  get(providerId: string): string | null
  /** Check if a secret exists */
  has(providerId: string): boolean
  /** Delete a secret */
  delete(providerId: string): void
  /** Get the encryption backend name used by this store */
  readonly backendName: SecretsBackendName
}

/**
 * Create a SecretsStore backed by the given SecretsBackend.
 *
 * On write: encrypts with the current backend and stores encryption_backend name.
 * On read: decrypts with the current backend (assumes migration has re-encrypted).
 */
export function createSecretsStore(backend: SecretsBackend): SecretsStore {
  return {
    get backendName(): SecretsBackendName {
      return backend.backendName
    },

    set(providerId: string, value: string): void {
      const encrypted = backend.encrypt(value)
      const db = getDb()
      db.prepare(
        `INSERT INTO secrets (id, provider_id, encrypted_value, encryption_backend, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(provider_id) DO UPDATE SET
           encrypted_value = excluded.encrypted_value,
           encryption_backend = excluded.encryption_backend,
           updated_at = datetime('now')`
      ).run(`cred:${providerId}`, providerId, encrypted.toString('base64'), backend.backendName)
    },

    get(providerId: string): string | null {
      const db = getDb()
      const row = db.prepare(
        'SELECT encrypted_value, encryption_backend FROM secrets WHERE provider_id = ?'
      ).get(providerId) as { encrypted_value: string; encryption_backend: string } | undefined

      if (!row) return null

      if (row.encryption_backend !== backend.backendName) {
        throw new Error(
          `Secret '${providerId}' encrypted with '${row.encryption_backend}', ` +
          `but current backend is '${backend.backendName}'. ` +
          `Run migration first (start Electron shell to trigger safeStorage → key-file migration).`
        )
      }

      return backend.decrypt(Buffer.from(row.encrypted_value, 'base64'))
    },

    has(providerId: string): boolean {
      const db = getDb()
      const row = db.prepare(
        'SELECT 1 FROM secrets WHERE provider_id = ?'
      ).get(providerId)
      return row !== undefined
    },

    delete(providerId: string): void {
      const db = getDb()
      db.prepare('DELETE FROM secrets WHERE provider_id = ?').run(providerId)
    },
  }
}

// ---------------------------------------------------------------------------
// Legacy singleton — backward-compatible API for existing callers
// ---------------------------------------------------------------------------

let storeBackend: SecretsBackend | null = null

/**
 * Initialize the legacy Secrets singleton with a SecretsBackend.
 * Called by daemon.ts after creating the backend.
 */
export function initSecretsStore(backend: SecretsBackend): void {
  storeBackend = backend
}

function getStoreBackend(): SecretsBackend {
  if (!storeBackend) {
    throw new Error('SecretsStore not initialized — call initSecretsStore() first')
  }
  return storeBackend
}

/**
 * Legacy Secrets object — backward-compatible with existing callers.
 * Will be removed in Phase 3e after all callers use createSecretsStore() directly.
 *
 * @deprecated Use createSecretsStore(backend) instead
 */
export const Secrets = {
  set(providerId: string, value: string): void {
    const backend = getStoreBackend()
    const encrypted = backend.encrypt(value)
    const db = getDb()
    db.prepare(
      `INSERT INTO secrets (id, provider_id, encrypted_value, encryption_backend, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(provider_id) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         encryption_backend = excluded.encryption_backend,
         updated_at = datetime('now')`
    ).run(`cred:${providerId}`, providerId, encrypted.toString('base64'), backend.backendName)
  },

  get(providerId: string): string | null {
    const backend = getStoreBackend()
    const db = getDb()
    const row = db.prepare(
      'SELECT encrypted_value, encryption_backend FROM secrets WHERE provider_id = ?'
    ).get(providerId) as { encrypted_value: string; encryption_backend: string } | undefined

    if (!row) return null

    return backend.decrypt(Buffer.from(row.encrypted_value, 'base64'))
  },

  has(providerId: string): boolean {
    const db = getDb()
    const row = db.prepare(
      'SELECT 1 FROM secrets WHERE provider_id = ?'
    ).get(providerId)
    return row !== undefined
  },

  delete(providerId: string): void {
    const db = getDb()
    db.prepare('DELETE FROM secrets WHERE provider_id = ?').run(providerId)
  },
}

// ---------------------------------------------------------------------------
// Migration utilities
// ---------------------------------------------------------------------------

/**
 * Check if any secrets still use electron-safe-storage encryption.
 * Used by daemon-entry.ts headless guard to prevent startup with unmigrated secrets.
 */
export function hasUnmigratedSecrets(): boolean {
  const db = getDb()
  const row = db.prepare(
    "SELECT 1 FROM secrets WHERE encryption_backend = 'electron-safe-storage' LIMIT 1"
  ).get()
  return row !== undefined
}