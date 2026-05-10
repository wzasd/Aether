---
adr: 014
title: Two-Layer Agent Memory Model (Shared Channel + Private Memory)
status: accepted
date: 2026-05-09
supersedes: null
relates: ADR-009 (Dual-Mode Collaboration), ADR-013 (Daemon Architecture)
---

# ADR-014: Two-Layer Agent Memory Model

## Context

@tomek-rumore raised a critical architecture concern during the Push vs Pull model discussion (2026-05-09):

> "大家agent不是同一个上下文，我想感知在一个channels中是一个上下文，然后可以参考slock每个agent都做好自己的memory这种"

This is actually two concerns:

1. **Shared context**: Do all agents see the same conversation? (Yes — `messages` table is the shared bus)
2. **Individual memory**: Does each agent persist its own knowledge across sessions? (No — this is the gap)

The Push model's `onMessageReply` (ADR-013) further exacerbates the first concern by injecting processed triggers (`"Agent X said Y, what do you think?"`) instead of raw conversation history.

Five agents independently converged on the same analysis: bytro needs a two-layer memory architecture aligned with Slock's proven model.

## Decision

We will adopt a **Two-Layer Agent Memory Model**:

```
Layer 1 (Shared):  messages table = Channel shared context
                    → All agents read the same message history
                    → Already exists, no schema change

Layer 2 (Private): ~/.bytro/agent-memory/{profileId}/MEMORY.md
                    → Each agent maintains its own persistent memory
                    → File system storage, human-readable Markdown
                    → Cross-session persistence
```

### Layer 1: Shared Channel Context (Phase A)

**Mechanism**: Replace `onMessageReply` push-trigger with pull-based context injection.

```
Before (push):
  Agent A replies → EventBus → onMessageReply → enqueue("Agent A said X, what do you think?") → all agents
  Problem: mechanical trigger chain, processed context, loop risk

After (pull):
  Agent A replies → EventBus → UI notification only
  Agent B's next poll → claimAndExecute → read full messages table → inject as context → LLM self-decides
  Benefit: natural convergence, shared context, no loop risk
```

**Key design decisions**:
- Interface: Zero breaking change. `onObservation({ message, context, ... })` signature unchanged.
- Context source: `context` parameter populated from `messages` table via `taskQueue.getConversationHistory()`
- Context strategy: **No artificial truncation** (aligned with Slock and Multica). Default DB query `LIMIT 50` (matching Slock's `message read` default and Multica's `comment list` default). No token budget, no message count cap. LLM context window is the only natural limit. Single-message cap at 32,000 chars (~8,000 tokens) for extreme outlier protection only.
- **Correction history**: Initial proposal used `MAX_CONTEXT_MESSAGES=20` + `MAX_CONTEXT_TOKENS=4000` based on estimation. @tomek-rumore pushed back against experience-based numbers. Investigation revealed:
  - **Slock** (behavioral inference, not source-verified): Slock Agent (`@UI设计专家`) operates via `slock message read` command to fetch channel history, with no observed platform-side truncation. MEMORY.md (3KB–30KB) is injected in full at startup.
  - **Multica** (source-verified): Go codebase at `/Users/wangzhao/Documents/agentWorkSpace/catwork/multica` confirms `task.go` and `context.go` implement agent-pull with LLM-native context management, no platform-side truncation.
  - Both align on agent-pull with LLM-native context management, not platform-side truncation. Corrected 2026-05-09.
- Safeguards retained: `MAX_RESPONSES_PER_AGENT=5`, `COOLDOWN_MS=2000`

### Layer 2: Private Agent Memory (Phase B)

**Storage**: File system at `~/.bytro/agent-memory/{profileId}/`

```
~/.bytro/agent-memory/{profileId}/
├── MEMORY.md          ← Entry point (loaded at AgentRuntime.start())
└── notes/             ← Topic-specific detail files (optional)
    ├── decisions.md
    ├── preferences.md
    └── domain.md
```

**File system over DB** — rationale:

| Dimension | DB Column (JSON) | File System (Markdown) |
|-----------|-----------------|----------------------|
| Human readability | ❌ Requires tooling | ✅ Open in any editor |
| Extensibility | ❌ Schema migration | ✅ Create sub-files freely |
| Version control | ❌ Separate mechanism | ✅ git diff |
| Debuggability | ❌ SQL query | ✅ `cat MEMORY.md` |
| Slock alignment | ❌ Different model | ✅ Identical pattern |

**Memory lifecycle**:

```
AgentRuntime.start()
  → AgentMemory.load(profileId)         // Read MEMORY.md
  → Inject summary into systemPrompt    // Last 2000 tokens only
  → Agent uses memory as reference, not verbatim repetition

Agent.onObservation()
  → systemPrompt = role prompt + memory summary + conversation context
  → Agent self-references memory when relevant

Conversation ends / User feedback
  → AgentMemory.append(profileId, entry) // Rule-driven, zero LLM cost
  → Format: timestamp + topic + conclusion
```

**Injection strategy**: Memory is injected as a summary (last ~2000 tokens), not the full MEMORY.md. The full file is always available for the Agent to reference via tool calls, but only the recent/important portion goes into the initial prompt.

**Update strategy (rule-driven, zero token cost)**:

