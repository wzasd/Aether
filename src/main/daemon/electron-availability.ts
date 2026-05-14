/**
 * Electron availability detection — centralised utility for headless-safe checks.
 *
 * All route files that need Electron APIs should use these helpers instead of
 * top-level `import { app, dialog } from 'electron'` to avoid crashing in
 * headless mode.
 */

let _app: typeof import('electron').app | null = null
let _dialog: typeof import('electron').dialog | null = null
let _browserWindow: typeof import('electron').BrowserWindow | null = null

/** Lazily load electron module, return null if not available (headless). */
function getElectronModule(): typeof import('electron') | null {
  try {
    return require('electron')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      return null
    }
    throw err
  }
}

/** Returns the Electron app module, or null in headless mode. */
export function getElectronApp(): typeof import('electron').app | null {
  if (!_app) {
    const electron = getElectronModule()
    _app = electron?.app ?? null
  }
  return _app
}

/** Returns the Electron dialog module, or null in headless mode. */
export function getElectronDialog(): typeof import('electron').dialog | null {
  if (!_dialog) {
    const electron = getElectronModule()
    _dialog = electron?.dialog ?? null
  }
  return _dialog
}

/** Returns the Electron BrowserWindow class, or null in headless mode. */
export function getElectronBrowserWindow(): typeof import('electron').BrowserWindow | null {
  if (!_browserWindow) {
    const electron = getElectronModule()
    _browserWindow = electron?.BrowserWindow ?? null
  }
  return _browserWindow
}

/** True if Electron APIs are available (running inside Electron main process). */
export function isElectronAvailable(): boolean {
  return getElectronModule() !== null
}
