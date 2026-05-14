/**
 * SSE Event Dispatcher — routes server-sent events to subscribers.
 *
 * One EventSource connection, multiple subscribers per event type.
 * No DOM manipulation — only store actions and callbacks.
 * ADR-019: Renderer HTTP Migration
 *
 * TODO(C1): Daemon `broadcastSSE()` currently sends `event:` + `data:` only —
 * no `id:` field. EventSource native `Last-Event-ID` header will be empty
 * on reconnect. Fix requires daemon-side change to include `id: <seq>`.
 * Layer 2 (`GET /api/events/recent`) can be used as fallback later.
 */

import { createEventSource } from './client'

type EventCallback = (data: unknown) => void
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

const listeners = new Map<string, Set<EventCallback>>()
const eventSourceListeners = new Map<string, EventListener>()
let eventSource: EventSource | null = null
let connectionStatus: ConnectionStatus = 'disconnected'
const statusListeners = new Set<(status: ConnectionStatus) => void>()

function getOrCreateSet(event: string): Set<EventCallback> {
  if (!listeners.has(event)) {
    listeners.set(event, new Set())
  }
  return listeners.get(event)!
}

function setStatus(status: ConnectionStatus): void {
  if (connectionStatus === status) return
  connectionStatus = status
  statusListeners.forEach((cb) => {
    try {
      cb(status)
    } catch (err) {
      console.error('[events] status listener error:', err)
    }
  })
}

function makeHandler(event: string): EventListener {
  return ((e: MessageEvent) => {
    let data: unknown = e.data
    try {
      data = JSON.parse(e.data)
    } catch {
      // keep raw string if not valid JSON
    }
    getOrCreateSet(event).forEach((cb) => {
      try {
        cb(data)
      } catch (err) {
        console.error(`[events] handler error for ${event}:`, err)
      }
    })
  }) as EventListener
}

function start(): void {
  if (eventSource) return

  setStatus('connecting')
  eventSource = createEventSource('/api/events')

  // Register listeners for all events that already have subscribers
  listeners.forEach((_, event) => {
    const handler = makeHandler(event)
    eventSourceListeners.set(event, handler)
    eventSource!.addEventListener(event, handler)
  })

  eventSource.onerror = () => {
    setStatus('disconnected')
    console.warn('[events] SSE connection error, will reconnect automatically')
  }

  eventSource.onopen = () => {
    setStatus('connected')
    console.info('[events] SSE connected')
  }
}

function stop(): void {
  if (eventSource) {
    eventSource.close()
    eventSource = null
    eventSourceListeners.clear()
    setStatus('disconnected')
  }
}

/** Get current SSE connection status */
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus
}

/** Subscribe to connection status changes */
export function onConnectionStatusChange(callback: (status: ConnectionStatus) => void): () => void {
  statusListeners.add(callback)
  return () => statusListeners.delete(callback)
}

/**
 * Subscribe to an SSE event.
 * Returns unsubscribe function.
 *
 * Lazy-starts the EventSource on first subscription;
 * closes it when the last subscriber unsubscribes.
 */
export function subscribe(event: string, callback: EventCallback): () => void {
  const set = getOrCreateSet(event)
  set.add(callback)

  if (!eventSource) {
    start()
  } else if (!eventSourceListeners.has(event)) {
    const handler = makeHandler(event)
    eventSourceListeners.set(event, handler)
    eventSource.addEventListener(event, handler)
  }

  return () => {
    set.delete(callback)
    const total = Array.from(listeners.values()).reduce((sum, s) => sum + s.size, 0)
    if (total === 0) {
      stop()
    }
  }
}
