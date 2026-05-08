---
adr: 005-008
title: Multi-Agent Session Layer Fixes
status: implemented
date: 2026-05-08
---

# ADR-005~008: Multi-Agent Session Layer Architecture Fixes

## Overview

Four ADRs documenting architectural decisions for fixing 5 session-layer bugs in bytro-app's multi-agent orchestrator. All four implemented and verified.

| ADR | Title | Bugs Fixed | Risk Level |
|-----|-------|------------|------------|
| ADR-005 | Runtime Identity Granularity | Bug 1, Bug 3 | Lifecycle |
| ADR-006 | Permission/Question Precise Routing | Bug 2 | Security |
| ADR-007 | Lifecycle Cleanup Convergence | Bug 1, Bug 4 | State |
| ADR-008 | Feedback Task Context Composition | Bug 5 | Context |

---

## ADR-005: Runtime Identity Granularity

### Decision
Change `runtimeKey` from `${conversationId}:${profileId}` to `${conversationId}:${profileId}:${taskId}`.

### Context
Originally `runtimes: Map<string, AgentRuntime>` was keyed by `conv:profile`. This **collapsed concurrent runtimes** for the same `(conv, profile)` pair into a single map entry — the second runtime overwrote the first, orphaning the original Claude CLI subprocess.

### Root cause impact
- Bug 1 (zombie defense missing for parallel tasks): zombie-defense iterates `processing` set, but parallel tasks bypass the queue. With `taskId` in the key, each parallel task has a stable, unique runtime entry that can be tracked.
- Bug 3 (key collision): explicit symptom — concurrent @mention tasks for same agent would collide.
- Bug 2 (permission broadcast): the prefix-scan `runtimes.forEach(key.startsWith(prefix))` now enables precise targeting with taskId.

### Consequences
- All callers of `runtimeKey()` must pass `taskId` (~10 call sites in orchestrator.ts)
- Cleanup paths must enumerate by prefix `conv:profile:` or `conv:` depending on scope
- `primarySessionIds` map keyed differently (`conv:profile` for resume cache) — kept as-is with explicit comment

### Implementation
See `src/main/ai/orchestrator.ts` — `runtimeKey()` function.

---

## ADR-006: Permission/Question Precise Routing (CRITICAL)

### Decision
Replace the `conversationId:`-prefix broadcast in `respondPermission` / `respondQuestion` with **request-ID based precise routing**.

### Context
Originally:
```typescript
respondPermission(conversationId, approved): void {
  const prefix = `${conversationId}:`
  this.runtimes.forEach((runtime, key) => {
    if (key.startsWith(prefix) && runtime.isActive) runtime.respondPermission(approved)
  })
}
```

When agent A asks "may I run rm?" and the user clicks "Allow", **all active agents in the conversation receive `respondPermission(true)`**. Agent B might be waiting on a different permission and wrongly act on it.

### Security impact (CRITICAL)
This is **privilege escalation across agent identity** — agent B can execute actions the user only authorized for agent A. In `manual` (PTY) mode this includes arbitrary shell commands.

### Decision detail
1. Generate a unique `requestId` (UUID) when an agent emits a `permission_request` or `question` event
2. Tag the IPC event with `requestId` and `runtimeKey`
3. Renderer echoes `requestId` back in `respondPermission(requestId, approved)`
4. Orchestrator looks up the specific runtime owning `requestId` and routes only there
5. Stale requests (runtime gone, request expired) are dropped with a log warning

### Implementation
See `src/main/ai/orchestrator.ts` — `respondPermission()` and `respondQuestion()` methods.

---

## ADR-007: Lifecycle Cleanup Convergence

### Decision
All runtime termination paths must converge through a single `cleanupRuntime(key, reason)` function that:
1. Aborts the runtime if active
2. Removes from `runtimes` Map
3. Removes from `webContentsMap`
4. Invalidates the `primarySessionIds` entry if reason ≠ "normal completion"
5. Notifies `invocationQueue.markDone()`
6. Resolves any pending permission/question requests with an "abandoned" verdict
7. Emits a `runtime:terminated` event (for observability)

