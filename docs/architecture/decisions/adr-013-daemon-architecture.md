---
adr: 013
title: Daemon Architecture for Event-Driven Agent Runtime
status: implemented
date: 2026-05-09
supersedes: ADR-012 (extends to persistent runtime model)
---

# ADR-013: Daemon Architecture for Event-Driven Agent Runtime

## Context

bytro 1.0 uses a **temporary-process model** for Agent execution: the orchestrator spawns AgentRuntime instances on-demand (per-message), collects replies, and destroys them. This model has three fundamental limitations:

1. **No cross-visibility**: Agents receive only the user message (parallel broadcast), not each other's replies. ADR-012 addressed this with multi-round iteration, but each round still rebuilds context from scratch.

2. **No session persistence**: Every `onObservation()` call starts from a fresh session. Token costs are high because full conversation history must be re-injected every round.

3. **No event-driven scheduling**: The orchestrator directly calls `executeOpenFloor()` → `Promise.all()` → collect. There's no task queue, no claim mechanism, no natural convergence detection.

Multica's architecture solves these with a **Daemon + EventBus + TaskQueue** model:
- Daemon: long-lived process that manages resident Agent runtimes
- EventBus: all state changes propagate as events (not direct function calls)
- TaskQueue: SQLite-backed queue with claim/complete/fail lifecycle
- Session resume: `--resume session_id` for cross-round memory

@tomek-rumore explicitly requested: "直接 Daemon 采用 Multica 的 Runtime 方式" and "完全用新模型替代".

## Decision

Adopt Multica's Daemon architecture, adapted for bytro's Electron context:

1. **Daemon** — long-lived resident runtime manager inside Electron main process
2. **EventBus** — synchronous in-process pub/sub (same constraints as Electron IPC)
3. **TaskQueue** — SQLite-backed task queue with full lifecycle (pending → claimed → running → completed/failed)
4. **RuntimeRegistry** — manages resident AgentRuntime instances with loop safeguards

### Why Not Full Multica Architecture?

Multica runs as a standalone Go server with OS-level child processes (spawn `claude CLI`). bytro runs inside an Electron app where Agent execution is in-process (LLM API calls, not CLI spawns). Key differences:

| Dimension | Multica | bytro (this ADR) |
|-----------|---------|-------------------|
| Process model | OS child processes (claude/codex CLI) | In-process AgentRuntime (LLM API) |
| Transport | WebSocket + HTTP API | Electron IPC + EventBus |
| Agent lifecycle | Daemon spawns CLI per task | Resident Runtime, claim from queue |
| Session resume | `--resume session_id` (CLI flag) | `sessionId` on AgentRuntime (in-process) |

We adopt the **architectural pattern** (Daemon + EventBus + TaskQueue), not the **implementation details** (Go server + CLI spawn). The pattern is what delivers the value — event-driven scheduling, persistent runtimes, and natural convergence.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Main Process                                       │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐ │
│  │  Daemon   │    │  EventBus    │    │  RuntimeRegistry  │ │
│  │           │    │              │    │                   │ │
│  │ poll 500ms│◄──►│ pub/sub sync │◄──►│ ResidentRuntime[] │ │
│  │ heartbeat │    │ 13 event types│    │ loop safeguards  │ │
│  │ start/stop│    │ panic-safe   │    │ claimAndExecute  │ │
│  └──────────┘    └──────────────┘    └───────────────────┘ │
│         │                │                     │            │
│         ▼                ▼                     ▼            │
│  ┌──────────────┐    ┌──────────────────────────────────┐ │
│  │  TaskQueue   │    │  AgentRuntime (resident)          │ │
│  │              │    │                                  │ │
│  │ SQLite table │    │  onObservation() → reply/NO_REPLY │ │
│  │ claim/complete│    │  sessionId (cross-round resume)  │ │
│  │ fail/cancel  │    │  abort() for user ⏹              │ │
│  └──────────────┘    └──────────────────────────────────┘ │
│                                                              │
│  IPC Bridge:                                                 │
│  daemon.onUserMessage() → EventBus → RuntimeRegistry        │
│  RuntimeRegistry → TaskQueue → claimAndExecute → reply      │
│  reply → EventBus → other agents → follow-up tasks          │
│  reply → IPC → renderer → chatStore → UI                    │
└─────────────────────────────────────────────────────────────┘
```

### Message Flow (Open Floor)

```
User sends message
  → orchestrator.sendUserMessage(mode='open_floor')
    → daemon.onUserMessage()
      → EventBus.Publish('message:new')
        → RuntimeRegistry.onMessageNew() for each resident
          → shouldRespond() heuristic check
            → TaskQueue.Enqueue() per eligible agent
              → Daemon.pollTasks() (500ms interval)
                → RuntimeRegistry.claimAndExecute()
                  → AgentRuntime.onObservation()
                    → reply → TaskQueue.Complete()
                      → EventBus.Publish('message:reply')
                        → Other agents: onMessageReply() → follow-up tasks
                        → IPC → renderer → chatStore → UI render
                    → NO_REPLY → TaskQueue.Complete('[NO_REPLY]')
                    → error → TaskQueue.Fail()

