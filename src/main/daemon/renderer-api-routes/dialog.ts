/**
 * Dialog route handlers for Renderer API.
 *
 * Dialog operations require Electron (BrowserWindow / dialog).
 * In headless/fork mode, these return 501 Not Implemented.
 */

import type { ServerResponse } from 'http'
import { getElectronDialog, isElectronAvailable } from '../electron-availability'

export async function handleOpenDirectory(res: ServerResponse): Promise<void> {
  if (!isElectronAvailable()) {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Not available in headless mode' }))
    return
  }

  const dialog = getElectronDialog()
  if (!dialog) {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Not available in headless mode' }))
    return
  }

  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })

  if (result.canceled || result.filePaths.length === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: null }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, path: result.filePaths[0] }))
}
