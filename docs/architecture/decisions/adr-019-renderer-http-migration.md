# ADR-019: Renderer HTTP Migration — Phase 3f of Frontend-Backend Separation

**Status**: Proposed
**Date**: 2026-05-14
**Supersedes**: —
**Related**: ADR-016 (Renderer API Server + SSE), ADR-017 (Daemon Independent Process), ADR-018 (Secrets Migration)

## Context

ADR-016 through ADR-018 established the daemon-side HTTP API layer:
- **ADR-016**: Renderer API Server (HTTP :5175, session auth, SSE push)
- **ADR-017**: Daemon independent process (DaemonCore, CLI entry, machine lock, fork mode)
- **ADR-018**: Secrets migration (safeStorage → KeyFile, headless guard)

Phase 3d completed: **136/136 IPC handlers have corresponding HTTP endpoints**. The daemon can operate fully via HTTP+SSE without Electron IPC.

However, the renderer still uses `ipcRenderer.invoke()` to communicate with the main process. This creates a hard dependency on Electron — the renderer cannot run as a standalone Web app.

**Current renderer communication**:

```
Renderer (React + Zustand)
  ├── ipcRenderer.invoke('list-conversations') → ipcMain.handle → DB
  ├── ipcRenderer.invoke('create-agent') → ipcMain.handle → DB
  ├── ipcRenderer.on('ai:event') → webContents.send() → SSE
  └── ... 136 IPC channels
```

**Target architecture**:

```
Renderer (React + Zustand)
  ├── apiFetch('/api/conversations') → Renderer API Server → DB
  ├── apiFetch('/api/agents', { method: 'POST' }) → Renderer API Server → DB
  ├── createEventSource('/api/events') → SSE push → Zustand store
  └── ... 136 HTTP endpoints
```

## Decision

### 1. API Client Layer — `renderer/api/client.ts`

A unified fetch wrapper that replaces all `ipcRenderer.invoke()` calls:

```typescript
// renderer/api/client.ts

const BASE_URL = `http://127.0.0.1:${window.__BYTRO_PORT__ ?? 5175}`

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`API ${status}: ${body}`)
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',  // Session cookie auto-sent
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return (await res.json()) as T
}

export function createEventSource(path: string): EventSource {
  return new EventSource(`${BASE_URL}${path}`, { withCredentials: true })
}
```

**Key design decisions**:

| Decision | Rationale |
|----------|-----------|
| `window.__BYTRO_PORT__` | Electron preload injects daemon port; Web app reads from env/config. Single variable, two environments. |
| `credentials: 'include'` | Session cookie auto-sent via `Set-Cookie` header. No manual token management. |
| `ApiError` with status | Structured error for UI: 401 → re-auth, 501 → feature unavailable, network → retry. |
| `EventSource` with `withCredentials` | SSE carries session cookie. `Last-Event-ID` header auto-sent on reconnect. |

### 2. SSE Event Dispatcher — `renderer/api/events.ts`

Maps SSE events to Zustand store actions (not DOM):

```typescript
// renderer/api/events.ts

export function connectSSE(): EventSource {
  const es = createEventSource('/api/events')

  es.addEventListener('daemon:heartbeat', (e) => {
    const data = JSON.parse(e.data)
    daemonStore.updateHeartbeat(data)
  })

  es.addEventListener('ai:event', (e) => {
    const data = JSON.parse(e.data)
    conversationStore.handleAIEvent(data)
  })

  // ... other event mappings

  return es
}
```

**Design principle**: events.ts is a dispatcher only. It receives SSE events and calls Zustand store actions. React components subscribe to stores and auto-update. No direct DOM manipulation.

### 3. Per-Module Migration Flag

During the IPC → HTTP transition, both paths coexist. A per-module flag prevents double-call:

```typescript
// renderer/api/migration.ts

// Global flag — set to true when all modules are migrated
const USE_HTTP = window.__BYTRO_USE_HTTP__ ?? false