Natural convergence:
  → No more follow-up tasks → checkConversationsComplete()
    → EventBus.Publish('open_floor:closed')
      → orchestrator → renderer → "讨论结束"

User ⏹ stop:
  → EventBus.Publish('system:abort')
    → RuntimeRegistry.onAbort()
      → TaskQueue.CancelPending()
      → AgentRuntime.abort()
      → resetConversationTracking()
```

### Loop Safeguards

| Mechanism | Value | Purpose |
|-----------|-------|---------|
| Max responses per agent per conversation | 5 | Prevent single-agent domination |
| Cooldown between responses | 2000ms | Prevent rapid-fire replies |
| Conversation timeout | 10 min | Hard ceiling for discussion length |
| Self-message filter | `event.actorId === agentId` → skip | Prevent agent responding to itself |
| NO_REPLY sentinel | Agent explicitly skips | Natural convergence signal |

### Session Resume (Phase 3)

Each AgentRuntime maintains a `sessionId` across rounds. When a follow-up task is created, the previous `sessionId` is passed:

```typescript
// task-queue.ts: AgentTask.sessionId
const lastSessionId = taskQueue.getLastSessionId(conversationId, profileId)
if (lastSessionId) {
  config = { ...config, sessionId: lastSessionId }
  // Resume existing session instead of starting fresh
}
```

This reduces token consumption by ~40-60% in multi-round discussions (no need to re-inject full history).

## Implementation

### Module Structure

| Module | File | Lines | Responsibility |
|--------|------|-------|---------------|
| EventBus | `src/main/daemon/event-bus.ts` | 101 | Synchronous pub/sub, 13 event types, panic-safe |
| TaskQueue | `src/main/daemon/task-queue.ts` | 263 | SQLite table, enqueue/claim/start/complete/fail/cancel |
| RuntimeRegistry | `src/main/daemon/runtime-registry.ts` | 285 | Resident runtime lifecycle, loop safeguards, session resume |
| Daemon | `src/main/daemon/daemon.ts` | 241 | Poll loop, heartbeat, abort, completion detection |
| Tests | `src/main/daemon/__tests__/` | 4 files | Unit tests for each module |

### SQLite Schema (agent_task_queue)

```sql
CREATE TABLE agent_task_queue (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_profile_id TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,                    -- JSON-serialized conversation context
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER,
  result TEXT,
  error TEXT,
  depth INTEGER NOT NULL DEFAULT 0,  -- delegation depth
  parent_task_id TEXT,                -- for chained tasks
  session_id TEXT                     -- cross-round resume
);

