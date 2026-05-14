/**
 * Auth Module API — session management for HTTP mode.
 *
 * HTTP-only module (no IPC equivalent). Creates a session cookie
 * that subsequent apiFetch calls automatically include via credentials.
 * ADR-019: Renderer HTTP Migration
 */

import { apiFetch } from './client'

function shouldUseHttp(): boolean {
  return window.__BYTRO_USE_HTTP_AUTH__ ?? window.__BYTRO_USE_HTTP__ ?? false
}

export const authApi = {
  /**
   * Create a new session with the daemon.
   * Sets the `bytro_session` cookie via HTTP response.
   */
  createSession: async (): Promise<string> => {
    if (shouldUseHttp()) {
      const res = await apiFetch<{ sessionId: string }>('/api/auth/session', {
        method: 'POST',
      })
      return res.sessionId
    }
    // Auth is HTTP-only; IPC mode does not use session cookies
    throw new Error('Auth module requires HTTP mode (__BYTRO_USE_HTTP__ or __BYTRO_USE_HTTP_AUTH__)')
  },
}
