/**
 * daemon-entry.ts — CLI entry point for running the daemon as an independent process.
 *
 * Usage:
 *   node dist/main/cli/daemon-entry.js [options]
 *   bytro-daemon [options]
 *
 * Options:
 *   --headless       Run without Electron shell (no GUI)
 *   --data-dir DIR   Override data directory
 *   --port PORT      Override Renderer API port (default: 5175)
 *   --help           Show help
 *
 * ADR-017: Daemon Independent Process — Phase 3b
 *
 * Lifecycle:
 *   1. Parse CLI flags
 *   2. Create AppPaths (standalone — no Electron dependency)
 *   3. Initialize DB (required for loading profiles)
 *   4. Acquire machine lock (prevent duplicate instances)
 *   5. Create SecretsBackend
 *   6. Load agent profiles + session config from DB
 *   7. Instantiate DaemonCore with injected config
 *   8. Initialize + start DaemonCore
 *   9. Send 'ready' message to parent process (if forked)
 *  10. Register graceful shutdown handlers (SIGINT, SIGTERM)
 */

import { DaemonCore, type DaemonCoreConfig } from '../daemon/daemon-core'
import { createStandaloneAppPaths, type AppPaths } from '../core/app-paths'
import { createSecretsBackend } from '../core/secrets-backend'
import { acquireLock, releaseLock, type AcquireResult } from '../core/machine-lock'
import { loadEnabledProfiles, loadSessionConfig } from '../core/load-daemon-config'
import { initDatabaseWithPath, getDb } from '../core/db'
import { hasUnmigratedSecrets } from '../core/secrets'
import { incrementMigrationVerifiedCount, cleanupBackup } from '../core/secrets-migration'
import { writeObservabilityEvent } from '../core/logging'
import * as path from 'path'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliOptions {
  headless: boolean
  dataDir: string | null
  port: number | null
  cleanupSecretsBackup: boolean
  help: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    headless: false,
    dataDir: null,
    port: null,
    cleanupSecretsBackup: false,
    help: false,
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]

    switch (arg) {
      case '--headless':
        options.headless = true
        break
      case '--data-dir':
        if (i + 1 >= argv.length || argv[i + 1]?.startsWith('--')) {
          console.error('[daemon-entry] --data-dir requires a value')
          process.exit(1)
        }
        options.dataDir = argv[++i]
        break
      case '--port':
        if (i + 1 >= argv.length || argv[i + 1]?.startsWith('--')) {
          console.error('[daemon-entry] --port requires a value')
          process.exit(1)
        }
        options.port = parseInt(argv[++i] ?? '', 10)
        if (Number.isNaN(options.port)) {
          console.error('[daemon-entry] Invalid --port value')
          process.exit(1)
        }
        break
      case '--cleanup-secrets-backup':
        options.cleanupSecretsBackup = true
        break
      case '--help':
        options.help = true
        break
      default:
        console.error(`[daemon-entry] Unknown option: ${arg}`)
        process.exit(1)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`
bytro-daemon — Bytro daemon process

Usage:
  bytro-daemon [options]

Options:
  --headless                   Run without Electron shell (no GUI)
  --data-dir DIR               Override data directory
  --port PORT                  Override Renderer API port (default: 5175)
  --cleanup-secrets-backup     Remove secrets backup table after migration
  --help                       Show this help message
`)
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv)

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  const rendererPort = options.port ?? parseInt(process.env.BYTRO_RENDERER_API_PORT || '5175', 10)

  // Step 1: Create AppPaths (standalone mode — no Electron dependency)
  const pathOverrides: Record<string, string> = {}
  if (options.dataDir) {
    pathOverrides.dataDir = options.dataDir
  }

  const paths = createStandaloneAppPaths(pathOverrides as Partial<AppPaths>)

  // Handle --cleanup-secrets-backup before daemon startup.
  // Note: This runs before acquiring the machine lock. Acceptable because:
  //   1. Cleanup is a one-time manual operation
  //   2. Concurrent cleanup is idempotent (DROP TABLE IF EXISTS)
  //   3. No data corruption risk — backup table is only read during migration
  if (options.cleanupSecretsBackup) {
    const dbPath = path.join(paths.dataDir, 'bytro.db')
    initDatabaseWithPath(dbPath)
    const db = getDb()
    cleanupBackup(db)
    console.info('[daemon-entry] Secrets backup cleaned up successfully')
    process.exit(0)
  }

  console.info('[daemon-entry] Data directory:', paths.dataDir)
  console.info('[daemon-entry] Log directory:', paths.logDir)

  // Step 2: Initialize DB (required for loading profiles)
  const dbPath = path.join(paths.dataDir, 'bytro.db')
  initDatabaseWithPath(dbPath)

  // Step 3: Acquire machine lock (prevent duplicate instances)
  const lockResult: AcquireResult = acquireLock(paths.dataDir, rendererPort)

  if (!lockResult.acquired) {
    if (lockResult.existingLock) {
      console.error(
        '[daemon-entry] Another daemon instance is already running',
        `(PID ${lockResult.existingLock.pid}, port ${lockResult.existingLock.port})`
      )
    } else {
      console.error('[daemon-entry] Failed to acquire machine lock')
    }
    process.exit(1)
  }

  if (lockResult.staleLockCleaned) {
    console.info('[daemon-entry] Cleaned up stale lock from previous session')
  }

  // Step 4: Create SecretsBackend (prefer key-file in headless mode)
  const secrets = createSecretsBackend({
    preferElectronSafeStorage: false, // CLI mode — no Electron safeStorage available
    dataDir: paths.dataDir,
  })

  console.info('[daemon-entry] Secrets backend:', secrets.backendName)

  // Step 4b: Headless guard — cannot decrypt safeStorage-encrypted secrets without Electron
  if (hasUnmigratedSecrets()) {
    console.error(
      '[daemon-entry] ERROR: Found secrets encrypted with electron-safeStorage.',
      'Start the Electron app first to migrate secrets to key-file encryption.',
      'After migration, headless mode will work normally.'
    )
    releaseLock(paths.dataDir)
    process.exit(2)
  }

  // Increment migration verified count (for backup auto-cleanup)
  const db = getDb()
  incrementMigrationVerifiedCount(db)

  // Step 5: Load agent profiles + session config from DB
  const profiles = loadEnabledProfiles()
  const baseConfig = loadSessionConfig()

  console.info('[daemon-entry] Loaded', profiles.length, 'enabled agent profiles')

  // Step 6: Build DaemonCoreConfig
  const coreConfig: DaemonCoreConfig = {
    paths,
    secrets,
    rendererPort,
    headless: options.headless,
    maxConcurrentTasks: 3,
    pollIntervalMs: 500,
    daemonHeartbeatIntervalMs: 30000,
  }

  // Step 7: Instantiate + initialize DaemonCore
  const daemon = new DaemonCore(coreConfig)
  await daemon.initialize(profiles, baseConfig)

  // Step 8: Graceful shutdown handler
  let shuttingDown = false

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    console.info(`[daemon-entry] Received ${signal}, shutting down...`)

    try {
      await daemon.stop()
    } catch (err) {
      console.error('[daemon-entry] Error during shutdown:', err)
    }

    releaseLock(paths.dataDir)
    writeObservabilityEvent('daemon_entry:shutdown', { signal })

    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Handle parent process disconnect (if forked from Electron shell)
  if (process.connected) {
    process.on('disconnect', () => {
      console.info('[daemon-entry] Parent process disconnected')
      // Don't shut down — daemon is independent after 'ready'
    })
  }

  // Step 9: Start DaemonCore
  try {
    await daemon.start()
  } catch (err) {
    console.error('[daemon-entry] Failed to start daemon:', err)
    releaseLock(paths.dataDir)
    process.exit(1)
  }

  // Step 10: Notify parent process (if forked)
  if (process.connected && process.send) {
    process.send({
      type: 'ready',
      pid: process.pid,
      port: rendererPort,
    })
  }

  writeObservabilityEvent('daemon_entry:started', {
    headless: options.headless,
    port: rendererPort,
    secretsBackend: secrets.backendName,
    profileCount: profiles.length,
  })

  console.info('[daemon-entry] Daemon started on port', rendererPort)
}

// Run main and handle uncaught errors
main().catch((err) => {
  console.error('[daemon-entry] Fatal error:', err)
  process.exit(1)
})