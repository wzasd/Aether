---
status: completed
owner: bytro
last_verified: 2026-05-01
doc_kind: plan
completed_at: 2026-05-01
completion_summary: "Historical memory-system implementation plan. Core durable memory files, SQLite read models, IPC, renderer store, memory context injection, agent session tracking, summaries, and candidate review UI are present in code."
---

# Bytro 记忆系统实现计划

> Status: Completed / historical. Current memory architecture lives in `docs/architecture/memory-system.md`; current product requirements live in `docs/specs/2026-04-30-functional-requirements.md` Module C.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现两层记忆体系（Project Memory + Agent Memory）+ Conversation Summary + AgentSession 追踪 + MemoryCandidate 防污染流程 + recall 检索接口

**Architecture:** 文件层（.bytro/ 目录）作为真相源，SQLite 作为编译产物和结构化数据，candidate 流程防止 agent 直接污染长期记忆。启动时自动组装上下文注入 agent。

**Tech Stack:** Electron main process (Node.js fs), SQLite (better-sqlite3), Zustand (renderer stores), IPC (ipcMain/ipcRenderer)

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/core/memory-fs.ts` | .bytro/ 目录读写：project-memory.md、agent memory 文件、markers |
| `src/main/core/memory-index.ts` | SQLite 记忆表 CRUD：candidates、project_memory_items、conversation_summaries、agent_sessions、agent_profiles |
| `src/main/ipc/memory.ts` | 记忆相关 IPC handlers：recall、candidate 提交/确认、summary 读写 |
| `src/renderer/src/stores/memoryStore.ts` | Renderer 记忆状态：candidates 列表、recall 结果 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/main/core/db.ts` | 新增 6 张表 + FTS + 索引 |
| `src/main/ipc/index.ts` | 注册 memory IPC |
| `src/preload/index.ts` | 新增 memory namespace |
| `src/renderer/src/types/global.d.ts` | 新增 memory 类型声明 |
| `src/renderer/src/stores/chatStore.ts` | sendMessage 前注入记忆上下文；done/complete 时记录 agent_session、生成 summary |

---

## Task 1: DB Schema — 新增记忆表

**Files:**
- Modify: `src/main/core/db.ts:27-147`

- [ ] **Step 1: 在 createTables() 的 db.exec() 末尾、schema_version 之前，追加 6 张表**

在 `INSERT OR IGNORE INTO schema_version (version) VALUES (1);` 之前追加：

```sql
-- Agent Sessions (runtime session chain)
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_session_id TEXT,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_sess_conv ON agent_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_sess_agent ON agent_sessions(agent_id, conversation_id);

-- Agent Profiles (memory read model / cache)
CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source_path TEXT,
  source_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profile_uniq ON agent_profiles(workspace_id, agent_id);

-- Memory Candidates (待沉淀知识)
CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_conversation_id TEXT,
  source_message_id TEXT,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mem_cand_ws ON memory_candidates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_mem_cand_status ON memory_candidates(status);

-- Project Memory Items (物化后的 read model)
CREATE TABLE IF NOT EXISTS project_memory_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  source_path TEXT,
  source_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_proj_mem_ws ON project_memory_items(workspace_id);

-- Conversation Summaries
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  completed_items TEXT,
  pending_items TEXT,
  changed_files TEXT,
  risks TEXT,
  next_steps TEXT,
  from_message_id TEXT,
  to_message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_conv_sum_conv ON conversation_summaries(conversation_id);

-- Summary Segments (append-only ledger)
CREATE TABLE IF NOT EXISTS summary_segments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  segment_type TEXT NOT NULL,
  content TEXT NOT NULL,
  message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sum_seg_conv ON summary_segments(conversation_id);

-- Memory FTS
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title,
  content,
  kind,
  content='project_memory_items',
  content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS proj_mem_ai AFTER INSERT ON project_memory_items BEGIN
  INSERT INTO memory_fts(rowid, title, content, kind) VALUES (new.rowid, new.title, new.content, new.kind);
END;
CREATE TRIGGER IF NOT EXISTS proj_mem_ad AFTER DELETE ON project_memory_items BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, content, kind) VALUES ('delete', old.rowid, old.title, old.content, old.kind);
END;
```