| Trigger | Writer | Content | LLM Cost |
|---------|--------|---------|-----------|
| Conversation ends | Daemon (`checkConversationsComplete`) | Key decisions + conclusions | 0 |
| User says "remember" | Frontend → IPC → Daemon | User-explicit content | 0 |
| Agent marks `[SAVE: ...]` | Agent via reply parsing | Agent-deemed important | 0 |
| Periodic Reflect (P2) | Scheduled task | LLM-summarized insights | ~500 tokens/session |

**Concurrency safety**:

```typescript
// Promise-queue per profile prevents write corruption
private writeQueue = new Map<string, Promise<void>>()

async append(profileId: string, entry: MemoryEntry): Promise<void> {
  const prev = this.writeQueue.get(profileId) ?? Promise.resolve()
  const next = prev.then(() => this.doAppend(profileId, entry))
  this.writeQueue.set(profileId, next)
  return next
}
```

**Safety measures**:

| Measure | Mechanism |
|---------|-----------|
| Path traversal | `profileId` regex validation: `[a-zA-Z0-9_-]+` |
| Concurrent write | Promise queue serialization per profile |
| Token budget | 2000-token memory injection cap |
| Disk limit | 10MB per-agent directory cap |

## Consequences

### Positive

1. **Shared context restored**: Pull model eliminates processed triggers. All agents see the full conversation.
2. **Natural convergence**: Agents self-decide NO_REPLY when topic is exhausted (LLM-driven, not mechanical limits).
3. **Persistent expertise**: Agents accumulate knowledge across sessions (user preferences, project decisions, domain knowledge).
4. **Slock alignment**: Two-layer model identical to Slock's proven architecture.
5. **Human debuggability**: MEMORY.md is editable in any text editor. No DB tooling required.
6. **Incremental delivery**: Phase A (~50 lines) delivers immediate value before Phase B is built.

### Negative / Risks

1. **Test rewrite cost**: Phase A requires rewriting `runtime-registry.test.ts` (~100 lines). The main cost is testing, not code.
2. **Token inflation**: Full conversation context increases prompt size. Mitigated by two-layer truncation.
3. **Memory drift**: Agent memory may accumulate stale or conflicting information over time. Mitigated by 2000-token injection cap.
4. **Concurrency edge cases**: Multiple conversations ending simultaneously could stress the write queue. Mitigated by Promise serialization.
5. **Memory not shared between agents**: Agents won't know what others have "learned". This is by design (same as Slock) — agents communicate through replies, not shared memory.

### Neutral

- DB column approach (`agent_profiles.memory TEXT`) was considered but rejected in favor of file system for human readability and Slock alignment.
- LLM-based reflection for memory updates was deferred to P2 to minimize token costs in early iterations.

## Implementation Plan

### Phase A: Agent Self-Fetch (Pull Model, Tool-Calling) — ~100 lines

**Direction corrected 2026-05-09**: Investigation revealed bytro already has tool use infrastructure (`event-parser.ts` handles `tool_use`/`tool_result`, `base-cli-provider.ts` has `parent_tool_use_id`). Original "platform injects context" approach (Path A) was replaced by "Agent self-fetches via tool" approach (Path B) to align with Slock and Multica.

| File | Change |
|------|--------|
| `src/main/daemon/runtime-registry.ts` | `onMessageReply`: remove `taskQueue.enqueue()` |
| `src/main/daemon/runtime-registry.ts` | `claimAndExecute`: pass `read_messages` tool instead of pre-built context |
| `src/main/ai/agent-runtime.ts` | `generateObservationReply`: add tool call loop (~80 lines) |
| `src/main/daemon/task-queue.ts` | Add `getConversationHistory(conversationId)` method |
| `src/main/daemon/__tests__/runtime-registry.test.ts` | Rewrite tests for tool-based flow (~100 lines) |

### Phase B: Agent Memory — ~125 lines

| File | Change |
|------|--------|
| `src/main/daemon/agent-memory.ts` (new) | `AgentMemory` class: load/append/initialize (~80 lines) |
| `src/main/ai/agent-runtime.ts` | `start()`: load memory from AgentMemory (~10 lines) |
| `src/main/daemon/daemon.ts` | `checkConversationsComplete`: trigger memory update (~10 lines) |
| `src/main/daemon/runtime-registry.ts` | `claimAndExecute`: inject memory into context (~5 lines) |
| `scripts/init-agent-memory.ts` (new) | First-run initialization script (~20 lines) |
| `src/main/daemon/__tests__/agent-memory.test.ts` (new) | Unit tests (~110 lines) |

## Comparison with Reference Architectures

| | Slock | bytro (target) |
|---|---|---|
| Channel model | `#channel` message bus | `messages` table |
| Agent sees | Full channel history (pull) | Full conversation history (pull, Phase A) |
| Agent remembers | `MEMORY.md` + `notes/` in workspace | `~/.bytro/agent-memory/{id}/MEMORY.md` (Phase B) |
| Memory injection | Read at startup, referenced on demand | Full injection into systemPrompt (no truncation) |
| Memory update | Agent writes after work | Rule-driven on conversation end |

## References

- ADR-009: Dual-Mode Collaboration Architecture (orchestrated / open_floor)
- ADR-013: Daemon Architecture for Event-Driven Agent Runtime
- Slock Agent Workspace: `~/.slock/agents/{agent-id}/MEMORY.md`
- Discussion thread: #all:ba710962
