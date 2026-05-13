import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StallDetector } from './stall-detector'
import type { StallDiagnostic } from './stall-detector'

// Use vi.hoisted() so mock functions are available inside hoisted vi.mock() factories
const { mockWriteObservabilityEvent, mockBusPublish } = vi.hoisted(() => ({
  mockWriteObservabilityEvent: vi.fn(),
  mockBusPublish: vi.fn(),
}))

vi.mock('../core/logging', () => ({
  writeObservabilityEvent: mockWriteObservabilityEvent,
}))

vi.mock('../daemon/event-bus', () => ({
  bus: {
    publish: mockBusPublish,
  },
}))

describe('StallDetector', () => {
  let detector: StallDetector

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    detector = new StallDetector('profile-1', 'TestAgent', 'claude', {
      stallTimeoutMs: 5000, // 5 seconds for testing
    })
  })

  afterEach(() => {
    detector.stopMonitoring()
    vi.useRealTimers()
  })

  describe('recordEvent', () => {
    it('updates lastActivity to "thinking" on text_delta', () => {
      detector.recordEvent({ type: 'text_delta' })
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.lastActivity).toBe('thinking')
    })

    it('updates lastActivity to "working" and sets pendingToolCall on tool_start', () => {
      detector.recordEvent({ type: 'tool_start' })
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.lastActivity).toBe('working')
      expect(diagnostic.pendingToolCall).toBe(true)
    })

    it('clears pendingToolCall on tool_result', () => {
      detector.recordEvent({ type: 'tool_start' })
      detector.recordEvent({ type: 'tool_result' })
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.pendingToolCall).toBe(false)
      expect(diagnostic.lastActivity).toBe('thinking')
    })

    it('updates lastActivity to "idle" on complete/done', () => {
      detector.recordEvent({ type: 'text_delta' })
      detector.recordEvent({ type: 'complete' })
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.lastActivity).toBe('idle')
      expect(diagnostic.pendingToolCall).toBe(false)
    })

    it('sets waitingForUserInput on permission_request', () => {
      detector.recordEvent({ type: 'permission_request' })
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.waitingForUserInput).toBe(true)
    })
  })

  describe('clearUserInputWait', () => {
    it('clears waitingForUserInput flag', () => {
      detector.recordEvent({ type: 'permission_request' })
      detector.clearUserInputWait()
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.waitingForUserInput).toBe(false)
    })
  })

  describe('recordOutput', () => {
    it('tracks recent stdout/stderr counts', () => {
      detector.recordOutput('stdout')
      detector.recordOutput('stdout')
      detector.recordOutput('stderr')
      const diagnostic = detector.buildDiagnostic('conv-1')
      expect(diagnostic.recentStdoutCount).toBe(2)
      expect(diagnostic.recentStderrCount).toBe(1)
    })
  })

  describe('buildDiagnostic', () => {
    it('returns correct provider info', () => {
      const diagnostic = detector.buildDiagnostic('conv-1', 'session-1', 3)
      expect(diagnostic.providerId).toBe('claude')
      expect(diagnostic.sessionId).toBe('session-1')
      expect(diagnostic.queuedMessageCount).toBe(3)
      expect(diagnostic.supportsResume).toBe(true)
    })

    it('reports supportsResume correctly for different providers', () => {
      const opencodeDetector = new StallDetector('p2', 'OC', 'opencode')
      expect(opencodeDetector.buildDiagnostic('c1').supportsResume).toBe(true)

      const codexDetector = new StallDetector('p3', 'Codex', 'codex')
      expect(codexDetector.buildDiagnostic('c1').supportsResume).toBe(false)
    })
  })

  describe('decideRecovery', () => {
    it('returns "auto_recover" when all safe conditions are met', () => {
      const diagnostic: StallDiagnostic = {
        staleForMs: 300000,
        lastActivity: 'idle',
        lastRuntimeEventAt: Date.now() - 300000,
        queuedMessageCount: 2,
        providerId: 'claude',
        sessionId: 'session-1',
        supportsResume: true,
        pendingToolCall: false,
        waitingForUserInput: false,
        recentStdoutCount: 0,
        recentStderrCount: 0,
      }
      expect(detector.decideRecovery(diagnostic)).toBe('auto_recover')
    })

    it('returns "manual_only" when no queued messages', () => {
      const diagnostic: StallDiagnostic = {
        staleForMs: 300000,
        lastActivity: 'idle',
        lastRuntimeEventAt: Date.now() - 300000,
        queuedMessageCount: 0,
        providerId: 'claude',
        sessionId: 'session-1',
        supportsResume: true,
        pendingToolCall: false,
        waitingForUserInput: false,
        recentStdoutCount: 0,
        recentStderrCount: 0,
      }
      expect(detector.decideRecovery(diagnostic)).toBe('manual_only')
    })

    it('returns "manual_only" when provider does not support resume', () => {
      const diagnostic: StallDiagnostic = {
        staleForMs: 300000,
        lastActivity: 'idle',
        lastRuntimeEventAt: Date.now() - 300000,
        queuedMessageCount: 2,
        providerId: 'codex',
        sessionId: undefined,
        supportsResume: false,
        pendingToolCall: false,
        waitingForUserInput: false,
        recentStdoutCount: 0,
        recentStderrCount: 0,
      }
      expect(detector.decideRecovery(diagnostic)).toBe('manual_only')
    })

    it('returns "manual_only" when tool call is pending', () => {
      const diagnostic: StallDiagnostic = {
        staleForMs: 300000,
        lastActivity: 'working',
        lastRuntimeEventAt: Date.now() - 300000,
        queuedMessageCount: 2,
        providerId: 'claude',
        sessionId: 'session-1',
        supportsResume: true,
        pendingToolCall: true,
        waitingForUserInput: false,
        recentStdoutCount: 0,
        recentStderrCount: 0,
      }
      expect(detector.decideRecovery(diagnostic)).toBe('manual_only')
    })

    it('returns "manual_only" when waiting for user input', () => {
      const diagnostic: StallDiagnostic = {
        staleForMs: 300000,
        lastActivity: 'idle',
        lastRuntimeEventAt: Date.now() - 300000,
        queuedMessageCount: 2,
        providerId: 'claude',
        sessionId: 'session-1',
        supportsResume: true,
        pendingToolCall: false,
        waitingForUserInput: true,
        recentStdoutCount: 0,
        recentStderrCount: 0,
      }
      expect(detector.decideRecovery(diagnostic)).toBe('manual_only')
    })
  })

  describe('stall detection', () => {
    it('does not report stall before timeout', () => {
      detector.startMonitoring('conv-1', 'session-1')
      detector.recordEvent({ type: 'text_delta' })

      // Advance 3 seconds (less than 5s timeout)
      vi.advanceTimersByTime(3000)

      expect(mockWriteObservabilityEvent).not.toHaveBeenCalledWith(
        'runtime.progress.stalled',
        expect.anything()
      )
      expect(mockBusPublish).not.toHaveBeenCalled()
    })

    it('reports stall after timeout with no events', () => {
      detector.startMonitoring('conv-1', 'session-1')

      // Advance past stall timeout (5s) + check interval (30s)
      vi.advanceTimersByTime(35000)

      expect(mockWriteObservabilityEvent).toHaveBeenCalledWith(
        'runtime.progress.stalled',
        expect.objectContaining({
          profileId: 'profile-1',
          providerId: 'claude',
          conversationId: 'conv-1',
        })
      )
    })

    it('does not report stall if events are still coming', () => {
      detector.startMonitoring('conv-1', 'session-1')

      // Simulate periodic events
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(2000)
        detector.recordEvent({ type: 'text_delta' })
      }

      expect(mockWriteObservabilityEvent).not.toHaveBeenCalledWith(
        'runtime.progress.stalled',
        expect.anything()
      )
    })

    it('does not report stall when waiting for user input', () => {
      detector.startMonitoring('conv-1', 'session-1')
      detector.recordEvent({ type: 'permission_request' })

      // Advance past stall timeout
      vi.advanceTimersByTime(35000)

      // Should NOT report stall because we're waiting for user input
      expect(mockWriteObservabilityEvent).not.toHaveBeenCalledWith(
        'runtime.progress.stalled',
        expect.anything()
      )
    })

    it('does not report duplicate stall events', () => {
      detector.startMonitoring('conv-1', 'session-1')

      // Advance past stall timeout twice
      vi.advanceTimersByTime(35000)
      vi.advanceTimersByTime(35000)

      // Should only have been called once
      const stallCalls = mockWriteObservabilityEvent.mock.calls.filter(
        (call: unknown[]) => call[0] === 'runtime.progress.stalled'
      )
      expect(stallCalls.length).toBe(1)
    })

    it('clears stall flag when event arrives after stall', () => {
      detector.startMonitoring('conv-1', 'session-1')

      // Advance past stall timeout
      vi.advanceTimersByTime(35000)

      // Stall should be reported
      const stallCalls1 = mockWriteObservabilityEvent.mock.calls.filter(
        (call: unknown[]) => call[0] === 'runtime.progress.stalled'
      )
      expect(stallCalls1.length).toBe(1)

      // Event arrives — stall should clear
      detector.recordEvent({ type: 'text_delta' })

      expect(mockWriteObservabilityEvent).toHaveBeenCalledWith(
        'runtime.stall_cleared',
        expect.objectContaining({
          profileId: 'profile-1',
          providerId: 'claude',
        })
      )
    })
  })

  describe('stopMonitoring', () => {
    it('stops the check timer', () => {
      detector.startMonitoring('conv-1', 'session-1')
      detector.stopMonitoring()

      // Advance way past stall timeout
      vi.advanceTimersByTime(60000)

      // Should NOT report stall because monitoring was stopped
      expect(mockWriteObservabilityEvent).not.toHaveBeenCalledWith(
        'runtime.progress.stalled',
        expect.anything()
      )
    })
  })
})