- [ ] **Step 2: 更新 schema_version**

将 `INSERT OR IGNORE INTO schema_version (version) VALUES (1);` 改为 `VALUES (2)`，并添加迁移逻辑：

```ts
// Migration: v1 → v2 (memory system tables)
try {
  const version = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
  if (version && version.version < 2) {
    // Tables are created with IF NOT EXISTS, so just bump version
    db.prepare('UPDATE schema_version SET version = 2').run()
  }
} catch {
  // Safe to ignore
}
```

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功，无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/main/core/db.ts
git commit -m "feat: add memory system DB tables (agent_sessions, agent_profiles, memory_candidates, project_memory_items, conversation_summaries, summary_segments, memory_fts)"
```

---

## Task 2: Memory FS — .bytro/ 目录读写

**Files:**
- Create: `src/main/core/memory-fs.ts`

- [ ] **Step 1: 实现 memory-fs.ts**

```ts
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises'
import { join } from 'path'

const BYTRO_DIR = '.bytro'

function bytroDir(workspacePath: string): string {
  return join(workspacePath, BYTRO_DIR)
}

function agentsDir(workspacePath: string): string {
  return join(bytroDir(workspacePath), 'agents')
}

function markersDir(workspacePath: string): string {
  return join(bytroDir(workspacePath), 'markers')
}

export async function ensureBytroDir(workspacePath: string): Promise<void> {
  await mkdir(bytroDir(workspacePath), { recursive: true })
  await mkdir(agentsDir(workspacePath), { recursive: true })
  await mkdir(markersDir(workspacePath), { recursive: true })
}

export async function readProjectMemory(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(join(bytroDir(workspacePath), 'project-memory.md'), 'utf-8')
  } catch {
    return null
  }
}

export async function writeProjectMemory(workspacePath: string, content: string): Promise<void> {
  await ensureBytroDir(workspacePath)
  await writeFile(join(bytroDir(workspacePath), 'project-memory.md'), content, 'utf-8')
}

export async function appendProjectMemory(workspacePath: string, section: string, entry: string): Promise<void> {
  const existing = await readProjectMemory(workspacePath) || ''
  const hasSection = existing.includes(`## ${section}`)
  const updated = hasSection
    ? existing.replace(`## ${section}`, `## ${section}\n${entry}`)
    : `${existing}\n\n## ${section}\n${entry}\n`
  await writeProjectMemory(workspacePath, updated.trim() + '\n')
}

export async function readAgentMemory(workspacePath: string, agentId: string): Promise<string | null> {
  try {
    return await readFile(join(agentsDir(workspacePath), `${agentId}.md`), 'utf-8')
  } catch {
    return null
  }
}

export async function writeAgentMemory(workspacePath: string, agentId: string, content: string): Promise<void> {
  await ensureBytroDir(workspacePath)
  await writeFile(join(agentsDir(workspacePath), `${agentId}.md`), content, 'utf-8')
}

export async function listMarkers(workspacePath: string): Promise<string[]> {
  try {
    const files = await readdir(markersDir(workspacePath))
    return files.filter((f) => f.endsWith('.yaml'))
  } catch {
    return []
  }
}

export async function readMarker(workspacePath: string, filename: string): Promise<string | null> {
  try {
    return await readFile(join(markersDir(workspacePath), filename), 'utf-8')
  } catch {
    return null
  }
}

export async function writeMarker(workspacePath: string, filename: string, content: string): Promise<void> {
  await ensureBytroDir(workspacePath)
  await writeFile(join(markersDir(workspacePath), filename), content, 'utf-8')
}

