# ADR-017: Daemon Independent Process — Step 3 of Frontend-Backend Separation

**Status**: Proposed
**Date**: 2026-05-14
**Supersedes**: —
**Related**: ADR-016 (Renderer API Server + SSE), ADR-015 (Chat Bridge MCP Sidecar)

## Context

ADR-016 defined a three-step migration plan to decouple the daemon from Electron:

| Step | Scope | Status |
|------|-------|--------|
| Step 1 | Renderer API Server (HTTP :5175, 53 endpoints) | ✅ APPROVED, implemented |
| Step 2 | SSE Push (replaces webContents.send) | ✅ APPROVED, implemented (dual-channel) |
| Step 3 | Daemon independent process | 🔄 This ADR |

Steps 1 and 2 are complete. The Renderer API Server and SSE Broadcaster are in place, providing HTTP+SSE communication between renderer and daemon. The remaining blocker is that daemon code still runs inside Electron's main process, importing Electron APIs directly.

**Current architecture**:

```
Electron main process
  ├── app.whenReady() → createWindow() + initDaemon()
  ├── daemon.ts (runs in-process)
  │   ├── Bridge API Server (:5174)
  │   ├── Renderer API Server (:5175)
  │   ├── SSE Broadcaster
  │   ├── AgentRuntime / Orchestrator
  │   └── SQLite / Memory / MCP / TaskQueue
  ├── ipcMain.handle() (74 handlers, partially migrated)
  └── BrowserWindow + webContents (push fallback)
```

**27 files import from `electron`**. The hard dependencies are:

| Category | Files | Difficulty |
|----------|-------|------------|
| `ipcMain.handle()` | 18 IPC modules | Easy — already migrating to HTTP |
| `app.getPath()` | db.ts, logging.ts, system.ts | Medium — needs path injection |
| `WebContents` push | orchestrator.ts (14 sites), daemon.ts, sse-broadcaster.ts | Medium — SSE replacement exists |
| `BrowserWindow` | index.ts, system.ts, terminal.ts | Hard — stays in Electron shell |
| `safeStorage` | secrets.ts (encrypt/decrypt) | Hard — needs OS keychain alternative |
| `dialog` | dialog.ts, conversation.ts, index.ts | Hard — native OS dialogs |
| `shell` | external.ts | Easy — `child_process.exec` replacement |
| `app` lifecycle | index.ts (whenReady, activate, window-all-closed) | Hard — stays in Electron shell |

## Decision

### 1. DaemonCore — Unified Orchestrator

Extract daemon logic into a `DaemonCore` class that has zero Electron imports:

```typescript
// src/main/daemon/daemon-core.ts
export class DaemonCore {
  private bridgeApi: BridgeApiServer
  private rendererApi: RendererApiServer
  private runtimeRegistry: RuntimeRegistry
  private taskQueue: TaskQueue
  private sseBroadcaster: SSEBroadcaster

  constructor(config: DaemonConfig) {
    // All dependencies injected, no Electron imports
  }

  async start(): Promise<void> { ... }
  async stop(): Promise<void> { ... }
  isRunning(): boolean { ... }
}
```

**DaemonConfig** provides all previously-Electron-resolved values:

```typescript
interface DaemonConfig {
  readonly dataDir: string      // replaces app.getPath('userData')
  readonly logDir: string       // replaces app.getPath('logs')
  readonly rendererPort: number // BYTRO_RENDERER_API_PORT or 5175
  readonly bridgePort: number   // 0 (random) or configured
  readonly secretsBackend: 'electron-safeStorage' | 'node-crypto'
  readonly headless: boolean    // true = no Electron shell needed
}
```

### 2. Dual Entry Points

Two ways to start the daemon:

**Entry A: CLI (`bytro-daemon`)**

```bash
# Headless mode — no UI
bytro-daemon --headless --data-dir ~/.bytro --port 5175

# With Electron shell — daemon spawns Electron
bytro-daemon --shell --data-dir ~/.bytro
```

**Entry B: Electron main (`index.ts`)**

```typescript
// Current: daemon runs in-process
const daemon = new Daemon(webContents)

// Step 3a: daemon runs in-process, but via DaemonCore + HTTP adapter
const daemon = new DaemonCore({ dataDir: app.getPath('userData'), ... })

// Step 3b: daemon runs as child process
const daemonProcess = spawn('bytro-daemon', ['--data-dir', ...])
```

### 3. Electron API Replacement Strategy

#### 3.1 Path Injection (`app.getPath` → `DaemonConfig`)

| Path | Current | Replacement |
|------|---------|-------------|
| `userData` | `app.getPath('userData')` | `config.dataDir` (default: `~/.bytro`) |
| `logs` | `app.getPath('logs')` | `config.logDir` (default: `~/.bytro/logs`) |
| `home` | `app.getPath('home')` | `os.homedir()` |
| `documents` | `app.getPath('documents')` | `path.join(os.homedir(), 'Documents')` |
| `desktop` | `app.getPath('desktop')` | `path.join(os.homedir(), 'Desktop')` |
| `downloads` | `app.getPath('downloads')` | `path.join(os.homedir(), 'Downloads')` |

