---
status: active
owner: bytro
last_verified: 2026-05-08
doc_kind: architecture
---

# Observability Logging

Structured JSONL logging for agent runtime lifecycle, task state transitions, permission decisions, and feedback chains.

## Architecture

```
src/main/
├── core/logging.ts          # Logger core: file I/O, event types, console bridge
├── ipc/logs.ts              # IPC handlers: getDirectory, list, read
└── ai/orchestrator.ts       # Instrumentation: 16 call sites, 12 event types
```

Log files are written to `app.getPath('logs')/` (Electron standard). Each event category gets its own file:
- `task.log` — task lifecycle (enqueued/started/completed/failed)
- `runtime.log` — runtime process lifecycle (started/terminated)
- `permission.log` — permission decisions (granted/denied/abandoned)
- `app.log` — console bridge output (when `installConsoleLogBridge()` is enabled)

## Event Types

### Task Events

| Event | Source | Payload | When |
|-------|--------|---------|------|
| `task:enqueued` | `task` | `{ taskId, conversationId, profileId, runtimeKey }` | Task enters queue (serial or parallel path) |
| `task:started` | `task` | `{ taskId, conversationId, profileId, runtimeKey }` | `executeTask()` sets status to `working` |
| `task:completed` | `task` | `{ taskId, conversationId, profileId, runtimeKey }` | Task finishes successfully |
| `task:failed` | `task` | `{ taskId, conversationId, profileId, runtimeKey, error }` | Task terminates with error |

### Intent Events

| Event | Source | Payload | When |
|-------|--------|---------|------|
| `intent:dispatched` | `task` | `{ conversationId, profileId, intentCount, source }` | `dispatchIntents()` parses intents and before iterating. `source`: `user` or `agent-scan`. Useful for diagnosing "mention parsed but no task created" issues. |

### Runtime Events

| Event | Source | Payload | When |
|-------|--------|---------|------|
| `runtime:started` | `runtime` | `{ taskId, conversationId, profileId, runtimeKey }` | `AgentRuntime.start()` succeeds |
| `runtime:terminated` | `runtime` | `{ taskId, conversationId, profileId, runtimeKey, reason }` | Runtime stops. `reason`: `completed`, `crashed`, `zombie`, or `aborted` |

### Permission Events

| Event | Source | Payload | When |
|-------|--------|---------|------|
| `permission:granted` | `permission` | `{ conversationId, profileId, taskId }` | User approves permission request |
| `permission:denied` | `permission` | `{ conversationId, profileId, taskId }` | User rejects permission request |
| `permission:abandoned` | `permission` | `{ conversationId, profileId, taskId, reason }` | No matching runtime found (stale or already disposed) |

### Feedback Events

| Event | Source | Payload | When |
|-------|--------|---------|------|
| `feedback:created` | `feedback` | `{ taskId, conversationId, profileId, runtimeKey }` | Feedback task persisted after child task completes |

> `permission:requested` is emitted by `agent-runtime.ts` (not orchestrator) when the agent requests a permission.

## IPC API

### `logs:getDirectory`
Returns `app.getPath('logs')` — the directory containing all log files.

### `logs:list`
Returns `LogFileInfo[]` — all `.log` files sorted by `updatedAt` descending.

```typescript
interface LogFileInfo {
  source: string    // "task", "runtime", "permission", "feedback", etc.
  fileName: string  // "task.log"
  path: string      // absolute path
  size: number      // bytes
  updatedAt: number  // mtime in ms
}
```

### `logs:read`
Read and filter log entries.

```typescript
interface LogReadOptions {
  source?: string        // default: "app"
  limit?: number         // default: 300, max: 2000
  level?: 'debug' | 'info' | 'warn' | 'error' | Array
  query?: string         // case-insensitive keyword match
  since?: number         // timestamp filter (ms)
  until?: number         // timestamp filter (ms)
  tailBytes?: number     // default: 512KB, max: 5MB
}

interface LogReadResult {
  entries: LogEntry[]    // filtered, limited to last N
  file: LogFileInfo | null
  truncated: boolean     // true if file was larger than tailBytes
  bytesRead: number
}
```

## Usage

### From renderer

```typescript
// List available log files
const files = await window.api.logs.list()

// Read task lifecycle for a specific task
const result = await window.api.logs.read({
  source: 'task',
  query: 'task-id-here',
  limit: 50
})
```

### From main process

```typescript
import { writeObservabilityEvent, createLogger, readLogs } from '../core/logging'

// Fire-and-forget event (fails silently, never throws)
writeObservabilityEvent('task:started', {
  taskId: task.id,
  conversationId,
  profileId: task.toProfileId
})

// General-purpose logger
const logger = createLogger('my-module')
logger.info('something happened', { details: '...' })

// Read logs programmatically
const entries = readLogs({ source: 'task', query: 'error', limit: 100 })
```

### Troubleshooting via logs

```bash
# Was the task even created?
logs:read source=task query=<taskId>

# Did the runtime start?
logs:read source=runtime query=<taskId>

# Were there permission issues?
logs:read source=permission query=<conversationId>

# Filter by level
logs:read source=runtime level=error
logs:read source=runtime level=["warn","error"]
```

## Troubleshooting Examples

### "Agent doesn't reply" debugging

1. Check if intents were dispatched:
   ```
   logs:read source=task query=intent:dispatched
   ```
   If no `intent:dispatched` → mention was never parsed or `dispatchIntents` was never called

2. Check if task was enqueued:
   ```
   logs:read source=task query=<taskId>
   ```
   If `intent:dispatched` exists but no `task:enqueued` → policy gate blocked or routing failed

3. Check if runtime started:
   ```
   logs:read source=runtime query=<taskId>
   ```
   If no `runtime:started` → dispatch/scheduling issue

4. Check how it ended:
   - `task:completed` + `runtime:terminated reason=completed` → success (output not persisted? check renderer)
   - `task:failed` + `runtime:terminated reason=crashed` → agent crashed
   - `runtime:terminated reason=zombie` → 10-minute timeout

### "Permission dialog stuck" debugging

```
logs:read source=permission query=<conversationId>
```
Shows the full permission decision chain: granted/denied/abandoned.

## Design Decisions

- **Fire-and-forget**: `writeObservabilityEvent` wraps `writeLog` which uses `appendFileSync`. If the write fails, it writes to stderr. It never throws or blocks execution.
- **JSONL format**: One JSON object per line. Machine-parseable, human-readable with `jq`.
- **Fail-safe**: Non-JSON lines in log files are parsed gracefully — parsed as raw text with level `info`.
- **Console bridge**: `installConsoleLogBridge()` intercepts `console.log/warn/error` and mirrors them to `app.log`. No existing console output is lost.
- **Source isolation**: Each event category writes to a separate file, preventing noisy categories from drowning out signal.