export async function computeFileHash(filePath: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
```

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/main/core/memory-fs.ts
git commit -m "feat: add memory-fs module for .bytro/ directory read/write"
```

---

## Task 3: Memory Index — SQLite CRUD

**Files:**
- Create: `src/main/core/memory-index.ts`

- [ ] **Step 1: 实现 memory-index.ts**

```ts
import { getDb } from './db'
import { randomUUID } from 'crypto'

// ─── Agent Sessions ───

export function createAgentSession(data: {
  workspaceId: string
  conversationId: string
  agentId: string
  provider: string
  externalSessionId?: string
  seq: number
  status: string
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO agent_sessions (id, workspace_id, conversation_id, agent_id, provider, external_session_id, seq, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.workspaceId, data.conversationId, data.agentId, data.provider, data.externalSessionId ?? null, data.seq, data.status, now)
  return id
}

export function endAgentSession(id: string): void {
  const db = getDb()
  db.prepare('UPDATE agent_sessions SET status = ?, ended_at = ? WHERE id = ?').run('ended', Math.floor(Date.now() / 1000), id)
}

export function getAgentSessions(conversationId: string): any[] {
  const db = getDb()
  return db.prepare('SELECT * FROM agent_sessions WHERE conversation_id = ? ORDER BY seq ASC').all(conversationId)
}

// ─── Agent Profiles ───

export function upsertAgentProfile(data: {
  workspaceId: string | null
  agentId: string
  content: string
  sourcePath?: string
  sourceHash?: string
}): void {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)
  const existing = db.prepare('SELECT id FROM agent_profiles WHERE workspace_id IS ? AND agent_id = ?').get(data.workspaceId ?? null, data.agentId) as { id: string } | undefined
  if (existing) {
    db.prepare('UPDATE agent_profiles SET content = ?, source_path = ?, source_hash = ?, updated_at = ? WHERE id = ?')
      .run(data.content, data.sourcePath ?? null, data.sourceHash ?? null, now, existing.id)
  } else {
    const id = randomUUID()
    db.prepare('INSERT INTO agent_profiles (id, workspace_id, agent_id, content, source_path, source_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, data.workspaceId ?? null, data.agentId, data.content, data.sourcePath ?? null, data.sourceHash ?? null, now, now)
  }
}

export function getAgentProfile(workspaceId: string | null, agentId: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM agent_profiles WHERE workspace_id IS ? AND agent_id = ?').get(workspaceId ?? null, agentId)
}

// ─── Memory Candidates ───

export function createMemoryCandidate(data: {
  workspaceId: string
  kind: string
  title: string
  content: string
  sourceConversationId?: string
  sourceMessageId?: string
  confidence: string
  status: string
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO memory_candidates (id, workspace_id, kind, title, content, source_conversation_id, source_message_id, confidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.workspaceId, data.kind, data.title, data.content, data.sourceConversationId ?? null, data.sourceMessageId ?? null, data.confidence, data.status, now, now)
  return id
}

export function updateCandidateStatus(id: string, status: string): void {
  const db = getDb()
  db.prepare('UPDATE memory_candidates SET status = ?, updated_at = ? WHERE id = ?').run(status, Math.floor(Date.now() / 1000), id)
}

export function getCandidatesByStatus(workspaceId: string, status: string): any[] {
  const db = getDb()
  return db.prepare('SELECT * FROM memory_candidates WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC').all(workspaceId, status)
}

// ─── Project Memory Items ───

export function createProjectMemoryItem(data: {
  workspaceId: string
  kind: string
  title: string
  content: string
  status: string
  sourcePath?: string
  sourceHash?: string
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO project_memory_items (id, workspace_id, kind, title, content, status, source_path, source_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.workspaceId, data.kind, data.title, data.content, data.status, data.sourcePath ?? null, data.sourceHash ?? null, now, now)
  return id
}

export function getProjectMemoryItems(workspaceId: string, kind?: string): any[] {
  const db = getDb()
  if (kind) {
    return db.prepare('SELECT * FROM project_memory_items WHERE workspace_id = ? AND kind = ? ORDER BY created_at DESC').all(workspaceId, kind)
  }
  return db.prepare('SELECT * FROM project_memory_items WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId)
}

// ─── Conversation Summaries ───

export function createConversationSummary(data: {
  conversationId: string
  summary: string
  completedItems?: string[]
  pendingItems?: string[]
  changedFiles?: string[]
  risks?: string[]
  nextSteps?: string[]
  fromMessageId?: string
  toMessageId?: string
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO conversation_summaries (id, conversation_id, summary, completed_items, pending_items, changed_files, risks, next_steps, from_message_id, to_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, data.conversationId, data.summary, JSON.stringify(data.completedItems || []), JSON.stringify(data.pendingItems || []), JSON.stringify(data.changedFiles || []), JSON.stringify(data.risks || []), JSON.stringify(data.nextSteps || []), data.fromMessageId ?? null, data.toMessageId ?? null, now)
  return id
}

export function getLatestSummary(conversationId: string): any | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conversationId)
}

// ─── Summary Segments ───

export function appendSummarySegment(data: {
  conversationId: string
  segmentType: string
  content: string
  messageId?: string
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO summary_segments (id, conversation_id, segment_type, content, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, data.conversationId, data.segmentType, data.content, data.messageId ?? null, now)
  return id
}

// ─── Recall (FTS search) ───

export function recallMemory(query: string, workspaceId: string, limit: number = 10): any[] {
  const db = getDb()
  return db.prepare(`
    SELECT pmi.*, bm25(memory_fts) as rank
    FROM memory_fts
    JOIN project_memory_items pmi ON pmi.rowid = memory_fts.rowid
    WHERE memory_fts MATCH ? AND pmi.workspace_id = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, workspaceId, limit)
}
```

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/main/core/memory-index.ts
git commit -m "feat: add memory-index module for SQLite memory CRUD and FTS recall"
```

