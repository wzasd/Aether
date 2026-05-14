/**
 * MachineLock — prevents multiple daemon instances from running simultaneously.
 *
 * Uses mkdir atomic lock + PID/port/startedAt metadata for crash recovery.
 *
 * Lock acquisition:
 *   1. `mkdir(lockDir)` — atomic, succeeds only if no other instance holds the lock
 *   2. Write `{ pid, port, startedAt }` to lockfile — metadata for parent process
 *
 * Lock release:
 *   1. `rmdir(lockDir)` — removes the lock directory
 *
 * Stale lock recovery:
 *   1. Check if PID is alive via `kill(pid, 0)` (Linux/macOS) or process listing
 *   2. If PID is dead → stale lock → clean up and retry
 *   3. If PID is alive but startedAt is unreasonable → stale (Windows PID reuse)
 *   4. 500ms grace period between stale detection and re-acquisition (race prevention)
 *
 * ADR-017: Daemon Independent Process — Phase 3b
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface LockMetadata {
  /** Process ID of the daemon holding the lock */
  readonly pid: number
  /** Port the daemon's Renderer API server is listening on */
  readonly port: number
  /** Timestamp (ms since epoch) when the daemon started */
  readonly startedAt: number
}

export interface AcquireResult {
  /** Whether the lock was successfully acquired */
  readonly acquired: boolean
  /** If acquisition failed, metadata of the existing lock holder */
  readonly existingLock: LockMetadata | null
  /** If a stale lock was cleaned up before acquisition */
  readonly staleLockCleaned: boolean
}

const LOCK_DIR_NAME = '.bytro-daemon-lock'
const LOCK_FILE_NAME = 'lock.json'
const STALE_GRACE_PERIOD_MS = 500

/**
 * Check if a process with the given PID is alive.
 * Uses `kill(pid, 0)` which sends signal 0 (no actual signal, just checks existence).
 * Works on Linux/macOS. On Windows, falls back to process listing.
 */
function isProcessAlive(pid: number): boolean {
  try {
    // kill(pid, 0) throws if process doesn't exist (Linux/macOS)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Read lock metadata from the lockfile.
 * Returns null if the lockfile doesn't exist or is malformed.
 */
function readLockMetadata(lockDir: string): LockMetadata | null {
  const lockFilePath = path.join(lockDir, LOCK_FILE_NAME)
  if (!fs.existsSync(lockFilePath)) return null

  try {
    const content = fs.readFileSync(lockFilePath, 'utf8')
    const parsed = JSON.parse(content) as Partial<LockMetadata>

    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number' || typeof parsed.startedAt !== 'number') {
      return null
    }

    return {
      pid: parsed.pid,
      port: parsed.port,
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

/**
 * Write lock metadata to the lockfile.
 */
function writeLockMetadata(lockDir: string, metadata: LockMetadata): void {
  const lockFilePath = path.join(lockDir, LOCK_FILE_NAME)
  fs.writeFileSync(lockFilePath, JSON.stringify(metadata, null, 2), 'utf8')
}

/**
 * Remove the lock directory (release or clean up stale lock).
 */
function removeLockDir(lockDir: string): void {
  const lockFilePath = path.join(lockDir, LOCK_FILE_NAME)
  if (fs.existsSync(lockFilePath)) {
    fs.unlinkSync(lockFilePath)
  }
  fs.rmdirSync(lockDir)
}

/**
 * Check if a lock appears stale based on PID and startedAt.
 *
 * A lock is stale if:
 * - The PID is not alive (process crashed/exited)
 * - The PID is alive but startedAt is unreasonable (Windows PID reuse)
 */
function isStaleLock(metadata: LockMetadata): boolean {
  // If PID is not alive, lock is definitely stale
  if (!isProcessAlive(metadata.pid)) {
    return true
  }

  // If PID is alive but startedAt is more than 30 days ago,
  // likely a PID reuse scenario (Windows) or extremely long-running stale daemon
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  if (Date.now() - metadata.startedAt > THIRTY_DAYS_MS) {
    return true
  }

  return false
}

/**
 * Acquire the machine lock for the daemon.
 *
 * @param dataDir - The daemon's data directory (lock is placed inside)
 * @param port - The port the daemon's Renderer API server will listen on
 * @returns AcquireResult indicating success or failure
 */
export function acquireLock(dataDir: string, port: number): AcquireResult {
  const lockDir = path.join(dataDir, LOCK_DIR_NAME)

  // Try atomic mkdir — succeeds only if no other instance holds the lock
  try {
    fs.mkdirSync(lockDir)
  } catch (err) {
    // mkdir failed — lock directory already exists
    const existingMetadata = readLockMetadata(lockDir)

    if (existingMetadata && isStaleLock(existingMetadata)) {
      // Stale lock — clean up and retry after grace period
      removeLockDir(lockDir)

      // Grace period to prevent race between stale detection and re-acquisition
      // Use Atomics.wait for true sleep without CPU spinning (Node.js only)
      const sharedBuffer = new Int32Array(new SharedArrayBuffer(4))
      Atomics.wait(sharedBuffer, 0, 0, STALE_GRACE_PERIOD_MS)

      // Retry acquisition
      try {
        fs.mkdirSync(lockDir)
      } catch {
        // Another instance acquired the lock during grace period
        const retryMetadata = readLockMetadata(lockDir)
        return {
          acquired: false,
          existingLock: retryMetadata,
          staleLockCleaned: true,
        }
      }

      // Successfully acquired after cleaning stale lock
      const metadata: LockMetadata = {
        pid: process.pid,
        port,
        startedAt: Date.now(),
      }
      writeLockMetadata(lockDir, metadata)

      return {
        acquired: true,
        existingLock: null,
        staleLockCleaned: true,
      }
    }

    // Lock is held by a live instance
    return {
      acquired: false,
      existingLock: existingMetadata,
      staleLockCleaned: false,
    }
  }

  // Successfully acquired — write metadata
  const metadata: LockMetadata = {
    pid: process.pid,
    port,
    startedAt: Date.now(),
  }
  writeLockMetadata(lockDir, metadata)

  return {
    acquired: true,
    existingLock: null,
    staleLockCleaned: false,
  }
}

/**
 * Release the machine lock.
 *
 * Should be called when the daemon stops gracefully.
 */
export function releaseLock(dataDir: string): void {
  const lockDir = path.join(dataDir, LOCK_DIR_NAME)

  if (fs.existsSync(lockDir)) {
    // Verify we own the lock before releasing
    const metadata = readLockMetadata(lockDir)
    if (metadata && metadata.pid === process.pid) {
      removeLockDir(lockDir)
    }
  }
}

/**
 * Read the current lock metadata (if any).
 * Useful for Electron shell to discover daemon port without polling.
 */
export function readCurrentLock(dataDir: string): LockMetadata | null {
  const lockDir = path.join(dataDir, LOCK_DIR_NAME)
  if (!fs.existsSync(lockDir)) return null
  return readLockMetadata(lockDir)
}