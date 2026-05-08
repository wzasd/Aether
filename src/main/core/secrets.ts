import { safeStorage } from 'electron'
import { getDb } from './db'

function keyFor(providerId: string): string {
  return `cred:${providerId}`
}

export const Secrets = {
  set(providerId: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform')
    }
    const encrypted = safeStorage.encryptString(value)
    const db = getDb()
    db.prepare(
      `INSERT INTO secrets (id, provider_id, encrypted_value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(provider_id) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = datetime('now')`
    ).run(keyFor(providerId), providerId, encrypted.toString('base64'))
  },

  get(providerId: string): string | null {
    const db = getDb()
    const row = db.prepare(
      'SELECT encrypted_value FROM secrets WHERE provider_id = ?'
    ).get(providerId) as { encrypted_value: string } | undefined
    if (!row) return null
    return safeStorage.decryptString(Buffer.from(row.encrypted_value, 'base64'))
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
  }
}