---

## Task 4: Memory IPC Handlers

**Files:**
- Create: `src/main/ipc/memory.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/global.d.ts`

- [ ] **Step 1: 实现 memory IPC handlers**

```ts
// src/main/ipc/memory.ts
import { ipcMain } from 'electron'
import * as memIdx from '../core/memory-index'
import * as memFs from '../core/memory-fs'

export function registerMemoryIpc(): void {
  // Recall: FTS search
  ipcMain.handle('memory:recall', (_event, query: string, workspaceId: string, limit?: number) => {
    return memIdx.recallMemory(query, workspaceId, limit || 10)
  })

  // Project memory: read from file
  ipcMain.handle('memory:readProjectMemory', (_event, workspacePath: string) => {
    return memFs.readProjectMemory(workspacePath)
  })

  // Project memory: write to file
  ipcMain.handle('memory:writeProjectMemory', (_event, workspacePath: string, content: string) => {
    return memFs.writeProjectMemory(workspacePath, content)
  })

  // Project memory: append entry to section
  ipcMain.handle('memory:appendProjectMemory', (_event, workspacePath: string, section: string, entry: string) => {
    return memFs.appendProjectMemory(workspacePath, section, entry)
  })

  // Agent memory: read from file
  ipcMain.handle('memory:readAgentMemory', (_event, workspacePath: string, agentId: string) => {
    return memFs.readAgentMemory(workspacePath, agentId)
  })

  // Agent memory: write to file
  ipcMain.handle('memory:writeAgentMemory', (_event, workspacePath: string, agentId: string, content: string) => {
    return memFs.writeAgentMemory(workspacePath, agentId, content)
  })

  // Candidate: create
  ipcMain.handle('memory:createCandidate', (_event, data: { workspaceId: string; kind: string; title: string; content: string; sourceConversationId?: string; sourceMessageId?: string; confidence: string }) => {
    const id = memIdx.createMemoryCandidate({ ...data, status: 'captured' })
    return { id }
  })

  // Candidate: update status
  ipcMain.handle('memory:updateCandidateStatus', (_event, id: string, status: string) => {
    memIdx.updateCandidateStatus(id, status)
    return { success: true }
  })

  // Candidate: list by status
  ipcMain.handle('memory:listCandidates', (_event, workspaceId: string, status: string) => {
    return memIdx.getCandidatesByStatus(workspaceId, status)
  })

  // Project memory items: list
  ipcMain.handle('memory:listProjectItems', (_event, workspaceId: string, kind?: string) => {
    return memIdx.getProjectMemoryItems(workspaceId, kind)
  })

  // Project memory items: create (after candidate approved)
  ipcMain.handle('memory:createProjectItem', (_event, data: { workspaceId: string; kind: string; title: string; content: string; sourcePath?: string; sourceHash?: string }) => {
    const id = memIdx.createProjectMemoryItem({ ...data, status: 'active' })
    return { id }
  })

  // Agent session: create
  ipcMain.handle('memory:createAgentSession', (_event, data: { workspaceId: string; conversationId: string; agentId: string; provider: string; externalSessionId?: string; seq: number; status: string }) => {
    const id = memIdx.createAgentSession(data)
    return { id }
  })

  // Agent session: end
  ipcMain.handle('memory:endAgentSession', (_event, id: string) => {
    memIdx.endAgentSession(id)
    return { success: true }
  })

  // Agent session: list by conversation
  ipcMain.handle('memory:listAgentSessions', (_event, conversationId: string) => {
    return memIdx.getAgentSessions(conversationId)
  })

  // Conversation summary: get latest
  ipcMain.handle('memory:getLatestSummary', (_event, conversationId: string) => {
    return memIdx.getLatestSummary(conversationId)
  })

  // Conversation summary: create
  ipcMain.handle('memory:createSummary', (_event, data: { conversationId: string; summary: string; completedItems?: string[]; pendingItems?: string[]; changedFiles?: string[]; risks?: string[]; nextSteps?: string[]; fromMessageId?: string; toMessageId?: string }) => {
    const id = memIdx.createConversationSummary(data)
    return { id }
  })

  // Summary segment: append
  ipcMain.handle('memory:appendSegment', (_event, data: { conversationId: string; segmentType: string; content: string; messageId?: string }) => {
    const id = memIdx.appendSummarySegment(data)
    return { id }
  })

  // Agent profile: upsert
  ipcMain.handle('memory:upsertAgentProfile', (_event, data: { workspaceId: string | null; agentId: string; content: string; sourcePath?: string; sourceHash?: string }) => {
    memIdx.upsertAgentProfile(data)
    return { success: true }
  })

  // Agent profile: get
  ipcMain.handle('memory:getAgentProfile', (_event, workspaceId: string | null, agentId: string) => {
    return memIdx.getAgentProfile(workspaceId, agentId)
  })
}
```