### Context
Before fix:
- `abort()` cleaned up runtimes but **didn't invalidate `primarySessionIds`**
- Crash paths (provider error, dispose exception) **didn't clean up at all** — the `primarySessionIds` entry remained, pointing to a dead Claude CLI session
- Zombie defense only saw queued tasks, not parallel ones

### Reason enum
```typescript
type TerminationReason = 'completed' | 'aborted' | 'crashed' | 'zombie' | 'disposed'
```

### Key consequence
- `--resume` fallback: if resume fails (sessionId stale), fall back to full `contextSnapshot` injection — don't just error out

### Implementation
See `src/main/ai/orchestrator.ts` — `cleanupRuntime()` and `src/main/ai/invocation-queue.ts` — zombie defense.

---

## ADR-008: Feedback Task Context Composition

### Decision
`createFeedbackTask` must **compose** the parent agent's context, not pass `contextSnapshot: ''`.

### Context
Originally feedback tasks (when child agent completes and notifies parent) skipped context injection. The parent agent received only:
```
[@子AgentId 的任务已完成]

<子 agent 输出>

请查看结果并决定下一步行动。
```
With no memory of its own prior work. For deep delegation chains (depth > 0), this means **every handoff resets the parent's memory**.

### Decision detail
1. Feedback task `contextSnapshot` should include:
   - Parent's continuity capsule (compressed memory) if available, OR
   - Parent's last N turns from the conversation if no capsule, OR
   - Full context-assembler output as fallback
2. Pass through `context-assembler.assembleContext()` with a `feedbackMode: true` flag
3. Treat feedback as "resumption with guest output" — preserve parent's working memory, append child's output as new turn

### Token budget concern
Parent context + child output may exceed window. Strategy: tail-bias for parent + full child output.

### Implementation
See `src/main/ai/orchestrator.ts` — `createFeedbackTask()` and `src/main/ai/context-assembler.ts`.

---

## Post-Implementation: Task #4 — Entry-Point Validation Layer

### Root cause: mention-parser separator mismatch (2026-05-08)

The session-layer fixes (ADR-005~008) were correct but invisible because the **mention-parser never produced an intent** for space-separated `@Codex task description`.

**Failure chain:**
```
"@Codex 帮我检查代码" (空格分隔, 用户自然输入)
    ↓
mention-parser regex: /@(\w+):\s*(.+)/ — 只匹配英文冒号
    ↓
解析失败 → 无 intent → orchestrator 不创建 A2A task
    ↓
Codex 从未被启动 → 无回复
```

### Architectural insight: multi-layer pipeline visibility

```
Layer 1 (Parser)     → Layer 2 (Routing)  → Layer 3 (Execution) → Layer 4 (Persistence)
mention-parser.ts       orchestrator.ts      agent-runtime.ts       chatStore.ts
```

The surface symptom appeared to be a Layer 3-4 problem, but the actual break was at Layer 1. When debugging multi-agent pipelines, **always verify each layer's output before assuming the next layer is broken**.

### Fix
- `mention-parser.ts`: support `空格` / `:` / `：` as three separator forms
- `orchestrator.ts`: use same rule as parser for `isAllMentions`
- Added test coverage for all three separator forms

---

## Observability Integration (Task #1)

All ADRs' observability hooks are now implemented via `writeObservabilityEvent()` in `src/main/core/logging.ts`:

| Event Type | Trigger Points | Log File |
|------------|---------------|----------|
| `runtime:started` | `executeTask()` after `runtime.start()` | runtime.log |
| `runtime:terminated` | completed/crashed/zombie/aborted paths | runtime.log |
| `task:enqueued` | `scheduleTask()` parallel + serial branches | task.log |
| `task:started` | `executeTask()` status → working | task.log |
| `task:completed` | `executeTask()` success path | task.log |
| `task:failed` | `executeTask()` catch block | task.log |
| `permission:granted` | `respondPermission()` approved | permission.log |
| `permission:denied` | `respondPermission()` rejected | permission.log |
| `permission:abandoned` | stale runtime / stale question | permission.log |
| `feedback:created` | `createFeedbackTask()` persist | feedback.log |

