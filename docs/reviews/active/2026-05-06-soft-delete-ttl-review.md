---
status: active
owner: mochi
last_updated: 2026-05-06
doc_kind: code-review
---

# Soft Delete TTL Code Review

Review scope:

- `src/main/core/db.ts` — SCHEMA_VERSION 16, `conversations.deleted_at` migration/index, startup TTL purge
- `src/main/ipc/conversation.ts` — soft-delete behavior and deleted-row filtering
- `src/renderer/src/components/ConversationDeleteConfirm.tsx` — delete retention copy
- Delete entry points in Sidebar, TaskRail, and keyboard shortcuts

Verification:

- `pnpm run typecheck` passed

## Findings

### [P1] #1 Search still returns deleted conversations

**File:** `src/main/ipc/conversation.ts` L190-200

`conversation:list` now hides soft-deleted rows, but search joins `conversations` without `c.deleted_at IS NULL`. Deleted conversations can still appear in `ConversationSearch`, and clicking a result navigates back into the supposedly deleted chat.

**Recommended fix:**

Add `c.deleted_at IS NULL` to the search query, ideally alongside any future `is_draft = 0` filtering if drafts should also stay hidden from search.

Status: **Open**

### [P1] #2 Direct load can reopen soft-deleted chats

**File:** `src/main/ipc/conversation.ts` L78-83

`conversation:get` still selects by id only, so refreshing or directly navigating to `/chat/:id` after deletion loads the retained conversation and its messages. Soft delete should preserve data for TTL, but normal read paths should treat it as not found unless there is an explicit restore/trash view.

**Recommended fix:**

Change the default `conversation:get` query to require `deleted_at IS NULL`. If a trash/restore view is added later, give it a separate explicit API rather than reusing the normal chat load path.

Status: **Open**

### [P2] #3 Other delete confirmations omit retention wording

**File:** `src/renderer/src/components/workspace/TaskRail.tsx` L100-107

The dedicated delete dialog now says data is retained for 30 days, but TaskRail keyboard deletion still uses a native confirm with only `Delete ...?`, and Cmd+W has a similar generic prompt. Users can still delete through those paths without seeing the new retention semantics.

**Recommended fix:**

Use the same confirmation copy for all delete entry points, or route keyboard deletion through the shared delete confirmation dialog so the 30-day retention behavior is communicated consistently.

Status: **Open**

## Positive Observations

- The list queries consistently filter `deleted_at IS NULL`, so normal TaskRail listing no longer shows soft-deleted conversations.
- The hard purge is delayed by a 30-day TTL and relies on existing foreign-key cascade only when the row is actually purged.
- The main deletion path updates `deleted_at` rather than immediately destroying conversation data.
