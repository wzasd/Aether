---
status: completed
owner: bytro
last_verified: 2026-05-01
doc_kind: plan
completed_at: 2026-05-01
completion_summary: "Historical P0 implementation plan. The core Claude CLI provider, selectors, conversation management, and AI status visualization are implemented in code; keep this document as an implementation record, not an active plan."
---

# Bytro P0 Implementation Plan

> Status: Completed / historical. Current runtime contracts live in `docs/architecture/ai-provider.md`, `docs/modules/ai-provider.md`, `docs/modules/selectors.md`, `docs/modules/conversation-management.md`, and `docs/modules/ai-status-visualization.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SDK-based ClaudeProvider with CLI process mode, add model/permission/dir selectors, conversation search/title/delete-confirm, and AI status visualization (usage/subagent/todo).

**Architecture:** Dual-mode CLI integration — child_process + stream-json for plan/autoEdit/fullAuto, node-pty for manual permission mode. AIProvider interface as abstraction. All new UI uses React + Zustand consistent with existing codebase.

**Tech Stack:** Electron, React 18, Zustand, Tailwind v4, better-sqlite3, node-pty (new dep), child_process (built-in)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/main/ai/provider.ts` | AIProvider interface, SessionConfig, Session types |
| `src/main/ai/providers/claude-cli.ts` | ClaudeCLIProvider: dual-mode CLI process management |
| `src/main/ai/event-parser.ts` | CLI stream-json → AIEvent mapping |
| `src/main/ipc/dialog.ts` | dialog:openDirectory IPC handler |
| `src/renderer/src/components/ModelSelector.tsx` | Model dropdown (Opus/Sonnet/Haiku) |
| `src/renderer/src/components/PermissionModeSelector.tsx` | Permission mode dropdown |
| `src/renderer/src/components/WorkingDirSelector.tsx` | Working directory picker |
| `src/renderer/src/components/ConversationSearch.tsx` | Search input + results |
| `src/renderer/src/components/ConversationDeleteConfirm.tsx` | Delete confirmation dialog |
| `src/renderer/src/components/UsageBar.tsx` | Token usage display |
| `src/renderer/src/components/SubagentStatus.tsx` | Subagent running/completed status |
| `src/renderer/src/components/TodoList.tsx` | Todo items list |
| `src/renderer/src/stores/sessionConfigStore.ts` | Model/permission/workingDir state |
| `src/renderer/src/stores/usageStore.ts` | Token usage accumulation |
| `src/renderer/src/stores/subagentStore.ts` | Subagent tracking |
| `src/renderer/src/stores/todoStore.ts` | Todo list tracking |

### Modified Files
| File | Change |
|------|--------|
| `src/main/ai/engine.ts` | Refactor: delegate to AIProvider instead of current provider Map |
| `src/main/ai/types.ts` | Add cost_usd to CompleteEvent, add HookEvent types |
| `src/main/core/db.ts` | Add title_source column to conversations |
| `src/main/ipc/conversation.ts` | Add conversation:search (fixed SQL), autoTitle, setTitle |
| `src/main/ipc/chat.ts` | Adapt to new AIEngine API |
| `src/main/ipc/index.ts` | Register dialog IPC |
| `src/main/index.ts` | Register dialog IPC on app startup |
| `src/preload/index.ts` | Add dialog namespace, update chat.sendMessage signature |
| `src/renderer/src/types/global.d.ts` | Add dialog API types, update Window.api |
| `src/renderer/src/pages/Chat.tsx` | Add selectors bar + UsageBar + SubagentStatus |
| `src/renderer/src/components/sidebar/Sidebar.tsx` | Add ConversationSearch + TodoList |
| `src/renderer/src/stores/chatStore.ts` | Route AIEvent to sub-stores, auto-title on complete |
| `package.json` | Add node-pty dependency |

### Deleted Files
| File | Reason |
|------|--------|
| `src/main/ai/providers/claude.ts` | Replaced by claude-cli.ts |

---

## Task 1: AIProvider Interface + EventParser

**Files:**
- Create: `src/main/ai/provider.ts`
- Create: `src/main/ai/event-parser.ts`
- Modify: `src/main/ai/types.ts`

- [ ] **Step 1: Create provider.ts with AIProvider interface**

