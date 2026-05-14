/**
 * Daemon — Electron adapter layer wrapping DaemonCore or DaemonProcessManager.
 *
 * ADR-017 (Step 3): The Daemon class supports two modes:
 * - **In-process mode** (default during Phase 3b): Creates DaemonCore with
 *   Electron-specific wiring (AppPaths, SecretsBackend, WebContents).
 *   All communication is in-process.
 * - **Fork mode** (Phase 3c+): Spawns daemon-entry.js as a child process
 *   via DaemonProcessManager. Communication goes through HTTP (Renderer API + SSE).
 *   After fork, IPC is disconnected — daemon survives Electron crashes.
 *
 * Mode selection:
 * - `BYTRO_DAEMON_MODE=in-process` (default) — in-process DaemonCore
 * - `BYTRO_DAEMON_MODE=fork` — fork daemon-entry.js as child process
 *
 * During Phase 3a-3b, in-process mode is the default. After all IPC handlers
 * are migrated to HTTP (Phase 3d), fork mode becomes the default.
 */

import type { WebContents } from 'electron'
import type { SessionConfig } from '../ai/provider'
import type { AgentProfile } from '../ai/a2a-types'
import { DaemonCore, type DaemonCoreConfig } from './daemon-core'
import { DaemonProcessManager, type DaemonProcessConfig } from './daemon-process-manager'
import { createElectronAppPaths } from '../core/app-paths'
import { createSecretsBackend, KeyFileSecretsBackend } from '../core/secrets-backend'
import { initSecretsStore } from '../core/secrets'
import { migrateSecrets, incrementMigrationVerifiedCount } from '../core/secrets-migration'
import { getDb } from '../core/db'
import { sseBroadcaster } from './sse-broadcaster'

export type DaemonMode = 'in-process' | 'fork'

export interface DaemonConfig {
  maxConcurrentTasks: number
  pollIntervalMs: number
  daemonHeartbeatIntervalMs: number
  mode: DaemonMode
}

const DEFAULT_CONFIG: DaemonConfig = {
  maxConcurrentTasks: 3,
  pollIntervalMs: 500,
  daemonHeartbeatIntervalMs: 30000,
  mode: process.env.BYTRO_DAEMON_MODE === 'fork' ? 'fork' : 'in-process',
}

const DEFAULT_RENDERER_PORT = parseInt(process.env.BYTRO_RENDERER_API_PORT || '5175', 10)

export class Daemon {
  private config: DaemonConfig
  private core: DaemonCore | null = null
  private processManager: DaemonProcessManager | null = null
  private webContents: WebContents | null = null
  private mode: DaemonMode

  constructor(config: Partial<DaemonConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.mode = this.config.mode

    if (this.mode === 'in-process') {
      this.initInProcessMode()
    }
    // Fork mode is initialized in start() when we have the webContents
  }

  /** Initialize the daemon with profiles and config */
  async initialize(
    profiles: AgentProfile[],
    baseConfig: SessionConfig,
    webContents: WebContents
  ): Promise<void> {
    this.webContents = webContents

    if (this.mode === 'in-process' && this.core) {
      await this.core.initialize(profiles, baseConfig)
    }
    // Fork mode: profiles are loaded by daemon-entry.ts from DB
  }

  /** Start the daemon */
  async start(): Promise<void> {
    if (this.mode === 'in-process') {
      await this.startInProcess()
    } else {
      await this.startFork()
    }
  }

  /** Stop the daemon */
  async stop(): Promise<void> {
    if (this.mode === 'in-process' && this.core) {
      await this.core.stop()
      sseBroadcaster.setWebContents(null)
    } else if (this.processManager) {
      await this.processManager.stop()
    }
  }

  /** User sends a message — delegates to DaemonCore or HTTP */
  async onUserMessage(
    conversationId: string,
    message: string,
    context: Array<{ role: string; content: string }>
  ): Promise<void> {
    if (this.mode === 'in-process' && this.core) {
      await this.core.onUserMessage(conversationId, message, context)
    } else {
      // Fork mode: send via Renderer API HTTP endpoint
      await this.sendViaHttp('POST', `/api/conversations/${conversationId}/messages`, {
        message,
        context,
      })
    }
  }