**Implementation**: Create `src/main/core/app-paths.ts` with `AppPaths` interface:

```typescript
export interface AppPaths {
  readonly dataDir: string
  readonly logDir: string
  readonly homeDir: string
  readonly documentsDir: string
  readonly desktopDir: string
  readonly downloadsDir: string
}

// Electron implementation
export function createElectronAppPaths(): AppPaths {
  return {
    dataDir: app.getPath('userData'),
    logDir: app.getPath('logs'),
    homeDir: app.getPath('home'),
    ...
  }
}

// Standalone implementation
export function createStandaloneAppPaths(dataDir?: string): AppPaths {
  const base = dataDir ?? path.join(os.homedir(), '.bytro')
  return {
    dataDir: base,
    logDir: path.join(base, 'logs'),
    homeDir: os.homedir(),
    ...
  }
}
```

#### 3.2 Secrets Backend (`safeStorage` → `SecretsBackend` interface)

```typescript
export interface SecretsBackend {
  encrypt(value: string): Buffer
  decrypt(encrypted: Buffer): string
  isAvailable(): boolean
}

// Electron implementation (current)
export class ElectronSafeStorage implements SecretsBackend { ... }

// Node.js crypto implementation (new)
export class NodeCryptoStorage implements SecretsBackend {
  // Uses machine-specific key derived from:
  //   macOS: IOPlatformSerialNumber (ioreg)
  //   Linux: /etc/machine-id
  //   Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
  // Key derivation: crypto.scryptSync(machineId, salt, 32)
  // Encryption: crypto.aes-256-gcm
}
```

**Migration path**: Existing `safeStorage`-encrypted data needs a one-time migration:
1. Daemon starts with `ElectronSafeStorage`
2. Decrypts all secrets from DB
3. Re-encrypts with `NodeCryptoStorage`
4. Writes re-encrypted values back to DB
5. Switches to `NodeCryptoStorage` for all future operations

#### 3.3 Shell Module (`shell.openExternal` → `child_process.exec`)

```typescript
// src/main/utils/external.ts
export async function safeOpenExternal(url: string): Promise<void> {
  // Validate protocol (http/https only) — keep existing whitelist
  if (!isAllowedProtocol(url)) throw new Error('Blocked protocol')

  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open'
  exec(`${command} "${url}"`)
}
```

#### 3.4 Dialog Module (`dialog` → split strategy)

| Dialog | Strategy |
|--------|----------|
| `showErrorBox` | Replace with `console.error` + `process.exit(1)` in headless mode |
| `showOpenDialog` | Keep in Electron shell (renderer-side file picker in headless mode) |
| `showSaveDialog` | Keep in Electron shell (renderer-side download in headless mode) |

Native file dialogs stay in the Electron shell. In headless mode, the renderer (web app) uses browser-native `<input type="file">` and download APIs.

### 4. Module Split: What Stays in Electron vs. What Moves to Daemon

**Stays in Electron shell** (`src/main/electron-shell/`):

| Module | Reason |
|--------|--------|
| `index.ts` (app lifecycle) | `app.whenReady`, `activate`, `window-all-closed` |
| `BrowserWindow` creation | Window management is Electron's job |
| `ipc/dialog.ts` | Native file dialogs |
| `ipc/system.ts` (showWindow/hideWindow) | Window focus/hide |

**Moves to DaemonCore** (`src/main/daemon/`):

| Module | Reason |
|--------|--------|
| `daemon.ts` → `daemon-core.ts` | Core orchestration, zero Electron deps |
| `bridge-api.ts` | HTTP server for agents |
| `renderer-api.ts` | HTTP server for renderer |
| `sse-broadcaster.ts` | SSE push (remove webContents fallback) |
| `runtime-registry.ts` | Agent process management |
| `task-queue.ts` | Task scheduling |
| `orchestrator.ts` | AI orchestration (remove WebContents, use SSE only) |
| `core/db.ts` | SQLite (replace `app.getPath` with injected path) |
| `core/logging.ts` | Observability (replace `app.getPath` with injected path) |
| `core/secrets.ts` | Encryption (replace `safeStorage` with `SecretsBackend`) |
| `core/memory-*` | Memory system (zero Electron deps already) |
| `mcp/*` | MCP management (zero Electron deps already) |
| `chat-bridge/*` | MCP sidecar (zero Electron deps already) |
| All IPC modules → renderer-api-routes | HTTP endpoints replace IPC |

### 5. Process Management

**Step 3a: In-process DaemonCore + HTTP adapter**

Daemon still runs in Electron main process, but via `DaemonCore` class. Renderer communicates via HTTP (not IPC). This is the zero-risk intermediate step.