```typescript
// src/main/ai/provider.ts
import type { AIEvent, PermissionMode } from './types'

export interface SessionConfig {
  model: 'opus' | 'sonnet' | 'haiku'
  permissionMode: PermissionMode
  workingDir: string
  sessionId?: string
}

export interface Session {
  id: string
  providerType: string
  config: SessionConfig
  status: 'idle' | 'running' | 'waiting_permission' | 'waiting_question' | 'error'
  createdAt: number
}

export interface AIProvider {
  readonly type: string
  startSession(config: SessionConfig): Promise<Session>
  endSession(sessionId: string): Promise<void>
  sendMessage(sessionId: string, content: string): void
  respondPermission(sessionId: string, approved: boolean): void
  respondQuestion(sessionId: string, answer: string): void
  abort(sessionId: string): void
  onEvent(sessionId: string, handler: (event: AIEvent) => void): void
  offEvent(sessionId: string, handler: (event: AIEvent) => void): void
}
```

- [ ] **Step 2: Add cost_usd to CompleteEvent in types.ts**

In `src/main/ai/types.ts`, add `costUsd` field to `CompleteEvent`:

```typescript
export interface CompleteEvent {
  type: 'complete'
  id: string
  fullText: string
  usage?: UsageInfo
  costUsd?: number
}
```

- [ ] **Step 3: Create event-parser.ts**

```typescript
// src/main/ai/event-parser.ts
import type { AIEvent, UsageInfo } from './types'

export class EventParser {
  parseLine(line: string): AIEvent | null {
    if (!line.trim()) return null
    try {
      const data = JSON.parse(line)
      switch (data.type) {
        case 'system':
          if (data.subtype === 'init') return this.parseInit(data)
          return this.parseHook(data)
        case 'assistant':
          return this.parseAssistant(data)
        case 'user':
          return this.parseUser(data)
        case 'result':
          return this.parseResult(data)
        default:
          return null
      }
    } catch {
      return null
    }
  }

  private parseInit(data: any): AIEvent {
    return {
      type: 'system_init',
      sessionId: data.session_id,
      tools: data.tools
    } as any
  }

  private parseHook(data: any): AIEvent | null {
    // Map hook events to subagent events
    const hookName: string = data.hook_name || ''
    if (hookName.includes('Subagent') || hookName.includes('Agent')) {
      if (data.subtype === 'hook_started' || hookName.includes('Start')) {
        return {
          type: 'subagent_started',
          agentId: data.uuid || data.session_id,
          agentType: 'subagent',
          name: hookName
        } as any
      }
      if (data.subtype === 'hook_response' || hookName.includes('Stop')) {
        return {
          type: 'subagent_completed',
          agentId: data.uuid || data.session_id,
          result: data.output ? String(data.output).slice(0, 200) : undefined
        } as any
      }
    }
    return null
  }

  private parseAssistant(data: any): AIEvent | null {
    const content: any[] = data.message?.content
    if (!Array.isArray(content) || content.length === 0) return null
    const block = content[0]
    switch (block.type) {
      case 'text':
        return { type: 'text_delta', id: data.uuid || '', delta: block.text || '' }
      case 'thinking':
        return { type: 'thinking_delta', delta: block.thinking || '' }
      case 'tool_use':
        return {
          type: 'tool_start',
          toolCallId: block.id || '',
          toolName: block.name || '',
          toolInput: typeof block.input === 'string' ? block.input : JSON.stringify(block.input)
        }
      default:
        return null
    }
  }

  private parseUser(data: any): AIEvent | null {
    const content: any[] = data.message?.content
    if (!Array.isArray(content) || content.length === 0) return null
    const block = content[0]
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        toolCallId: block.tool_use_id || '',
        success: !block.is_error,
        result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
      }
    }
    return null
  }

  private parseResult(data: any): AIEvent[] | null {
    const events: AIEvent[] = []
    if (data.subtype === 'success') {
      events.push({
        type: 'complete',
        id: data.session_id || '',
        fullText: typeof data.result === 'string' ? data.result : '',
        usage: this.extractUsage(data),
        costUsd: data.total_cost_usd
      })
      events.push({ type: 'done', id: data.session_id || '' })
    } else if (data.subtype?.startsWith('error')) {
      events.push({ type: 'error', error: data.error || data.subtype })
      events.push({ type: 'done', id: data.session_id || '' })
    } else {
      events.push({ type: 'done', id: data.session_id || '' })
    }
    return events as any
  }

  private extractUsage(data: any): UsageInfo | undefined {
    const raw = data.usage
    if (!raw) return undefined
    return {
      inputTokens: raw.input_tokens || 0,
      outputTokens: raw.output_tokens || 0,
      cacheReadTokens: raw.cache_read_input_tokens || undefined,
      cacheCreationTokens: raw.cache_creation_input_tokens || undefined
    }
  }
}
```

