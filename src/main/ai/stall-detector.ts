/**
 * StallDetector — detects and diagnoses stalled Agent runtime processes.
 *
 * Inspired by Slock 0.48.0's runtime.progress.stalled mechanism.
 * A "stall" means the runtime process is alive but not producing output
 * for an extended period, indicating it may be stuck.
 *
 * Design:
 * - Transport-aware: spawn (OpenCode/Codex/Gemini/Kimi) and PTY (Claude/Cursor)
 *   have different stall characteristics
 * - Conservative: only auto-recover when safe conditions are met
 * - Observable: every stall/recovery event is written to observability log
 * - Non-blocking: stall detection runs on a timer, does not block the main event loop
 */

import { writeObservabilityEvent } from '../core/logging'
import type { BusEventType, BusEvent } from '../daemon/event-bus'
import { bus } from '../daemon/event-bus'

// ─── Stall Diagnostic Types ─────────────────────────────────────────────────

/** What the runtime was last doing before it stalled. */
export type StallActivity =
  | 'starting'     // Runtime just started, no events yet
  | 'thinking'     // Last event was text_delta (agent generating text)
  | 'working'      // Last event was tool_start (agent executing tool)
  | 'idle'         // No recent activity, runtime may be waiting for input

/** Structured diagnostic information for a stalled runtime. */
export interface StallDiagnostic {
  /** How long the runtime has been stalled (ms). */
  staleForMs: number
  /** What the runtime was last doing. */
  lastActivity: StallActivity
  /** Timestamp of the last runtime event received. */
  lastRuntimeEventAt: number
  /** Number of messages queued for this runtime. */
  queuedMessageCount: number
  /** Provider type (e.g. 'claude', 'opencode'). */
  providerId: string
  /** Session ID if available. */
  sessionId?: string
  /** Whether the provider supports session resume. */
  supportsResume: boolean
  /** Whether a tool call is pending (agent waiting for tool result). */
  pendingToolCall: boolean
  /** Whether the runtime is waiting for user permission input. */
  waitingForUserInput: boolean
  /** Number of stdout events received in the last monitoring window. */
  recentStdoutCount: number
  /** Number of stderr events received in the last monitoring window. */
  recentStderrCount: number
}

/** Recovery decision based on stall diagnostic. */
export type RecoveryDecision =
  | 'auto_recover'   // Safe to terminate + restart + replay queue
  | 'manual_only'    // Not safe to auto-recover, user must decide
  | 'false_alarm'    // Stall cleared before action was taken

export interface StallEventPayload {
  profileId: string
  profileName: string
  conversationId: string
  diagnostic: StallDiagnostic
  recoveryDecision: RecoveryDecision
}

export interface RecoveryEventPayload {
  profileId: string
  profileName: string
  conversationId: string
  reason: 'auto_recover' | 'manual_retry'
  newSessionId?: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default timeout before declaring a stall (ms). */
const DEFAULT_STALL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes (same as waitForReply timeout)

/** How often to check for stalls (ms). */
const STALL_CHECK_INTERVAL_MS = 30 * 1000 // 30 seconds

/** Window for counting recent stdout/stderr events (ms). */
const RECENT_EVENT_WINDOW_MS = 60 * 1000 // 1 minute

// ─── StallDetector ──────────────────────────────────────────────────────────

export class StallDetector {
  private lastEventAt = 0
  private lastActivity: StallActivity = 'idle'
  private pendingToolCall = false
  private waitingForUserInput = false
  private recentStdoutTimestamps: number[] = []
  private recentStderrTimestamps: number[] = []
  private stallDetected = false
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS

  readonly profileId: string
  readonly profileName: string
  readonly providerId: string

  constructor(
    profileId: string,
    profileName: string,
    providerId: string,
    options?: { stallTimeoutMs?: number }
  ) {
    this.profileId = profileId
    this.profileName = profileName
    this.providerId = providerId
    if (options?.stallTimeoutMs) {
      this.stallTimeoutMs = options.stallTimeoutMs
    }
  }

  /** Record an AIEvent from the runtime — updates activity tracking. */
  recordEvent(event: { type: string }): void {
    const now = Date.now()
    this.lastEventAt = now

    // Update activity state based on event type
    if (event.type === 'text_delta') {
      this.lastActivity = 'thinking'
    } else if (event.type === 'tool_start') {
      this.lastActivity = 'working'
      this.pendingToolCall = true
    } else if (event.type === 'tool_result') {
      this.pendingToolCall = false
      this.lastActivity = 'thinking'
    } else if (event.type === 'complete' || event.type === 'done') {
      this.lastActivity = 'idle'
      this.pendingToolCall = false
    } else if (event.type === 'permission_request' || event.type === 'question') {
      this.waitingForUserInput = true
      this.lastActivity = 'idle'
    }

    // Clear stall flag if we receive any event
    if (this.stallDetected) {
      this.stallDetected = false
      writeObservabilityEvent('runtime.stall_cleared', {
        profileId: this.profileId,
        profileName: this.profileName,
        providerId: this.providerId,
        staleForMs: now - this.lastEventAt,
      })
    }
  }

