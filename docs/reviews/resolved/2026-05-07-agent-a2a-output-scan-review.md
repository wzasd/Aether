---
status: closed
owner: bytro
last_updated: 2026-05-07
doc_kind: code-review
scope: agent-a2a-output-scan
---

# Agent A2A Output Scanning Code Review

This review covers the Agent output scanning implementation: `agent-output-scanner.ts`, `agent-runtime.ts`, `orchestrator.ts`, `a2a-types.ts`, and related docs.

Verification performed:

- `pnpm test -- --run src/main/ai/agent-output-scanner.test.ts` was attempted.
- `src/main/ai/agent-output-scanner.test.ts` passed: 15 tests.
- The broader Vitest run failed in `src/main/core/db.test.ts` because `better-sqlite3` was compiled for a different Node module ABI (`NODE_MODULE_VERSION 133` vs required `127`). This appears environmental and unrelated to the scanner change.

## Findings

### P1: Agent-scan tasks can stay queued forever in parallel mode — **FIXED**

File: `src/main/ai/orchestrator.ts:185`

`dispatchIntents()` schedules normal `@Agent` handoffs with `plan.executionMode`, which is `serial` for mention intents, so `scheduleTask()` pushes them into `serialQueues`. But after the primary task completes, the queue is drained only when the original user-selected `executionMode` is `serial`.

If a primary run is started in parallel mode and the agent output contains:

```text
@Codex: review this implementation
```

that task is enqueued and never executed.

**Fix:** `drainSerialQueue()` now always runs after `executeTask()` completes, regardless of the root execution mode. The loop-based drain handles dynamically appended work.

### P2: Code-change review policy is now a no-op — **FIXED**

File: `src/main/ai/orchestrator.ts:535`

`executeTask()` still calls `runTeamPolicies()` after a root task, and `team-config` still exposes `requireReviewOnCodeChange`, but `runTeamPolicies()` now only deletes `fileChangeFlags` and never dispatches the synthetic `policy_review` intent.

This silently disables the existing review-on-code-change safety gate.

**Fix:** Product decision is to rely on agent-initiated review mentions only. Removed the dead code entirely:
- Removed `runTeamPolicies()` method from `orchestrator.ts`
- Removed `requireReviewOnCodeChange` from `AgentSpacePolicy` interface, `DEFAULT_POLICY`, and `DEV_TEAM_POLICIES`
- Removed `policy_review` from `Intent` union and `EdgeType`
- Removed `policy_review` routing case from `routing-planner.ts`
- Removed `policy_review` policy-gate case from `policy-gate.ts`
- Removed `makePolicyReviewIntent()` from `intent-parser.ts`
- Removed PolicyToggle UI for `requireReviewOnCodeChange` from `WorkspaceArea.tsx`
- Removed `policy-review` edge type from `TaskGraph.tsx` labels/colors maps

### P3: New task source is not persisted or restored — **FIXED**

File: `src/main/ai/orchestrator.ts:386`

`A2ATask.source` is set on the live task object, but `persistTask()` does not insert it, the `a2a_tasks` schema has no `source` column, and `rowToTask()` does not read it back.

After reload, or when `getActiveGraph()` reconstructs tasks from DB, agent-scanned tasks lose their `user` vs `agent-scan` source.

**Fix:**
- DB migration v22 adds `source TEXT` column to `a2a_tasks` (via `addMissingColumn`)
- Initial schema (for new DBs) also includes `source TEXT`
- `persistTask()` now inserts `task.source ?? null`
- `rowToTask()` now restores `source` from the row

## Suggested Fix Order

1. ✅ Fix serial queue draining so agent-scan handoffs cannot get stuck in parallel root runs.
2. ✅ Decide whether `requireReviewOnCodeChange` remains a real policy; removed the stale hook.
3. ✅ Persist and restore `A2ATask.source` for UI, diagnostics, and graph semantics.
