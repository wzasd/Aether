import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { join } from 'path'
import type Database from 'better-sqlite3'
import {
  PRESET_PROFILE_SEEDS,
  DEV_TEAM_ID,
  DEV_TEAM_NAME,
  DEV_TEAM_DESCRIPTION,
  DEV_TEAM_MEMBERS,
  DEV_TEAM_POLICIES
} from '../ai/preset-seed-data'

const require = createRequire(import.meta.url)
const BetterSqlite3 = require('better-sqlite3')

const SCHEMA_VERSION = 26

let db: Database.Database

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'bytro.db')
  db = new BetterSqlite3(dbPath) as Database.Database

  // Performance optimizations
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  createTables()
  purgeExpiredConversations()
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database has not been initialized')
  }
  return db
}

export function closeDatabase(): void {
  if (db?.open) {
    db.close()
  }
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
      status TEXT NOT NULL DEFAULT 'Idle',
      mode TEXT DEFAULT 'build',
      agent_count INTEGER NOT NULL DEFAULT 0,
      change_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_conv_workspace ON conversations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

    -- File Changes (Module B)
    CREATE TABLE IF NOT EXISTS file_changes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id TEXT,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      diff_text TEXT,
      tool_call_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_file_changes_conv ON file_changes(conversation_id);

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

    -- MCP Servers (created via schema migration v12)

    -- User Preferences
    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Tasks
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'Idle',
      mode TEXT DEFAULT 'build',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    -- Task Agents
    CREATE TABLE IF NOT EXISTS task_agents (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_profile_id TEXT NOT NULL,
      provider_session_id TEXT,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_task_agents_task ON task_agents(task_id);

    -- Task Events (append-only lifecycle log)
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);

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

    -- Agent Profile Cache (memory read model)
    CREATE TABLE IF NOT EXISTS agent_profile_cache (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source_path TEXT,
      source_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profile_cache_uniq ON agent_profile_cache(workspace_id, agent_id);

    -- Agent Profile Configs (user-configurable profiles)
    CREATE TABLE IF NOT EXISTS agent_profile_configs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'coder',
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      description TEXT,
      system_prompt TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_profile_configs_ws ON agent_profile_configs(workspace_id);

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

    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_summaries_fts USING fts5(
      summary,
      completed_items,
      pending_items,
      changed_files,
      risks,
      next_steps,
      content='conversation_summaries',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS conv_sum_ai AFTER INSERT ON conversation_summaries BEGIN
      INSERT INTO conversation_summaries_fts(rowid, summary, completed_items, pending_items, changed_files, risks, next_steps)
      VALUES (new.rowid, new.summary, new.completed_items, new.pending_items, new.changed_files, new.risks, new.next_steps);
    END;
    CREATE TRIGGER IF NOT EXISTS conv_sum_ad AFTER DELETE ON conversation_summaries BEGIN
      INSERT INTO conversation_summaries_fts(conversation_summaries_fts, rowid, summary, completed_items, pending_items, changed_files, risks, next_steps)
      VALUES ('delete', old.rowid, old.summary, old.completed_items, old.pending_items, old.changed_files, old.risks, old.next_steps);
    END;

    -- A2A Tasks (agent-to-agent delegation)
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_profile_id TEXT,
      to_profile_id TEXT NOT NULL,
      message TEXT NOT NULL,
      context_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      depth INTEGER NOT NULL DEFAULT 0,
      chain TEXT NOT NULL DEFAULT '[]',
      execution_mode TEXT NOT NULL DEFAULT 'serial',
      source TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_conv ON a2a_tasks(conversation_id);

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
    CREATE TRIGGER IF NOT EXISTS proj_mem_au AFTER UPDATE ON project_memory_items BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, title, content, kind) VALUES ('delete', old.rowid, old.title, old.content, old.kind);
      INSERT INTO memory_fts(rowid, title, content, kind) VALUES (new.rowid, new.title, new.content, new.kind);
    END;

    -- Secrets (encrypted API keys)
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL UNIQUE,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Provider Configs (non-sensitive)
    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      binary_path TEXT,
      extra_env TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Schema Version
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `)

  applyMigrations()
}

function applyMigrations(): void {
  const version = getSchemaVersion()

  if (version < 2) {
    addMissingColumn('workspaces', 'repo_path', 'TEXT')
    addMissingColumn('conversations', 'title_source', "TEXT NOT NULL DEFAULT 'auto'")
    addMissingColumn('conversations', 'model', 'TEXT')
    addMissingColumn('conversations', 'provider', 'TEXT')
    addMissingColumn('messages', 'thinking', 'TEXT')
    addMissingColumn('messages', 'tool_calls', 'TEXT')
    addMissingColumn('messages', 'tool_results', 'TEXT')
    addMissingColumn('messages', 'usage', 'TEXT')
    addMissingColumn('messages', 'parent_tool_use_id', 'TEXT')
  }

  if (version < 3) {
    addMissingColumn('task_agents', 'provider_session_id', 'TEXT')
  }

  if (version < 4) {
    addMissingColumn('conversations', 'status', "TEXT NOT NULL DEFAULT 'Idle'")
    addMissingColumn('conversations', 'mode', "TEXT DEFAULT 'build'")
    addMissingColumn('conversations', 'agent_count', 'INTEGER NOT NULL DEFAULT 0')
    addMissingColumn('conversations', 'change_count', 'INTEGER NOT NULL DEFAULT 0')
  }

  if (version < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_changes (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        agent_id TEXT,
        path TEXT NOT NULL,
        status TEXT NOT NULL,
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        diff_text TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_file_changes_conv ON file_changes(conversation_id);
    `)
  }

  if (version < 6) {
    addMissingColumn('project_memory_items', 'tags', "TEXT NOT NULL DEFAULT '[]'")
    addMissingColumn('project_memory_items', 'cited_by', "TEXT NOT NULL DEFAULT '[]'")
  }

  if (version < 7) {
    // Migrate old agent_profiles (memory cache) → agent_profile_cache
    const hasOldTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_profiles'").get()
    if (hasOldTable) {
      const hasCacheTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_profile_cache'").get()
      if (!hasCacheTable) {
        // No cache table yet — simple rename
        db.exec('ALTER TABLE agent_profiles RENAME TO agent_profile_cache')
      } else {
        // Cache already exists (created by createTables) — copy rows, skip duplicates
        const oldRows = db.prepare('SELECT * FROM agent_profiles').all() as Array<Record<string, unknown>>
        for (const row of oldRows) {
          const exists = db.prepare('SELECT 1 FROM agent_profile_cache WHERE id = ?').get(row.id)
          if (!exists) {
            db.prepare(`
              INSERT INTO agent_profile_cache (id, workspace_id, agent_id, content, source_path, source_hash, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(row.id, row.workspace_id, row.agent_id, row.content, row.source_path, row.source_hash, row.created_at, row.updated_at)
          }
        }
        db.exec('DROP TABLE IF EXISTS agent_profiles')
      }
    }

    // Create agent_profile_configs table
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profile_configs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'coder',
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
        description TEXT,
        system_prompt TEXT,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profile_configs_ws ON agent_profile_configs(workspace_id);
    `)

    // Add agent_profile_id to conversations
    addMissingColumn('conversations', 'agent_profile_id', 'TEXT REFERENCES agent_profile_configs(id) ON DELETE SET NULL')

    // Seed default profiles if table is empty
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM agent_profile_configs').get() as { cnt: number }
    if (count.cnt === 0) {
      const now = Math.floor(Date.now() / 1000)
      const defaults = [
        { name: 'Planner', role: 'planning', model: 'claude-opus-4-7', is_enabled: 1, sort_order: 0, description: '任务分解与方案验证' },
        { name: 'Coder', role: 'implementation', model: 'claude-sonnet-4-6', is_enabled: 1, sort_order: 1, description: '代码编写与重构' },
        { name: 'Reviewer', role: 'review', model: 'claude-haiku-4-5-20251001', is_enabled: 0, sort_order: 2, description: '代码审查与风险识别' }
      ]
      for (const d of defaults) {
        db.prepare(`
          INSERT INTO agent_profile_configs (id, workspace_id, name, role, model, description, is_enabled, sort_order, created_at, updated_at)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), d.name, d.role, d.model, d.description, d.is_enabled, d.sort_order, now, now)
      }
    }
  }

  if (version < 8) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS proj_mem_au AFTER UPDATE ON project_memory_items BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, kind) VALUES ('delete', old.rowid, old.title, old.content, old.kind);
        INSERT INTO memory_fts(rowid, title, content, kind) VALUES (new.rowid, new.title, new.content, new.kind);
      END;
    `)
  }

  if (version < 9) {
    addMissingColumn('messages', 'agent_profile_id', 'TEXT')
    db.exec(`
      CREATE TABLE IF NOT EXISTS a2a_tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        from_profile_id TEXT,
        to_profile_id TEXT NOT NULL,
        message TEXT NOT NULL,
        context_snapshot TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        depth INTEGER NOT NULL DEFAULT 0,
        chain TEXT NOT NULL DEFAULT '[]',
        execution_mode TEXT NOT NULL DEFAULT 'serial',
        source TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER,
        result TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_tasks_conv ON a2a_tasks(conversation_id);
    `)
  }

  if (version < 10) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL UNIQUE,
        encrypted_value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS provider_configs (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        binary_path TEXT,
        extra_env TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  }

  if (version < 11) {
    addMissingColumn('agent_profile_configs', 'preferred_provider', 'TEXT')
  }

  if (version < 12) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        name TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        args TEXT DEFAULT '[]',
        env TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1
      );
    `)
  }

  if (version < 13) {
    addMissingColumn('conversation_usage', 'provider_id', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_day_model ON conversation_usage(created_at, model, provider_id);
      CREATE VIEW IF NOT EXISTS usage_daily AS
      SELECT
        date(created_at, 'unixepoch', 'localtime') AS day,
        model,
        provider_id,
        SUM(input_tokens)            AS total_input,
        SUM(output_tokens)           AS total_output,
        SUM(cache_read_tokens)       AS total_cache_read,
        SUM(cache_creation_tokens)   AS total_cache_creation,
        SUM(cost_usd)                AS total_cost
      FROM conversation_usage
      GROUP BY day, model, provider_id;
    `)
  }

  if (version < 14) {
    // AgentTeam: add team_id to conversations
    addMissingColumn('conversations', 'team_id', 'TEXT DEFAULT NULL')

    // Agent profile discovery: add capabilities, when_to_use, output_contract
    addMissingColumn('agent_profile_configs', 'capabilities', 'TEXT')
    addMissingColumn('agent_profile_configs', 'when_to_use', 'TEXT')
    addMissingColumn('agent_profile_configs', 'output_contract', 'TEXT')

    // Seed DevTeam preset profiles if they don't exist
    const now = Math.floor(Date.now() / 1000)

    for (const profile of PRESET_PROFILE_SEEDS) {
      const exists = db.prepare('SELECT 1 FROM agent_profile_configs WHERE id = ?').get(profile.id)
      if (exists) continue
      db.prepare(`
        INSERT INTO agent_profile_configs
          (id, workspace_id, name, role, model, description, system_prompt, preferred_provider, capabilities, when_to_use, output_contract, is_enabled, sort_order, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
      `).run(
        profile.id,
        profile.name,
        profile.role,
        profile.model,
        `${profile.name} — ${profile.whenToUse}`,
        profile.systemPrompt,
        profile.preferredProvider,
        JSON.stringify(profile.capabilities),
        profile.whenToUse,
        profile.outputContract,
        now,
        now
      )
    }
  }

  if (version < 15) {
    // Draft conversations: not visible in TaskRail until first message is sent
    addMissingColumn('conversations', 'is_draft', 'INTEGER NOT NULL DEFAULT 0')
  }

  if (version < 16) {
    addMissingColumn('conversations', 'deleted_at', 'INTEGER DEFAULT NULL')
    db.exec('CREATE INDEX IF NOT EXISTS idx_conv_deleted ON conversations(deleted_at)')
  }

  if (version < 17) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS team_configs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        members TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // Seed default Dev Team
    const now = Math.floor(Date.now() / 1000)
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM team_configs').get() as { cnt: number }
    if (count.cnt === 0) {
      db.prepare(`
        INSERT INTO team_configs (id, workspace_id, name, description, members, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
      `).run(DEV_TEAM_ID, DEV_TEAM_NAME, DEV_TEAM_DESCRIPTION, JSON.stringify(DEV_TEAM_MEMBERS), now, now)
    }
  }

  if (version < 18) {
    addMissingColumn('team_configs', 'policies_json', "TEXT NOT NULL DEFAULT '{}'")
    db.prepare(`
      UPDATE team_configs
      SET policies_json = ?
      WHERE id = ? AND (policies_json IS NULL OR policies_json = '{}')
    `).run(JSON.stringify(DEV_TEAM_POLICIES), DEV_TEAM_ID)
  }

  if (version < 19) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_task_edges (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        from_node_id TEXT,
        to_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL DEFAULT 'user-mention',
        label TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_edges_conv ON agent_task_edges(conversation_id)')
  }

  if (version < 20) {
    addMissingColumn('tasks', 'provider_override', 'TEXT')
    addMissingColumn('tasks', 'model_override', 'TEXT')
  }

  if (version < 21) {
    addMissingColumn('conversations', 'task_id', 'TEXT REFERENCES tasks(id) ON DELETE SET NULL')
  }

  if (version < 22) {
    addMissingColumn('a2a_tasks', 'source', 'TEXT')
  }

  if (version < 23) {
    // Fix stale auto-review references in preset profile prompts
    db.prepare(`
      UPDATE agent_profile_configs
      SET system_prompt = REPLACE(system_prompt, '系统会自动在你完成代码变更后安排 Codex review，你不需要主动 @Codex 触发 review 流程', '当你认为代码变更需要质量把关时，主动 @Codex 请求 review')
      WHERE id = 'claude-primary' AND system_prompt LIKE '%系统会自动在你完成代码变更后安排 Codex review%'
    `).run()
    db.prepare(`
      UPDATE agent_profile_configs
      SET when_to_use = REPLACE(when_to_use, '由系统自动触发，也可由 Claude 主动委托。', '由 Claude 主动委托触发。')
      WHERE id = 'codex-reviewer' AND when_to_use LIKE '%由系统自动触发%'
    `).run()
  }

  if (version < 24) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS continuity_capsules (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        parent_capsule_id TEXT,
        a2a_depth INTEGER NOT NULL DEFAULT 0,
        ball_state TEXT NOT NULL DEFAULT 'in_progress',
        continuation_reason TEXT,
        seal_session_id TEXT,
        seal_session_seq INTEGER,
        seal_checkpoint_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_capsules_conv ON continuity_capsules(conversation_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_capsules_task ON continuity_capsules(task_id)')
  }

  if (version < 25) {
    // Add chain position tracking columns to continuity_capsules
    db.exec(`ALTER TABLE continuity_capsules ADD COLUMN chain_index INTEGER`)
    db.exec(`ALTER TABLE continuity_capsules ADD COLUMN chain_total INTEGER`)
  }

  if (version < 26) {
    // Sync preset profile metadata with latest seed data (systemPrompt, whenToUse, outputContract).
    // Only updates profiles whose id matches a preset seed — user-created profiles are untouched.
    for (const seed of PRESET_PROFILE_SEEDS) {
      const row = db.prepare('SELECT system_prompt, when_to_use, output_contract FROM agent_profile_configs WHERE id = ?').get(seed.id) as { system_prompt: string | null; when_to_use: string | null; output_contract: string | null } | undefined
      if (!row) continue
      // Only update if content differs from current seed data
      if (row.system_prompt !== seed.systemPrompt ||
          row.when_to_use !== seed.whenToUse ||
          row.output_contract !== seed.outputContract) {
        db.prepare(`
          UPDATE agent_profile_configs
          SET system_prompt = ?, when_to_use = ?, output_contract = ?, updated_at = unixepoch()
          WHERE id = ?
        `).run(seed.systemPrompt, seed.whenToUse, seed.outputContract, seed.id)
      }
    }
  }

  setSchemaVersion(SCHEMA_VERSION)
}

function getSchemaVersion(): number {
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null } | undefined
    return row?.version ?? 0
  } catch {
    return 0
  }
}

function setSchemaVersion(version: number): void {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM schema_version').run()
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
  })
  transaction()
}

function addMissingColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((existing) => existing.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function purgeExpiredConversations(): void {
  const TTL_SECONDS = 30 * 24 * 3600
  const cutoff = Math.floor(Date.now() / 1000) - TTL_SECONDS
  db.prepare('DELETE FROM conversations WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff)
}