  /** Record stdout/stderr output for stall diagnosis. */
  recordOutput(kind: 'stdout' | 'stderr'): void {
    const now = Date.now()
    if (kind === 'stdout') {
      this.recentStdoutTimestamps.push(now)
    } else {
      this.recentStderrTimestamps.push(now)
    }
  }

  /** Mark that user input has been provided (permission/question answered). */
  clearUserInputWait(): void {
    this.waitingForUserInput = false
  }

  /** Start periodic stall checking. Stops any previous monitoring first. */
  startMonitoring(conversationId: string, sessionId?: string): void {
    // Stop any previous monitoring to prevent stale timers
    this.stopMonitoring()

    this.lastEventAt = Date.now()
    this.lastActivity = 'starting'
    this.pendingToolCall = false
    this.waitingForUserInput = false
    this.stallDetected = false
    this.recentStdoutTimestamps = []
    this.recentStderrTimestamps = []

    this.checkTimer = setInterval(() => {
      this.checkForStall(conversationId, sessionId)
    }, STALL_CHECK_INTERVAL_MS)
  }

  /** Stop periodic stall checking. */
  stopMonitoring(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  /** Build a StallDiagnostic for the current state. */
  buildDiagnostic(conversationId: string, sessionId?: string, queuedMessageCount = 0): StallDiagnostic {
    const now = Date.now()
    const windowStart = now - RECENT_EVENT_WINDOW_MS

    // Prune recent event timestamps outside the window
    this.recentStdoutTimestamps = this.recentStdoutTimestamps.filter(t => t >= windowStart)
    this.recentStderrTimestamps = this.recentStderrTimestamps.filter(t => t >= windowStart)

    // Determine if provider supports resume
    const supportsResume = this.providerId === 'opencode' || this.providerId === 'claude'

    return {
      staleForMs: this.lastEventAt > 0 ? now - this.lastEventAt : 0,
      lastActivity: this.lastActivity,
      lastRuntimeEventAt: this.lastEventAt,
      queuedMessageCount,
      providerId: this.providerId,
      sessionId,
      supportsResume,
      pendingToolCall: this.pendingToolCall,
      waitingForUserInput: this.waitingForUserInput,
      recentStdoutCount: this.recentStdoutTimestamps.length,
      recentStderrCount: this.recentStderrTimestamps.length,
    }
  }

  /** Determine recovery decision based on diagnostic. */
  decideRecovery(diagnostic: StallDiagnostic): RecoveryDecision {
    // Conservative auto-recovery: only when ALL safe conditions are met
    // (aligned with Slock 0.48.0 stall recovery logic)
    const safeToAutoRecover =
      diagnostic.queuedMessageCount > 0
      && diagnostic.supportsResume
      && !diagnostic.pendingToolCall
      && !diagnostic.waitingForUserInput

    if (safeToAutoRecover) {
      return 'auto_recover'
    }

    // If there are no queued messages, it's not urgent — manual intervention only
    return 'manual_only'
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private checkForStall(conversationId: string, sessionId?: string): void {
    const now = Date.now()
    const staleForMs = this.lastEventAt > 0 ? now - this.lastEventAt : now - (now - this.stallTimeoutMs)

    if (staleForMs < this.stallTimeoutMs) {
      // Not stalled yet
      return
    }

    if (this.stallDetected) {
      // Already reported, don't duplicate
      return
    }

    // Don't report stall if we're waiting for user input — that's expected
    if (this.waitingForUserInput) {
      return
    }

    this.stallDetected = true

    const diagnostic = this.buildDiagnostic(conversationId, sessionId)
    const recoveryDecision = this.decideRecovery(diagnostic)

    const payload: StallEventPayload = {
      profileId: this.profileId,
      profileName: this.profileName,
      conversationId,
      diagnostic,
      recoveryDecision,
    }

    // Emit event on the bus
    bus.publish({
      type: 'runtime.progress.stalled' as BusEventType,
      conversationId,
      actorType: 'system',
      actorId: this.profileId,
      payload,
    })

    // Write observability event
    writeObservabilityEvent('runtime.progress.stalled', {
      profileId: this.profileId,
      profileName: this.profileName,
      providerId: this.providerId,
      conversationId,
      staleForMs,
      lastActivity: diagnostic.lastActivity,
      queuedMessageCount: diagnostic.queuedMessageCount,
      pendingToolCall: diagnostic.pendingToolCall,
      waitingForUserInput: diagnostic.waitingForUserInput,
      supportsResume: diagnostic.supportsResume,
      recoveryDecision,
    })
  }
}