Note: `parseLine` may return a single AIEvent or an array (from parseResult). The consumer should handle both.

- [ ] **Step 4: Type check**

Run: `cd /Users/wangzhao/Documents/agentWorkSpace/catwork/bytro-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/provider.ts src/main/ai/event-parser.ts src/main/ai/types.ts
git commit -m "feat: add AIProvider interface and EventParser for CLI stream-json"
```

---

## Task 2: ClaudeCLIProvider Implementation

**Files:**
- Create: `src/main/ai/providers/claude-cli.ts`
- Delete: `src/main/ai/providers/claude.ts`

- [ ] **Step 1: Install node-pty**

Run: `cd /Users/wangzhao/Documents/agentWorkSpace/catwork/bytro-app && pnpm add node-pty && pnpm add -D @types/node-pty`

- [ ] **Step 2: Create claude-cli.ts**

```typescript
// src/main/ai/providers/claude-cli.ts
import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { PERMISSION_MODE_CLI_MAP } from '../types'
import type { AIProvider, SessionConfig, Session } from '../provider'
import type { AIEvent, PermissionMode } from '../types'
import { EventParser } from '../event-parser'

export class ClaudeCLIProvider extends EventEmitter implements AIProvider {
  readonly type = 'claude-cli'

  private sessions: Map<string, {
    process: ChildProcess
    config: SessionConfig
    status: Session['status']
    parser: EventParser
    buffer: string
  }> = new Map()

  async startSession(config: SessionConfig): Promise<Session> {
    const sessionId = config.sessionId || `cli-${Date.now()}`
    const args = this.buildArgs(config)

    const child = spawn('claude', args, {
      cwd: config.workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    const entry = {
      process: child,
      config,
      status: 'idle' as Session['status'],
      parser: new EventParser(),
      buffer: ''
    }
    this.sessions.set(sessionId, entry)

    child.stdout.on('data', (data: Buffer) => {
      entry.buffer += data.toString()
      const lines = entry.buffer.split('\n')
      entry.buffer = lines.pop() || ''
      for (const line of lines) {
        const events = entry.parser.parseLine(line)
        if (!events) continue
        const eventArr = Array.isArray(events) ? events : [events]
        for (const event of eventArr) {
          this.emit(`event:${sessionId}`, event)
        }
      }
    })

    child.stderr.on('data', () => { /* debug logging if needed */ })

    child.on('exit', () => {
      this.sessions.delete(sessionId)
    })

    return {
      id: sessionId,
      providerType: this.type,
      config,
      status: 'idle',
      createdAt: Date.now()
    }
  }

  async endSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.process.kill()
      this.sessions.delete(sessionId)
    }
  }

  sendMessage(sessionId: string, content: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.status = 'running'
    const msg = JSON.stringify({ type: 'user_message', content }) + '\n'
    entry.process.stdin.write(msg)
  }

  respondPermission(sessionId: string, approved: boolean): void {
    // In -p stream-json mode, permissions are handled by --permission-mode
    // This method is for PTY mode (manual) — write y/n to PTY
    // For now, if denied, abort the session
    if (!approved) {
      this.abort(sessionId)
    }
  }

  respondQuestion(sessionId: string, answer: string): void {
    // Similar to permission — in -p mode, abort if can't answer
    // In PTY mode, write answer to stdin
    this.abort(sessionId)
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.process.kill('SIGTERM')
      entry.status = 'idle'
    }
  }

  onEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.on(`event:${sessionId}`, handler)
  }

  offEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.off(`event:${sessionId}`, handler)
  }

  private buildArgs(config: SessionConfig): string[] {
    const cliPermissionMode = PERMISSION_MODE_CLI_MAP[config.permissionMode]
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'stream-json',
      '--model', config.model,
      '--permission-mode', cliPermissionMode
    ]
    if (config.sessionId) {
      args.push('--resume', config.sessionId)
    }
    return args
  }
}
```

- [ ] **Step 3: Delete old claude.ts**

Run: `rm src/main/ai/providers/claude.ts`

- [ ] **Step 4: Type check**

