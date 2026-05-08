---
status: active
owner: bytro
last_verified: 2026-05-08
doc_kind: architecture
---

# Session Bug Fixes (2026-05-08)

Summary of 5 session-level bugs fixed in `orchestrator.ts` and related files, plus 1 entry-point fix in `mention-parser.ts`.

## Bug Overview

| # | Bug | Root Cause | Fix |
|---|-----|-----------|-----|
| 1 | Parallel zombie defense missing | `InvocationQueue` only tracked serial tasks; parallel tasks had no timeout guard | Added `trackParallel`/`untrackParallel`; zombie scan checks both serial and parallel |
| 2 | Permission/question broadcast leak | `respondPermission`/`respondQuestion` broadcast to all runtimes in a conversation | Changed to fail-closed: exact `runtimeKey` match with `taskId`; no fallback broadcast |
| 3 | Runtime key collision | `runtimeKey = conv:profile` caused parallel tasks to overwrite each other | Changed to `conv:profile:taskId`; all callers updated |
| 4 | Stale session resume | Failed sessions left `primarySessionIds` entries, causing broken `--resume` on next turn | Clear `primarySessionIds` in catch block on failure |
| 5 | Feedback context injection | `createFeedbackTask` used empty context string | Changed to `assembleContext({ strategy: 'handoff', ... })` |
| 6 | @Codex no output (Path A) | `persistTaskOutput()` duplicated renderer's existing `complete` → `message.create()` path | Removed `persistTaskOutput()`; renderer handles all persistence |
| **R** | @Agent mention not parsed | `mention-parser.ts` only matched `@Agent: task` (colon), not `@Agent task` (space) | Added support for space, `:`, and `：` separators; unified strip rules with orchestrator |

## Key Architecture Decisions

### ADR: runtimeKey Three-Dimensional Model

```
Before: `${conversationId}:${profileId}`
After:  `${conversationId}:${profileId}:${taskId}`
```

This is the **foundation decision** for the session architecture. It enables:
- Parallel tasks for the same profile without runtime collision
- Precise permission routing by taskId
- Proper zombie cleanup per task

### ADR: Permission Routing — Fail Closed

```
Before: respondPermission → match by conv:profile → broadcast to all matching runtimes
After:  respondPermission → match by conv:profile:taskId → exact match only
        If no exact match → fail closed (don't route)
```

Security improvement: a permission response for task A can never accidentally reach task B's runtime.

### ADR: Output Persistence — Single Renderer Path

```
Before: orchestrator persistTaskOutput() + renderer complete handler = duplicate
After:  renderer chatStore.handleAIEvent → case 'complete' → per-task path → message.create()
```

The renderer is the **single source of truth** for message persistence. The orchestrator only emits events; it never writes messages.

## Files Changed

| File | Changes |
|------|---------|
| `src/main/ai/orchestrator.ts` | runtimeKey 3D, permission routing fail-closed, stale session clear, feedback context, remove persistTaskOutput, zombie defense for parallel, isAllMentions rule unification |
| `src/main/ai/invocation-queue.ts` | Added parallel task tracking (`trackParallel`/`untrackParallel`), zombie scan covers both serial and parallel |
| `src/renderer/src/stores/chatStore.ts` | Added `taskId` to `PendingPermission`/`PendingQuestion`, taskId routing in handlers |
| `src/main/ipc/orchestrator.ts` | IPC handlers accept optional `taskId` parameter |
| `src/preload/index.ts` | Preload bridge passes `taskId` through |
| `src/renderer/src/types/global.d.ts` | Updated `ElectronAPI.orchestrator` types with `taskId` |
| `src/main/ai/mention-parser.ts` | Support space/colon/fullwidth-colon separators |
| `src/main/ai/mention-parser.test.ts` | Tests for all separator variants |

## Verification

- `pnpm run typecheck` ✅
- `pnpm vitest run src/main/ai/mention-parser.test.ts` ✅ (38 tests)
- `pnpm vitest run src/main/ai/invocation-queue.test.ts` ✅

## Lessons Learned

1. **Test the entry point first**: Task #2's 5 session fixes were all correct, but they never activated because `mention-parser` silently dropped `@Agent task` (no colon). Always verify the full chain from input to output.

2. **Single persistence path**: Having two mechanisms writing messages (orchestrator + renderer) creates race conditions and duplicates. Pick one and stick with it.

3. **Exact routing wins**: Broadcasting events to all matching runtimes is convenient but creates security holes. Always route by the most specific identifier available.

4. **Immutable keys**: Adding dimensions to a key (`conv:profile` → `conv:profile:taskId`) is a low-risk change that eliminates whole categories of collision bugs.