  /** Abort all tasks for a conversation */
  abortConversation(conversationId: string): void {
    if (this.mode === 'in-process' && this.core) {
      this.core.abortConversation(conversationId)
    } else {
      // Fork mode: send via Renderer API HTTP endpoint
      this.sendViaHttp('POST', `/api/conversations/${conversationId}/abort`, {}).catch((err) => {
        console.error('[Daemon] abort via HTTP failed:', err)
      })
    }
  }

  /** Check if daemon is running */
  isRunning(): boolean {
    if (this.mode === 'in-process' && this.core) {
      return this.core.isRunning()
    }
    if (this.processManager) {
      return this.processManager.isRunning()
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // In-process mode
  // ---------------------------------------------------------------------------

  private initInProcessMode(): void {
    const paths = createElectronAppPaths()
    let secrets = createSecretsBackend({
      preferElectronSafeStorage: true,
      dataDir: paths.dataDir,
    })

    // ADR-018 Phase 3c: Migrate secrets from safeStorage → KeyFile
    // Only runs in Electron (in-process) mode — safeStorage.decryptString() requires Electron.
    if (secrets.backendName === 'electron-safeStorage') {
      const keyFileBackend = new KeyFileSecretsBackend(paths.dataDir)
      const db = getDb()
      const result = migrateSecrets(db, secrets, keyFileBackend)

      if (result.success) {
        console.info('[Daemon] Secrets migration completed:', result.rowsMigrated, 'rows migrated')
        // Switch to key-file backend after successful migration
        secrets = keyFileBackend
      } else {
        console.error('[Daemon] Secrets migration failed:', result.rowsFailed, 'rows failed')
        // Continue with electron-safe-storage — migration will retry on next startup
      }
    } else {
      // Already using key-file — increment verified count for backup cleanup
      const db = getDb()
      incrementMigrationVerifiedCount(db)
    }

    // Initialize the SecretsStore singleton for legacy callers
    initSecretsStore(secrets)

    const coreConfig: DaemonCoreConfig = {
      paths,
      secrets,
      rendererPort: DEFAULT_RENDERER_PORT,
      headless: false,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      pollIntervalMs: this.config.pollIntervalMs,
      daemonHeartbeatIntervalMs: this.config.daemonHeartbeatIntervalMs,
    }

    this.core = new DaemonCore(coreConfig)
  }

  private async startInProcess(): Promise<void> {
    sseBroadcaster.setWebContents(this.webContents)
    await this.core!.start()
  }

  // ---------------------------------------------------------------------------
  // Fork mode
  // ---------------------------------------------------------------------------

  private async startFork(): Promise<void> {
    const paths = createElectronAppPaths()

    const processConfig: DaemonProcessConfig = {
      paths,
      port: DEFAULT_RENDERER_PORT,
      headless: false,
      startupTimeoutMs: 30_000,
      healthCheckIntervalMs: 500,
    }

    this.processManager = new DaemonProcessManager(processConfig)

    const metadata = await this.processManager.start()
    console.info('[Daemon] Forked daemon process — PID:', metadata.pid, 'port:', metadata.port)

    // Wire SSE broadcaster with webContents for backward compatibility
    // (In fork mode, SSE comes from the daemon's Renderer API server)
    sseBroadcaster.setWebContents(this.webContents)
  }

  // ---------------------------------------------------------------------------
  // HTTP helper for fork mode
  // ---------------------------------------------------------------------------

  private async sendViaHttp(method: string, path: string, body: unknown): Promise<void> {
    const lock = this.processManager?.getLockMetadata()
    if (!lock) {
      throw new Error('[Daemon] Cannot send via HTTP — daemon lock metadata not available')
    }

    const url = `http://127.0.0.1:${lock.port}${path}`
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`[Daemon] HTTP ${method} ${path} failed: ${response.status} ${response.statusText}`)
    }
  }
}

/** Singleton daemon instance */
export const daemon = new Daemon()