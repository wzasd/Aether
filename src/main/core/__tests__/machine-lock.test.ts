import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { acquireLock, releaseLock, readCurrentLock, type LockMetadata } from '../machine-lock'

// Use a temp directory for each test
let testDir: string

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytro-lock-test-'))
})

afterEach(() => {
  // Clean up test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true })
  }
})

describe('MachineLock', () => {
  describe('acquireLock', () => {
    it('acquires lock successfully on first attempt', () => {
      const result = acquireLock(testDir, 5175)

      expect(result.acquired).toBe(true)
      expect(result.existingLock).toBeNull()
      expect(result.staleLockCleaned).toBe(false)
    })

    it('writes lock metadata with pid, port, and startedAt', () => {
      acquireLock(testDir, 5175)

      const metadata = readCurrentLock(testDir)
      expect(metadata).not.toBeNull()
      expect(metadata!.pid).toBe(process.pid)
      expect(metadata!.port).toBe(5175)
      expect(metadata!.startedAt).toBeGreaterThan(0)
      expect(metadata!.startedAt).toBeLessThanOrEqual(Date.now())
    })

    it('fails to acquire lock when another instance holds it', () => {
      // First acquisition succeeds
      const result1 = acquireLock(testDir, 5175)
      expect(result1.acquired).toBe(true)

      // Second acquisition fails (same PID but lock dir exists)
      const result2 = acquireLock(testDir, 5176)
      expect(result2.acquired).toBe(false)
      expect(result2.existingLock).not.toBeNull()
      expect(result2.existingLock!.port).toBe(5175)
    })

    it('cleans up stale lock when PID is not alive', () => {
      // Manually create a stale lock with a dead PID
      const lockDir = path.join(testDir, '.bytro-daemon-lock')
      fs.mkdirSync(lockDir)

      const staleMetadata: LockMetadata = {
        pid: 999999999, // Non-existent PID
        port: 5175,
        startedAt: Date.now(),
      }
      fs.writeFileSync(
        path.join(lockDir, 'lock.json'),
        JSON.stringify(staleMetadata, null, 2),
        'utf8'
      )

      // Acquisition should clean up stale lock and succeed
      const result = acquireLock(testDir, 5176)

      expect(result.acquired).toBe(true)
      expect(result.staleLockCleaned).toBe(true)

      // New lock should have our PID and port
      const metadata = readCurrentLock(testDir)
      expect(metadata!.pid).toBe(process.pid)
      expect(metadata!.port).toBe(5176)
    })

    it('cleans up stale lock when startedAt is too old', () => {
      // Create a stale lock with a live PID but unreasonable startedAt
      const lockDir = path.join(testDir, '.bytro-daemon-lock')
      fs.mkdirSync(lockDir)

      const staleMetadata: LockMetadata = {
        pid: process.pid, // Live PID
        port: 5175,
        startedAt: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
      }
      fs.writeFileSync(
        path.join(lockDir, 'lock.json'),
        JSON.stringify(staleMetadata, null, 2),
        'utf8'
      )

      // Acquisition should detect stale lock (startedAt too old)
      const result = acquireLock(testDir, 5176)

      expect(result.acquired).toBe(true)
      expect(result.staleLockCleaned).toBe(true)
    })

    it('does not clean up lock held by a live process with reasonable startedAt', () => {
      // Create a lock with current process PID and recent startedAt
      const lockDir = path.join(testDir, '.bytro-daemon-lock')
      fs.mkdirSync(lockDir)

      const liveMetadata: LockMetadata = {
        pid: process.pid, // Live PID
        port: 5175,
        startedAt: Date.now(),
      }
      fs.writeFileSync(
        path.join(lockDir, 'lock.json'),
        JSON.stringify(liveMetadata, null, 2),
        'utf8'
      )

      // Acquisition should fail — lock is held by a live process
      const result = acquireLock(testDir, 5176)

      expect(result.acquired).toBe(false)
      expect(result.existingLock).not.toBeNull()
      expect(result.existingLock!.pid).toBe(process.pid)
      expect(result.staleLockCleaned).toBe(false)
    })

    it('handles malformed lock file gracefully', () => {
      // Create a lock dir with malformed JSON
      const lockDir = path.join(testDir, '.bytro-daemon-lock')
      fs.mkdirSync(lockDir)
      fs.writeFileSync(path.join(lockDir, 'lock.json'), 'not valid json', 'utf8')

      // Malformed lock file → no metadata → treat as live lock (conservative)
      const result = acquireLock(testDir, 5176)

      expect(result.acquired).toBe(false)
      expect(result.existingLock).toBeNull()
    })

    it('handles missing lock file inside lock dir', () => {
      // Create a lock dir without lock.json
      const lockDir = path.join(testDir, '.bytro-daemon-lock')
      fs.mkdirSync(lockDir)

      // No metadata → treat as live lock (conservative)
      const result = acquireLock(testDir, 5176)

      expect(result.acquired).toBe(false)
      expect(result.existingLock).toBeNull()
    })
  })

  describe('releaseLock', () => {
    it('releases lock held by current process', () => {
      acquireLock(testDir, 5175)
      expect(readCurrentLock(testDir)).not.toBeNull()

      releaseLock(testDir)
      expect(readCurrentLock(testDir)).toBeNull()
    })

    it('does not release lock held by another process', () => {
      // Create a lock with a different PID
      const lockDir = path.join(testDir, '.bytro-daemon-lock')
      fs.mkdirSync(lockDir)

      const otherMetadata: LockMetadata = {
        pid: 999999999,
        port: 5175,
        startedAt: Date.now(),
      }
      fs.writeFileSync(
        path.join(lockDir, 'lock.json'),
        JSON.stringify(otherMetadata, null, 2),
        'utf8'
      )

      // Release should not remove the lock (wrong PID)
      releaseLock(testDir)
      expect(readCurrentLock(testDir)).not.toBeNull()
    })

    it('handles missing lock directory gracefully', () => {
      // No lock exists — should not throw
      expect(() => releaseLock(testDir)).not.toThrow()
    })
  })

  describe('readCurrentLock', () => {
    it('returns null when no lock exists', () => {
      expect(readCurrentLock(testDir)).toBeNull()
    })

    it('returns lock metadata when lock exists', () => {
      acquireLock(testDir, 5175)

      const metadata = readCurrentLock(testDir)
      expect(metadata).not.toBeNull()
      expect(metadata!.pid).toBe(process.pid)
      expect(metadata!.port).toBe(5175)
    })
  })
})