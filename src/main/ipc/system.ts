import { ipcMain, app, BrowserWindow } from 'electron'
import { safeOpenExternal } from '../utils/external'

export function registerSystemIpc(): void {
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('system:showWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.show()
      win.focus()
    }
  })

  ipcMain.handle('system:hideWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.hide()
  })

  ipcMain.handle('system:openExternal', async (_event, url: string) => {
    return safeOpenExternal(url)
  })

  ipcMain.handle('system:getPaths', () => {
    return {
      home: app.getPath('home'),
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      desktop: app.getPath('desktop'),
      downloads: app.getPath('downloads')
    }
  })
}