- [ ] **Step 2: 注册到 index.ts**

在 `src/main/ipc/index.ts` 中添加 import 和调用：

```ts
import { registerMemoryIpc } from './memory'
// 在 registerIpcHandlers() 中添加：
registerMemoryIpc()
```

- [ ] **Step 3: 添加 preload API**

在 `src/preload/index.ts` 的 `api` 对象中新增 `memory` namespace：

```ts
memory: {
  recall: (query: string, workspaceId: string, limit?: number): Promise<any[]> =>
    ipcRenderer.invoke('memory:recall', query, workspaceId, limit),
  readProjectMemory: (workspacePath: string): Promise<string | null> =>
    ipcRenderer.invoke('memory:readProjectMemory', workspacePath),
  writeProjectMemory: (workspacePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('memory:writeProjectMemory', workspacePath, content),
  appendProjectMemory: (workspacePath: string, section: string, entry: string): Promise<void> =>
    ipcRenderer.invoke('memory:appendProjectMemory', workspacePath, section, entry),
  readAgentMemory: (workspacePath: string, agentId: string): Promise<string | null> =>
    ipcRenderer.invoke('memory:readAgentMemory', workspacePath, agentId),
  writeAgentMemory: (workspacePath: string, agentId: string, content: string): Promise<void> =>
    ipcRenderer.invoke('memory:writeAgentMemory', workspacePath, agentId, content),
  createCandidate: (data: { workspaceId: string; kind: string; title: string; content: string; sourceConversationId?: string; sourceMessageId?: string; confidence: string }): Promise<{ id: string }> =>
    ipcRenderer.invoke('memory:createCandidate', data),
  updateCandidateStatus: (id: string, status: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('memory:updateCandidateStatus', id, status),
  listCandidates: (workspaceId: string, status: string): Promise<any[]> =>
    ipcRenderer.invoke('memory:listCandidates', workspaceId, status),
  listProjectItems: (workspaceId: string, kind?: string): Promise<any[]> =>
    ipcRenderer.invoke('memory:listProjectItems', workspaceId, kind),
  createProjectItem: (data: { workspaceId: string; kind: string; title: string; content: string; sourcePath?: string; sourceHash?: string }): Promise<{ id: string }> =>
    ipcRenderer.invoke('memory:createProjectItem', data),
  createAgentSession: (data: { workspaceId: string; conversationId: string; agentId: string; provider: string; externalSessionId?: string; seq: number; status: string }): Promise<{ id: string }> =>
    ipcRenderer.invoke('memory:createAgentSession', data),
  endAgentSession: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('memory:endAgentSession', id),
  listAgentSessions: (conversationId: string): Promise<any[]> =>
    ipcRenderer.invoke('memory:listAgentSessions', conversationId),
  getLatestSummary: (conversationId: string): Promise<any | null> =>
    ipcRenderer.invoke('memory:getLatestSummary', conversationId),
  createSummary: (data: { conversationId: string; summary: string; completedItems?: string[]; pendingItems?: string[]; changedFiles?: string[]; risks?: string[]; nextSteps?: string[]; fromMessageId?: string; toMessageId?: string }): Promise<{ id: string }> =>
    ipcRenderer.invoke('memory:createSummary', data),
  appendSegment: (data: { conversationId: string; segmentType: string; content: string; messageId?: string }): Promise<{ id: string }> =>
    ipcRenderer.invoke('memory:appendSegment', data),
  upsertAgentProfile: (data: { workspaceId: string | null; agentId: string; content: string; sourcePath?: string; sourceHash?: string }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('memory:upsertAgentProfile', data),
  getAgentProfile: (workspaceId: string | null, agentId: string): Promise<any | null> =>
    ipcRenderer.invoke('memory:getAgentProfile', workspaceId, agentId)
}
```

