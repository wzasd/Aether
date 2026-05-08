---
status: active
owner: bytro
last_verified: 2026-05-02
doc_kind: review
scope: module-D-and-p1-roadmap
source: docs/plans/2026-05-02-module-D-and-p1-roadmap.md
---

# Module D + P1 Roadmap Review

This review covers `docs/plans/2026-05-02-module-D-and-p1-roadmap.md`, especially the Module D Agent Profiles plan, the Phase C6 closeout criteria, and the P1 Terminal / Monaco roadmap.

Conclusion: Module D and P1 Terminal reviewed blockers are fixed. Latest verification passes for typecheck, tests, and build.

## Verification Context

- Reviewed against current DB schema in `src/main/core/db.ts`.
- Reviewed against current memory profile code in `src/main/core/memory-index.ts`.
- Reviewed against current chat model validation in `src/main/ipc/chat.ts`.
- Reviewed against AgentProfile IPC/store/UI integration in `src/main/ipc/agent.ts`, `src/renderer/src/stores/agentProfileStore.ts`, and `src/renderer/src/components/chat/ChatInput.tsx`.
- Reviewed against active review index and latest A/B/C re-review docs.
- Earlier verification on 2026-05-02 (after fixes):
  - `pnpm run typecheck`: passed.
  - `pnpm run build`: passed.
  - `pnpm test`: passed (6 files, 72 tests), `out/` excluded via `vitest.config.ts`.
- Latest verification on 2026-05-02:
  - `pnpm run typecheck`: passed.
  - `pnpm run build`: passed.
  - `pnpm test`: passed, 6 files / 72 tests.

## Summary

| Priority | Area | Finding | Status |
|---|---|---|---|
| P1 | P1 Terminal | TerminalPanel creates two PTY sessions on first mount | ✅ Fixed |
| P1 | P1 Terminal | Terminal output/exit events are not filtered by session id | ✅ Fixed |
| P1 | Test gate | Standard `pnpm test` currently fails due `better-sqlite3` native binding ABI mismatch | ✅ Fixed |
| P1 | DB migration | v7 migration can drop existing memory profile cache rows | ✅ Fixed |
| P1 | Agent Profiles | Disabled active profile can still be used by `sendMessage` | ✅ Fixed |
| P1 | Composer / workspace scope | Composer loads unscoped profiles and can use another workspace's AgentProfile | ✅ Fixed |
| P1 | Test discovery | `pnpm test` discovered compiled tests in `out/main` | ✅ Fixed |
| P2 | Roadmap schema | Module D schema section still documents the old `agent_profiles` plan | ✅ Fixed |
| P2 | Docs workflow | Document closeout omits active review index / completion review updates | ✅ Fixed |

## Findings

### [P1] TerminalPanel creates two PTY sessions on first mount ✅

**File**: `src/renderer/src/components/workspace/TerminalPanel.tsx:45-48`

The initialization effect calls `createSession(currentWorkspaceId)`, and the workspace-change effect below also runs on the same initial mount and calls `createSession(currentWorkspaceId)` again.

**Impact**

- Two PTY sessions can be created for one visible terminal panel.
- The two async creates can race when writing `sessionIdRef`.
- One PTY can be left orphaned and continue emitting shell output.

**Recommendation**

Keep a single session creation path. Prefer letting the workspace-change effect own create/kill behavior, while the initialization effect only creates and wires the xterm instance/listeners.

Resolution: `TerminalPanel` no longer creates a PTY in the initialization effect. The workspace-change effect is the sole session lifecycle owner.

### [P1] Terminal events are not filtered by session id ✅

**File**: `src/renderer/src/components/workspace/TerminalPanel.tsx:58-65`

`terminal:onData` and `terminal:onExit` include `sessionId`, but the component ignores it and writes every event into the current xterm instance.

**Impact**

- Output from old, duplicate, or future parallel terminal sessions can appear in the wrong panel.
- Exit messages can be shown for a session that is no longer current.

**Recommendation**

Only handle events where `event.sessionId === sessionIdRef.current`. Ignore all other terminal events in this component.

Resolution: `onData` and `onExit` handlers now compare the event `sessionId` with `sessionIdRef.current` before writing to xterm.

### [P1] Standard test command currently fails ✅

**File**: `package.json:13`

The latest `pnpm test` run failed. 69 tests passed and 3 were skipped, but `src/main/core/db.test.ts` failed before assertions because `better-sqlite3` was compiled for `NODE_MODULE_VERSION 133` while the current Node runtime requires `NODE_MODULE_VERSION 127`.

**Impact**

- The project cannot use `pnpm test` as a completion gate.
- Module C / Module D / P1 Terminal cannot be closed while the standard test command exits non-zero.

**Recommendation**

Rebuild or reinstall native dependencies for the Node runtime used by tests, and re-run `pnpm test`. If this mismatch is expected after Electron rebuilds, document the required rebuild command in the dev workflow.

Resolution: `better-sqlite3` was rebuilt for the current runtime. Latest `pnpm test` passes with 6 files / 72 tests.

### [P1] v7 migration can drop existing memory profile cache ✅

**File**: `src/main/core/db.ts:419-425`

`createTables()` now creates `agent_profile_cache` before `applyMigrations()` runs. On an existing pre-v7 DB that still has the old `agent_profiles` memory-cache table, this branch sees both tables present and drops `agent_profiles` instead of renaming or copying it.

