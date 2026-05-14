import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { closeDatabase, initDatabase } from './core/db'
import { createLogger, installConsoleLogBridge } from './core/logging'
import { registerIpcHandlers } from './ipc'
import { safeOpenExternal } from './utils/external'
import { checkForUpdatesSilent } from './ipc/update'
import { daemon } from './daemon/daemon'

let mainWindow: BrowserWindow | null = null
const logger = createLogger('app')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    void safeOpenExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.env.NODE_ENV !== 'production' && process.env.TRAE_SANDBOX) {
    app.commandLine.appendSwitch('no-sandbox')
    app.commandLine.appendSwitch('disable-gpu-sandbox')
  }

  app.setAppUserModelId('com.bytro.app')
  installConsoleLogBridge('app')
  logger.info('App starting', { version: app.getVersion(), packaged: app.isPackaged })

  try {
    initDatabase()
    daemon.init()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Failed to initialize database:', err)
    dialog.showErrorBox('Bytro database initialization failed', message)
    app.quit()
    return
  }
  registerIpcHandlers()
  createWindow()

  // Silent update check on startup (5s delay)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      checkForUpdatesSilent().then((info) => {
        if (info.hasUpdate) {
          mainWindow?.webContents.send('update:available', info)
        }
      })
    }
  }, 5000)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  logger.info('All windows closed')
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