- [ ] **Step 4: 添加类型声明**

在 `src/renderer/src/types/global.d.ts` 的 `ElectronAPI` 接口中新增 `memory` namespace，与 preload API 签名一致。

- [ ] **Step 5: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/memory.ts src/main/ipc/index.ts src/preload/index.ts src/renderer/src/types/global.d.ts
git commit -m "feat: add memory IPC handlers, preload API, and type declarations"
```

---

## Task 5: Renderer memoryStore

**Files:**
- Create: `src/renderer/src/stores/memoryStore.ts`

- [ ] **Step 1: 实现 memoryStore**

```ts
import { create } from 'zustand'

interface MemoryCandidate {
  id: string
  kind: string
  title: string
  content: string
  confidence: string
  status: string
}

interface MemoryState {
  candidates: MemoryCandidate[]
  projectMemoryText: string | null
  agentMemoryText: string | null
  latestSummary: any | null
  recallResults: any[]
}

export const useMemoryStore = create<MemoryState & {
  loadCandidates: (workspaceId: string, status: string) => Promise<void>
  loadProjectMemory: (workspacePath: string) => Promise<void>
  loadAgentMemory: (workspacePath: string, agentId: string) => Promise<void>
  loadLatestSummary: (conversationId: string) => Promise<void>
  recall: (query: string, workspaceId: string, limit?: number) => Promise<void>
  submitCandidate: (data: { workspaceId: string; kind: string; title: string; content: string; confidence: string }) => Promise<string | null>
  approveCandidate: (id: string) => Promise<void>
  rejectCandidate: (id: string) => Promise<void>
}>((set, get) => ({
  candidates: [],
  projectMemoryText: null,
  agentMemoryText: null,
  latestSummary: null,
  recallResults: [],

  loadCandidates: async (workspaceId, status) => {
    const candidates = await window.api.memory.listCandidates(workspaceId, status)
    set({ candidates })
  },

  loadProjectMemory: async (workspacePath) => {
    const text = await window.api.memory.readProjectMemory(workspacePath)
    set({ projectMemoryText: text })
  },

  loadAgentMemory: async (workspacePath, agentId) => {
    const text = await window.api.memory.readAgentMemory(workspacePath, agentId)
    set({ agentMemoryText: text })
  },

  loadLatestSummary: async (conversationId) => {
    const summary = await window.api.memory.getLatestSummary(conversationId)
    set({ latestSummary: summary })
  },

  recall: async (query, workspaceId, limit) => {
    const results = await window.api.memory.recall(query, workspaceId, limit)
    set({ recallResults: results })
  },

  submitCandidate: async (data) => {
    try {
      const { id } = await window.api.memory.createCandidate(data)
      set((state) => ({
        candidates: [...state.candidates, { ...data, id, status: 'captured' }]
      }))
      return id
    } catch {
      return null
    }
  },

  approveCandidate: async (id) => {
    await window.api.memory.updateCandidateStatus(id, 'approved')
    set((state) => ({
      candidates: state.candidates.map((c) => c.id === id ? { ...c, status: 'approved' } : c)
    }))
  },

  rejectCandidate: async (id) => {
    await window.api.memory.updateCandidateStatus(id, 'rejected')
    set((state) => ({
      candidates: state.candidates.map((c) => c.id === id ? { ...c, status: 'rejected' } : c)
    }))
  }
}))
```

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/memoryStore.ts
git commit -m "feat: add memoryStore for renderer-side memory state management"
```