// Per-module flags — allow incremental migration
const USE_HTTP_CONVERSATIONS = window.__BYTRO_USE_HTTP_CONVERSATIONS__ ?? USE_HTTP
const USE_HTTP_AGENTS = window.__BYTRO_USE_HTTP_AGENTS__ ?? USE_HTTP
// ...
```

Each module's API file checks its flag:

```typescript
// renderer/api/conversations.ts

export async function listConversations() {
  if (USE_HTTP_CONVERSATIONS) {
    return apiFetch('/api/conversations')
  }
  return ipcRenderer.invoke('list-conversations')
}
```

After all modules are migrated, the flag and IPC fallback code are removed.

### 4. Module Migration Order

Ordered by dependency depth — shallowest first:

| Phase | Module | Endpoints | Complexity |
|-------|--------|-----------|------------|
| 1 | system | version, paths, update | Low — read-only, no SSE |
| 2 | auth | session creation | Low — prerequisite for all others |
| 3 | conversations | CRUD, search, export | Medium — core feature |
| 4 | agents | CRUD, seed defaults | Medium — depends on conversations |
| 5 | tasks | CRUD, status, events | Medium — depends on conversations + agents |
| 6 | files/terminal | read/write/create/PTY | Medium — independent features |
| 7 | chat/orchestrator | session lifecycle, streaming | High — SSE streaming, permission flow |
| 8 | memory/palace | CRUD, import/export | Medium — independent features |
| 9 | MCP/usage/other | remaining modules | Low — simple CRUD |

### 5. SSE Reconnection Strategy

EventSource natively reconnects and sends `Last-Event-ID` header. Two layers of state sync:

1. **Layer 1 (default)**: `Last-Event-ID` — EventSource auto-sends on reconnect. Daemon resumes from last event.
2. **Layer 2 (optional)**: `GET /api/events/recent?after=<id>` — Client fetches missed events after reconnect. Added if Layer 1 proves insufficient.

**SSE Layer 2 design constraints** (if implemented):
- **Buffer size**: 100 events (ring buffer, ~50KB typical)
- **Event format**: Same as SSE `data:` field — `{ channel: string, payload: unknown, seq: number }`
- **Eviction**: Ring buffer — oldest events discarded when buffer is full
- **Memory overhead**: ~50KB per connected client (negligible for local daemon)
- **Query**: `after=<seq>` returns all events with `seq > after`, up to 100

### 6. Error Handling Strategy

| Error | Status | UI Response | Recovery |
|-------|--------|-------------|----------|
| Session expired | 401 | Full-screen re-auth prompt | User re-authenticates |
| Feature unavailable | 501 | Toast: "Not available in this mode" | N/A (headless limitation) |
| Bad request | 400 | Inline validation error | User corrects input |
| Server error | 500 | Error boundary + retry button | User retries |
| Network error | — | Toast + auto-retry (3x, exponential backoff) | Automatic |
| SSE disconnect | — | AgentStatusBar: "⚠️ Connection interrupted" | Auto-reconnect via EventSource |

## C4 Model — Container Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Renderer (Browser)                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ React UI     │  │ Zustand      │  │ SSE EventSource   │  │
│  │ Components   │──│ Stores       │──│ (/api/events)     │  │
│  └──────────────┘  └──────┬───────┘  └─────────┬─────────┘  │
│                           │                     │            │
│  ┌────────────────────────┴─────────────────────┴──────────┐ │
│  │              renderer/api/                               │ │
│  │  client.ts  events.ts  conversations.ts  agents.ts  ... │ │
│  └────────────────────────┬────────────────────────────────┘ │
└───────────────────────────┼──────────────────────────────────┘
                            │ HTTP + SSE
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Daemon (Node.js)                          │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Renderer API     │  │ Bridge API       │                 │
│  │ Server (:5175)   │  │ Server (:5174)   │                 │
│  │ 136 endpoints    │  │ 8 endpoints      │                 │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                           │
│  ┌────────┴──────────────────────┴────────┐                 │
│  │           DaemonCore                   │                 │
│  │  RuntimeRegistry / TaskQueue / SQLite  │                 │
│  └───────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Consequences

### Positive

1. **Web app becomes possible** — Renderer can run in any browser, not just Electron. API client layer is directly reusable.
2. **Architecture simplification** — Eliminates IPC concept from renderer. Single communication pattern (HTTP + SSE).
3. **Testability** — Renderer can be tested against a running daemon without Electron.
4. **Deployment flexibility** — Renderer can be served from any HTTP server (CDN, Vercel, etc.).
5. **SSE standard** — EventSource is a web standard, works in all browsers. No Electron-specific API.

### Negative

1. **Migration effort** — Every `ipcRenderer.invoke()` call must be replaced. ~136 call sites across renderer.
2. **IPC/HTTP coexistence** — During migration, both paths exist. Migration flag adds complexity.
3. **SSE reconnection** — EventSource reconnection may miss events. `Last-Event-ID` + optional recent-events endpoint needed.
4. **Session management** — Cookie-based auth requires session creation on startup. IPC had implicit trust.
5. **Latency** — HTTP has slightly higher latency than in-process IPC (localhost ≈ 0.1ms, negligible).
6. **SSE is unidirectional** — Server-to-client push only. Bidirectional communication requires HTTP request (one extra round-trip vs IPC invoke).
7. **EventSource header limitation** — EventSource does not support custom headers. Auth must rely on cookies, not `Authorization` header.
8. **Cookie security** — Session cookies require SameSite, HttpOnly, Secure flags. Additional configuration vs IPC's implicit trust.

## Risks

| Risk | Mitigation |
|------|------------|
| Double-call during migration | Per-module migration flag prevents IPC and HTTP being called simultaneously |
| SSE event loss on reconnect | `Last-Event-ID` header + optional `GET /api/events/recent` catch-up endpoint |
| Session cookie security | SameSite=Strict, HttpOnly, Secure (in production), Path=/api |
| Renderer startup race | Session creation must succeed before any API call. Retry with backoff. |
| Breaking change for Electron users | Migration flag defaults to IPC (false). Incremental rollout per module. |

### Rollback Strategy

Each module migration is independently reversible via the per-module flag:

1. **Per-module rollback** — Set `window.__BYTRO_USE_HTTP_<MODULE>__ = false` to revert a single module to IPC. Other modules unaffected.
2. **IPC handler retention** — Keep `ipcMain.handle()` registrations for 1 version cycle after module migration. Only remove in 3f-7 after all modules are stable.
3. **Stability gate** — 3f-7 (remove IPC fallback) only executes after all modules have been running on HTTP for 1 week without issues.
4. **Full rollback** — Set `window.__BYTRO_USE_HTTP__ = false` to revert all modules to IPC simultaneously.

## Implementation Phases

| Phase | Scope | Owner | Dependencies |
|-------|-------|-------|--------------|
| 3f-0 | IPC handler audit (COMPLETE) | @需求文档师 | — |
| 3f-1 | `client.ts` + `events.ts` + `system.ts` | @UI设计专家 | 3f-0 |
| 3f-2 | `auth.ts` + `conversations.ts` | @UI设计专家 | 3f-1 |
| 3f-3 | `agents.ts` + `tasks.ts` | @UI设计专家 | 3f-2 |
| 3f-4 | `files.ts` + `terminal.ts` | @UI设计专家 | 3f-3 |
| 3f-5 | `chat.ts` + `orchestrator.ts` | @UI设计专家 | 3f-4 |
| 3f-6 | Remaining modules + remove IPC fallback | @UI设计专家 | 3f-5 |
| 3f-7 | Remove `ipcRenderer` dependency + webContents fallback | @需求文档师 | 3f-6 |
| 3f-8 | Web app validation | @架构设计 | 3f-7 |
