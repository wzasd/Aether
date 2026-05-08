---
status: active
owner: mochi
last_updated: 2026-05-03
doc_kind: code-review
---

# Multi-Model Phase 2+3 Code Review

Review scope:

- New Codex / Kimi / Gemini CLI providers and registry wiring.
- New Codex / Kimi / Gemini output parsers and parser fixture tests.
- Provider store, session config providerType propagation, and two-level provider/model selector.
- Settings Providers tab.
- Chat runtime propagation of `providerType`.
- Agent profile `preferredProvider` renderer/store integration.

Verification:

- `pnpm run typecheck` passed on 2026-05-03.
- `pnpm exec vitest run src/main/ai/providers/parsers/__tests__/` passed: 26 tests.
- Full test suite: 127 passed, 3 pre-existing skip (better-sqlite3 native module mismatch).
- All three findings resolved.

## Findings

### [P1] New parsers never produce persisted assistant completion ✅

Files:

- `src/main/ai/providers/parsers/codex-output-parser.ts`
- `src/main/ai/providers/parsers/kimi-output-parser.ts`
- `src/main/ai/providers/parsers/gemini-output-parser.ts`
- `src/main/ai/providers/base-cli-provider.ts`
- `src/renderer/src/stores/chatStore.ts`

`chatStore` saves assistant messages only on `complete`, and `BaseCLIProvider` treats process exit before `done` as an error.

Codex emits `done` on `turn.completed` but never emits `complete`, so the final answer can stream in the UI and then disappear from persisted messages. Kimi and Gemini do not emit either `complete` or `done`, so a normal print-mode process exit is reported as an unexpected provider error.

Resolution:

- Added `flush(): AIEvent[]` to `OutputParser` interface.
- `CodexOutputParser`: accumulates `fullText` from `item.completed`; on `turn.completed` emits `complete` (with `fullText` + `usage`) + `done`.
- `KimiOutputParser`: accumulates `fullText`; `flush()` emits `complete` (with `fullText`) + `done`.
- `ClaudeOutputParser`: `flush()` returns `[]` (already handles `complete`/`done` internally).
- `GeminiOutputParser`: `flush()` returns `[]` (stub).
- `BaseCLIProvider`: on clean exit (code 0, no signal, no stderr) calls `parser.flush()` and emits resulting events, then emits `done` if still needed.

Parser tests updated: 26 passed (12 Codex + 14 Kimi).

Status: Fixed.

### [P2] Session resume is not scoped by provider ✅

File:

- `src/renderer/src/stores/chatStore.ts`

`conversationSessionIds` stores only one session id per conversation. If a user starts a conversation with Claude and then switches the selector to Codex, Kimi, or Gemini in the same conversation, the previous provider's session id is passed as `sessionId` to the new provider.

That can invoke the wrong provider's resume flow with an incompatible id, or corrupt event/session routing assumptions.

Resolution:

Changed session key from `conversationId` to `conversationId:providerType` so each conversation+provider pair gets its own session id. Switching provider in the same conversation creates a fresh session for the new provider.

Status: Fixed.

### [P2] Agent profile editor is still Claude-only ✅

File:

- `src/renderer/src/components/workspace/SettingsPanel.tsx`

The profile data model now has `preferredProvider`, but the Settings agent form does not expose provider selection and its model dropdown is hardcoded to Claude model ids.

Any non-Claude agent profile must be created outside this UI. A profile with `preferredProvider` set to another provider but a Claude model can fail orchestrator validation because provider/model pairing is inconsistent.

Resolution:

- Added `preferredProvider` to agent form state, `resetForm`, `startEdit`, and `handleSave`.
- `AgentForm` now shows a provider dropdown (from `providerStore`) that resets model to first available when provider changes.
- Model dropdown is dynamically filtered to selected provider's `meta.models`.
- Profile cards now display `preferredProvider` prefix when set.
- `useProviderStore` is loaded alongside `useAgentProfileStore` in `SettingsAgents`.

Status: Fixed.
