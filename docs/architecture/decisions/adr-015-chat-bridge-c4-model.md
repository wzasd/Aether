---
status: proposed
owner: 架构设计
last_verified: 2026-05-13
doc_kind: design
---

# Chat Bridge MCP Sidecar — C4 Architecture Model

## Level 1: System Context

```
┌─────────────────────────────────────────────────────────┐
│                     bytro-app System                     │
│                                                          │
│  ┌──────────┐    ┌──────────────────────────────────┐   │
│  │   User    │───▶│  Electron App (Renderer)          │   │
│  │  (Human)  │◀───│  - Chat UI                       │   │
│  └──────────┘    │  - Action Card UI                 │   │
│                  └──────────────┬───────────────────────┘   │
│                                 │ IPC                       │
│                  ┌──────────────▼───────────────────────┐   │
│                  │  Daemon (Electron Main)               │   │
│                  │  - TaskQueue                          │   │
│                  │  - EventBus                           │   │
│                  │  - ActionCardService                  │   │
│                  │  - Agent spawn management             │   │
│                  └──────────────┬───────────────────────┘   │
│                                 │ spawn + IPC               │
│           ┌─────────────────────┼─────────────────────┐    │
│           │                     │                       │    │
│  ┌────────▼─────────┐  ┌───────▼──────────┐           │    │
│  │  Agent Runtime 1  │  │  Agent Runtime 2  │           │    │
│  │  (Claude CLI)     │  │  (Kimi CLI)       │           │    │
│  └────────┬─────────┘  └───────┬──────────┘           │    │
│           │ stdio MCP          │ stdio MCP             │    │
│  ┌────────▼─────────┐  ┌───────▼──────────┐           │    │
│  │  Chat Bridge 1    │  │  Chat Bridge 2    │           │    │
│  │  (Sidecar)        │  │  (Sidecar)        │           │    │
│  └────────┬─────────┘  └───────┬──────────┘           │    │
│           │ HTTP API           │ HTTP API              │    │
│           │ (Bearer token)    │ (Bearer token)        │    │
│           └──────────┬────────┘                       │    │
│                      │                                  │    │
│            ┌─────────▼──────────┐                      │    │
│            │  SQLite Database    │                      │    │
│            │  (messages, tasks,  │                      │    │
│            │   action_cards)     │                      │    │
│            └────────────────────┘                      │    │
└─────────────────────────────────────────────────────────┘
```

## Level 2: Container — Chat Bridge Sidecar

```
┌──────────────────────────────────────────────────────────────┐
│                    bytro-chat-bridge Process                   │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  MCP Server (@modelcontextprotocol/sdk)                  │ │
│  │                                                          │ │
│  │  Tools:                                                  │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │ │
│  │  │ send_message  │ │check_messages│ │ read_history  │     │ │
│  │  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘     │ │
│  │         │                │                 │              │ │
│  │  ┌──────┴───────┐ ┌──────┴───────┐ ┌──────┴───────┐     │ │
│  │  │ list_convs    │ │ list_tasks   │ │ claim_task    │     │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │ │
│  └──────────────────────┬───────────────────────────────────┘ │
│                         │                                     │
│  ┌──────────────────────▼───────────────────────────────────┐ │
│  │  Transport Layer                                          │ │
│  │                                                          │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │ │
│  │  │ SQLite Read  │  │  IPC Write   │  │ Message Dedup   │  │ │
│  │  │ (direct)     │  │ (→ daemon)   │  │ (LRU 5000)      │  │ │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────────┘  │ │
│  └─────────┼────────────────┼──────────────────────────────┘ │
└────────────┼────────────────┼─────────────────────────────────┘
             │                │
    ┌────────▼────────┐  ┌───▼────────────┐
    │  SQLite DB       │  │  Daemon IPC     │
    │  (shared read)   │  │  (write proxy)  │
    └─────────────────┘  └────────────────┘
```

## Level 3: Component — MCP Tools Detail

### send_message

```
Agent CLI
  │ MCP tool call: send_message(target, content)
  ▼
Chat Bridge
  │ 1. Validate target format (conv:xxx / dm:xxx / conv:xxx:msgId)
  │ 2. Generate idempotency UUID
  │ 3. Forward to daemon via IPC: { type: 'send_message', target, content, idempotencyKey }
  │ 4. Await daemon response
  │ 5. Return formatted text: "Message sent to conv:conv-123 [msg=abc123]"
  ▼
Daemon
  │ 1. Receive IPC message
  │ 2. Write to messages table
  │ 3. Publish event to EventBus
  │ 4. Return { messageId, seq }
  ▼
Chat Bridge
  │ Return to agent
```

