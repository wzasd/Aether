---
status: closed
owner: bytro
last_updated: 2026-05-07
doc_kind: code-review
scope: a2a-gap-fill
---

# A2A Gap Fill Code Review

This review covers the six A2A Gap Fill phases: invocation queue, continuity capsules, reflow orchestration, ACP model switching, A2A memory distillation, and related documentation.

Verification performed:

- Static code review of `src/main/ai/orchestrator.ts`
- Static code review of `src/main/ai/reflow-orchestrator.ts`
- Static code review of `src/main/ai/continuity-capsule.ts`
- Static code review of `src/main/ai/agent-runtime.ts`
- Static code review of `src/main/ai/a2a-memory-distiller.ts`
- `pnpm run typecheck` passed after fixes.

## Fix Status

| # | Issue | Status | Fix Location |
|---|-------|--------|--------------|
| P1 | Reflow aggregation never emits feedback | ✅ Fixed | `orchestrator.ts:handleChildComplete` |
| P1 | Reflow timeout has no delivery path | ✅ Fixed | `reflow-orchestrator.ts` + `orchestrator.ts` constructor |
| P1 | Zombie defense does not unblock stuck execution | ✅ Fixed | `orchestrator.ts` zombie callback |
| P2 | switchModel overrides task/runtime model selection | ✅ Fixed | `orchestrator.ts:executeTask` |
| P2 | Capsule parent links use profile ids instead of task ids | ✅ Fixed | `a2a-types.ts` + `orchestrator.ts:scheduleTask/executeTask` |
| **P1** | **Race condition: async mention handler vs drainSerialQueue** | ✅ Fixed | `orchestrator.ts:executeTask` |

---

## Findings

### P1: Race condition — async mention handler vs drainSerialQueue

**Root cause of "后面几个任务都没有执行".**

File: `src/main/ai/orchestrator.ts:executeTask`

`runtime.on('mention', async ...)` registers an async EventEmitter handler. When Agent output contains @mentions, `AgentRuntime.emit('mention')` fires but does **not await** the async handler. The `done` event then resolves `executeTask()`'s Promise, and `drainSerialQueue()` runs immediately — often before `dispatchIntents()` has enqueued the child tasks.

The queue appears empty, `drainSerialQueue()` returns instantly, and child tasks are orphaned in the queue forever.

Fix: Track `pendingMentionDispatch: Promise<void>` inside `executeTask`, and wait for it to complete before resolving the `done`/`error` Promise.

---

### P1: Reflow aggregation never emits feedback

File: `src/main/ai/orchestrator.ts:927`

`onChildComplete()` / `onChildFail()` already call `tryAggregate()` and mutate the group state to `done`, `partial`, or `failed` when the last child reports. `handleChildComplete()` then calls `tryAggregate(group)` a second time; because the state is no longer `running`, `tryAggregate()` returns false and the aggregated feedback task is never created.

Parallel multi-agent result aggregation therefore silently stalls exactly when all children finish.

Expected direction:

- Make `onChildComplete()` / `onChildFail()` return whether the group became ready.
- Or have `handleChildComplete()` inspect `group.state` after recording the child result instead of calling `tryAggregate()` again.
- Ensure the ready path creates exactly one aggregated feedback task and disposes the group.

### P1: Reflow timeout has no delivery path

File: `src/main/ai/reflow-orchestrator.ts:152`

The timeout guard only changes `group.state` to `timeout`; no orchestrator callback is invoked, no partial aggregation task is created, and the group is not disposed. Once timed out, later child completions also cannot aggregate because `tryAggregate()` rejects non-`running` groups.

The advertised 5-minute timeout becomes a permanent stuck group rather than a partial result back to the parent.

Expected direction:

- Add a timeout callback/event from `ReflowOrchestrator` back to `AgentOrchestrator`.
- On timeout, build a partial aggregation message with completed and missing child results.
- Enqueue/send the feedback task and dispose the group.

### P1: Zombie defense does not unblock stuck execution

File: `src/main/ai/orchestrator.ts:86`

When a task is detected as stale, the callback marks the DB row failed and emits completion, but it never aborts the active runtime or resolves the `executeTask()` promise currently awaited by `drainSerialQueue()`.

The queue remains stuck on the original hung task, and downstream work still will not run.

Expected direction:

- Find and abort the active runtime for the zombie task/conversation.
- Ensure the awaited `executeTask()` path resolves or errors so `drainSerialQueue()` reaches `markDone()` and continues.
- Avoid double completion events if the abort path also emits `error` / `done`.

Fix:

- Zombie callback aborts the active runtime and marks the invocation queue done.
- `executeTask()` tracks zombie task ids and returns after cleanup so the failed DB status is not overwritten as completed.
- Terminal `error` events now route through the failed task path instead of completing successfully.

### P2: switchModel overrides task/runtime model selection

File: `src/main/ai/orchestrator.ts:583`

`runtime.start(runtimeConfig, runtimeOverrides)` already resolves the selected model using task-level overrides and team member overrides, but the follow-up `runtime.switchModel(profile.model)` forces the session back to the profile's default model.

That breaks task runtime overrides and team member model overrides for ACP sessions.

Expected direction:

- Switch to the same resolved runtime model used by `runtime.start()`.
- Or have `AgentRuntime.start()` expose the resolved model/session config so `executeTask()` does not recompute it incorrectly.

Fix:

- `executeTask()` switches to `runtimeOverrides?.model ?? profile.model`, preserving task/team model overrides.

### P2: Capsule parent links use profile ids instead of task ids

File: `src/main/ai/orchestrator.ts:509`

`getByTaskId()` expects a task id, but `executeTask()` passes `task.fromProfileId`, which is an agent profile id. Child capsules therefore almost never get a `parentCapsuleId`, so the continuity chain cannot reconstruct parent-child session lineage.

This undermines the seal/resume state machine for handoffs.

Expected direction:

- Carry parent task id explicitly when scheduling child tasks, or derive it from the task graph edge.
- Use that task id to link the child capsule to the parent capsule.
- Add a regression test for A → B → C capsule parent lineage.

Fix:

- `A2ATask.parentTaskId` carries lineage through scheduling.
- `executeTask()` resolves parent capsules by `task.parentTaskId`, not `fromProfileId`.

## Suggested Fix Order

1. Fix reflow aggregation readiness so all-complete parallel groups emit feedback.
2. Add timeout delivery for reflow groups.
3. Make zombie defense actually abort/release the active runtime.
4. Align `switchModel()` with resolved runtime overrides.
5. Link continuity capsules by parent task id rather than profile id.