Run: `cd /Users/wangzhao/Documents/agentWorkSpace/catwork/bytro-app && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/providers/claude-cli.ts package.json pnpm-lock.yaml
git rm src/main/ai/providers/claude.ts
git commit -m "feat: replace SDK ClaudeProvider with ClaudeCLIProvider (child_process + stream-json)"
```

---

## Task 3: AIEngine Refactor

**Files:**
- Modify: `src/main/ai/engine.ts`
- Modify: `src/main/ipc/chat.ts`

- [ ] **Step 1: Refactor engine.ts to use AIProvider**

Replace the entire engine.ts to delegate to AIProvider:

```typescript
// src/main/ai/engine.ts
import { EventEmitter } from 'events'
import type { AIProvider, SessionConfig, Session } from './provider'
import type { AIEvent, AIRequest } from './types'

export class AIEngine extends EventEmitter {
  private provider: AIProvider | null = null
  private activeSessionId: string | null = null

  setProvider(provider: AIProvider): void {
    this.provider = provider
  }

  async startSession(config: SessionConfig): Promise<Session> {
    if (!this.provider) throw new Error('No AI provider registered')
    return this.provider.startSession(config)
  }

  async endSession(sessionId: string): Promise<void> {
    return this.provider?.endSession(sessionId)
  }

  sendMessage(sessionId: string, content: string): void {
    this.provider?.sendMessage(sessionId, content)
  }

  respondPermission(sessionId: string, approved: boolean): void {
    this.provider?.respondPermission(sessionId, approved)
  }

  respondQuestion(sessionId: string, answers: Record<string, string>): void {
    // For now, pass first answer; full multi-question support later
    const firstAnswer = Object.values(answers)[0] || ''
    this.provider?.respondQuestion(sessionId, firstAnswer)
  }

  abort(sessionId: string): void {
    this.provider?.abort(sessionId)
  }

  onProviderEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.provider?.onEvent(sessionId, handler)
  }

  offProviderEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.provider?.offEvent(sessionId, handler)
  }
}
```

- [ ] **Step 2: Refactor chat.ts IPC to use new engine API**

```typescript
// src/main/ipc/chat.ts
import { ipcMain, BrowserWindow } from 'electron'
import { AIEngine } from '../ai/engine'
import type { SessionConfig } from '../ai/provider'
import type { PermissionMode } from '../ai/types'

export function registerChatIpc(engine: AIEngine): void {
  ipcMain.handle('chat:send', async (event, request: {
    conversationId: string
    messages: Array<{ role: string; content: string }>
    model: string
    provider: string
    permissionMode: PermissionMode
    workingDir?: string
  }) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) throw new Error('No window found for sender')

    const sendEvent = (aiEvent: any): void => {
      try { senderWindow.webContents.send('ai:event', aiEvent) } catch {}
    }

    const config: SessionConfig = {
      model: request.model.includes('opus') ? 'opus' : request.model.includes('haiku') ? 'haiku' : 'sonnet',
      permissionMode: request.permissionMode,
      workingDir: request.workingDir || process.cwd()
    }

    const session = await engine.startSession(config)
    engine.onProviderEvent(session.id, sendEvent)

    const lastMsg = request.messages[request.messages.length - 1]
    engine.sendMessage(session.id, lastMsg?.content || '')

    return { requestId: session.id }
  })

  ipcMain.handle('chat:abort', (_event, requestId: string) => {
    engine.abort(requestId)
    return { success: true }
  })

  ipcMain.handle('chat:confirmPermission', (_event, confirmId: string, approved: boolean) => {
    engine.respondPermission(confirmId, approved)
    return { success: true }
  })

  ipcMain.handle('chat:answerQuestion', (_event, confirmId: string, answers: Record<string, string>) => {
    engine.respondQuestion(confirmId, answers)
    return { success: true }
  })
}
```

- [ ] **Step 3: Update main/index.ts to register ClaudeCLIProvider**

In `src/main/index.ts`, after AIEngine creation, add:

```typescript
import { ClaudeCLIProvider } from './ai/providers/claude-cli'

// After engine creation:
const cliProvider = new ClaudeCLIProvider()
engine.setProvider(cliProvider)
```

- [ ] **Step 4: Type check and commit**

```bash
git add src/main/ai/engine.ts src/main/ipc/chat.ts src/main/index.ts
git commit -m "refactor: AIEngine delegates to AIProvider, chat IPC uses session-based API"
```

---

## Task 4: Dialog IPC + Preload Update

**Files:**
- Create: `src/main/ipc/dialog.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/global.d.ts`