CREATE INDEX idx_task_queue_status_agent ON agent_task_queue(status, agent_profile_id);
CREATE INDEX idx_task_queue_conversation ON agent_task_queue(conversation_id, created_at);
```

### Orchestrator Integration

The orchestrator's `sendUserMessage()` now delegates to Daemon when `collaborationMode === 'open_floor'`:

```typescript
// orchestrator.ts (simplified)
if (collaborationMode === 'open_floor') {
  await daemon.onUserMessage(conversationId, message, context)
  // Daemon handles everything — no Promise.all, no manual round management
} else {
  // Orchestrated mode: existing single-agent execution (unchanged)
}
```

### EventBus Event Types

| Event | Trigger | Consumers |
|-------|---------|-----------|
| `message:new` | User sends message | RuntimeRegistry (enqueue tasks) |
| `message:reply` | Agent completes reply | RuntimeRegistry (follow-up), orchestrator (forward to renderer) |
| `agent:thinking` | Agent starts task | renderer (thinking indicator) |
| `agent:observation` | Agent produces output | renderer (message display) |
| `agent:task_claimed` | Agent claims task | logging |
| `agent:task_completed` | Task completes | completion detection |
| `agent:task_failed` | Task fails | logging, error handling |
| `open_floor:start` | User message in open_floor | renderer (UI state) |
| `open_floor:round_complete` | All agents finish a round | logging |
| `open_floor:closed` | No more active tasks | renderer ("讨论结束") |
| `conversation:created` | New conversation | Daemon (register tracking) |
| `conversation:updated` | Conversation metadata change | Daemon (update context) |
| `system:abort` | User ⏹ stop | Daemon, RuntimeRegistry (cancel + abort) |

## Migration Path

### From bytro 1.0 (temporary-process) to bytro 2.0 (Daemon)

| Phase | Content | Status |
|-------|---------|--------|
| L1 | Multi-round Open Floor (ADR-012) | ✅ Implemented on main |
| Phase 1 | Daemon core (EventBus + TaskQueue + RuntimeRegistry + Daemon) | ✅ Implemented |
| Phase 1 fix | 3 critical bugs (teamId, follow-up template, abort filter) | ✅ Fixed |
| Phase 2 | Event-driven message trigger (EventBus replaces direct calls) | ✅ Implemented |
| Phase 3 | Session resume (sessionId persistence across rounds) | ✅ Implemented |
| Merge | Daemon branch → main (after L1 E2E verification) | ⏳ Pending |
| Frontend | chatStore adapt for `message:reply` events | ⏳ Pending |
| Tests | Rewrite integration tests for Daemon architecture | ⏳ In progress |
| Typecheck | Fix 3 TS2802 errors (Set/Map downlevelIteration) | ⏳ Blocking merge |

### What's Preserved from bytro 1.0

- ✅ Orchestrated mode (single-agent execution) — unchanged
- ✅ AgentRuntime.onObservation() — same interface, now called from TaskQueue
- ✅ UI components (ChatInput, SharedConversation, AgentStatusBar) — unchanged
- ✅ SQLite messages/conversations tables — unchanged
- ✅ IPC bridge pattern — unchanged (Daemon sends via webContents.send)

### What's Replaced

- ❌ `orchestrator.executeOpenFloor()` → `daemon.onUserMessage()` + EventBus
- ❌ `Promise.all()` batch execution → TaskQueue claim + poll
- ❌ Multi-round manual context assembly → EventBus `message:reply` + follow-up tasks
- ❌ Per-round fresh sessions → Session resume with `sessionId`

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Resident runtime memory leak | Medium | High | Heartbeat monitoring + periodic restart |
| EventBus synchronous blocking | Low | Medium | Handlers are async-safe; long handlers logged |
| TaskQueue SQLite contention | Low | Medium | Single-process access; WAL mode |
| Agent infinite loop (mutual @mention) | Medium | High | MAX_RESPONSES_PER_AGENT=5 + cooldown + timeout |
| Merge conflict with main | Medium | Medium | Daemon branch is 6 commits on top of main; clean rebase possible |
| Frontend event mismatch | Medium | High | chatStore needs `message:reply` handler (pending) |

## Known Gaps (Post-Merge)

1. **EventBus is synchronous only** — no cross-process capability. Electron IPC handles renderer→main, but if bytro ever adds out-of-process agents, need `bus.publishAsync()` variant.

2. **TaskQueue trigger is push-mode** — orchestrator explicitly enqueues tasks. Multica uses DB trigger (comment INSERT → auto-enqueue). Push-mode is simpler but can't auto-trigger on new messages in DB.

3. **RuntimeRegistry follow-up is template-based** — `onMessageReply()` builds a structured follow-up message. Multica lets Agent read full thread and self-decide. Template approach is simpler but less flexible.

4. **Orchestrated mode not Daemon-ified** — single-agent execution still uses old orchestrator path. Could be unified later (TaskQueue with single claim).

5. **No WebSocket wake-up** — Multica Daemon receives WS push when tasks available. bytro uses 500ms polling. Polling is simpler but slightly less responsive.

## Related

- ADR-009: Dual-Mode Collaboration Architecture (open_floor + orchestrated)
- ADR-010: Layered Permission Model (open_floor=trusted, orchestrated=双层信任)
- ADR-011: Open Floor Bug Fix Retrospective (11-layer fix history)
- ADR-012: Iterative Open Floor for Agent Cross-Visibility (multi-round, superseded by Daemon for execution model)
- Multica: `server/internal/daemon/daemon.go` (reference architecture)
- `docs/features/bytro-multica-refactor-prd.md` — Refactoring PRD