```
Electron main process
  ├── DaemonCore (in-process, no Electron imports)
  │   ├── RendererApiServer (:5175)
  │   ├── BridgeApiServer (:5174)
  │   └── SSEBroadcaster (no webContents fallback)
  └── Electron shell (BrowserWindow, app lifecycle)
      └── Renderer (React) → fetch() + EventSource → DaemonCore
```

**Step 3b: Daemon as child process**

Daemon runs as independent Node.js process. Electron shell spawns it and communicates via HTTP.

```
bytro-daemon (Node.js child process)
  ├── DaemonCore
  │   ├── RendererApiServer (:5175)
  │   ├── BridgeApiServer (:5174)
  │   └── SSEBroadcaster
  └── SQLite + Memory + MCP + Agents

Electron shell (separate process)
  ├── BrowserWindow (UI)
  └── Renderer → fetch() + EventSource → bytro-daemon
```

**Machine lock** (prevent multiple daemon instances):

```typescript
// src/main/daemon/machine-lock.ts
const LOCK_FILE = path.join(config.dataDir, 'bytro-daemon.lock')

export function acquireLock(): boolean {
  // Write PID + port to lock file
  // Check existing lock file for stale PID
  // Return false if another daemon is running
}

export function releaseLock(): void {
  // Delete lock file on graceful shutdown
}
```

### 6. Headless Mode

```bash
bytro-daemon --headless \
  --data-dir ~/.bytro \
  --port 5175 \
  --secrets-backend node-crypto
```

Headless mode:
- No Electron dependency
- No BrowserWindow
- Renderer API + Bridge API serve HTTP
- SSE for push
- CLI or Web app connects via HTTP
- `safeOpenExternal` logs URL instead of opening
- No native dialogs (renderer uses browser APIs)

### 7. Implementation Phases

| Phase | Scope | Risk | Duration |
|-------|-------|------|----------|
| **3a** | DaemonCore class + AppPaths injection + SecretsBackend interface + remove webContents fallback from SSE | Low | 2-3 days |
| **3b** | CLI entry point + machine lock + Electron shell spawns daemon as child process | Medium | 3-5 days |
| **3c** | Secrets migration (safeStorage → NodeCryptoStorage one-time migration) | Medium | 1-2 days |
| **3d** | Remove remaining IPC handlers (89 → 0) | Low (mechanical) | 5-7 days |
| **3e** | Headless mode validation + integration tests | Medium | 2-3 days |

**Phase 3a is the critical milestone** — once DaemonCore has zero Electron imports, the daemon can theoretically run outside Electron. Phase 3b makes it reality.

## Alternatives Considered

### 1. Keep daemon in Electron, just add HTTP API

Rejected — this was Step 1/2. Step 3 is explicitly about removing the Electron dependency from daemon code. Without this, daemon can never run headless or on a server.

### 2. stdin/stdout pipe (Slock pattern)

Considered — Slock's DaemonCore communicates with the shell via stdin/stdout JSON-RPC. This is lighter than HTTP but only supports 1:1 communication. Since we already have Renderer API Server (HTTP), using it for Electron shell communication is simpler and consistent. No new transport layer needed.

### 3. Full rewrite as separate npm package

Rejected — too much risk. Gradual extraction (DaemonCore) preserves all existing logic while removing Electron imports one by one.

### 4. Docker container for daemon

Future consideration — once daemon is independent, it can be containerized. But this is beyond Step 3 scope.

## Consequences

### Positive
- **Daemon independence** — runs without Electron (headless, CLI, server)
- **Frontend flexibility** — Electron, Web app, or CLI all use the same HTTP API
- **Testability** — daemon can be tested without Electron bootstrap
- **Deployment options** — daemon can run on remote server, in Docker, or as systemd service
- **Consistent architecture** — same pattern as Slock (DaemonCore + HTTP API + SSE)

### Negative
- **Process management complexity** — Electron shell must spawn and monitor daemon child process
- **Startup latency** — daemon process spawn + HTTP server ready adds ~2-3s vs in-process
- **Secrets migration risk** — one-time safeStorage → NodeCryptoStorage migration must be flawless
- **Native dialog loss** — headless mode has no OS file dialogs

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Daemon child process crash | Medium | High | Electron shell monitors PID + auto-restart + SSE reconnect |
| Secrets migration failure | Low | Critical | Migration script with rollback; keep ElectronSafeStorage as fallback during transition |
| Port conflict (5175) | Low | Low | Machine lock file includes port; configurable via env var |
| Startup race condition | Medium | Medium | Electron shell polls daemon `/api/daemon/status` until ready before loading renderer |
| Multiple daemon instances | Low | Medium | Machine lock file with PID check |

## References

- ADR-015: Chat Bridge MCP Sidecar (HTTP API pattern proven)
- ADR-016: Renderer API Server + SSE (HTTP + SSE communication proven)
- Slock DaemonCore: `DaemonCore` class + `AgentProcessManager` + machine lock
- Slock CLI entry: `slock daemon start` with `--headless` flag