# ADR-016: Renderer API Server + SSE

**Status**: Proposed
**Date**: 2026-05-14
**Decision-makers**: @架构设计, @tomek-rumore
**Context**: ADR-015 Chat Bridge MCP Sidecar

## Summary

Replace Electron IPC (`ipcMain.handle`) with HTTP API for renderer↔daemon communication, and replace `webContents.send()` push with Server-Sent Events (SSE). This enables daemon to run as an independent process without Electron.

## Motivation

### Current Architecture

```
Renderer (Electron) ←→ IPC (ipcMain/ipcRenderer) ←→ Daemon (Electron main)
Renderer (Electron) ← webContents.send() push ← Daemon
```

- 141 `ipcMain.handle()` registrations across 19 modules (exact count varies — some handlers are dynamically registered)
- 19 `webContents.send()` push points
- Daemon cannot run without Electron (WebContents, ipcMain, app.getPath dependencies)

### Why Now

ADR-015 (Chat Bridge MCP Sidecar) proved that daemon can serve HTTP API without Electron IPC. The Bridge API Server pattern (HTTP server + auth + route dispatch + observability) is mature and can be reused for renderer.

### Goals

1. **Daemon independence** — daemon can run without Electron (headless, CLI, server mode)
2. **Frontend flexibility** — renderer can be Electron, Web app, or CLI
3. **Multi-client** — same daemon serves multiple frontends simultaneously
4. **Slock alignment** — API design references Slock's RESTful endpoint patterns

## Design

### Renderer API Server

A second HTTP server (independent from Bridge API) on a fixed port:

| Dimension | Bridge API (sidecar) | Renderer API (frontend) |
|-----------|---------------------|------------------------|
| Port | `:0` (random, localhost only) | `:5175` (configurable) |
| Auth | Bearer token (per-agent, 24h TTL) | Session cookie (per-user) |
| Path prefix | `/internal/agent/:agentId/` | `/api/` |
| Response format | text/plain (prose) + JSON | JSON (structured) |
| CORS | None (internal) | Allowed (renderer origin only) |

### SSE Broadcaster

Replace `webContents.send()` with SSE:

```
Current: daemon → webContents.send('ai:event', data) → renderer
New:     daemon → SSE broadcast → EventSource in renderer → handle
```

SSE endpoint: `GET /api/events` with `Content-Type: text/event-stream`

Event types (aligned with Slock):
- `message:new` — new message in conversation
- `ai:stream` — streaming AI output (text_delta, thinking_delta, tool_*)
- `task:updated` — task status change
- `agent:status` — agent status change
- `a2a:taskCreated/Completed/Queued` — A2A task lifecycle
- `terminal:onData/onExit` — terminal output
- `system:update` — update available

### Session Authentication

Renderer connects to daemon on startup:
1. `POST /api/auth/session` → daemon issues session cookie (HttpOnly, Secure, SameSite=Strict)
2. Subsequent requests include cookie automatically
3. Session TTL: 7 days (configurable)
4. Single user model — only one active session (local app)

### Migration Strategy

**Coexistence period**: IPC handlers and HTTP endpoints exist simultaneously. Renderer gradually switches to HTTP. When all calls for a module are migrated, the IPC handler is removed.

**4 phases by priority**:

| Phase | Modules | Handler Count | Priority |
|-------|---------|---------------|----------|
| 1A | orchestrator, chat, conversation, message, daemon | ~35 | Highest |
| 1B | task, agent, action-card | ~16 | High |
| 1C | memory, memory-palace, mcp | ~41 | Medium |
| 1D | system, file, workspace, team, terminal, logs, change, dialog, update, usage, todo | ~49 | Low |

### File Structure

