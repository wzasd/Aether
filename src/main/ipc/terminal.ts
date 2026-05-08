import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type IPty } from 'node-pty'

interface TerminalSession {
  id: string
  pty: IPty
  workspaceId: string
}

const sessions = new Map<string, TerminalSession>()

function sendToRenderer(win: BrowserWindow, channel: string, data: unknown): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

export function registerTerminalIpc(): void {
  ipcMain.handle('terminal:create', (event, workspaceId: string, cwd?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')

    const pty = spawn('zsh', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 24,
      cwd: cwd ?? process.env.HOME ?? '/',
      env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' }
    })

    const id = randomUUID()
    sessions.set(id, { id, pty, workspaceId })

    pty.onData((data: string) => {
      sendToRenderer(win, 'terminal:onData', { sessionId: id, data })
    })

    pty.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
      sendToRenderer(win, 'terminal:onExit', { sessionId: id, exitCode })
      sessions.delete(id)
    })

    return id
  })

  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    const session = sessions.get(sessionId)
    if (session) {
      session.pty.write(data)
    }
  })

  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    const session = sessions.get(sessionId)
    if (session) {
      session.pty.resize(cols, rows)
    }
  })

  ipcMain.handle('terminal:kill', (_event, sessionId: string) => {
    const session = sessions.get(sessionId)
    if (session) {
      session.pty.kill()
      sessions.delete(sessionId)
    }
  })
}

export function killWorkspaceTerminals(workspaceId: string): void {
  sessions.forEach((session, id) => {
    if (session.workspaceId === workspaceId) {
      session.pty.kill()
      sessions.delete(id)
    }
  })
}