- [ ] **Step 1: Create dialog.ts**

```typescript
// src/main/ipc/dialog.ts
import { ipcMain, dialog } from 'electron'

export function registerDialogIpc(): void {
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
```

- [ ] **Step 2: Register in ipc/index.ts**

Add `registerDialogIpc()` to the IPC registration function.

- [ ] **Step 3: Add dialog namespace to preload**

In `src/preload/index.ts`, add to the `api` object:

```typescript
dialog: {
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory')
}
```

- [ ] **Step 4: Update global.d.ts**

Add `dialog` to the `Window.api` interface in `src/renderer/src/types/global.d.ts`:

```typescript
dialog: {
  openDirectory: () => Promise<string | null>
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/dialog.ts src/main/ipc/index.ts src/preload/index.ts src/renderer/src/types/global.d.ts
git commit -m "feat: add dialog:openDirectory IPC for working directory selection"
```

---

## Task 5: Session Config Store + Selectors UI

**Files:**
- Create: `src/renderer/src/stores/sessionConfigStore.ts`
- Create: `src/renderer/src/components/ModelSelector.tsx`
- Create: `src/renderer/src/components/PermissionModeSelector.tsx`
- Create: `src/renderer/src/components/WorkingDirSelector.tsx`
- Modify: `src/renderer/src/pages/Chat.tsx`

- [ ] **Step 1: Create sessionConfigStore.ts**

```typescript
// src/renderer/src/stores/sessionConfigStore.ts
import { create } from 'zustand'

type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto'

interface SessionConfigState {
  model: 'opus' | 'sonnet' | 'haiku'
  permissionMode: PermissionMode
  workingDir: string
}

export const useSessionConfigStore = create<SessionConfigState & {
  setModel: (model: SessionConfigState['model']) => void
  setPermissionMode: (mode: PermissionMode) => void
  selectWorkingDir: () => Promise<void>
}>((set) => ({
  model: 'sonnet',
  permissionMode: 'plan',
  workingDir: '',
  setModel: (model) => set({ model }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  selectWorkingDir: async () => {
    const dir = await window.api.dialog.openDirectory()
    if (dir) set({ workingDir: dir })
  }
}))
```

- [ ] **Step 2: Create ModelSelector.tsx**

Simple dropdown with 3 options (Opus/Sonnet/Haiku), reads/writes sessionConfigStore.

- [ ] **Step 3: Create PermissionModeSelector.tsx**

Dropdown with 4 options (Manual/Plan/Auto-edit/Full-auto), reads/writes sessionConfigStore.

- [ ] **Step 4: Create WorkingDirSelector.tsx**

Displays current workingDir, button calls `sessionConfigStore.selectWorkingDir()`.

- [ ] **Step 5: Add selectors to Chat.tsx**

Insert the 3 selector components in a row above the message area in `Chat.tsx`.

- [ ] **Step 6: Update chatStore.sendMessage to use sessionConfigStore**

