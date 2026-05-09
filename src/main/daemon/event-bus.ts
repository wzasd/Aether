/**
 * EventBus — in-process synchronous pub/sub event bus.
 *
 * Inspired by Multica's events.Bus (server/internal/events/bus.go).
 * This is the core message infrastructure for bytro 2.0 Daemon architecture.
 *
 * Design:
 * - Synchronous: handlers run immediately in Publish() call stack
 * - Ordered: type-specific handlers first, then global handlers
 * - Safe: panic in one handler does not break others
 * - Typed: strongly typed events for compile-time safety
 */

export type BusEventType =
  | 'message:new'
  | 'message:reply'
  | 'agent:thinking'
  | 'agent:observation'
  | 'agent:task_claimed'
  | 'agent:task_completed'
  | 'agent:task_failed'
  | 'open_floor:start'
  | 'open_floor:round_complete'
  | 'open_floor:closed'
  | 'conversation:created'
  | 'conversation:updated'
  | 'system:abort'

export interface BusEvent {
  type: BusEventType
  conversationId: string
  actorType: 'user' | 'agent' | 'system'
  actorId: string | null
  payload: unknown
}

export type BusHandler = (event: BusEvent) => void

export class EventBus {
  private listeners = new Map<BusEventType, BusHandler[]>()
  private globalHandlers: BusHandler[] = []

  /** Register a handler for a specific event type */
  subscribe(eventType: BusEventType, handler: BusHandler): void {
    const list = this.listeners.get(eventType) ?? []
    list.push(handler)
    this.listeners.set(eventType, list)
  }

  /** Register a handler that receives ALL events */
  subscribeAll(handler: BusHandler): void {
    this.globalHandlers.push(handler)
  }

  /** Remove a specific handler */
  unsubscribe(eventType: BusEventType, handler: BusHandler): void {
    const list = this.listeners.get(eventType)
    if (!list) return
    const idx = list.indexOf(handler)
    if (idx >= 0) list.splice(idx, 1)
  }

  /** Remove a global handler */
  unsubscribeAll(handler: BusHandler): void {
    const idx = this.globalHandlers.indexOf(handler)
    if (idx >= 0) this.globalHandlers.splice(idx, 1)
  }

  /** Publish an event to all registered handlers */
  publish(event: BusEvent): void {
    // Type-specific handlers first
    const typeHandlers = this.listeners.get(event.type)
    if (typeHandlers) {
      for (const h of typeHandlers) {
        this.safeCall(h, event)
      }
    }

    // Global handlers after
    for (const h of this.globalHandlers) {
      this.safeCall(h, event)
    }
  }

  private safeCall(handler: BusHandler, event: BusEvent): void {
    try {
      handler(event)
    } catch (err) {
      console.error('[EventBus] panic in handler:', err, 'event_type:', event.type)
    }
  }

  /** Clear all handlers (useful for testing) */
  clear(): void {
    this.listeners.clear()
    this.globalHandlers = []
  }
}

/** Singleton event bus for the daemon */
export const bus = new EventBus()
