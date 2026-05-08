---
status: completed
owner: mochi
last_updated: 2026-05-06
doc_kind: acceptance-review
---

# ACP Backends Acceptance Review

Review scope:

- `src/main/ai/acp/acp-provider.ts` — ACP provider lifecycle, detect/startSession, env, fs callbacks
- `src/main/ai/acp/acp-transport.ts` — pending request lifecycle and prompt timeout handling
- `src/main/ai/acp/acp-event-mapper.ts` — ACP update to Bytro `AIEvent` mapping
- `src/main/ai/acp/acp-backends.ts` — 16 backend definitions
- `src/main/ai/provider-registry.ts` — ACP provider registration
- Provider UI integration through `provider:list` and `ModelSelector`

Verification:

- `pnpm run typecheck` passed
- Confirmed `ACP_BACKENDS` contains 16 backend entries
- 2nd pass: `pnpm run typecheck` passed

## Findings

### [P1] #1 npx ACP backends are disabled in the UI

**File:** `src/main/ai/acp/acp-provider.ts` L100-103

`detect()` returns `null` whenever `cliCommand` is absent. The npx-only ACP backends like `claude-acp`, `codex-acp`, and `codebuddy-acp` are therefore reported as not installed, and `ModelSelector` disables them even though `startSession()` can run them via `npx`.

**Recommended fix:**

Teach ACP provider detection about `strategy: 'npx'`, for example by checking that `npx` is available and optionally probing the package command/version without requiring a `cliCommand`.

Status: **Resolved** — `detect()` now checks `npx --version` when strategy is `'npx'`.

### [P1] #2 ACP API keys are stored under a different key than they are read from

**File:** `src/main/ai/acp/acp-provider.ts` L71-75

`buildEnv()` reads secrets via `cfg.secretsKey` such as `claude-cli` and `codex-cli`, but `provider:setApiKey` stores keys under the selected provider id, e.g. `claude-acp` or `codex-acp`. Setting an ACP API key in the provider UI will not populate the env var used to launch that backend.

**Recommended fix:**

Align secret storage and lookup. Either store ACP keys under `cfg.secretsKey`, or make `buildEnv()` fall back to the provider id before launching the backend.

Status: **Resolved** — `buildEnv()` now falls back to `cfg.id` when `cfg.secretsKey` lookup returns nothing.

### [P1] #3 ACP file callbacks allow unrestricted absolute paths

**File:** `src/main/ai/acp/acp-provider.ts` L261-272

The ACP fs callbacks resolve relative paths under the working directory, but pass absolute paths through unchanged. Any ACP backend can request reads or writes outside the workspace without a permission check, which bypasses the workspace boundary the rest of the app tries to maintain.

**Recommended fix:**

Resolve every requested path, then verify it remains inside the configured working directory (or an explicitly approved allowed root) before reading or writing. Reject out-of-root paths.

Status: **Resolved** — Added `resolvePathInWorkspace()` helper that rejects paths outside the workspace root.

### [P2] #4 Provider binaryPath is ignored for ACP launches

**File:** `src/main/ai/acp/acp-provider.ts` L111-135

`initialize()` stores the provider config, but `resolveSpawnCommand()` only uses the static backend config. Users who configure a custom binary path in Settings still launch the hardcoded `cliCommand` or `npx`, so the setting and the startup error guidance do not actually help ACP providers.

**Recommended fix:**

Pass `providerConfig` into spawn command resolution and prefer `providerConfig.binaryPath` when present, while preserving backend-specific ACP args.

Status: **Resolved** — `resolveSpawnCommand()` now accepts `providerConfig` and prefers `binaryPath` for both npx and cli strategies.

### [P1] #5 npx launches can block on install confirmation

**File:** `src/main/ai/acp/acp-provider.ts` L49-52

The binaryPath fix rewired npx backend launch args from the previous `npx --yes --prefer-offline <pkg> ...` shape to `npx <pkg> ...`. For ACP bridge packages that are not already cached locally, `npx` may prompt for install confirmation on stdio before the JSON-RPC initialize handshake starts, causing the ACP session to hang or time out.

**Recommended fix:**

Preserve non-interactive npx flags when no custom binary path is supplied, e.g. launch `npx --yes --prefer-offline <pkg> ...`. If `binaryPath` is used as a custom package runner, document or encode how its non-interactive flags should be provided.

Status: **Resolved** — `resolveSpawnCommand()` now restores `--yes --prefer-offline` when using default `npx`, skips them when `binaryPath` overrides the runner.

## Positive Observations

- The TypeScript cleanup points are typecheck-clean.
- Pending prompt loops now snapshot `this.pending` with `Array.from(...)`, avoiding iterator mutation hazards while resolving/rejecting entries.
- The backend registry includes all 16 expected ACP backend configs.
