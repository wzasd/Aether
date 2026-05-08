---
status: active
owner: bytro
last_verified: 2026-05-07
doc_kind: architecture
applies_to:
  - src/main/ai/agent-runtime.ts
  - src/main/ai/orchestrator.ts
  - src/main/ai/acp/
---

# ACP Protocol Leverage in Bytro A2A Orchestration

Date: 2026-05-07

## Why ACP Matters for Multi-Agent

Bytro uses **ACP (Agent Communication Protocol)** — a JSON-RPC 2.0 protocol over stdio — as the unified layer for all AI backends. This is a fundamental architectural difference from clowder-ai, which shells out to raw CLI tools.

The CLI approach works for single-turn chat but breaks down in multi-agent orchestration because:
- Each agent spawn is a new process with no session state sharing
- Model switching requires process restart
- Permission flows are ad-hoc string parsing
- Events are raw text streams that must be regex-parsed

ACP solves these by treating the backend as a stateful JSON-RPC peer.

---

## Capability Matrix: clowder-ai vs Bytro

| Capability | clowder-ai (raw CLI) | Bytro (ACP) |
|-----------|----------------------|-------------|
| **Session lifecycle** | `--resume <sessionId>` flag, behavior varies by backend | `session/new`, `session/load`, `session/close` — standardized across 16 backends |
| **Dynamic model switching** | Not supported; model is set at process spawn | `session/set_model` — switch mid-session without restart |
| **Runtime configuration** | Environment variables only | `config_option_update` — per-session, typed, persisted |
| **Permission flow** | Custom string parsing per backend | Standardized `request_permission` / `respond_permission` JSON-RPC |
| **Structured events** | Stream text + regex parsing | Typed events: `agent_message_chunk`, `tool_call`, `usage_update`, `complete` |
| **Error handling** | Exit codes + stderr guessing | JSON-RPC error objects with structured codes |
| **Multi-agent state** | None; each agent = isolated process | Session pool with `session/load` for context resumption |

---

## How Bytro Uses ACP in Orchestration

### 1. Session Seal / Resume (`ContinuityCapsuleManager`)

When a child agent completes, the orchestrator checks if the parent agent's session is still alive. If resumable, it prepends a `formatContinuationPrompt` to the next message so the Agent knows it's picking up a sealed session:

```typescript
const continuationPrefix = parentCapsule && capsuleManager.isSessionResumable(parentCapsule.id)
  ? formatContinuationPrompt(parentCapsule) + '\n\n'
  : ''
// messageContent = continuationPrefix + task.message
```

The continuation prompt includes the sealed session ID, chain position (`chainIndex/chainTotal`), and continuation reason — giving the Agent full context about where it left off.

**ACP advantage**: `session/load` restores not just the session ID but the full conversation context. The orchestrator can then `sendMessage` directly into the resumed session, avoiding context re-injection.

### 2. Dynamic Model Switch (`AgentRuntime.switchModel`)

Different Agent Profiles may specify different models (e.g., Coder uses `claude-opus-4-7`, Reviewer uses `claude-haiku-4-5`).

```typescript
// In orchestrator.executeTask()
if (sessionIdAtStart && profile.model) {
  await runtime.switchModel(profile.model)  // ACP session/set_model
}
```

**ACP advantage**: Model switches happen within the same session process. CLI would require terminating and respawning.

### 3. Structured Event Routing

All AI events carry `conversationId`, `agentProfileId`, `taskId`, and `sessionId`:

```typescript
interface RoutedAIEvent {
  conversationId: string
  agentProfileId: string | null
  taskId?: string
  sessionId: string
  type: string
}
```

**ACP advantage**: Events are natively structured. The orchestrator receives `agent_message_chunk` with `sessionId` already attached, enabling per-task streaming buffers without regex extraction.

### 4. Permission Flow Standardization

When an agent requests tool permission:

```text
ACP:  { jsonrpc: "2.0", method: "request_permission", params: { toolCallId, toolName, args } }
Bytro: runtime.emit('permission_request', ...) → renderer UI → runtime.respondPermission(true/false)
```

**ACP advantage**: The permission payload is typed and consistent across all backends. CLI implementations parse free-text prompts differently per backend.

---

## Future ACP Leverage

| Opportunity | ACP Method | Status |
|-------------|-----------|--------|
| Session state inspection | `session/get_state` | Not yet implemented |
| Config option persistence | `config_option_update` + store | Partial — `acp-provider.ts` has `persistedConfig` Map |
| Idle timeout management | `session/set_idle_timeout` | Not yet implemented |
| Multi-backend routing | `backend/switch` | Not yet implemented |

---

## Implementation Files

- `src/main/ai/agent-runtime.ts` — `switchModel()`, event routing
- `src/main/ai/orchestrator.ts` — `executeTask()` integration
- `src/main/ai/continuity-capsule.ts` — session seal/resume state machine
- `src/main/ai/acp/acp-provider.ts` — ACP transport implementation
- `src/main/ai/acp/acp-client.ts` — JSON-RPC 2.0 client
