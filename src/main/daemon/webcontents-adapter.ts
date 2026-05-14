/**
 * WebContents Adapter — bridges SSE broadcaster to WebContents-like interface.
 *
 * Used by HTTP route handlers that need to pass an event sink to
 * modules expecting Electron WebContents (e.g., orchestrator.sendUserMessage).
 *
 * In headless mode, events flow through SSE instead of webContents.send().
 * In Electron mode, the real WebContents is used directly.
 *
 * ADR-016: Renderer API Server + SSE
 */

import type { WebContents } from 'electron'
import { sseBroadcaster } from './sse-broadcaster'

/**
 * Create a minimal WebContents adapter that delegates send() to SSE broadcaster.
 *
 * Only implements the subset used by orchestrator/chat:
 * - isDestroyed() → always false
 * - send(event, data) → sseBroadcaster.broadcast(event, data)
 */
export function createSSEWebContentsAdapter(): Pick<WebContents, 'send' | 'isDestroyed'> {
  return {
    isDestroyed: () => false,
    send: (event: string, data: unknown) => {
      sseBroadcaster.broadcast(event, data)
    },
  } as Pick<WebContents, 'send' | 'isDestroyed'>
}
