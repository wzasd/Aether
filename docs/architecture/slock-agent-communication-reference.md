---
status: reference
doc_kind: architecture
source: Slock agent communication analysis (task #3)
date: 2026-05-08
---

# Slock Agent Communication Model Reference

> Analysis of Slock platform's agent communication patterns as reference for bytro-app multi-agent architecture.

## 1. Overall Communication Architecture

Slock uses **Message Bus + Decentralized Agent** architecture:

```
Agent A (process)         Agent B (process)         Agent C (process)
    │                          │                          │
    │ slock CLI                │ slock CLI                │ slock CLI
    ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Slock Daemon (local proxy)                 │
│  · message send/receive  · task claim  · file upload        │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ HTTP/WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Slock Server                               │
│  · message routing  · channel management  · task queue      │
│  · @mention resolution  · loop detection  · event broadcast │
└─────────────────────────────────────────────────────────────┘
```

**Key architectural characteristics:**
- Agents do **not** communicate directly; all messages go through Slock Server
- Each Agent is an independent process with its own workspace and persistent storage
- Communication is **asynchronous message passing**, not RPC or shared memory

## 2. Message Bus Model

### Target Address Types

| Target Type | Example | Semantics |
|-------------|---------|-----------|
| Channel | `#all`, `#engineering` | Multicast: all members in channel |
| DM (Direct Message) | `dm:@alice` | Unicast: target only |
| Thread | `#all:fb132ca9` | Sub-namespace: topic isolation |
| @mention | `@架构设计`, `@Cindy` | Directed notification |

### Message Routing Flow

```
User/Agent sends message
    ↓
Daemon → Server (HTTP POST)
    ↓
Server resolves @mentions → matches target agent
    ↓
┌─────────────────────────────────────┐
│ Anti-loop gate:                     │
│ · Self-trigger (author == agent)    │
│ · Dedup (same issue pending → skip) │
│ · Inheritance guard (agent replies  │
│   don't inherit parent mentions)    │
└─────────────────────────────────────┘
    ↓
Enqueue task → push task:available (WS)
    ↓
Target Agent Daemon receives → Agent claims → executes
```

### Push vs Pull

Slock uses a **hybrid model**:
- **Push (WebSocket)**: task:available, new message notifications, state changes
- **Pull (HTTP)**: history reading (`slock message read`), server info, file downloads

## 3. @mention Distribution Mechanism

### Resolution Layer

```
[@Label](mention://type/id)
```

Four mention types:
- `member` — human users
- `agent` — AI agents
- `issue` — task/issue references (e.g., `MUL-123`)
- `all` — global broadcast (`@all`)

### Slock ↔ bytro-app Mapping

| Slock | bytro-app A2A |
|-------|---------------|
| `@agent` → resolve mention → match agent UUID | `parseMentions(text)` → `AgentProfile` ← `dispatchIntents` |
| `@all` → broadcast → enqueue per-agent | `@All` → `maxParallelAgents` expansion → parallel execution |
| Anti-loop: self-trigger / dedup / inheritance guard | Anti-loop: `checkLoopDetection(chain)` / `isPingPong` |

### Patterns bytro-app Can Adopt

1. **Per-(task, agent) dedup** — Slock: `HasPendingTaskForIssueAndAgent` → bytro-app already has `invocationQueue`
2. **Agent author doesn't inherit parent mentions** — Slock: `shouldInheritParentMentions` → suggest adding agent-author gate in `dispatchIntents`
3. **Parallel @mention aggregation** — Slock: independent replies → bytro-app already has `ReflowOrchestrator` (timeout aggregation)

## 4. Task System — Ownership & State Machine

### State Machine

```
todo → in_progress → in_review → done
  ↑        ↓
  └── unclaim (release, back to todo)
```

### Core Operations

| Operation | Slock CLI | Semantics |
|-----------|-----------|-----------|
| Create task | `slock task create` | New message + publish as task |
| Claim | `slock task claim` | Declare ownership, prevent duplicate work |
| Release | `slock task unclaim` | Release ownership |
| Status update | `slock task update` | todo/in_progress/in_review/done |

### Ownership Model

Slock's claim mechanism is **optimistic concurrency control**: claim first, then work. If claim fails (already claimed), immediately give up.

### Slock vs bytro-app Task Model

| Feature | Slock | bytro-app A2A |
|---------|-------|---------------|
| Task creation | Explicit or message conversion | `scheduleTask()` auto-creation |
| Claim | Manual claim | Auto-enqueue execution |
| Concurrency control | Claim conflict returns failure | `InvocationQueue` serialization |
| State flow | 4 states | 3 states (pending→working→completed/failed) |
| Timeout handling | No built-in timeout | **Zombie defense (10min)** 🏆 |
| Parallel tasks | Independent execution | **ReflowOrchestrator aggregation** 🏆 |

**Key insight:** bytro-app's task model is **more complete than Slock** — zombie defense, parallel aggregation, depth limits are all innovations beyond Slock.

## 5. Thread Isolation Model

### Slock Thread Mechanism

```
#all (main channel)
  ├─ msg:fb132ca9 (topic A discussion)
  ├─ msg:dc672bc7 (topic B discussion)
  └─ msg:a1b2c3d4 (topic C discussion)
```

- Each message can be "threaded" — `target="#channel:msgId"`
- Thread discussions don't pollute the main channel
- Threads cannot be nested (one level only)
- Thread visibility inherits from parent channel; can unfollow individually

### bytro-app Equivalent

| Slock Thread | bytro-app |
|--------------|-----------|
| `#channel:msgId` | `conversationId` (each conversation is isolated) |
| @mention isolation within thread | A2A chain (`parentTaskId` → `depth`) |
| Thread unfollow | Not applicable (no "subscription" concept) |

**Suggested adoption:** Introduce "focus mode" — when agent is in deep chain, only show current chain's messages, hiding other parallel task output from the timeline.

## 6. Context Management Model

### Slock Agent Context Acquisition

```
┌────────────────────────────────────────┐
│         Active Turn                    │
│  · Delivered message + thread summary  │
│  · System prompt (role + constraints)  │
└────────────────────────────────────────┘
              ↓ pull when needed
┌────────────────────────────────────────┐
│         Message History                │
│  · slock message read                  │
│  · slock message search                │
│  · slock task list                     │
└────────────────────────────────────────┘
              ↓ persist across sessions
┌────────────────────────────────────────┐
│         Persistent Memory              │
│  · MEMORY.md (read on every startup)   │
│  · notes/*.md (domain knowledge)       │
│  · Local filesystem (code/docs)        │
└────────────────────────────────────────┘
```

### Slock vs bytro-app Context

| Dimension | Slock Agent | bytro-app Agent |
|-----------|-------------|-----------------|
| Session context | New delivery each turn | `contextSnapshot` (assembleContext) |
| History | Active pull | Push into AI (inject to system prompt) |
| Cross-session memory | MEMORY.md (manual) | ContinuityCapsule (automatic) |
| Context window management | Platform handles compression | Developer controls (isResuming, --resume) |
| Inter-agent context sharing | No sharing (independent) | No sharing (independent) ✅ consistent |
| Compression recovery | MEMORY.md as recovery anchor | `primarySessionIds` + `--resume` |

**Key difference:** bytro-app is **push-based context injection** (assembleContext → inject into CLI prompt), Slock is **pull-based** (agent actively reads). Each has trade-offs:
- Push: Agent doesn't need to "know what to read", but may inject too much
- Pull: Agent reads precisely what's needed, but may miss information

### Suggested Hybrid Model

Combine both approaches:
```
Push: buildContextPacket({ tokenBudget: 3000 }) — baseline context
Pull: agent declares [NEED_CONTEXT: keyword] → orchestrator search-injects
Resume: ContinuityCapsule seal summary — cross-turn recovery
```

## 7. Slock → bytro-app Complete Mapping

| Slock Concept | bytro-app Equivalent | Maturity |
|---------------|---------------------|----------|
| `#channel` | `conversation` | ✅ |
| `message` | `comment` / chat message | ✅ |
| `thread` (`#channel:msgId`) | `conversationId` (isolation) + A2A `depth`/`chain` | 🟡 |
| `@agent` mention | `@AgentName: task` → `dispatchIntents` → A2A Task | ✅ |
| `@all` broadcast | `@All` → `maxParallelAgents` expansion | ✅ |
| Task claim (ownership) | `InvocationQueue` serialization | ✅ (stronger) |
| Task state machine | A2A Task `pending/working/completed/failed` | ✅ |
| Anti-loop | `checkLoopDetection(chain)` + `isPingPong` | ✅ |
| Depth limit | `MAX_DELEGATION_DEPTH` | ✅ |
| MEMORY.md (persistent) | ContinuityCapsule + MemoryPalace | ✅ (more automatic) |
| File sharing | Local filesystem (Read tool) | ✅ |
| WS push | `ai:event` + `a2a:*` IPC | ✅ |
| — | **Zombie defense (10min)** | bytro 🏆 |
| — | **ReflowOrchestrator (parallel aggregation)** | bytro 🏆 |
| — | **Agent Card / Capability routing** | bytro 🏆 |
| — | **Structured observability events** | bytro 🏆 (new in task #1) |

## 8. Three Patterns bytro-app Should Prioritize

### 8.1 Thread Isolation → Focus Mode
When A2A chain depth > 1, UI should only show current chain's message flow, preventing parallel task outputs from interleaving. Implementation: add `chainId` field to `ai:event`, renderer groups by `chainId`.

### 8.2 Push + Pull Hybrid Context
Current bytro-app is pure push (assembleContext injects everything). Add a pull exit: agent can declare `[NEED_CONTEXT: keyword]` in response, orchestrator search-injects targeted results, reducing massive contextSnapshot token waste.

### 8.3 Agent Autonomous Claim vs Auto-Assignment
Slock's claim mechanism ensures "only the best-fit agent takes the task". bytro-app currently auto-routes (intent → routing → fixed assignment). Future direction: capability bidding — multiple agents see task, highest match claims.

## 9. Architecture Risk Warnings

1. **Don't copy Slock's issue+comment model** — Slock conflates "work item" and "conversation" in Issue, causing agent-to-agent social echo. bytro-app should maintain its conversation/task separation.
2. **Context injection vs window overflow** — push-based injection can accumulate excessive history in deep chains. Monitor token usage.
3. **Parallel agent UI convergence** — multiple agents outputting simultaneously in conversation requires renderer to handle interleaved streaming events. Current `ai:event` with `agentProfileId` and `taskId` already supports grouping, but verify UI rendering path.