```
src/main/daemon/
  ├── bridge-api.ts              # Existing (for sidecar)
  ├── renderer-api.ts            # New (for renderer)
  ├── renderer-api-routes/
  │   ├── auth.ts                # Session auth endpoints
  │   ├── chat.ts                # chat:* → HTTP
  │   ├── orchestrator.ts        # orchestrator:* → HTTP
  │   ├── conversation.ts        # conversation:* + message:* → HTTP
  │   ├── task.ts                # task:* → HTTP
  │   ├── agent.ts               # agent:* → HTTP
  │   ├── action-card.ts         # action-card:* → HTTP
  │   ├── daemon.ts              # daemon:* → HTTP
  │   ├── memory.ts              # memory:* → HTTP
  │   ├── memory-palace.ts       # memory-palace:* → HTTP
  │   ├── mcp.ts                 # mcp:* → HTTP
  │   └── system.ts              # system:* + workspace:* + team:* + file:* → HTTP
  ├── renderer-auth.ts           # Session cookie auth
  └── sse-broadcaster.ts         # SSE push (replaces webContents.send)
```

### Path Decoupling (Step 1)

Move `app.getPath('userData')` → `os.homedir() + '/.bytro/'` early (low risk, high value).

### safeStorage Decoupling (Step 3)

Replace `safeStorage.encryptString()` with OS keychain:
- macOS: Keychain (via `security` CLI or node-keytar)
- Windows: DPAPI (via windows-credential-provider)
- Linux: libsecret (via secret-storage)

## Alternatives Considered

### 1. Shared HTTP Server (Bridge + Renderer on same port)

Rejected — Bridge API uses `:0` random port (sidecar discovers via config file), Renderer API needs fixed port (renderer needs to know at build time). Separate servers provide isolation and independent lifecycle.

### 2. WebSocket instead of SSE

Rejected for push channel — SSE is simpler (unidirectional, no framing protocol), works with EventSource API, no library needed. WebSocket adds complexity for bidirectional communication we don't need (renderer sends via HTTP POST, receives push via SSE).

### 3. tRPC instead of REST

Considered — tRPC provides end-to-end type safety. Rejected for now — adds dependency and complexity. REST with JSON schema validation is sufficient and aligns with Slock's API patterns. Can revisit in Phase 2.

### 4. GraphQL

Rejected — overkill for this use case, adds complexity without clear benefit for a local-first app.

## Consequences

### Positive
- Daemon can run without Electron (headless, CLI, server mode)
- Frontend can be Electron, Web app, or CLI
- Same daemon serves multiple clients
- API design aligned with Slock patterns
- IPC handler removal reduces Electron coupling progressively

### Negative
- Two HTTP servers to manage (Bridge API + Renderer API)
- Session cookie management complexity
- SSE reconnection handling on renderer side
- Migration period where IPC and HTTP coexist (code duplication)
- Fixed port may conflict with other services (mitigated by configurable port)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auth bypass on localhost | Low | High | `127.0.0.1` bind + session cookie + SameSite=Strict |
| Malicious website CSRF | Low | High | CORS origin whitelist (`file://`, `http://localhost:5173`) + SameSite=Strict cookie |
| SSE connection drops | Medium | Low | Auto-reconnect in EventSource + webContents fallback |
| IPC/HTTP divergence | Medium | Medium | Shared service layer ensures same logic; integration tests cover both paths |
| Port conflict (5175) | Low | Low | Configurable port; fallback to next available |

### CORS Policy

Renderer API CORS is stricter than Bridge API:
- **Allowed origins**: `file://` (Electron), `http://localhost:5173` (Vite dev server), configurable `rendererOrigin`
- **Credentials**: `Access-Control-Allow-Credentials: true` (required for session cookie)
- **Methods**: GET, POST, PUT, PATCH, DELETE
- **Headers**: Content-Type, Cookie

## References

- ADR-015: Chat Bridge MCP Sidecar (proves HTTP API pattern)
- Slock API: `slock message send/read/check`, `slock task claim/update`, `slock channel list`
- Slock WebSocket: event types for message, task, channel updates
