# ADR-018: Secrets Backend Migration (safeStorage → KeyFile)

**Status**: Proposed
**Date**: 2026-05-14
**Supersedes**: Part of ADR-017 Phase 3c

## Context

Currently, `core/secrets.ts` uses Electron's `safeStorage` API directly to encrypt/decrypt secrets stored in the SQLite `secrets` table. This creates a hard dependency on the Electron runtime — the daemon cannot decrypt secrets in headless/CLI mode (`bytro-daemon --headless`).

Phase 3b introduced `SecretsBackend` abstraction (`core/secrets-backend.ts`) with two implementations:
- `ElectronSafeStorageBackend` — wraps `safeStorage` (Electron required)
- `KeyFileSecretsBackend` — AES-256-GCM with key file (no Electron dependency)

The daemon-entry.ts (headless mode) already uses `KeyFileSecretsBackend`, but existing secrets in the database were encrypted with `safeStorage` and cannot be decrypted without Electron.

## Decision

### 1. Migrate secrets from safeStorage to KeyFile encryption

One-time migration that re-encrypts all secrets from `safeStorage` → `KeyFileSecretsBackend`:

```
1. Read all rows from `secrets` table
2. For each row encrypted with `electron-safe-storage`:
   a. Decrypt using ElectronSafeStorageBackend
   b. Re-encrypt using KeyFileSecretsBackend
   c. Update the row with new encrypted value + set encryption_backend = 'key-file'
3. Record migration completion in `secrets_migration_state` table
```

### 2. Trigger: Electron shell startup only

Migration requires Electron runtime (`safeStorage.decryptString()`). It triggers in `daemon.ts` in-process mode only:

```typescript
// daemon.ts — in-process mode only
if (secrets.backendName === 'electron-safe-storage') {
  // Create KeyFile backend for migration target
  const keyFileBackend = new KeyFileSecretsBackend(paths.dataDir)
  await migrateSecrets(db, secrets, keyFileBackend)
  // Switch active backend to key-file
  secrets = keyFileBackend
}
```

**Headless guard**: If `daemon-entry.ts` detects `encryption_backend = 'electron-safe-storage'` for any secret, it logs a warning and exits with code 2 (actionable error — user must start Electron shell first).

### 3. Backup strategy: startup counter, not TTL

- Before migration, copy all affected rows to `secrets_backup` table (same schema + `migrated_at` timestamp)
- Backup cleanup uses a **startup counter** instead of TTL:
  - After successful migration, write `migration_verified_count = 0` to `secrets_migration_state`
  - Each daemon startup increments the counter
  - Counter ≥ 5 → auto-cleanup backup table + delete counter
- Manual cleanup: `bytro-daemon --cleanup-secrets-backup` CLI flag

### 4. Idempotency

- Migration checks `secrets_migration_state.status` before running
- If `status = 'completed'`, skip migration entirely
- If `status = 'in_progress'` (crash during migration), resume from last checkpoint
- Individual rows with `encryption_backend = 'key-file'` are skipped (partial migration recovery)

### 5. Schema changes (v32)

```sql
-- Add encryption_backend column to secrets table
ALTER TABLE secrets ADD COLUMN encryption_backend TEXT NOT NULL DEFAULT 'electron-safe-storage';

-- Migration state tracking
CREATE TABLE IF NOT EXISTS secrets_migration_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | completed
  migration_started_at INTEGER,
  migration_completed_at INTEGER,
  rows_migrated INTEGER NOT NULL DEFAULT 0,
  migration_verified_count INTEGER NOT NULL DEFAULT 0
);

-- Backup table (same schema + metadata)
CREATE TABLE IF NOT EXISTS secrets_backup (
  key TEXT PRIMARY KEY,
  encrypted_value BLOB NOT NULL,
  encryption_backend TEXT NOT NULL DEFAULT 'electron-safe-storage',
  migrated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### 6. Rewrite `core/secrets.ts` to use SecretsBackend

Replace direct `safeStorage` calls with `SecretsBackend` interface:

```typescript
// Before (core/secrets.ts)
export const Secrets = {
  set(key, value) {
    const encrypted = safeStorage.encryptString(value)
    db.prepare('INSERT OR REPLACE INTO secrets ...').run(key, encrypted)
  },
  get(key) {
    const row = db.prepare('SELECT encrypted_value FROM secrets WHERE key = ?').get(key)
    return safeStorage.decryptString(row.encrypted_value)
  }
}

// After (core/secrets.ts)
export function createSecretsStore(backend: SecretsBackend): SecretsStore {
  return {
    set(key, value) {
      const encrypted = backend.encrypt(value)
      db.prepare('INSERT OR REPLACE INTO secrets ...').run(key, encrypted, backend.backendName)
    },
    get(key) {
      const row = db.prepare('SELECT encrypted_value FROM secrets WHERE key = ?').get(key)
      return backend.decrypt(row.encrypted_value)
    }
  }
}
```

## Consequences

### Positive
- Daemon can run fully in headless/CLI mode after migration
- No Electron dependency for secrets decryption
- Clean separation: `SecretsBackend` handles encryption, `SecretsStore` handles DB CRUD
- Idempotent migration with crash recovery
- Backup with startup-counter cleanup (no TTL race conditions)

### Negative
- Key file on disk is a slightly weaker security posture than OS keychain (safeStorage)
  - Mitigated by: key file stored in `dataDir` with 0600 permissions, AES-256-GCM with per-value IV
- Migration requires Electron shell to run once
  - Mitigated by: clear error message in headless mode, migration is one-time operation

### Risks
- **Key file loss**: If the key file is deleted, all secrets are unrecoverable
  - Mitigated by: key file is in `dataDir` (same location as SQLite DB), backup strategy
- **Migration crash**: Power loss during re-encryption
  - Mitigated by: per-row migration with backup, `in_progress` state for resume

## Migration Timeline

1. **Schema v32**: Add `encryption_backend` column + migration state tables
2. **Rewrite `core/secrets.ts`**: Use `SecretsBackend` interface
3. **`secrets-migration.ts`**: Migration logic with backup + idempotency
4. **`daemon.ts` trigger**: In-process mode migration on startup
5. **`daemon-entry.ts` guard**: Headless mode startup check
6. **Tests**: Unit tests for migration, integration test for full flow