---

## Task 6: chatStore 集成 — AgentSession 追踪 + 上下文注入

**Files:**
- Modify: `src/renderer/src/stores/chatStore.ts`

- [ ] **Step 1: 在 sendMessage 中记录 agent session**

在 `sendMessage` 函数中，`await window.api.chat.sendMessage(sessionId, content)` 之后，添加 agent session 记录：

```ts
// Record agent session
const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId
if (currentWorkspaceId) {
  const existingSessions = await window.api.memory.listAgentSessions(conversationId)
  const seq = existingSessions.length
  window.api.memory.createAgentSession({
    workspaceId: currentWorkspaceId,
    conversationId,
    agentId: 'claude-code',
    provider: 'claude-cli',
    externalSessionId: sessionId,
    seq,
    status: 'running'
  }).catch(() => {})
}
```

- [ ] **Step 2: 在 done 事件中结束 agent session**

在 `handleAIEvent` 的 `done` case 中，清理流式状态之前，添加：

```ts
// End agent session
if (doneId) {
  window.api.memory.endAgentSession(doneId).catch(() => {})
}
```

- [ ] **Step 3: 在 sendMessage 中注入记忆上下文**

在 `sendMessage` 中，发送消息前，加载并拼接记忆上下文到用户消息前面：

```ts
// Assemble memory context
const workspacePath = useWorkspaceStore.getState().workspaces.find(
  (w) => w.id === useWorkspaceStore.getState().currentWorkspaceId
)?.repo_path

let memoryPrefix = ''
if (workspacePath) {
  const projectMemory = await window.api.memory.readProjectMemory(workspacePath)
  if (projectMemory) {
    memoryPrefix += `<project-memory>\n${projectMemory}\n</project-memory>\n\n`
  }
  const agentMemory = await window.api.memory.readAgentMemory(workspacePath, 'claude-code')
  if (agentMemory) {
    memoryPrefix += `<agent-memory>\n${agentMemory}\n</agent-memory>\n\n`
  }
}
const latestSummary = await window.api.memory.getLatestSummary(conversationId)
if (latestSummary) {
  memoryPrefix += `<conversation-summary>\n${latestSummary.summary}\nPending: ${latestSummary.pending_items}\nRisks: ${latestSummary.risks}\n</conversation-summary>\n\n`
}

const effectiveContent = memoryPrefix ? `${memoryPrefix}${content}` : content
```