### check_messages

```
Agent CLI
  │ MCP tool call: check_messages()
  ▼
Chat Bridge
  │ 1. Read messages table (SQLite direct read)
  │    WHERE conversation_id = ? AND seq > lastSeenSeq
  │ 2. Filter already-delivered via LRU cache
  │ 3. Format as human-readable text
  │ 4. Send ack to daemon: { lastSeenSeq }
  │ 5. Return formatted text
  ▼
Agent CLI receives new messages
```

### read_history

```
Agent CLI
  │ MCP tool call: read_history(target, before?, after?, around?, limit?)
  ▼
Chat Bridge
  │ 1. Read messages table (SQLite direct read)
  │    WHERE conversation_id = ? ORDER BY seq
  │ 2. Apply pagination (before/after/around/limit)
  │ 3. Format as human-readable text:
  │    [seq=3515632 msg=b1e152d8 time=2026-05-13 11:01:29 type=agent] @架构设计: ...
  │ 4. Return formatted text
  ▼
Agent CLI receives history
```

## Data Flow — Phase 1 (MCP + Orchestrator Coexist)

```
User sends message
  │
  ▼
Daemon receives message
  │
  ├──▶ Store in SQLite messages table
  │
  ├──▶ [Orchestrator Path] Publish event to EventBus
  │    │
  │    ▼
  │    RuntimeRegistry subscribers decide which agents respond
  │    │
  │    ▼
  │    AgentRuntime receives message (existing push model)
  │
  └──▶ [MCP Path] Bridge poll detects new message
       │
       ▼
       check_messages() returns new message to agent
       │
       ▼
       Agent decides to respond via send_message()
       │
       ▼
       Bridge forwards to daemon via IPC
       │
       ▼
       Daemon writes response to messages table

Both paths write to the same messages table.
Daemon deduplicates by messageId.
```

## Process Lifecycle

```
Daemon.start()
  │
  ├──▶ spawnAgentRuntime(profile, conversationId)
  │    │
  │    ├──▶ spawn CLI provider process (Claude/Kimi/...)
  │    │
  │    └──▶ spawn Chat Bridge process
  │         │ node bytro-chat-bridge.js
  │         │   --agent-profile-id <profile.id>
  │         │   --conversation-id <conversationId>
  │         │   --db-path <dbPath>
  │         │   --daemon-ipc-port <port>
  │         │
  │         └──▶ Generate MCP config pointing to bridge
  │              │ { "chat": { "command": "node", "args": ["bytro-chat-bridge.js", ...] } }
  │              │
  │              └──▶ Pass to CLI provider via --mcp-config-file
  │
  └──▶ Monitor both processes
       │
       ├──▶ Agent crash → kill bridge + cleanup
       ├──▶ Bridge crash → restart bridge (agent continues)
       └──▶ Normal exit → kill both + cleanup
```

## Security Model

```
┌─────────────────────────────────────────────────┐
│  Per-Bridge Authentication (HTTP Bearer Token)   │
│                                                  │
│  Bridge 1 (agent-profile-1, conv-123)           │
│  ├── Auth token: <random-1>                     │
│  ├── Can access: conversations where profile-1 participates │
│  ├── Can send messages as: @profile-1 only       │
│  ├── Cannot access: other conversations          │
│  └── Cannot send messages as: other agents       │
│                                                  │
│  Bridge 2 (agent-profile-2, conv-456)           │
│  ├── Auth token: <random-2>                     │
│  ├── Can access: conversations where profile-2 participates │
│  ├── Can send messages as: @profile-2 only       │
│  ├── Cannot access: conv-123                     │
│  └── Cannot send messages as: agent-profile-1    │
└─────────────────────────────────────────────────┘

Enforcement:
- Auth tokens generated by daemon at spawn time (crypto.randomUUID)
- Every HTTP request must include Authorization: Bearer <token>
- Daemon validates token → resolves to profileId
- API handlers scope queries by profileId
- Bridge process cannot modify its own CLI args (set by daemon)
- MCP config file permissions: 0o600
```
