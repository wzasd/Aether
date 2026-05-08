---
status: active
owner: bytro
last_verified: 2026-05-02
doc_kind: code-review
scope: multi-agent-a2a-orchestration
---

# A2A Orchestration Code Review

This review covers the recent multi-agent A2A orchestration work, including main-process orchestration, IPC wiring, DB persistence, and frontend chat changes.

Verification performed:

- `pnpm run typecheck` passed.
- `pnpm test` passed: 85 tests across 7 files.

## Findings

### P1: Direct user @mentions are not routed

File: `src/renderer/src/components/chat/ChatInput.tsx:139`

The UI now autocompletes `@Coder: ...`, but sending still passes raw text into `sendMessage`, and `chatStore` chooses the orchestrator path only when an active profile is selected.

If the user selects `Default`, `@Coder:` goes through the old single-agent chat path. If `Planner` is selected, the message still goes to Planner rather than directly creating a Coder A2A task.

This breaks the expected manual flow:

```text
@Coder: 帮我写一个 hello world
```

Expected direction:

- Detect a leading known-agent mention in user input.
- Route it directly through orchestrator as a task to the mentioned Agent Profile.
- Keep the active profile path for normal messages that should go to the selected/default agent first.

### P1: A2A events can persist into the wrong conversation

File: `src/renderer/src/stores/chatStore.ts:931`

For orchestrator-forwarded events, the main process already includes `conversationId`, but the `complete` handler ignores it and first tries `sessionConversationIds`.

A2A sessions are never added to `sessionConversationIds`, so the fallback is `currentConversation?.id`. If the user switches conversations while an agent is running, assistant output, usage, summaries, and status updates can be written to the visible conversation instead of the task's conversation.

Expected direction:

- Prefer `event.conversationId` for all orchestrator-routed events.
- Only fall back to `sessionConversationIds` for the legacy chat path.
- Avoid using `currentConversation?.id` for persistence when a routed event includes explicit conversation identity.

### P1: Serial A2A appears done after the first agent

File: `src/renderer/src/stores/chatStore.ts:1042`

Every `done` event clears `streamingRequestId` and optimistic state. In serial A2A, the first agent emits `done`, then the orchestrator drains queued mentioned tasks, but the UI is already marked idle and the user can send another message while downstream agents are still running.

Completion/status should be tied to the whole orchestrator task chain, not each underlying runtime turn.

Expected direction:

- Treat underlying AgentRuntime `done` as per-agent completion.
- Keep conversation-level A2A streaming active until orchestrator emits a final chain/task-queue completion event.
- Use `a2a:taskCompleted` for task lifecycle display, but add or derive an orchestration-level "all tasks drained" signal before enabling the composer again.

### P2: Loop chain omits the initial agent

File: `src/main/ai/orchestrator.ts:89`

The root task starts with:

```ts
chain: ['user']
```

The next task appends only the target profile. That means `Planner -> Coder -> Planner` is not detected, because Planner was never added to the chain for the Planner root task.

Expected direction:

- Seed the chain with `['user', profile.id]` for agent runs.
- Or pass the current `fromProfile.id` into loop detection before creating the target task.

### P2: Agent lookup ignores workspace scope

File: `src/main/ai/orchestrator.ts:334`

Mention resolution and known-agent injection query all enabled profiles globally. In a multi-workspace setup, `@Coder` can resolve to another workspace's Coder, and agents may be prompted with names they should not be able to call.

Expected direction:

- Resolve the conversation's workspace first.
- Scope enabled profiles to `workspace_id = conversation.workspace_id OR workspace_id IS NULL`.
- Use that same scoped list for both known-agent prompt injection and mention resolution.

### P2: Context snapshot misses the delegating output

File: `src/main/ai/orchestrator.ts:310`

`buildContextSnapshot` reads recent assistant messages from the DB, but the current agent's `complete` text is persisted asynchronously in the renderer after the event is forwarded.

A mention like:

```text
@Coder: implement the plan above
```

can enqueue Coder before the Planner output is available in DB, so the snapshot may omit the exact plan being referenced.

Expected direction:

- Build context from the current `complete.fullText` plus persisted conversation context.
- Or move assistant-message persistence for orchestrator-managed runs into the main process before routeMention builds downstream snapshots.
- Avoid relying only on renderer-side async persistence for A2A context construction.

## Suggested Fix Order

1. Fix event routing in `chatStore` so orchestrator events always persist by `event.conversationId`.
2. Fix serial A2A lifecycle so the UI stays busy until the orchestrator queue drains.
3. Add direct user `@Agent:` routing.
4. Seed loop chains with the initial target agent.
5. Scope profile lookup by conversation workspace.
6. Include the delegating output in context snapshots.