15 injection points across orchestrator.ts covering all 11 event types.

## Cross-Cutting Concerns

### Testing strategy
- Each ADR's implementation includes unit tests
- Integration test: "@All triggers 3 parallel agents, each gets correct permission, one crashes, all clean up correctly"
- Mention-parser: 3 separator forms + orchestrator rule consistency

### Migration order (completed)
1. **PR 1**: ADR-006 (Bug 2) — security, ship first, hotfix-able
2. **PR 2**: ADR-005 + ADR-007 partial (Bug 1, 3) — lifecycle
3. **PR 3**: ADR-007 rest + ADR-008 (Bug 4, 5) — state
4. **PR 4**: Task #4 parser fix — entry-point validation

### Lessons learned
1. **Entry-point validation is as critical as core logic** — a one-line regex fix at Layer 1 masked weeks of correct work at Layers 2-4
2. **Observability at every layer boundary** — with `writeObservabilityEvent`, future issues will be traceable by filtering `task.log` / `runtime.log`
3. **Parser and orchestrator must use the same rules** — hidden inconsistencies cause silent failures

---

## ADR-009: Dual-Mode Collaboration Architecture

**Date:** 2026-05-08  
**Author:** 架构设计  
**Status:** Accepted — pending implementation  
**Discussion:** Thread #all:dc672bc7

### Decision
bytro-app adopts a dual-mode collaboration architecture: `CollaborationMode = 'orchestrated' | 'open_floor'`.

- `orchestrated`: Current centralized A2A pipeline (RoutingPlanner → CapabilityRouting → executeTask → chain tracking). Suited for implementation, code review, bug fixes — tasks with clear inputs and deterministic outputs.
- `open_floor`: New decentralized broadcast mode. All team members receive the conversation, each Agent autonomously decides whether to participate. Suited for brainstorming, architecture discussion, diagnostics — tasks requiring diverse perspectives.

### Context
bytro-app currently has only one collaboration mode: centralized orchestration. All messages go through Intent Parser → Routing Planner → single Agent assignment. This works well for structured execution pipelines (Plan→Code→Review) but fails for divergent scenarios:

- Brainstorming: Orchestrator cannot predict which Agent has the best idea
- Architecture discussion: Needs multiple perspectives simultaneously
- Diagnostics: Multiple hypotheses need parallel exploration

The discussion in #all:dc672bc7 revealed that all 5 agents independently converged on the same conclusion: bytro needs a decentralized mode alongside its existing centralized pipeline.

Slock already demonstrates this pattern — agents in #all observe conversations and autonomously decide when to intervene based on their capabilities.

### Consequences

**Open Floor mode characteristics:**
- Broadcasts to all team members (not single-agent assignment)
- Agents autonomously assess relevance (score ≥ 0.3 → participate)
- Full conversation history as context (not curated ContextPacket)
- 5-minute discussion window with automatic convergence
- SummarizePanel bridges open_floor output → orchestrated execution
- No chain tracking, no feedback loops, no InvocationQueue

**Mode coexistence:**
- Both modes share underlying storage (MemoryPalace, logging, context-selector)
- Mode switching is user-controlled or auto-inferred from keywords
- `@openfloor` / `@build` shortcuts for quick mode switching
- NewTaskDialog mode cards for visual mode selection

**Implementation scope:**
- ❌ No DB schema changes
- ❌ No ACP protocol changes
- ❌ No routing-planner changes
- ✅ orchestrator.ts: new `executeOpenFloor()` branch
- ✅ agent-runtime.ts: new `onObservation()` + `assessRelevance()`
- ✅ 4 frontend components: minor modifications (80% infrastructure already exists)