**Impact**

- Existing memory read-model rows can be lost during migration.
- Agent memory/profile cache behavior can regress for upgraded user databases.

**Recommendation**

Handle the old `agent_profiles` table before creating `agent_profile_cache`, or copy rows from `agent_profiles` into `agent_profile_cache` before dropping the old table.

Resolution: Migration now copies rows from old `agent_profiles` into `agent_profile_cache`, skipping duplicates, before dropping the old table.

### [P1] Disabled active profile can still be used at runtime ✅

**File**: `src/renderer/src/stores/chatStore.ts:517-520`

Composer only renders enabled profiles, but `sendMessage` looks up `activeProfileId` in the full `profiles` list and does not check `isEnabled`. If a selected profile is later disabled in Settings, new sends can still use its model and system prompt.

**Impact**

- Disabling a profile in Settings does not reliably disable it at runtime.
- The selector can visually hide the profile while the store still sends with it.

**Recommendation**

Either clear `activeProfileId` when disabling the selected profile, or require `p.isEnabled` when resolving `activeProfile` in `sendMessage`.

Resolution: `sendMessage` now resolves `activeProfile` only when the matching profile is enabled.

### [P1] Composer loads unscoped profiles ✅

**File**: `src/renderer/src/components/chat/ChatInput.tsx:34-41`

**Resolution**: 

- `ChatInput.tsx`: `loadProfiles()` now receives `currentWorkspaceId`, reloads on workspace switch via `useEffect` dependency on `currentWorkspaceId`.
- `agentProfileStore.ts`: `loadProfiles` now resets `activeProfileId` to `null` when the active profile is no longer in the newly loaded set.
- `SettingsPanel.tsx` intentionally loads all profiles (admin view) — no change needed.

### [P1] Test discovery included compiled output ✅

**File**: `vitest.config.ts`

**Resolution**:

- Added `vitest.config.ts` excluding `out/**` and `dist/**` from test discovery.
- `pnpm test` now passes (6 files, 72 tests) without double-discovering compiled output.
- The `better-sqlite3` native binding mismatch is an environment issue (Electron rebuild vs system Node). Running `npm rebuild better-sqlite3` restores the system Node binding when needed.

### [P2] Roadmap schema section still documents the old table plan ✅

**File**: `docs/plans/2026-05-02-module-D-and-p1-roadmap.md:91-113`

**Resolution**: Updated D1 section to document:
- `agent_profile_configs` table (not `agent_profiles`)
- `agent_profile_cache` as the renamed memory-cache table
- `SCHEMA_VERSION = 8`
- v7 migration: table rename + agent_profile_configs creation
- v8 migration: `proj_mem_au` trigger for Memory FTS sync

### [P2] Document closeout omits active review index / completion review updates ✅

**File**: `docs/plans/2026-05-02-module-D-and-p1-roadmap.md:361-364`

**Resolution**: Updated "文档更新约定" section to include:
- `docs/reviews/active/README.md`
- `docs/reviews/active/plan-completion-review.md`
- the relevant active review document
- the related plan document

## Resolved Or Superseded Since Earlier Review

| Previous finding | Current status |
|---|---|
| Module D reused existing memory-cache `agent_profiles` table | Resolved in code by using `agent_profile_cache` and `agent_profile_configs` |
| Agent profile model IDs did not match `chat:startSession` validation | Resolved in code; `src/main/ipc/chat.ts` now accepts full Claude profile model IDs |
| Phase C6 omitted Memory Palace FTS sync | Resolved in code; `SCHEMA_VERSION = 8` adds `proj_mem_au` trigger with `db.test.ts` coverage |
| `agent_profile_id` write path omitted conversation IPC/types | Resolved in code; `conversation:create`, preload, and global types include `agent_profile_id` |
| Composer loaded unscoped profiles | Resolved; `ChatInput` now passes `currentWorkspaceId` to `loadProfiles` and reloads on workspace switch |
| `pnpm test` failing and discovering compiled output | Resolved; `vitest.config.ts` excludes `out/**`, tests pass cleanly |
| Roadmap schema section stale | Resolved; D1 section updated to v8 schema with `agent_profile_configs` |
| Document closeout missing review docs | Resolved; closeout checklist expanded with review doc entries |

## Required Before Marking Module D / P1 Terminal Complete

- ~~Fix TerminalPanel so initial mount creates exactly one PTY session.~~ ✅
- ~~Filter terminal `onData` / `onExit` events by `sessionId`.~~ ✅
- ~~Make the standard `pnpm test` command pass in the current dev runtime.~~ ✅
- ~~Fix the v7 migration so old `agent_profiles` rows are preserved.~~ ✅
- ~~Prevent disabled active profiles from being used by `sendMessage`.~~ ✅

## Remaining Manual Verification

- ~~Route Composer profile loading by `currentWorkspaceId` and reset invalid `activeProfileId` after workspace switches.~~ ✅
- ~~Make `pnpm test` pass without discovering compiled test output.~~ ✅
- ~~Update the roadmap schema section to match the implemented v8 schema and migrations.~~ ✅
- ~~Update the roadmap's document closeout checklist to include review docs and indexes.~~ ✅
- Manual verification: switch workspaces with an AgentProfile active and confirm the selector resets correctly.
- Manual verification: confirm `pnpm test` stays green after `pnpm install` (native module rebuild).