然后将 `sendMessage` 中使用 `content` 发送的地方改为使用 `effectiveContent`。

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/chatStore.ts
git commit -m "feat: integrate memory system into chatStore — agent session tracking + context injection"
```

---

## Task 7: Conversation Summary 自动生成

**Files:**
- Modify: `src/renderer/src/stores/chatStore.ts`

- [ ] **Step 1: 在 complete 事件中生成摘要**

在 `handleAIEvent` 的 `complete` case 中，保存 AI 消息之后，添加摘要生成逻辑：

```ts
// Auto-generate conversation summary on complete
if (conversationId && fullText) {
  const messageCount = state.messages.length + 1 // +1 for the current message being saved
  // Generate summary every 10 messages or on task completion signals
  if (messageCount % 10 === 0 || fullText.includes('完成') || fullText.includes('done')) {
    const recentMessages = state.messages.slice(-10)
    const summaryText = recentMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role}: ${(m.content || '').slice(0, 200)}`)
      .join('\n')

    window.api.memory.createSummary({
      conversationId,
      summary: summaryText.slice(0, 2000),
      pendingItems: [],
      changedFiles: [],
      risks: [],
      nextSteps: [],
      fromMessageId: recentMessages[0]?.id || undefined,
      toMessageId: undefined
    }).catch(() => {})
  }
}
```

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/chatStore.ts
git commit -m "feat: auto-generate conversation summaries on complete events"
```

---

## Task 8: Memory Candidates UI — 侧边栏候选记忆审核

**Files:**
- Modify: `src/renderer/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: 在侧边栏底部添加候选记忆审核入口**

在 Sidebar.tsx 中，TodoList 下方添加候选记忆列表：

```tsx
{/* Memory Candidates */}
{memoryCandidates.length > 0 && (
  <div className="px-3 py-2 border-t border-border">
    <div className="text-xs font-medium text-muted-foreground mb-1.5">待确认记忆</div>
    {memoryCandidates.slice(0, 3).map((c) => (
      <div key={c.id} className="bg-zinc-900 border border-zinc-700 rounded p-2 mb-1.5 text-xs">
        <div className="text-zinc-300 font-medium truncate">{c.title}</div>
        <div className="text-zinc-500 truncate">{c.content.slice(0, 80)}</div>
        <div className="flex gap-1 mt-1.5">
          <button
            onClick={() => useMemoryStore.getState().approveCandidate(c.id)}
            className="px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-500"
          >
            确认
          </button>
          <button
            onClick={() => useMemoryStore.getState().rejectCandidate(c.id)}
            className="px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600"
          >
            拒绝
          </button>
        </div>
      </div>
    ))}
  </div>
)}
```

添加对应的 store 订阅：

```ts
const memoryCandidates = useMemoryStore((s) => s.candidates)
```

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/sidebar/Sidebar.tsx
git commit -m "feat: add memory candidates review UI in sidebar"
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 启动应用**

Run: `pnpm dev`

- [ ] **Step 2: 验证 DB 表创建**

打开应用后，检查 `{userData}/bytro.db` 中是否存在新增的 6 张表。

- [ ] **Step 3: 验证 .bytro/ 目录**

选择一个 workspace 后，检查 workspace 目录下是否自动创建了 `.bytro/` 目录结构。

- [ ] **Step 4: 验证记忆注入**

发送消息时，检查 CLI 进程是否收到了 project-memory 和 agent-memory 上下文。

- [ ] **Step 5: 验证 agent session 记录**

发送消息后，检查 `agent_sessions` 表中是否有新记录。

- [ ] **Step 6: 验证 conversation summary**

连续发送 10+ 条消息后，检查 `conversation_summaries` 表中是否有摘要记录。

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete Bytro memory system P0 implementation"
```
