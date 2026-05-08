---
status: active
owner: mochi
last_updated: 2026-05-06
doc_kind: code-review
---

# Draft Task Flow Code Review

Review scope:

- `src/main/core/db.ts` — SCHEMA_VERSION 15, `conversations.is_draft` migration
- `src/main/ipc/conversation.ts` — draft-aware list/create/update, `conversation:promoteDraft`
- `src/preload/index.ts` — `conversation.create` / `conversation.promoteDraft` bridge
- `src/renderer/src/types/global.d.ts` — draft/team IPC typings
- `src/renderer/src/stores/chatStore.ts` — draft-aware create/send/promote behavior
- `src/renderer/src/App.tsx` — New Task creates draft conversation
- `src/renderer/src/pages/Chat.tsx` — Solo / Dev Team selector and draft cleanup
- `src/renderer/src/components/workspace/TaskRail.tsx` — client-side draft filter guard

Verification:

- `pnpm run typecheck` passed
- 2nd pass: `pnpm run typecheck` passed

## Findings

### [P1] #1 Draft cleanup deletes new tasks in dev

**File:** `src/renderer/src/pages/Chat.tsx` L45-53

The cleanup runs on every effect cleanup, including React 18 StrictMode's dev-only mount cleanup. Because `App` is wrapped in `React.StrictMode` and `currentConversation` is already the newly-created draft, opening a draft chat can immediately delete it before the user sends anything.

**Attempted fix:**

Added `hasSentRef` (`useRef(false)`) that is reset to `false` on every new `id`. A separate effect sets it to `true` when `messages.length > 0`. The cleanup effect guards with `if (hasSentRef.current) return`, so StrictMode's synthetic cleanup (which fires before any message arrives) never deletes the draft.

**2nd-pass note:**

This does not fix the StrictMode path. On React's dev-only synthetic cleanup, `hasSentRef.current` is still `false`, so the current draft can still be deleted immediately.

Status: **Open**

### [P1] #2 Dev Team selection is not reflected in first send state

**File:** `src/renderer/src/pages/Chat.tsx` L83-88

The IPC update persists `team_id`, but the Zustand `currentConversation` is never updated. `sendMessage` snapshots `currentConversation.team_id` from the store, so the first turn after choosing Dev Team can still start from the stale solo/null state and use the wrong primary profile path.

**Fix:**

Added `updateCurrentConversation(id, patch)` action to chatStore that patches both `currentConversation` and the matching entry in `conversations` immutably. `handleSelectMode` now calls it after the IPC update resolves, ensuring `sendMessage` reads the correct `team_id`.

Status: **Fixed**

### [P2] #3 Promotion can publish stale title to TaskRail

**File:** `src/renderer/src/stores/chatStore.ts` L604-630

`autoTitle` is fired without awaiting it, then `promoteDraft` selects and inserts the promoted row into `conversations`. If `promoteDraft` wins that race, TaskRail gets the old `New Task` title.

**Fix:**

Changed `window.api.conversation.autoTitle()` to `await`ed. `promoteDraft` is called only after the DB row carries the correct title. Additionally, the promoted row inserted into `conversations` merges the local `autoTitle` value as a safety net for any residual timing gap.

Status: **Fixed**

### [P1] #4 `updateCurrentConversation` hook is called after early returns

**File:** `src/renderer/src/pages/Chat.tsx` L73-93

The new `useChatStore((s) => s.updateCurrentConversation)` call is placed after the `loading` and `!currentConversation` early returns. The component can render once without calling this hook, then later render with the hook once the conversation loads, violating React's Rules of Hooks and risking a runtime "Rendered more hooks than during the previous render" failure.

**Recommended fix:**

Move the `updateCurrentConversation` hook next to the other store hooks at the top of `ChatPage`, before any conditional returns.

Status: **Open**

## Positive Observations

- `conversation:list` excludes drafts in main-process SQL, with TaskRail retaining a defensive client-side filter.
- `conversation:create` and preload typings consistently carry `is_draft`.
- Draft promotion is explicit (`conversation:promoteDraft`) rather than overloading generic update semantics.
- The selector visibility is correctly keyed to `is_draft` instead of message count, which preserves the intended UX for empty non-draft conversations.