### Trade-offs
- **+** Enables brainstorming, exploration, and multi-perspective discussion
- **+** Leverages existing UI infrastructure (Explore button, AGENT_PALETTE)
- **+** Minimal change surface (3 backend files, 4 frontend components)
- **+** Forward-compatible with future collaboration modes
- **-** Agents may produce noise if relevance assessment is poorly tuned
- **-** Discussion window time limit may feel arbitrary

### Mode selection matrix

| Scenario | Recommended Mode | Reason |
|----------|-----------------|--------|
| Code implementation | orchestrated | Clear input/output, needs chain tracking |
| Code review | orchestrated | Structured checklist, deterministic output |
| Bug fix | orchestrated | Needs root cause tracking, verification |
| Brainstorming | open_floor | Multi-perspective, divergent thinking |
| Architecture discussion | open_floor | Needs collision of viewpoints |
| Technical selection | open_floor → orchestrated | Diverge first, converge after |
| Diagnostics | open_floor | Multiple hypotheses in parallel |

---

## ADR-010: Layered Permission Model

**Date:** 2026-05-08  
**Author:** 架构设计  
**Status:** Accepted — pending implementation  
**Discussion:** Thread #all:dc672bc7

### Decision
bytro-app adopts a layered permission model tied to collaboration mode:

```
open_floor → trusted (zero approval, read-only tools, post-hoc audit via observability logs)
orchestrated → dual-layer trust:
  L1: Session trust (within task scope → auto-approve)
  L2: Boundary gate (out-of-scope operations → permission dialog)
  + User-selectable PermissionMode: manual | autoEdit | plan | trusted
```

New `PermissionMode` value: `trusted` — skips all permission dialogs, logs all operations to observability JSONL. Modeled after Slock's approach where "human in the loop" serves as the audit layer rather than step-by-step approval.

### Context
bytro-app currently requires `permission_request` for every tool invocation. This creates "approval fatigue" — users mechanically click "Allow" without actually reviewing, defeating the purpose of permission gates.

Slock takes the opposite approach: agents have full filesystem access on the user's machine. The trust boundary is "you invited the agent to your machine" rather than "you approved every step." Review happens on the output (`in_review` status), not on individual operations.

The core insight from discussion: **review should happen on deliverables, not on steps.** Step-level dialogs create fatigue without improving quality.

### Consequences

**Permission mode spectrum:**

| Mode | Read | Write | Execute | API Call | Audit |
|------|------|-------|---------|----------|-------|
| manual | ask | ask | ask | ask | ✅ |
| autoEdit | auto | auto | ask | ask | ✅ |
| plan | auto | batch | batch | ask | ✅ |
| trusted | auto | auto | auto | auto | ✅ |

**Open Floor enforcement:**
- open_floor mode always uses `trusted`
- Agent tools limited to read-only during open_floor (read_file, search_memory, search_history, read_summary)
- Write/execute/api tools auto-rejected with "switch to orchestrated mode" prompt

**Mode transition gate:**
- Pure mode switch (collaborationMode only) → no permission needed
- Mode switch + immediate execution → confirmation dialog: "Agent will modify code. Current permission: autoEdit. [Proceed] [Change mode]"

### Trade-offs
- **+** Eliminates approval fatigue — review happens on actual output
- **+** Full audit trail via observability logging (already implemented, 6 permission event types)
- **+** Open Floor has zero friction (pure discussion needs no approval)
- **+** Boundary gate catches only truly risky operations
- **-** Trusted mode requires user discipline (must actually review output)
- **-** Scope detection (`isWithinScope`) may have false positives/negatives initially

### References
- Slock permission model: channel membership = full trust, human-in-the-loop auditing
- ADR-006: permission precise routing (requestId-based, already implemented)
- observability-logging.md: 16 injection points, 12 event types including permission events
