"use strict";
const electron = require("electron");
const path = require("path");
const node_module = require("node:module");
const crypto = require("crypto");
const child_process = require("child_process");
const events = require("events");
const require$1 = node_module.createRequire(require("url").pathToFileURL(__filename).href);
const BetterSqlite3 = require$1("better-sqlite3");
let db;
function initDatabase() {
  const dbPath = path.join(electron.app.getPath("userData"), "bytro.db");
  db = new BetterSqlite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  createTables();
}
function getDb() {
  return db;
}
function createTables() {
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

    -- Schema Version
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
    INSERT OR IGNORE INTO schema_version (version) VALUES (1);
  `);
  try {
    db.exec("ALTER TABLE conversations ADD COLUMN title_source TEXT NOT NULL DEFAULT 'auto'");
  } catch {
  }
}
const ALLOWED_EXTERNAL_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:", "mailto:"]);
async function safeOpenExternal(url) {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false;
    }
    await electron.shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}
function registerSystemIpc() {
  electron.ipcMain.handle("system:getVersion", () => {
    return electron.app.getVersion();
  });
  electron.ipcMain.handle("system:showWindow", (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.show();
      win.focus();
    }
  });
  electron.ipcMain.handle("system:hideWindow", (event) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    if (win) win.hide();
  });
  electron.ipcMain.handle("system:openExternal", async (_event, url) => {
    return safeOpenExternal(url);
  });
  electron.ipcMain.handle("system:getPaths", () => {
    return {
      home: electron.app.getPath("home"),
      userData: electron.app.getPath("userData"),
      documents: electron.app.getPath("documents"),
      desktop: electron.app.getPath("desktop"),
      downloads: electron.app.getPath("downloads")
    };
  });
}
function registerWorkspaceIpc() {
  electron.ipcMain.handle("workspace:list", () => {
    const db2 = getDb();
    return db2.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all();
  });
  electron.ipcMain.handle("workspace:get", (_event, id) => {
    const db2 = getDb();
    return db2.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("workspace:create", (_event, data) => {
    const db2 = getDb();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1e3);
    db2.prepare(
      "INSERT INTO workspaces (id, name, description, icon, repo_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, data.name, data.description ?? null, data.icon ?? null, data.repo_path ?? null, now, now);
    return db2.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("workspace:update", (_event, id, data) => {
    const db2 = getDb();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid payload: data must be a plain object");
    }
    const allowedFields = /* @__PURE__ */ new Set(["name", "description", "icon", "repo_path"]);
    const unknownKeys = Object.keys(data).filter((k) => !allowedFields.has(k));
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid fields: ${unknownKeys.join(", ")}`);
    }
    const validEntries = Object.entries(data).filter(([k]) => allowedFields.has(k));
    if (validEntries.length === 0) {
      throw new Error("No valid fields to update");
    }
    const now = Math.floor(Date.now() / 1e3);
    const fields = [];
    const values = [];
    for (const [key, value] of validEntries) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);
    db2.prepare(`UPDATE workspaces SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return db2.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("workspace:delete", (_event, id) => {
    const db2 = getDb();
    db2.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
    return { success: true };
  });
}
function registerConversationIpc() {
  electron.ipcMain.handle("conversation:list", (_event, workspaceId) => {
    const db2 = getDb();
    if (workspaceId) {
      return db2.prepare("SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId);
    }
    return db2.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all();
  });
  electron.ipcMain.handle("conversation:get", (_event, id) => {
    const db2 = getDb();
    const conversation = db2.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!conversation) return null;
    const messages = db2.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(id);
    return { ...conversation, messages };
  });
  electron.ipcMain.handle("conversation:create", (_event, data) => {
    const db2 = getDb();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1e3);
    db2.prepare(
      "INSERT INTO conversations (id, workspace_id, title, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, data.workspace_id ?? null, data.title ?? "New Chat", data.model ?? null, data.provider ?? null, now, now);
    return db2.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("conversation:update", (_event, id, data) => {
    const db2 = getDb();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid payload: data must be a plain object");
    }
    const allowedFields = /* @__PURE__ */ new Set(["title", "title_source", "model", "provider"]);
    const unknownKeys = Object.keys(data).filter((k) => !allowedFields.has(k));
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid fields: ${unknownKeys.join(", ")}`);
    }
    const validEntries = Object.entries(data).filter(([k]) => allowedFields.has(k));
    if (validEntries.length === 0) {
      throw new Error("No valid fields to update");
    }
    const now = Math.floor(Date.now() / 1e3);
    const fields = [];
    const values = [];
    for (const [key, value] of validEntries) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    fields.push("updated_at = ?");
    values.push(now);
    values.push(id);
    db2.prepare(`UPDATE conversations SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return db2.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("conversation:delete", (_event, id) => {
    const db2 = getDb();
    db2.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return { success: true };
  });
  electron.ipcMain.handle("message:create", (_event, data) => {
    const db2 = getDb();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1e3);
    db2.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, thinking, tool_calls, tool_results, usage, parent_tool_use_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, data.conversation_id, data.role, data.content, data.thinking ?? null, data.tool_calls ?? null, data.tool_results ?? null, data.usage ?? null, data.parent_tool_use_id ?? null, now);
    db2.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, data.conversation_id);
    return db2.prepare("SELECT * FROM messages WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("conversation:search", (_event, query) => {
    const db2 = getDb();
    const results = db2.prepare(`
      SELECT c.id, c.title,
             snippet(messages_fts, 0, '<<', '>>', '...', 32) as snippet,
             m.created_at as matchedAt,
             bm25(messages_fts) as rank
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `).all(query);
    return results;
  });
  electron.ipcMain.handle("conversation:autoTitle", async (_, id, title) => {
    const db2 = getDb();
    const stmt = db2.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND title_source = 'auto'"
    );
    stmt.run(title, Math.floor(Date.now() / 1e3), id);
    return { success: true };
  });
  electron.ipcMain.handle("conversation:setTitle", async (_, id, title) => {
    const db2 = getDb();
    const stmt = db2.prepare(
      "UPDATE conversations SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?"
    );
    stmt.run(title, Math.floor(Date.now() / 1e3), id);
    return { success: true };
  });
}
class AIEngine {
  constructor() {
    this.provider = null;
    this.sessions = /* @__PURE__ */ new Map();
  }
  setProvider(provider) {
    this.provider = provider;
  }
  async startSession(config) {
    if (!this.provider) throw new Error("No AI provider configured");
    const session = await this.provider.startSession(config);
    this.sessions.set(session.id, session);
    return session;
  }
  async endSession(sessionId) {
    if (!this.provider) return;
    await this.provider.endSession(sessionId);
    this.sessions.delete(sessionId);
  }
  sendMessage(sessionId, content) {
    if (!this.provider) throw new Error("No AI provider configured");
    this.provider.sendMessage(sessionId, content);
  }
  respondPermission(sessionId, approved) {
    if (!this.provider) return;
    this.provider.respondPermission(sessionId, approved);
  }
  respondQuestion(sessionId, answer) {
    if (!this.provider) return;
    this.provider.respondQuestion(sessionId, answer);
  }
  abort(sessionId) {
    if (!this.provider) return;
    this.provider.abort(sessionId);
  }
  onEvent(sessionId, handler) {
    if (!this.provider) return;
    this.provider.onEvent(sessionId, handler);
  }
  offEvent(sessionId, handler) {
    if (!this.provider) return;
    this.provider.offEvent(sessionId, handler);
  }
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
}
const aiEngine = new AIEngine();
function registerChatIpc() {
  electron.ipcMain.handle("chat:startSession", async (_, config) => {
    return aiEngine.startSession(config);
  });
  electron.ipcMain.handle("chat:sendMessage", async (_, sessionId, content) => {
    aiEngine.sendMessage(sessionId, content);
  });
  electron.ipcMain.handle("chat:respondPermission", async (_, sessionId, approved) => {
    aiEngine.respondPermission(sessionId, approved);
  });
  electron.ipcMain.handle("chat:respondQuestion", async (_, sessionId, answer) => {
    aiEngine.respondQuestion(sessionId, answer);
  });
  electron.ipcMain.handle("chat:abort", async (_, sessionId) => {
    aiEngine.abort(sessionId);
  });
  electron.ipcMain.handle("chat:endSession", async (_, sessionId) => {
    await aiEngine.endSession(sessionId);
  });
}
function registerDialogIpc() {
  electron.ipcMain.handle("dialog:openDirectory", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
function registerIpcHandlers() {
  registerSystemIpc();
  registerWorkspaceIpc();
  registerConversationIpc();
  registerChatIpc();
  registerDialogIpc();
}
const PERMISSION_MODE_CLI_MAP = {
  manual: "default",
  autoEdit: "acceptEdits",
  plan: "plan",
  fullAuto: "bypassPermissions"
};
class EventParser {
  parseLine(line) {
    if (!line.trim()) return null;
    try {
      const data = JSON.parse(line);
      switch (data.type) {
        case "system":
          if (data.subtype === "init") return this.parseInit(data);
          return this.parseHook(data);
        case "assistant":
          return this.parseAssistant(data);
        case "user":
          return this.parseUser(data);
        case "result":
          return this.parseResult(data);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
  parseInit(data) {
    return {
      type: "system_init",
      sessionId: data.session_id,
      tools: data.tools
    };
  }
  parseHook(data) {
    const hookName = data.hook_name || "";
    if (hookName.includes("Subagent") || hookName.includes("Agent")) {
      if (data.subtype === "hook_started" || hookName.includes("Start")) {
        return {
          type: "subagent_started",
          agentId: data.uuid || data.session_id,
          agentType: "subagent",
          name: hookName
        };
      }
      if (data.subtype === "hook_response" || hookName.includes("Stop")) {
        return {
          type: "subagent_completed",
          agentId: data.uuid || data.session_id,
          result: data.output ? String(data.output).slice(0, 200) : void 0
        };
      }
    }
    return null;
  }
  parseAssistant(data) {
    const content = data.message?.content;
    if (!Array.isArray(content) || content.length === 0) return null;
    const block = content[0];
    switch (block.type) {
      case "text":
        return { type: "text_delta", id: data.uuid || "", delta: block.text || "" };
      case "thinking":
        return { type: "thinking_delta", delta: block.thinking || "" };
      case "tool_use":
        return {
          type: "tool_start",
          toolCallId: block.id || "",
          toolName: block.name || "",
          toolInput: typeof block.input === "string" ? block.input : JSON.stringify(block.input)
        };
      default:
        return null;
    }
  }
  parseUser(data) {
    const content = data.message?.content;
    if (!Array.isArray(content) || content.length === 0) return null;
    const block = content[0];
    if (block.type === "tool_result") {
      return {
        type: "tool_result",
        toolCallId: block.tool_use_id || "",
        success: !block.is_error,
        result: typeof block.content === "string" ? block.content : JSON.stringify(block.content)
      };
    }
    return null;
  }
  parseResult(data) {
    const events2 = [];
    if (data.subtype === "success") {
      events2.push({
        type: "complete",
        id: data.session_id || "",
        fullText: typeof data.result === "string" ? data.result : "",
        usage: this.extractUsage(data),
        costUsd: data.total_cost_usd
      });
      events2.push({ type: "done", id: data.session_id || "" });
    } else if (data.subtype?.startsWith("error")) {
      events2.push({ type: "error", error: data.error || data.subtype });
      events2.push({ type: "done", id: data.session_id || "" });
    } else {
      events2.push({ type: "done", id: data.session_id || "" });
    }
    return events2;
  }
  extractUsage(data) {
    const raw = data.usage;
    if (!raw) return void 0;
    return {
      inputTokens: raw.input_tokens || 0,
      outputTokens: raw.output_tokens || 0,
      cacheReadTokens: raw.cache_read_input_tokens || void 0,
      cacheCreationTokens: raw.cache_creation_input_tokens || void 0
    };
  }
}
class ClaudeCLIProvider extends events.EventEmitter {
  constructor() {
    super(...arguments);
    this.type = "claude-cli";
    this.sessions = /* @__PURE__ */ new Map();
  }
  async startSession(config) {
    const sessionId = config.sessionId || `cli-${Date.now()}`;
    const args = this.buildArgs(config);
    const child = child_process.spawn("claude", args, {
      cwd: config.workingDir || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });
    const entry = {
      process: child,
      config,
      status: "idle",
      parser: new EventParser(),
      buffer: ""
    };
    this.sessions.set(sessionId, entry);
    child.stdout.on("data", (data) => {
      entry.buffer += data.toString();
      const lines = entry.buffer.split("\n");
      entry.buffer = lines.pop() || "";
      for (const line of lines) {
        const events2 = entry.parser.parseLine(line);
        if (!events2) continue;
        const eventArr = Array.isArray(events2) ? events2 : [events2];
        for (const event of eventArr) {
          this.emit(`event:${sessionId}`, event);
        }
      }
    });
    child.stderr.on("data", () => {
    });
    child.on("exit", () => {
      this.sessions.delete(sessionId);
    });
    return {
      id: sessionId,
      providerType: this.type,
      config,
      status: "idle",
      createdAt: Date.now()
    };
  }
  async endSession(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.process.kill();
      this.sessions.delete(sessionId);
    }
  }
  sendMessage(sessionId, content) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.status = "running";
    const msg = JSON.stringify({ type: "user_message", content }) + "\n";
    entry.process.stdin.write(msg);
  }
  respondPermission(sessionId, approved) {
    if (!approved) {
      this.abort(sessionId);
    }
  }
  respondQuestion(sessionId, answer) {
    this.abort(sessionId);
  }
  abort(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.process.kill("SIGTERM");
      entry.status = "idle";
    }
  }
  onEvent(sessionId, handler) {
    this.on(`event:${sessionId}`, handler);
  }
  offEvent(sessionId, handler) {
    this.off(`event:${sessionId}`, handler);
  }
  buildArgs(config) {
    const cliPermissionMode = PERMISSION_MODE_CLI_MAP[config.permissionMode];
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--input-format",
      "stream-json",
      "--model",
      config.model,
      "--permission-mode",
      cliPermissionMode
    ];
    if (config.sessionId) {
      args.push("--resume", config.sessionId);
    }
    return args;
  }
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void safeOpenExternal(details.url);
    return { action: "deny" };
  });
  if (!electron.app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  electron.app.setAppUserModelId("com.bytro.app");
  const claudeProvider = new ClaudeCLIProvider();
  aiEngine.setProvider(claudeProvider);
  initDatabase();
  registerIpcHandlers();
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
