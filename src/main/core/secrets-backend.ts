/**
 * SecretsBackend — abstracted encryption/decryption, decoupled from Electron's safeStorage.
 *
 * Three implementations:
 * - `ElectronSafeStorageBackend` — wraps Electron's safeStorage (current behavior, macOS/Windows only)
 * - `KeytarSecretsBackend` — uses OS keychain via keytar (equal security to safeStorage, portable)
 * - `KeyFileSecretsBackend` — uses a random 32-byte key file (for Linux/headless without keychain)
 *
 * All daemon code should depend on the `SecretsBackend` interface, never call `safeStorage` directly.
 *
 * Migration strategy:
 * - DB stores `encryption_backend` column per secret
 * - New secrets use the highest-priority available backend
 * - Old secrets are decrypted with their original backend and re-encrypted on next write
 */

import { safeStorage } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export type SecretsBackendName =
  | 'electron-safeStorage'
  | 'key-file'
  // Phase 3c: add 'keytar' when KeytarSecretsBackend is implemented

export interface SecretsBackend {
  /** Encrypt a plaintext string to a Buffer */
  encrypt(value: string): Buffer
  /** Decrypt an encrypted Buffer back to plaintext */
  decrypt(encrypted: Buffer): string
  /** Whether this backend is available on the current platform */
  isAvailable(): boolean
  /** Unique name for this backend (stored in DB for migration tracking) */
  readonly backendName: SecretsBackendName
}

// ---------------------------------------------------------------------------
// Electron safeStorage backend (current behavior)
// ---------------------------------------------------------------------------

/**
 * Wraps Electron's safeStorage API.
 * Available on macOS (Keychain), Windows (DPAPI), Linux (libsecret).
 */
export class ElectronSafeStorageBackend implements SecretsBackend {
  readonly backendName = 'electron-safeStorage' as const

  encrypt(value: string): Buffer {
    return safeStorage.encryptString(value)
  }

  decrypt(encrypted: Buffer): string {
    return safeStorage.decryptString(encrypted)
  }

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }
}

// ---------------------------------------------------------------------------
// Key-file backend (for headless/CLI mode without keychain)
// ---------------------------------------------------------------------------

const KEY_FILE_NAME = '.bytro-encryption-key'
const KEY_LENGTH = 32 // AES-256
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

/**
 * Uses a random 32-byte key file stored in the data directory.
 * The key file is created with chmod 600 (owner read/write only).
 *
 * Security model:
 * - Key file is protected by filesystem permissions (chmod 600)
 * - AES-256-GCM provides authenticated encryption
 * - Key is derived from random bytes (not from machine ID)
 * - Back up the key file to migrate secrets between machines
 */
export class KeyFileSecretsBackend implements SecretsBackend {
  readonly backendName = 'key-file' as const
  private readonly keyFilePath: string
  private cachedKey: Buffer | null = null

  constructor(dataDir: string) {
    this.keyFilePath = path.join(dataDir, KEY_FILE_NAME)
  }

  encrypt(value: string): Buffer {
    const key = this.getOrCreateKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)

    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    // Format: [iv (16 bytes)] [authTag (16 bytes)] [encrypted data]
    return Buffer.concat([iv, authTag, encrypted])
  }

  decrypt(encrypted: Buffer): string {
    const key = this.getKey()
    if (!key) {
      throw new Error('Key file not found — cannot decrypt. Restore the key file or re-create the secret.')
    }

    const iv = encrypted.subarray(0, IV_LENGTH)
    const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const data = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    return decipher.update(data, undefined, 'utf8') + decipher.final('utf8')
  }

  isAvailable(): boolean {
    return true // Always available (no OS dependency)
  }

  private getOrCreateKey(): Buffer {
    if (this.cachedKey) return this.cachedKey

    if (fs.existsSync(this.keyFilePath)) {
      this.cachedKey = fs.readFileSync(this.keyFilePath)
      return this.cachedKey
    }

    // Generate new key — randomBytes(KEY_LENGTH) provides 256 bits of entropy,
    // sufficient for AES-256 without additional KDF stretching
    const newKey = crypto.randomBytes(KEY_LENGTH)
    fs.writeFileSync(this.keyFilePath, newKey, { mode: 0o600 })
    this.cachedKey = newKey
    return newKey
  }

  private getKey(): Buffer | null {
    if (this.cachedKey) return this.cachedKey
    if (!fs.existsSync(this.keyFilePath)) return null

    this.cachedKey = fs.readFileSync(this.keyFilePath)
    return this.cachedKey
  }
}

// ---------------------------------------------------------------------------
// Factory: select the best available backend
// ---------------------------------------------------------------------------

const BACKEND_PRIORITY: SecretsBackendName[] = [
  'electron-safeStorage',
  'key-file',
]

/**
 * Create the highest-priority available SecretsBackend.
 * In Electron: prefers safeStorage (OS keychain)
 * In headless: falls back to key-file
 */
export function createSecretsBackend(
  options: {
    preferElectronSafeStorage?: boolean
    dataDir: string
  }
): SecretsBackend {
  const { preferElectronSafeStorage = true, dataDir } = options

  if (preferElectronSafeStorage) {
    const electronBackend = new ElectronSafeStorageBackend()
    if (electronBackend.isAvailable()) {
      return electronBackend
    }
  }

  return new KeyFileSecretsBackend(dataDir)
}
