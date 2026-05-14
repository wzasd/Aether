/**
 * SSE Broadcaster — replaces webContents.send() with SSE push.
 *
 * Provides a unified broadcast interface that:
 * 1. Pushes events to connected renderer clients via SSE
 * 2. Falls back to webContents.send() during migration period
 *
 * ADR-016: Renderer API Server + SSE
 *
 * Usage in daemon:
 *   // Before (Electron-only):
 *   this.webContents.send('ai:event', { type: 'open_floor:start', conversationId })
 *
 *   // After (SSE + fallback):
 *   sseBroadcaster.broadcast('ai:event', { type: 'open_floor:start', conversationId })
 *
 * During Step 1 (coexistence), both SSE and webContents are active.
 * During Step 2, webContents fallback is removed.
 */

import type { WebContents } from 'electron'
import { getRendererApiServer } from './renderer-api'

export interface SSEEvent {
  readonly event: string
  readonly data: unknown
}

class SSEBroadcaster {
  private webContents: WebContents | null = null

  /** Set the Electron WebContents for fallback during migration */
  setWebContents(wc: WebContents | null): void {
    this.webContents = wc
  }

  /**
   * Broadcast an event to all connected renderer clients.
   *
   * During migration: sends via both SSE and webContents.send().
   * After Step 2: SSE only.
   */
  broadcast(event: string, data: unknown): void {
    // SSE push
    const server = getRendererApiServer()
    server.broadcast(event, data)

    // Fallback: webContents.send() during migration
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send(event, data)
    }
  }

  /**
   * Broadcast a typed AI event.
   * Replaces the common pattern: webContents.send('ai:event', { type, ...payload })
   */
  broadcastAIEvent(type: string, payload: Record<string, unknown>): void {
    this.broadcast('ai:event', { type, ...payload })
  }
}

/** Singleton broadcaster instance */
export const sseBroadcaster = new SSEBroadcaster()
