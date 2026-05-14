/**
 * DaemonProcessManager — manages the daemon as a child process.
 *
 * ADR-017 Phase 3b: Electron shell spawns daemon as an independent process
 * via `child_process.fork()`, communicates initial config over Node.js IPC,
 * then disconnects after receiving the 'ready' signal.
 *
 * Lifecycle:
 *   1. fork(daemon-entry.js) — spawn daemon child process
 *   2. Send initial config via IPC (dataDir, port, secrets choice)
 *   3. Wait for 'ready' message from child (timeout: 30s)
 *   4. Call childProcess.disconnect() — daemon is now independent
 *   5. All subsequent communication goes through HTTP (Renderer API + SSE)
 *
 * If Electron crashes, the daemon process survives (it's independent).
 * If the daemon crashes, the lock is released and Electron can restart it.
 */

import { fork, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { readCurrentLock, acquireLock, releaseLock, type LockMetadata } from '../core/machine-lock'
import type { AppPaths } from '../core/app-paths'

export interface DaemonProcessConfig {
  /** Resolved filesystem paths */
  readonly paths: AppPaths
  /** Renderer API port */
  readonly port: number
  /** Whether to run in headless mode */
  readonly headless: boolean
  /** Max time to wait for daemon 'ready' signal (ms) */
  readonly startupTimeoutMs: number
  /** Interval between health checks (ms) */
  readonly healthCheckIntervalMs: number
}

const DEFAULT_PROCESS_CONFIG = {
  startupTimeoutMs: 30_000,
  healthCheckIntervalMs: 500,
}

export interface DaemonReadyEvent {
  readonly type: 'ready'
  readonly pid: number
  readonly port: number
}

export class DaemonProcessManager {
  private config: DaemonProcessConfig
  private childProcess: ChildProcess | null = null
  private ready = false

  constructor(config: DaemonProcessConfig) {
    this.config = { ...DEFAULT_PROCESS_CONFIG, ...config } as DaemonProcessConfig
  }

  /**
   * Start the daemon as a child process.
   *
   * 1. Check if daemon is already running (read lock metadata)
   * 2. If not, fork daemon-entry.js with initial config
   * 3. Wait for 'ready' message from child
   * 4. Disconnect IPC — daemon is now independent
   *
   * @returns LockMetadata with pid and port of the running daemon
   */
  async start(): Promise<LockMetadata> {
    // Check if daemon is already running
    const existingLock = readCurrentLock(this.config.paths.dataDir)
    if (existingLock) {
      // Verify the existing daemon is still alive
      try {
        process.kill(existingLock.pid, 0)
        console.info('[DaemonProcessManager] Daemon already running on port', existingLock.port)
        this.ready = true
        return existingLock
      } catch {
        // Existing daemon is dead — clean up stale lock
        releaseLock(this.config.paths.dataDir)
      }
    }

    // Fork daemon-entry.js
    const daemonEntryPath = this.resolveDaemonEntryPath()

    console.info('[DaemonProcessManager] Forking daemon from:', daemonEntryPath)

    this.childProcess = fork(daemonEntryPath, [
      '--port', String(this.config.port),
      ...(this.config.headless ? ['--headless'] : []),
      '--data-dir', this.config.paths.dataDir,
    ], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })

    // Forward child stdout/stderr to parent
    this.childProcess.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data)
    })
    this.childProcess.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data)
    })

    // Wait for 'ready' message from child
    const readyPromise = new Promise<LockMetadata>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Daemon did not send 'ready' within ${this.config.startupTimeoutMs}ms`))
      }, this.config.startupTimeoutMs)

      const messageHandler = (message: unknown) => {
        if (this.isReadyEvent(message)) {
          clearTimeout(timeout)
          this.childProcess?.off('message', messageHandler)
          resolve({
            pid: message.pid,
            port: message.port,
            startedAt: Date.now(),
          })
        }
      }

      this.childProcess?.on('message', messageHandler)
    })

    // Handle child process exit
    this.childProcess.on('exit', (code, signal) => {
      if (!this.ready) {
        console.error(`[DaemonProcessManager] Daemon exited before ready (code=${code}, signal=${signal})`)
      } else {
        console.info(`[DaemonProcessManager] Daemon exited (code=${code}, signal=${signal})`)
      }
      this.childProcess = null
      this.ready = false
    })

    try {
      const metadata = await readyPromise
      this.ready = true

      // Disconnect IPC — daemon is now fully independent
      // After disconnect, daemon survives even if Electron crashes
      if (this.childProcess?.connected) {
        this.childProcess.disconnect()
        console.info('[DaemonProcessManager] IPC disconnected — daemon is independent')
      }

      return metadata
    } catch (err) {
      // Clean up on failure
      this.kill()
      throw err
    }
  }

  /**
   * Stop the daemon process.
   * Sends SIGTERM and waits for graceful shutdown.
   */
  async stop(): Promise<void> {
    if (!this.childProcess) return

    const pid = this.childProcess.pid
    if (!pid) return

    // Send SIGTERM for graceful shutdown (use childProcess.kill to trigger exit event)
    try {
      this.childProcess.kill('SIGTERM')
    } catch {
      // Process may already be dead
    }

    // Wait for exit (with timeout)
    const exitPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running after 5s
        try {
          this.childProcess?.kill('SIGKILL')
        } catch {
          // Already dead
        }
        resolve()
      }, 5000)

      this.childProcess?.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    await exitPromise
    this.childProcess = null
    this.ready = false
  }

  /**
   * Check if the daemon process is running.
   */
  isRunning(): boolean {
    if (!this.childProcess || !this.childProcess.pid) return false

    try {
      process.kill(this.childProcess.pid, 0)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the daemon's lock metadata (pid, port, startedAt).
   */
  getLockMetadata(): LockMetadata | null {
    return readCurrentLock(this.config.paths.dataDir)
  }

  /**
   * Force-kill the daemon process.
   */
  private kill(): void {
    if (this.childProcess) {
      try {
        this.childProcess.kill('SIGKILL')
      } catch {
        // Already dead
      }
      this.childProcess = null
    }
  }

  /**
   * Resolve the path to daemon-entry.js.
   * In dev mode: dist/main/cli/daemon-entry.js
   * In production: asar.unpacked path (handled by electron-builder)
   */
  private resolveDaemonEntryPath(): string {
    // In development, use the compiled JS file
    const devPath = path.join(__dirname, '..', 'cli', 'daemon-entry.js')

    // In production (Electron packaged app), use asar.unpacked path
    // electron-builder will place the file via extraResources config
    const prodPath = path.join(process.resourcesPath ?? '', 'bytro-daemon.js')

    // Use dev path if it exists, otherwise fall back to production path
    if (fs.existsSync(devPath)) {
      return devPath
    }

    return prodPath
  }

  /**
   * Type guard for DaemonReadyEvent.
   */
  private isReadyEvent(message: unknown): message is DaemonReadyEvent {
    if (typeof message !== 'object' || message === null) return false
    const obj = message as Record<string, unknown>
    return obj.type === 'ready' && typeof obj.pid === 'number' && typeof obj.port === 'number'
  }
}