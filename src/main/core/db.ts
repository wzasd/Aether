import { createRequire } from 'node:module'
import { app } from 'electron'
import { join } from 'path'
import type Database from 'better-sqlite3'

const require = createRequire(import.meta.url)
const BetterSqlite3 = require('better-sqlite3')

let db: Database.Database

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'bytro.db')
  db = new BetterSqlite3(dbPath) as Database.Database

  // Performance optimizations
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  createTables()
}

export function getDb(): Database.Database {
  return db
}

function createTables(): void {
  db.exec(`
    -- Workspaces
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      repo_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Conversations
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT,
      title_source TEXT NOT NULL DEFAULT 'auto',
      model TEXT,
      provider TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_conv_workspace ON conversations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT,
      thinking TEXT,
      tool_calls TEXT,
      tool_results TEXT,
      usage TEXT,
      parent_tool_use_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);

    -- FTS5 full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;

    -- OAuth Tokens
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      provider TEXT PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER
    );

    -- Token Usage
    CREATE TABLE IF NOT EXISTS conversation_usage (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_usage_conv ON conversation_usage(conversation_id);

    -- Todos
    CREATE TABLE IF NOT EXISTS conversation_todos (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      order_index INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Custom Commands
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt TEXT NOT NULL,
      icon TEXT,
      shortcut TEXT,
      category TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- MCP Servers
    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      args TEXT DEFAULT '[]',
      env TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1
    );

    -- User Preferences
    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

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

    -- Schema Version
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
    INSERT OR IGNORE INTO schema_version (version) VALUES (2);
  `)

  // Add title_source column if it doesn't exist (migration for existing DBs)
  try {
    db.exec("ALTER TABLE conversations ADD COLUMN title_source TEXT NOT NULL DEFAULT 'auto'")
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: v1 → v2 (memory system tables)
  try {
    const version = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
    if (version && version.version < 2) {
      db.prepare('UPDATE schema_version SET version = 2').run()
    }
  } catch {
    // Safe to ignore
  }
}
