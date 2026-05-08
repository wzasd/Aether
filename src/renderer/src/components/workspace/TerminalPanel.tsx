import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUIStore } from '../../stores/uiStore'

const XTERM_THEMES = {
  dark: {
    background: '#09090b',
    foreground: '#d4d4d8',
    cursor: '#a1a1aa',
    selectionBackground: '#3f3f46',
  },
  light: {
    background: '#ffffff',
    foreground: '#1a1a2e',
    cursor: '#3b82f6',
    selectionBackground: '#e9ecef',
  },
}

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const resolved = useUIStore((s) => s.resolved)

  const createSession = useCallback(async (workspaceId: string) => {
    // Kill previous session if any
    if (sessionIdRef.current) {
      window.api.terminal.kill(sessionIdRef.current).catch(() => {})
    }

    const workspaceEntry = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
    const cwd = workspaceEntry?.repo_path ?? undefined
    const id = await window.api.terminal.create(workspaceId, cwd)
    sessionIdRef.current = id

    terminalRef.current?.clear()
    return id
  }, [])

  // Sync xterm theme
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = XTERM_THEMES[resolved]
    }
  }, [resolved])

  // Initialize xterm instance and event listeners (once)
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
      theme: XTERM_THEMES[useUIStore.getState().resolved],
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Input → PTY
    term.onData((data) => {
      if (sessionIdRef.current) {
        window.api.terminal.write(sessionIdRef.current, data).catch(() => {})
      }
    })

    // PTY → output (filter by current sessionId)
    const unsubData = window.api.terminal.onData(({ sessionId, data }) => {
      if (sessionId === sessionIdRef.current) {
        term.write(data)
      }
    })

    // Session exit (filter by current sessionId)
    const unsubExit = window.api.terminal.onExit(({ sessionId, exitCode }) => {
      if (sessionId === sessionIdRef.current) {
        term.write(`\r\n\x1b[33mProcess exited with code ${exitCode}\x1b[0m\r\n`)
      }
    })

    // Resize handler
    const handleResize = () => {
      fitAddon.fit()
      if (sessionIdRef.current) {
        window.api.terminal.resize(
          sessionIdRef.current,
          term.cols,
          term.rows
        ).catch(() => {})
      }
    }

    term.onResize(handleResize)

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit() } catch { /* ignore */ }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      unsubData()
      unsubExit()
      if (sessionIdRef.current) {
        window.api.terminal.kill(sessionIdRef.current).catch(() => {})
        sessionIdRef.current = null
      }
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Create/kill PTY session when workspace changes (sole session lifecycle owner)
  useEffect(() => {
    if (!terminalRef.current || !currentWorkspaceId) return
    createSession(currentWorkspaceId)
  }, [currentWorkspaceId, createSession])

  return (
    <div ref={containerRef} className="h-full w-full" />
  )
}
