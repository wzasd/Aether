---
status: completed
owner: bytro
last_verified: 2026-05-01
doc_kind: review
scope: module-B-file-change-tracking
source: docs/plans/2026-05-01-module-B-implementation.md
---

# Module B Code Review: File Change Tracking

This review covers the Module B implementation for file change tracking: `file_changes` persistence, `change:*` IPC, preload/types, `changeStore`, `chatStore` tool-result extraction, `DiffPanel`, `SessionChangesSummary`, and TaskRail counters.

Status update on 2026-05-01: all seven review findings are now resolved. Module B-specific tests are still missing.

## Verification

- `pnpm run typecheck`: passing on 2026-05-01
- `pnpm test`: passing on 2026-05-01
- Module B-specific tests: not present yet

## Summary

| Priority | Area | Finding | Status |
|---|---|---|---|
| P1 | Tool extraction | MCP file tools are never recognized | Resolved |
| P1 | TaskRail counters | Sidebar change count stays stale | Resolved |
| P2 | DiffPanel | Delete changes are hidden | Resolved |
| P2 | Diff stats | Added/deleted line counts are unreliable | Resolved |
| P2 | Agent counters | Agent count path is not implemented | Resolved |
| P1 | Session routing | Module B writes changes/counters to the visible conversation | Resolved |
| P2 | Agent counters | `agent_count` can overwrite an unseen conversation count | Resolved |

## Findings

### ~~[P1] MCP file tools are never recognized~~ → Resolved

- File: `src/renderer/src/stores/chatStore.ts`
- Lines: 14-16
- Status: resolved

For names like `mcp__filesystem__Edit`, the current normalization returns `filesystem__Edit`, which does not match `Write`, `Edit`, or `Delete`. Any MCP-backed file operation is silently skipped, so Module B misses a major class of edits.

Resolution: `normalizeToolName()` now takes the last `__` segment before checking `FILE_OPERATION_TOOLS`.

### ~~[P1] Sidebar change count stays stale~~ → Resolved

- File: `src/renderer/src/stores/chatStore.ts`
- Lines: 736-743
- Status: resolved

Recording a change only updates `changeStore`; it does not update `currentConversation` or the `conversations` list that `TaskRail` renders. The DB `change_count` increments in `change:record`, but the visible counter does not move until the conversation list is reloaded.

Resolution: `tool_result` now optimistically increments `change_count` for both `currentConversation` and the matching item in `conversations`.

### ~~[P2] Delete changes are hidden~~ → Resolved

- File: `src/renderer/src/components/workspace/DiffPanel.tsx`
- Lines: 35-37
- Status: resolved

`extractFileChange` records Delete operations as `deleted`, but `DiffPanel` filters the list down to only `modified` and `added`. A conversation containing only deletes shows the empty state even though changes were captured.

Resolution: `DiffPanel` now renders all `changes` without filtering out `deleted`.

### ~~[P2] Added/deleted line counts are unreliable~~ → Resolved

- File: `src/renderer/src/stores/chatStore.ts`
- Lines: 41-55
- Status: resolved

Single-line Edit changes report `0` additions/deletions because the code subtracts `1` from the split length. Write counts lines from the tool result instead of the input content; in practice Write results are often success messages, so displayed diff stats can be wrong.

Resolution: `extractFileChange()` now uses a shared `countLines()` helper and reads Write line counts from input `content`/`text`.

### ~~[P2] Agent count path is not implemented~~ → Resolved

- File: `src/renderer/src/stores/chatStore.ts`
- Lines: 823-834
- Status: resolved

The Module B plan requires incrementing and persisting `agent_count` on `subagent_started`. Earlier code only updated subagent state, so the TaskRail agent counter remained at its previous value.

Resolution: `subagent_started` now increments `agent_count` in local UI state and persists the new value through `conversation.update`.

### ~~[P1] Module B writes changes/counters to the visible conversation~~ → Resolved

- File: `src/renderer/src/stores/chatStore.ts`
- Lines: 741, 857
- Status: resolved

The Module B paths now resolve the target conversation via `event.sessionId || state.streamingRequestId` looked up in `sessionConversationIds`, falling back to `currentConversation` only when no session mapping exists. Applied to both `tool_result` change recording and `subagent_started` counter updates. `sessionId?: string` added to both `tool_result` and `subagent_started` variants in `global.d.ts`.

### ~~[P2] `agent_count` can overwrite an unseen conversation count~~ → Resolved

- File: `src/renderer/src/stores/chatStore.ts`
- Lines: 860-862
- Status: resolved

Resolution: replaced renderer-computed absolute `conversation.update({ agent_count: newCount })` with a new `conversation:incrementAgentCount` IPC that does `UPDATE conversations SET agent_count = agent_count + 1 WHERE id = ?` atomically in the main process. The optimistic UI update now also increments by `+1` relative to the current cached value, consistent with `change_count` semantics.

## Test Gaps

- No tests cover `change:record` transaction behavior or `change_count` increments.
- No tests cover `extractFileChange` for direct and MCP tool names.
- No tests cover Write/Edit/Delete line-count behavior.
- No tests cover `DiffPanel` rendering deleted changes.
- No tests cover `subagent_started` updating `agent_count`.
