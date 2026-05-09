import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus, type BusEvent, type BusEventType } from '../event-bus'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  it('delivers events to type-specific subscribers', () => {
    const handler = vi.fn()
    bus.subscribe('message:new', handler)

    const event: BusEvent = {
      type: 'message:new',
      conversationId: 'conv-1',
      actorType: 'user',
      actorId: null,
      payload: { text: 'hello' },
    }

    bus.publish(event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'message:new' }))
  })

  it('does not deliver events to unsubscribed types', () => {
    const handler = vi.fn()
    bus.subscribe('message:new', handler)

    const event: BusEvent = {
      type: 'message:reply',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'agent-1',
      payload: { text: 'reply' },
    }

    bus.publish(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it('delivers events to global subscribers for all types', () => {
    const globalHandler = vi.fn()
    bus.subscribeAll(globalHandler)

    const event: BusEvent = {
      type: 'open_floor:closed',
      conversationId: 'conv-1',
      actorType: 'system',
      actorId: null,
      payload: {},
    }

    bus.publish(event)

    expect(globalHandler).toHaveBeenCalledTimes(1)
    expect(globalHandler).toHaveBeenCalledWith(expect.objectContaining({ type: 'open_floor:closed' }))
  })

  it('delivers to both type-specific and global subscribers', () => {
    const typeHandler = vi.fn()
    const globalHandler = vi.fn()
    bus.subscribe('agent:thinking', typeHandler)
    bus.subscribeAll(globalHandler)

    const event: BusEvent = {
      type: 'agent:thinking',
      conversationId: 'conv-1',
      actorType: 'agent',
      actorId: 'coder',
      payload: {},
    }

    bus.publish(event)

    expect(typeHandler).toHaveBeenCalledTimes(1)
    expect(globalHandler).toHaveBeenCalledTimes(1)
  })

  it('calls multiple handlers for the same event type in order', () => {
    const order: number[] = []
    const handler1 = vi.fn(() => order.push(1))
    const handler2 = vi.fn(() => order.push(2))
    bus.subscribe('message:new', handler1)
    bus.subscribe('message:new', handler2)

    const event: BusEvent = {
      type: 'message:new',
      conversationId: 'conv-1',
      actorType: 'user',
      actorId: null,
      payload: {},
    }

    bus.publish(event)

    expect(handler1).toHaveBeenCalledBefore(handler2)
    expect(order).toEqual([1, 2])
  })

  it('survives a panicking handler without breaking others', () => {
    const badHandler = vi.fn(() => {
      throw new Error('handler panic')
    })
    const goodHandler = vi.fn()
    bus.subscribe('message:new', badHandler)
    bus.subscribe('message:new', goodHandler)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const event: BusEvent = {
      type: 'message:new',
      conversationId: 'conv-1',
      actorType: 'user',
      actorId: null,
      payload: {},
    }

    bus.publish(event)

    expect(badHandler).toHaveBeenCalledTimes(1)
    expect(goodHandler).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[EventBus] panic in handler:',
      expect.any(Error),
      'event_type:',
      'message:new'
    )

    consoleSpy.mockRestore()
  })

  it('allows unsubscribing a specific handler', () => {
    const handler = vi.fn()
    bus.subscribe('message:new', handler)
    bus.unsubscribe('message:new', handler)

    const event: BusEvent = {
      type: 'message:new',
      conversationId: 'conv-1',
      actorType: 'user',
      actorId: null,
      payload: {},
    }

    bus.publish(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it('allows unsubscribing a global handler', () => {
    const handler = vi.fn()
    bus.subscribeAll(handler)
    bus.unsubscribeAll(handler)

    const event: BusEvent = {
      type: 'message:new',
      conversationId: 'conv-1',
      actorType: 'user',
      actorId: null,
      payload: {},
    }

    bus.publish(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it('clears all handlers', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    bus.subscribe('message:new', handler1)
    bus.subscribeAll(handler2)
    bus.clear()

    const event: BusEvent = {
      type: 'message:new',
      conversationId: 'conv-1',
      actorType: 'user',
      actorId: null,
      payload: {},
    }

    bus.publish(event)

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).not.toHaveBeenCalled()
  })

  it('does not throw when unsubscribing a handler that was never subscribed', () => {
    const handler = vi.fn()
    expect(() => bus.unsubscribe('message:new', handler)).not.toThrow()
    expect(() => bus.unsubscribeAll(handler)).not.toThrow()
  })
})
