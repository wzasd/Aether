/**
 * AppPaths — abstracted filesystem paths, decoupled from Electron's app.getPath().
 *
 * Two implementations:
 * - `createElectronAppPaths()` — resolves via Electron's `app.getPath()` (current behavior)
 * - `createStandaloneAppPaths()` — resolves via OS conventions + CLI flags (headless/CLI mode)
 *
 * All daemon code should depend on the `AppPaths` interface, never call `app.getPath()` directly.
 */

import { app } from 'electron'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

export interface AppPaths {
  /** Application data directory (replaces app.getPath('userData')) */
  readonly dataDir: string
  /** Log directory (replaces app.getPath('logs')) */
  readonly logDir: string
  /** User home directory (replaces app.getPath('home')) */
  readonly homeDir: string
  /** Documents directory (replaces app.getPath('documents')) */
  readonly documentsDir: string
  /** Desktop directory (replaces app.getPath('desktop')) */
  readonly desktopDir: string
  /** Downloads directory (replaces app.getPath('downloads')) */
  readonly downloadsDir: string
  /** Temp directory (replaces app.getPath('temp')) */
  readonly tempDir: string
}

/**
 * Create AppPaths using Electron's `app.getPath()`.
 * Use this when running inside Electron's main process.
 */
export function createElectronAppPaths(): AppPaths {
  return {
    dataDir: app.getPath('userData'),
    logDir: app.getPath('logs'),
    homeDir: app.getPath('home'),
    documentsDir: app.getPath('documents'),
    desktopDir: app.getPath('desktop'),
    downloadsDir: app.getPath('downloads'),
    tempDir: app.getPath('temp'),
  }
}

/**
 * Create AppPaths using OS conventions and optional overrides.
 * Use this when running outside Electron (headless/CLI mode).
 *
 * @param overrides - Optional path overrides (e.g. from CLI flags)
 */
/**
 * Resolve an optional user directory (Documents, Desktop, Downloads).
 * On Linux these directories may not exist — fallback to homeDir.
 */
function resolveOptionalDir(homeDir: string, dirName: string): string {
  const candidate = path.join(homeDir, dirName)
  if (fs.existsSync(candidate)) return candidate
  return homeDir
}

export function createStandaloneAppPaths(overrides?: Partial<AppPaths>): AppPaths {
  const homeDir = os.homedir()
  const dataDir = overrides?.dataDir ?? path.join(homeDir, '.bytro')
  const logDir = overrides?.logDir ?? path.join(dataDir, 'logs')

  // Ensure directories exist
  for (const dir of [dataDir, logDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  return {
    dataDir,
    logDir,
    homeDir,
    documentsDir: overrides?.documentsDir ?? resolveOptionalDir(homeDir, 'Documents'),
    desktopDir: overrides?.desktopDir ?? resolveOptionalDir(homeDir, 'Desktop'),
    downloadsDir: overrides?.downloadsDir ?? resolveOptionalDir(homeDir, 'Downloads'),
    tempDir: overrides?.tempDir ?? os.tmpdir(),
  }
}
