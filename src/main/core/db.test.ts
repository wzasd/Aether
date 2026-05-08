import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS project_memory_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '[]',
  cited_by TEXT NOT NULL DEFAULT '[]',
  confidence TEXT,
  source_conversation_id TEXT,
  source_message_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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
`

const SEED = `
INSERT INTO project_memory_items (id, workspace_id, kind, title, content)
VALUES ('mem-1', 'ws-1', 'architecture', 'Old Title', 'Old content about architecture');
`

const UPDATE = `
UPDATE project_memory_items SET title = 'New Title', content = 'Updated content' WHERE id = 'mem-1'
`

function recall(ftsQuery: string, db: Database.Database) {
  return db.prepare(`
    SELECT pmi.* FROM memory_fts ft
    JOIN project_memory_items pmi ON ft.rowid = pmi.rowid
    WHERE memory_fts MATCH ?
    ORDER BY rank
  `).all(ftsQuery)
}

describe('memory_fts sync', () => {
  let db: Database.Database

  beforeAll(() => {
    db = new Database(':memory:')
    db.exec(SCHEMA)
  })

  afterAll(() => {
    db.close()
  })

  it('indexes INSERT via AFTER INSERT trigger', () => {
    db.exec(SEED)
    const results = recall('"Old"', db)
    expect(results).toHaveLength(1)
  })

  it('syncs UPDATE to FTS so new content is searchable', () => {
    db.exec(UPDATE)

    const newResults = recall('"Updated"', db)
    expect(newResults).toHaveLength(1)

    const oldResults = recall('"Old"', db)
    expect(oldResults).toHaveLength(0)
  })

  it('removes row from FTS on DELETE', () => {
    db.exec("DELETE FROM project_memory_items WHERE id = 'mem-1'")
    const results = recall('"Updated"', db)
    expect(results).toHaveLength(0)
  })
})
