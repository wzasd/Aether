/**
 * Terminal route handlers for Renderer API.
 *
 * Uses node-pty for PTY spawning. Events (onData, onExit) are broadcast via SSE.
 */

import type { ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { spawn, type IPty } from 'node-pty'
import { sseBroadcaster } from '../sse-broadcaster'

interface TerminalSession {
  id: string
  pty: IPty
  workspaceId: string
}

const sessions = new Map<string, TerminalSession>()

export function killWorkspaceTerminals(workspaceId: string): void {
  sessions.forEach((session, id) => {
    if (session.workspaceId === workspaceId) {
      session.pty.kill()
      sessions.delete(id)
    }
  })
}

export async function handleCreateTerminal(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const workspaceId = data?.workspace_id as string | undefined
  const cwd = data?.cwd as string | undefined

  if (!workspaceId || typeof workspaceId !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'workspace_id is required' }))
    return
  }

  const SHELL = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
  const pty = spawn(SHELL, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 24,
    cwd: cwd ?? process.env.HOME ?? '/',
    env: { ...process.env as Record<string, string>, TERM: 'xterm-256color' },
  })

  const id = randomUUID()
  sessions.set(id, { id, pty, workspaceId })

  pty.onData((data: string) => {
    sseBroadcaster.broadcast('terminal:onData', { sessionId: id, data })
  })

  pty.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
    sseBroadcaster.broadcast('terminal:onExit', { sessionId: id, exitCode })
    sessions.delete(id)
  })

  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, sessionId: id }))
}

export async function handleWriteTerminal(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const sessionId = data?.session_id as string | undefined
  const input = data?.data as string | undefined

  if (!sessionId || typeof input !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'session_id and data are required' }))
    return
  }

  const session = sessions.get(sessionId)
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Terminal session not found' }))
    return
  }

  session.pty.write(input)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export async function handleResizeTerminal(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const sessionId = data?.session_id as string | undefined
  const cols = data?.cols as number | undefined
  const rows = data?.rows as number | undefined

  if (!sessionId || typeof cols !== 'number' || typeof rows !== 'number') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'session_id, cols, and rows are required' }))
    return
  }

  const session = sessions.get(sessionId)
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Terminal session not found' }))
    return
  }

  session.pty.resize(cols, rows)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

export async function handleKillTerminal(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const sessionId = data?.session_id as string | undefined
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'session_id is required' }))
    return
  }

  const session = sessions.get(sessionId)
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Terminal session not found' }))
    return
  }

  session.pty.kill()
  sessions.delete(sessionId)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}
