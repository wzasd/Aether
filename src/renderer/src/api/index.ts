/**
 * Renderer API Layer — HTTP client modules for Renderer ↔ Daemon communication.
 *
 * ADR-019: Renderer HTTP Migration
 */

export { apiFetch, createEventSource, ApiError, setGlobalAuthErrorHandler, setGlobalServerErrorHandler } from './client'
export { subscribe, getConnectionStatus, onConnectionStatusChange } from './events'
export { systemApi } from './system'
export { authApi } from './auth'
export { conversationApi } from './conversations'
export { memoryApi } from './memory'
export { memoryPalaceApi } from './memory-palace'
export { mcpApi } from './mcp'
export { orchestratorApi } from './orchestrator'
