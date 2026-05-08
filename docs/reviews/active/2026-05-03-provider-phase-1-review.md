---
status: active
owner: mochi
last_updated: 2026-05-03
doc_kind: code-review
---

# Provider Phase 1 Code Review

Review scope:

- Provider registry and `BaseCLIProvider` lifecycle changes.
- Claude provider migration to provider meta + parser wrapper.
- `secrets` / `provider_configs` schema additions.
- Provider IPC handlers and chat/orchestrator providerType validation.
- Agent runtime propagation of profile/provider selection.

Verification:

- `pnpm run typecheck` passed on 2026-05-03.
- Full build/test were not rerun in this review pass.
- Re-verified fixes with `pnpm run typecheck` on 2026-05-03.

## Findings

### [P1] Model selector still sends legacy aliases ✅

Files:

- `src/renderer/src/components/ModelSelector.tsx`
- `src/renderer/src/stores/sessionConfigStore.ts`
- `src/main/ipc/chat.ts`

Provider validation now accepts only full provider model ids from `provider.meta.models`, such as `claude-opus-4-7`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`.

The default session config and `ModelSelector` still emit legacy aliases: `sonnet`, `opus`, and `haiku`. The ordinary chat path will fail on first `chat:startSession` with:

```text
Invalid model for claude-cli: sonnet
```

Recommended fix:

Update the renderer model options and default persisted fallback to full provider model ids, or introduce an explicit alias-to-provider-model normalization layer before IPC validation.

Resolution:

`ModelSelector` and `sessionConfigStore` now use full Claude model ids, so `chat:startSession` passes provider meta model validation.

Status: Fixed.

### [P2] ProviderConfig configure path does not affect runtime ✅

Files:

- `src/main/ai/providers/base-cli-provider.ts`
- `src/main/ipc/system.ts`
- `src/main/core/db.ts`

`provider:configure` calls `provider.initialize(config)`, but `BaseCLIProvider.detect`, stream-json spawn, and PTY spawn still use `this.meta.binary`. Runtime env only merges `buildEnv()` and never applies `config.extraEnv`.

The schema creates `provider_configs`, but the current IPC path does not persist to or load from that table. A custom CLI path or extra env can appear to configure successfully while detect/start still use the default binary and env, and the configuration is lost after restart.

Recommended fix:

Persist provider configs in `provider_configs`, load them during provider/registry initialization, and have `BaseCLIProvider` resolve the executable and env from `this.config`:

- executable: `config.binaryPath || meta.binary`
- env: `{ ...process.env, ...config.extraEnv, ...buildEnv() }`
- availability: consider `config.enabled`

Resolution:

`provider:configure` now persists configs into `provider_configs`, startup loads saved configs, and `BaseCLIProvider` resolves the binary/env from provider config when detecting and spawning sessions.

Follow-up:

`enabled` is persisted but currently not used to block `startSession` or filter availability. Track separately if disabled providers must be hard-disabled in Phase 1.

Status: Fixed.

### [P2] AgentProfile preferredProvider is not wired through data layer ✅

Files:

- `src/main/ai/a2a-types.ts`
- `src/main/ai/agent-runtime.ts`
- `src/main/ai/orchestrator.ts`
- `src/main/ipc/agent.ts`
- `src/main/core/db.ts`

`AgentRuntime` already reads `this.profile.preferredProvider` to override `SessionConfig.providerType`, but `agent_profile_configs` has no corresponding column and the profile IPC row mappers do not read, create, or update the field.

The result is a silent fallback to the base session provider. This is not visible while only Claude is registered, but it will break profile-level provider selection as soon as additional providers land.

Recommended fix:

Add `preferred_provider` to `agent_profile_configs`, migrate existing DBs, include it in `AgentProfileRow`, `rowToProfile`, create/update IPC payloads, renderer profile types, and Settings UI once provider choice is exposed.

Resolution:

`preferred_provider` is now added via schema v11 migration, loaded in main-process profile row mappers, accepted by agent create/update IPC, exposed through preload/global types, and propagated into `AgentRuntime` through `AgentProfile.preferredProvider`.

Status: Fixed.