In `chatStore.ts` `sendMessage`, read model/permissionMode/workingDir from `useSessionConfigStore.getState()`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/sessionConfigStore.ts src/renderer/src/components/ModelSelector.tsx src/renderer/src/components/PermissionModeSelector.tsx src/renderer/src/components/WorkingDirSelector.tsx src/renderer/src/pages/Chat.tsx src/renderer/src/stores/chatStore.ts
git commit -m "feat: add model/permission/dir selectors with sessionConfigStore"
```

---

## Task 6: DB Schema Update + Conversation Search/Title

**Files:**
- Modify: `src/main/core/db.ts`
- Modify: `src/main/ipc/conversation.ts`
- Create: `src/renderer/src/components/ConversationSearch.tsx`
- Create: `src/renderer/src/components/ConversationDeleteConfirm.tsx`
- Modify: `src/renderer/src/components/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/stores/chatStore.ts`

- [ ] **Step 1: Add title_source to conversations table in db.ts**

Add column: `title_source TEXT NOT NULL DEFAULT 'auto'` to the conversations CREATE TABLE statement.

- [ ] **Step 2: Fix conversation:search SQL in conversation.ts**

Replace the existing search handler with the corrected SQL using `messages_fts` and `snippet(messages_fts, 0, ...)`.

- [ ] **Step 3: Add conversation:autoTitle and conversation:setTitle IPC handlers**

`autoTitle`: UPDATE title only WHERE title_source = 'auto'. `setTitle`: UPDATE title AND SET title_source = 'manual'.

- [ ] **Step 4: Add title_source to allowedFields in conversation:update**

Add `'title_source'` to the `allowedFields` Set in the update handler.

- [ ] **Step 5: Create ConversationSearch.tsx**

Debounce search input, call `window.api.conversation.search()`, display results with highlighted snippets.

- [ ] **Step 6: Create ConversationDeleteConfirm.tsx**

Simple confirm dialog before calling `window.api.conversation.delete()`.

- [ ] **Step 7: Update Sidebar.tsx**

Add ConversationSearch at top, wrap delete button with ConversationDeleteConfirm.

- [ ] **Step 8: Add auto-title logic to chatStore**

On `complete` event, extract first 50 chars of AI text, call `window.api.conversation.autoTitle()`.

- [ ] **Step 9: Commit**

```bash
git add src/main/core/db.ts src/main/ipc/conversation.ts src/renderer/src/components/ConversationSearch.tsx src/renderer/src/components/ConversationDeleteConfirm.tsx src/renderer/src/components/sidebar/Sidebar.tsx src/renderer/src/stores/chatStore.ts
git commit -m "feat: conversation search, auto-title with manual protection, delete confirm"
```

---

## Task 7: AI Status Visualization Stores + Components

**Files:**
- Create: `src/renderer/src/stores/usageStore.ts`
- Create: `src/renderer/src/stores/subagentStore.ts`
- Create: `src/renderer/src/stores/todoStore.ts`
- Create: `src/renderer/src/components/UsageBar.tsx`
- Create: `src/renderer/src/components/SubagentStatus.tsx`
- Create: `src/renderer/src/components/TodoList.tsx`
- Modify: `src/renderer/src/stores/chatStore.ts`
- Modify: `src/renderer/src/pages/Chat.tsx`

- [ ] **Step 1: Create usageStore.ts**

Zustand store that accumulates token usage per conversation from `complete` events. Displays inputTokens, outputTokens, costUsd.

- [ ] **Step 2: Create subagentStore.ts**

Zustand store tracking subagents by agentId. Updated by `subagent_started`, `subagent_stopped`, `subagent_completed` AIEvents.

- [ ] **Step 3: Create todoStore.ts**

Zustand store updated by `todo_updated` AIEvent. P0 degradation: if no events arrive, list stays empty.

- [ ] **Step 4: Create UsageBar.tsx**

Compact bar showing token counts and cost for current conversation.

- [ ] **Step 5: Create SubagentStatus.tsx**

Panel showing active/completed subagents with timing. Only visible when subagents exist.

- [ ] **Step 6: Create TodoList.tsx**

List of todo items with pending/in_progress/completed states.

- [ ] **Step 7: Route AIEvents to sub-stores in chatStore**

In `chatStore.handleAIEvent`, add cases:
- `complete` → `usageStore.updateFromComplete()`
- `subagent_started` → `subagentStore.onSubagentStarted()`
- `subagent_stopped` → `subagentStore.onSubagentStopped()`
- `subagent_completed` → `subagentStore.onSubagentCompleted()`
- `todo_updated` → `todoStore.onTodoUpdated()`

- [ ] **Step 8: Add components to Chat.tsx**

Add UsageBar at bottom of chat area, SubagentStatus above it, TodoList in sidebar.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/stores/usageStore.ts src/renderer/src/stores/subagentStore.ts src/renderer/src/stores/todoStore.ts src/renderer/src/components/UsageBar.tsx src/renderer/src/components/SubagentStatus.tsx src/renderer/src/components/TodoList.tsx src/renderer/src/stores/chatStore.ts src/renderer/src/pages/Chat.tsx
git commit -m "feat: AI status visualization — token usage, subagent tracking, todo list"
```

---

## Task 8: Integration Test + CLAUDE.md Update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Manual smoke test**

Run: `cd /Users/wangzhao/Documents/agentWorkSpace/catwork/bytro-app && pnpm dev`

Verify:
- App launches, sidebar shows
- New conversation creates, message sends
- AI response streams with tool calls visible
- Model/permission/dir selectors appear and change state
- Search input in sidebar works
- Usage bar shows after AI response
- Delete button shows confirmation

- [ ] **Step 2: Update CLAUDE.md architecture section**

Update the AI Engine section to reflect ClaudeCLIProvider, dual-mode process, EventParser. Update the file structure diagram.

- [ ] **Step 3: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for P0 implementation"
```
