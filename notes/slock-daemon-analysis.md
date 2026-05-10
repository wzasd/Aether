# Slock Daemon 深度架构分析

> 分析对象：`@slock-ai/daemon` npm package  
> 来源路径：`/Users/wangzhao/.npm/_npx/277f35d2ed0078b9/node_modules/@slock-ai/daemon/dist/`  
> 分析日期：2026-05-09  
> 目标读者：Tomek (bytro 团队)

---

## 0. 总览

Slock Daemon 是一个 Node.js 编写的代理进程编排器（Agent Orchestrator），负责：
- 通过 WebSocket 与 Slock 服务器通信
- 根据服务器指令 spawn/kill 各类 AI Runtime（Claude Code、Codex CLI、Kimi CLI、Cursor、Gemini、Copilot、OpenCode）
- 管理每个 agent 的 workspace、session、memory、消息投递、崩溃恢复
- 将不同 Runtime 的异构输出统一抽象为标准化的 `ParsedEvent` 流

核心设计哲学：**Daemon 是 Runtime 的"翻译层和保姆"，不是 AI 本身**。它不做 token 计算、不做 prompt 压缩，只负责进程生命周期和协议转换。

---

## 1. Session 管理

### 1.1 Session 的创建与恢复

Slock 的 Session 概念与底层 Runtime 强绑定。Daemon 本身不生成 session ID，而是透传 Runtime 返回的 session ID：

```js
// ClaudeDriver.spawn() 中
if (config.sessionId) {
  args.push("--resume", config.sessionId);
}
// stdin 注入初始消息时也带上 session_id
const stdinMsg = JSON.stringify({
  type: "user",
  message: { role: "user", content: [...] },
  ...ctx.config.sessionId ? { session_id: ctx.config.sessionId } : {}
});
```

Codex 的 session 恢复则通过 JSON-RPC 的 `thread/resume` 方法：

```js
// CodexDriver.buildThreadRequest()
if (ctx.config.sessionId) {
  return {
    method: "thread/resume",
    params: { threadId: ctx.config.sessionId, ...threadParams }
  };
}
```

Kimi 则通过 `--session <sessionId>` CLI 参数：

```js
const args = [
  "--wire", "--yolo",
  "--agent-file", agentFilePath,
  "--mcp-config-file", mcpConfigPath,
  "--session", this.sessionId
];
```

### 1.2 Session ID 的持久化

Session ID 持久化在三个层面：

1. **Server 端**：服务器通过 `agent:session` 消息接收并保存 session ID
2. **Daemon 内存**：`idleAgentConfigs` Map 缓存每个 agent 的 `config.sessionId`
3. **Runtime 本地文件**：
   - Claude: `~/.claude/projects/<project>/<sessionId>.jsonl`
   - Codex: `~/.codex/sessions/<...>/<sessionId>.jsonl`

### 1.3 `--resume` 标志与缺失恢复

当 daemon 重启 agent 并传入 `--resume` 时，若 Runtime 报告 session 不存在，会触发 **冷启动回退**：

```js
function isMissingResumeSession(ap) {
  if (ap.driver.id === "claude") {
    return candidates.some(t => /No conversation found with session ID/i.test(t));
  }
  if (ap.driver.id === "opencode") {
    return candidates.some(t => /Session not found/i.test(t) && t.includes(ap.sessionId));
  }
  return false;
}
```

在 `proc.on("close")` 中：

```js
if (missingResumeSession) {
  const restartConfig = { ...ap.config, sessionId: null };
  logger.warn(`[Agent ${agentId}] Stored session ${staleSessionId} unavailable; falling back to cold start`);
  this.startAgent(agentId, restartConfig, ap.startupWakeMessage, ...);
}
```

### 1.4 Session 生命周期

```
[new] → 服务器发送 agent:start → Daemon 加入 startQueue
   ↓
[spawning] → spawn 进程 → 等待 session_init 事件
   ↓
[active/working] → 处理消息、工具调用、思考
   ↓
[turn_end] → 进程 exit code 0（per_turn runtime）或进入 idle（persistent runtime）
   ↓
[idle] → 缓存到 idleAgentConfigs，等待新消息或 stall 检测
   ↓
[archived] → 若进程 crash，清除缓存，标记 inactive
```

关键状态机代码：

```js
// turn_end 事件处理
if (ap.inbox.length > 0 && ap.driver.supportsStdinNotification && ap.sessionId) {
  // 立即投递队列中的消息
  const nextMessages = ap.inbox.splice(0, ap.inbox.length);
  this.deliverMessagesViaStdin(agentId, ap, nextMessages, "idle");
} else {
  ap.isIdle = true;
  this.broadcastActivity(agentId, "online", "Idle");
}
```

---

## 2. Context 管理

### 2.1 对话上下文如何注入 Agent

Slock 不维护对话历史，而是**每次 wake 时把完整上下文拼成一个 prompt 通过 stdin 注入**。

对于 idle agent 收到新消息时：

```js
const prompt = `New message received:

${formatIncomingMessage(messages[0], ap.driver)}

Respond as appropriate. Complete all your work before stopping.
${RESPONSE_TARGET_HINT}`;

const encoded = ap.driver.encodeStdinMessage(prompt, ap.sessionId, { mode });
ap.process.stdin?.write(encoded + "\n");
```

对于 resume（恢复上线）场景：

```js
if (isResume && unreadSummary) {
  prompt = `You have unread messages from while you were offline:`;
  for (const [ch, count] of Object.entries(unreadSummary)) {
    prompt += `\n- ${ch}: ${count} unread`;
  }
  prompt += `\n\nUse ${communicationCommand(driver, "read_history")} to catch up...`;
}
```

### 2.2 Context Window / Token 限制

**Daemon 层面完全不管理 token 限制**。这是一个关键设计决策：

- Token 计数、context window 管理、truncation 全部由底层 Runtime（Claude Code、Codex 等）自行处理
- Daemon 只监听 `compaction_started` / `compaction_finished` 事件
- 当 compaction 超过 5 分钟没结束，触发 watchdog：

```js
const COMPACTION_STALE_MS = 5 * 60 * 1000;
startCompactionWatchdog(agentId, ap) {
  ap.compactionWatchdog = setTimeout(() => {
    this.markCompactionStale(agentId, startedAt);
  }, COMPACTION_STALE_MS);
}
```

### 2.3 历史消息注入

Slock 采用 **"pull 模式"** 而非 "push 模式"：

- Daemon 不会把历史消息自动塞进 prompt
- 而是在 system prompt 中教 agent 使用 `read_history` / `search_messages` 工具自行拉取
- 这样避免了一次性注入过多历史导致 token 爆炸

唯一例外是 **thread_join_context**：当 agent 被 @mention 加入 thread 时，daemon 会注入 parent message + recent thread messages：

```js
const threadJoinPrefix = message.thread_join_context ? [
  `[System: You were added to a new thread via @mention.]`,
  `parent: ${message.thread_join_context.parent_target}`,
  `thread: ${message.thread_join_context.thread_target}`,
  "Parent message:",
  formatThreadContextMessage(message.thread_join_context.parent_message),
  `Recent thread context:`,
  message.thread_join_context.recent_messages.map(formatThreadContextMessage).join("\n")
].join("\n") : "";
```

### 2.4 多轮对话状态

Persistent runtime（Claude、Codex、Kimi）的进程保持存活，对话状态由 Runtime 自己维护。Daemon 只维护：

- `sessionId`: 当前 session 标识
- `inbox`: 待处理消息队列
- `isIdle`: 是否处于空闲等待状态
- `gatedSteering`: Claude 的 gated 状态机

---

## 3. Memory 管理

### 3.1 持久化 Memory 机制

Slock 的 memory 完全**文件化、agent 自管理**：

```js
const memoryMdPath = path11.join(agentDataDir, "MEMORY.md");
try {
  await access(memoryMdPath);
} catch {
  const initialMemoryMd = buildInitialMemoryMd(runtimeConfig);
  await writeFile(memoryMdPath, initialMemoryMd);
}
```

首次启动时自动生成 `MEMORY.md`：

```markdown
# <Agent Name>

## Role
No role defined yet.

## Key Knowledge
- No notes yet.

## Active Context
- First startup.
```

### 3.2 MEMORY.md 作为恢复锚点

System Prompt 中有专门的 **"Compaction Safety (CRITICAL)"** 章节：

> "Your context will be periodically compressed to stay within limits. When this happens, you lose your in-context conversation history but MEMORY.md is always re-read. Therefore: MEMORY.md must be self-sufficient as a recovery point."

这是 Slock 解决 context compression 后状态丢失的核心策略：**靠文件系统的 MEMORY.md 做状态锚点**。

### 3.3 Memory 组织规范

Prompt 中明确指导 agent 如何组织 memory：

```
- MEMORY.md is always the index. Keep it concise but comprehensive as a table of contents.
- Create a `notes/` directory for detailed knowledge files:
  - notes/user-preferences.md
  - notes/channels.md
  - notes/work-log.md
  - notes/<domain>.md
- Update notes proactively — Don't wait to be asked.
- Keep MEMORY.md current — After updating notes, update the index.
```

### 3.4 Memory 更新触发策略

**Daemon 不主动触发 memory 更新**。完全依赖：
1. System prompt 中的指令要求 agent 主动更新
2. Agent 在 turn 结束时自行决定写文件
3. 对于 onboarding agent（Cindy），daemon 会预置 seed files：

```js
if (getOnboardingSeedMode(config) === FIRST_CINDY_SEED_MODE) {
  const seedFiles = buildOnboardingSeedFiles(); // onboarding_playbook.md + onboarding_knowledge_faq.md
  for (const { relativePath, content } of seedFiles) {
    await writeFile(fullPath, content);
  }
}
```

### 3.5 bytro 当前对比

bytro 目前也有 `MEMORY.md`，但：
- Slock 的 memory 策略更系统化（index + notes/ 子目录）
- Slock 明确将 MEMORY.md 作为 compaction 后的恢复点
- Slock 的 system prompt 中花了大量篇幅教育 agent 如何维护 memory

---

## 4. Agent 进程管理

### 4.1 Spawn 与生命周期

`AgentProcessManager.startAgentNow()` 是核心 spawn 逻辑：

```js
const { process: proc } = driver.spawn({
  agentId,
  config: effectiveConfig,
  standingPrompt,
  prompt,
  workingDirectory: agentDataDir,
  chatBridgePath: this.chatBridgePath,
  slockCliPath: this.slockCliPath,
  daemonApiKey: this.daemonApiKey,
  launchId: launchId || null
});
```

每个 driver 的 `spawn()` 返回 `{ process: proc }`，daemon 随后挂载事件监听器：
- `proc.stdout?.on("data", ...)` — 解析 stream-json
- `proc.stderr?.on("data", ...)` — 记录最近 8 行 stderr
- `proc.on("error", ...)` — spawn 错误
- `proc.on("exit", ...)` — 记录 exit code
- `proc.on("close", ...)` — 完整的清理和重启决策

### 4.2 崩溃恢复与重试

在 `proc.on("close")` 中：

```js
const processEndedCleanly = finalCode === 0 || (expectedTermination && !ap.lastRuntimeError);
const terminalFailureDetail = processEndedCleanly ? null : classifyTerminalFailure(ap);
```

`classifyTerminalFailure` 检测可分类的终端错误：

```js
function classifyTerminalFailure(ap) {
  const candidates = [ap.lastRuntimeError, ...ap.recentStderr].filter(Boolean);
  for (const text of candidates) {
    const lower = text.toLowerCase();
    if (lower.includes("usage limit") || lower.includes("quota exceeded")
        || lower.includes("modelnotfounderror") || lower.includes("model deprecated")) {
      return text;
    }
  }
  return null;
}
```

**恢复策略**：
- Clean exit + inbox 有消息 → **立即重启处理队列消息**
- Missing session → **冷启动回退**（sessionId 设为 null）
- Crash → 标记 `inactive`，上报错误，**不自动无限重试**

### 4.3 僵尸进程清理

Daemon 通过以下机制防止僵尸：

1. **agentsStarting Set**：防止同一 agent 并发启动
2. **agents Map**：只保留当前活跃进程，exit 后立即 `this.agents.delete(agentId)`
3. **kill timeout**：stopAgent 时先 SIGTERM，5 秒后强制 SIGKILL

```js
if (wait) {
  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      ap.process.kill("SIGKILL");
      resolve();
    }, 5000);
    ap.process.on("exit", () => { clearTimeout(forceKillTimer); resolve(); });
  });
}
```

4. **Stall detection**：15 分钟无 runtime 事件，自动 kill

```js
const RUNTIME_PROGRESS_STALE_MS = 15 * 60 * 1000;
if (staleForMs >= RUNTIME_PROGRESS_STALE_MS) {
  ap.expectedTerminationReason = "stalled_recovery";
  ap.process.kill("SIGTERM");
}
```

---

## 5. 任务/消息队列

### 5.1 Agent 启动队列

Daemon 使用一个**全局 agent 启动队列**，防止 spawn 风暴：

```js
class AgentProcessManager {
  agents = new Map();              // 运行中的 agent
  agentsStarting = new Set();      // 正在启动的 agent
  queuedAgentStarts = new Map();   // agentId -> queue item
  agentStartQueue = [];            // FIFO 队列
  activeAgentStartCount = 0;
  maxConcurrentAgentStarts = 5;    // 默认最大并发
  agentStartIntervalMs = 500;      // 启动间隔
}
```

队列泵 `pumpAgentStartQueue()` 逻辑：

```js
if (this.activeAgentStartCount >= this.maxConcurrentAgentStarts) return;
const elapsed = Date.now() - this.lastAgentStartAt;
const waitMs = Math.max(0, this.agentStartIntervalMs - elapsed);
if (waitMs > 0) {
  this.agentStartPumpTimer = setTimeout(() => this.pumpAgentStartQueue(), waitMs);
  return;
}
// 出队并启动
```

### 5.2 消息队列（Inbox）

每个运行中的 agent 维护自己的 inbox：

```js
const agentProcess = {
  process: proc,
  inbox: this.startingInboxes.get(agentId) || [],
  // ...
};
```

消息投递策略 `deliverMessage()`：

| 状态 | 策略 |
|------|------|
| Agent 未运行 + 有 idle config | 自动重启，消息作为 wakeMessage |
| Agent 未运行 + 无 config | 拒绝，上报 offline |
| Agent starting | 缓存在 `startingInboxes` |
| Agent idle + supportsStdinNotification | 立即通过 stdin 投递 |
| Agent busy + gated (Claude) | 加入 inbox，等待 tool boundary flush |
| Agent busy + direct (Codex/Kimi) | 立即 steer |
| Agent busy + 不支持 stdin | 加入 inbox，等 turn_end 后重启 |

### 5.3 并发控制

- **每 agent 单进程**：一个 agent 同一时间只有一个进程
- **全局启动并发**：`SLOCK_DAEMON_MAX_CONCURRENT_AGENT_STARTS` 环境变量控制（默认 5）
- **启动速率限制**：`SLOCK_DAEMON_AGENT_START_INTERVAL_MS`（默认 500ms）

---

## 6. 通信协议（Stream-JSON）

### 6.1 协议概述

Slock Daemon 与 Runtime 之间通过 **stdin/stdout 的换行分隔 JSON（NDJSON/Stream-JSON）** 通信。

### 6.2 Claude 协议

**输出格式**（Claude Code `--output-format stream-json`）：

```json
{"type": "system", "subtype": "init", "session_id": "abc-123"}
{"type": "assistant", "message": {"role": "assistant", "content": [
  {"type": "thinking", "thinking": "..."},
  {"type": "text", "text": "..."},
  {"type": "tool_use", "name": "bash", "input": {"command": "ls"}}
]}}
{"type": "user", "message": {"role": "user", "content": [
  {"type": "tool_result", "tool_use_id": "..."}
]}}
{"type": "result", "subtype": "success", "session_id": "abc-123", "is_error": false}
```

**输入格式**（stdin 注入）：

```json
{"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "New message..."}]}, "session_id": "abc-123"}
```

### 6.3 Codex 协议（JSON-RPC 2.0）

Codex 使用 app-server 模式，通过 stdio 走 JSON-RPC：

```js
// 初始化
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"clientInfo": {...}}}
// 创建/恢复 thread
{"jsonrpc": "2.0", "id": 2, "method": "thread/start", "params": {"cwd": "...", "approvalPolicy": "never"}}
// 开始 turn
{"jsonrpc": "2.0", "id": 3, "method": "turn/start", "params": {"threadId": "...", "input": [{"type": "text", "text": "..."}]}}
// Busy 时 steer
{"jsonrpc": "2.0", "id": 4, "method": "turn/steer", "params": {"threadId": "...", "expectedTurnId": "...", "input": [...]}}
```

Codex 的事件类型：`thread/started`, `turn/started`, `item/agentMessage/delta`, `item/reasoning/textDelta`, `item/started`, `item/completed`, `turn/completed`, `error`。

### 6.4 Kimi 协议

Kimi 也使用 JSON-RPC，但方法名不同：

```js
// 初始化
{"jsonrpc": "2.0", "id": "...", "method": "initialize", "params": {"protocol_version": "1.3", ...}}
// Prompt（idle 模式）
{"jsonrpc": "2.0", "id": "...", "method": "prompt", "params": {"user_input": "..."}}
// Steer（busy 模式）
{"jsonrpc": "2.0", "id": "...", "method": "steer", "params": {"user_input": "..."}}
```

Kimi 的事件通过 `method: "event"` 推送：

```json
{"jsonrpc": "2.0", "method": "event", "params": {"type": "StepBegin", "payload": {}}}
{"jsonrpc": "2.0", "method": "event", "params": {"type": "ToolCall", "payload": {"function": {"name": "bash", "arguments": "..."}}}}
{"jsonrpc": "2.0", "method": "event", "params": {"type": "TurnEnd", "payload": {}}}
```

### 6.5 统一事件抽象

所有 Runtime 的 parseLine 最终都映射到统一的 `ParsedEvent`：

```ts
type ParsedEvent =
  | { kind: "session_init"; sessionId: string }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool_call"; name: string; input: any }
  | { kind: "tool_output"; name: string }
  | { kind: "compaction_started" }
  | { kind: "compaction_finished" }
  | { kind: "turn_end"; sessionId?: string }
  | { kind: "error"; message: string };
```

这是 Slock 架构的核心设计：**Driver 负责协议适配，Daemon 负责统一语义**。

### 6.6 错误处理

- JSON parse 失败：静默丢弃（`try { event = JSON.parse(line); } catch { return []; }`）
- `result` 事件中的 error：根据 subtype 分类（`error_max_budget_usd`, `error_max_turns`, `error_during_execution`）
- Stderr 非空输出：记录到 `recentStderr`（最多 8 行，每行最多 240 字符）

---

## 7. Driver 架构

### 7.1 Driver 接口定义

```ts
interface Driver {
  id: string;                    // "claude" | "codex" | "kimi" | ...
  lifecycle: {
    kind: "persistent" | "per_turn";
    stdin?: "gated" | "direct";   // persistent 才有
    inFlightWake: "queue" | "steer" | "spawn_new" | "coalesce_into_pending";
    start?: "immediate" | "defer_until_concrete_message";
    exit?: "natural" | "terminate_on_turn_end";
  };
  communication: {
    chat: "slock_cli" | "mcp_chat_bridge";
    runtimeControl: "mcp_runtime_actions";
  };
  session: { recovery: "resume_or_fresh" };
  model: {
    detectedModelsVerifiedAs: "launchable" | "suggestion_only";
    toLaunchSpec: (modelId: string) => { args?: string[]; params?: object; env?: object };
  };
  supportsStdinNotification: boolean;
  busyDeliveryMode: "gated" | "direct" | "none";
  mcpToolPrefix: string;
  usesSlockCliForCommunication: boolean;
  
  probe(): { available: boolean; version?: string };
  spawn(ctx: SpawnContext): { process: ChildProcess };
  parseLine(line: string): ParsedEvent[];
  encodeStdinMessage(text: string, sessionId: string | null, opts?: { mode: "idle" | "busy" }): string | null;
  buildSystemPrompt(config: AgentConfig, agentId: string): string;
  detectModels?(): Promise<{ models: ModelInfo[]; default?: string } | null>;
}
```

### 7.2 Driver 分类矩阵

| Runtime | lifecycle.kind | stdin | busyDelivery | inFlightWake | chat |
|---------|---------------|-------|--------------|--------------|------|
| Claude | persistent | gated | gated | queue | slock_cli |
| Codex | persistent | direct | direct | steer | slock_cli |
| Kimi | persistent | direct | direct | steer | mcp_chat_bridge |
| Copilot | per_turn | - | none | spawn_new | mcp_chat_bridge |
| Cursor | per_turn | - | none | spawn_new | mcp_chat_bridge |
| Gemini | per_turn | - | none | spawn_new | slock_cli |
| OpenCode | per_turn | - | none | coalesce_into_pending | slock_cli |

### 7.3 关键设计模式

1. **Persistent vs Per-Turn**：
   - Persistent：进程长期存活，支持 same-turn steering（Claude gated, Codex/Kimi direct）
   - Per-Turn：每次 wake 新 spawn 进程，turn 结束自动 kill

2. **CLI Transport 准备**：
   `prepareCliTransport()` 为每个 agent workspace 创建 `.slock/` 目录，写入：
   - `agent-token` 文件（auth token）
   - `slock` wrapper 脚本（将 `slock` 命令代理到 daemon 的 CLI）
   - 注入 PATH 和环境变量

3. **MCP Config 动态生成**：
   Claude/Cursor/Gemini/Kimi/OpenCode 都需要动态生成 MCP 配置文件，把 `chat-bridge.js` 注册为 MCP server。

---

## 8. System Prompt 构建

### 8.1 Prompt 构建函数

核心函数 `buildPrompt(config, variant, opts)` 位于 `src/drivers/systemPrompt.ts`，是一个**纯字符串拼接函数**，代码量约 1200 行。

```js
function buildPrompt(config, variant, opts) {
  const isCli = variant === "cli";
  const t = (name) => toolRef(opts.toolPrefix, name);
  // ... 大量模板字符串拼接
}
```

### 8.2 两个变体

| 变体 | 用途 | 通信方式 |
|------|------|----------|
| `cli` | Claude, Codex, Gemini, OpenCode | `slock message send` 等 CLI 命令 |
| `mcp` | Cursor, Copilot, Kimi | MCP 工具调用 |

### 8.3 动态注入内容

System Prompt 包含以下动态生成的章节：

1. **Runtime Context Lines**：Agent ID、Server ID、Computer、Hostname、OS、Daemon Version、Workspace Path
2. **Critical Rules**：通信方式、task claim 规则
3. **Startup Sequence**：0-5 步启动流程（含 Runtime Profile Control 优先处理）
4. **Communication Section**：完整的 slock CLI 或 MCP 工具说明
5. **Reminders Section**：提醒系统使用说明
6. **Threads Section**：Thread 目标格式、回复规则
7. **Tasks Section**：Task 状态流、claim/unclaim/update 工作流
8. **MEMORY.md Section**：Memory 索引规范、compaction safety
9. **Message Notifications**：Busy 时新消息的处理方式
10. **Runtime Profile Control**：Migration 或 Release Notice

### 8.4 Prompt 版本与缓存

**没有缓存机制**。每次 spawn 都会重新调用 `driver.buildSystemPrompt(config, agentId)` 生成完整 prompt。对于 per-turn runtime，这意味着每个 turn 都重新生成。

不过 `standingPrompt` 和 `prompt` 有区分：
- `standingPrompt` = system prompt（长期不变的指令）
- `prompt` = 本次 wake 的具体输入（可能包含新消息内容）

Claude 支持 `--system-prompt-file` 传递 standing prompt，而 Codex 通过 `developerInstructions` 参数。

---

## 9. 可观测性与日志

### 9.1 日志系统

```js
var logger = {
  info(msg) { console.log(line); emit({ level: "INFO", ... }); },
  warn(msg) { console.warn(line); emit({ level: "WARN", ... }); },
  error(msg, err) { console.error(line, err); emit({ level: "ERROR", ... }); }
};
```

支持外部订阅：`subscribeDaemonLogs(listener)`。

### 9.2 分布式追踪

Slock 实现了自定义的轻量级追踪系统（不依赖 OpenTelemetry）：

```js
class BasicTracer {
  startSpan(name, options) {
    const context = createTraceContext({ parent: options.parent ?? null });
    return new RecordingActiveSpan({ context, name, ... });
  }
}
```

Trace 写入 `LocalRotatingTraceSink`：
- 每个文件最大 5MB
- 最多保留 8 个文件
- 文件按时间轮转（默认 5 分钟）
- 自动 gzip 上传到服务器

### 9.3 心跳机制

当 agent 处于 `working` 或 `thinking` 状态时：

```js
ap.activityHeartbeat = setInterval(() => {
  if (this.markRuntimeProgressStaleIfNeeded(agentId, ap)) return;
  ap.activityClientSeq += 1;
  this.sendToServer({
    type: "agent:activity",
    agentId,
    activity: ap.lastActivity,
    detail: ap.lastActivityDetail,
    clientSeq: ap.activityClientSeq
  });
}, ACTIVITY_HEARTBEAT_MS); // 60s
```

服务器也会发送 `agent:activity_probe`，daemon 回复当前真实状态，防止"UI 显示 green 但实际卡死"。

### 9.4 Runtime 停滞检测

```js
const RUNTIME_PROGRESS_STALE_MS = 15 * 60 * 1000; // 15 分钟
```

若 15 分钟无 runtime 事件（无 thinking、text、tool 输出）：
1. 记录 `runtime.progress.stalled` trace
2. 广播 activity 为 `error`
3. 如果 inbox 有消息且支持重启，kill 进程并重启

### 9.5 Gated Steering 事件日志（Claude 专用）

Claude 的 gated delivery 会记录详细的事件流：

```js
recordGatedSteeringEvent(agentId, ap, "buffer", { reason: "busy_message", pendingMessages: ap.inbox.length });
recordGatedSteeringEvent(agentId, ap, "flush", { reason: "tool_batch_complete", messageCount: nextMessages.length });
recordGatedSteeringEvent(agentId, ap, "phase", { event: "tool_call", tool: invocation.toolName });
```

---

## 10. 对 bytro 的关键启示

### 10.1 bytro 应该借鉴的（Slock 做得好的）

#### A. 进程级 Agent 隔离 + 统一抽象
Slock 把每个 agent 当作独立 OS 进程管理，通过 Driver 抽象屏蔽 Runtime 差异。bytro 目前似乎把 agent 跑在单一进程/上下文中，可以考虑：
- 如果未来支持多 Runtime（Claude + Kimi + 自研），Driver 抽象是必选项
- 即使单 Runtime，进程隔离也能防止一个 agent 的崩溃/阻塞影响其他 agent

#### B. Idle Agent Config 缓存
Slock 的 `idleAgentConfigs` 设计非常精巧：

```js
idleAgentConfigs = Map<agentId, { config, sessionId, launchId }>
```

当进程 clean exit 后，不销毁状态，而是缓存起来。下次消息到来时**毫秒级重启**。bytro 应该引入类似的"热休眠"机制，而不是完全销毁上下文。

#### C. MEMORY.md 作为 Compaction 恢复锚点
Slock 明确教育 agent："MEMORY.md must be self-sufficient as a recovery point"。bytro 应该：
- 在 system prompt 中强化 MEMORY.md 的 index 角色
- 规定 notes/ 子目录的组织规范
- 在 context compaction 前主动触发 agent 写 memory（如果 bytro 控制 compaction 时机）

#### D. Gated Steering / Safe Boundary 投递
Claude Code 的 stream-json 有 signed thinking block，不能随意打断。Slock 的 gated steering 策略值得 bytro 学习：
- 识别 tool boundary（tool_output 后 outstandingToolUses === 0）
- 识别 turn_end
- 在 safe boundary 才 flush inbox 中的消息
- 遇到 thinking-block mutation error 后自动降级（`toolBoundaryFlushDisabled = true`）

如果 bytro 支持 mid-turn 消息注入（比如用户追加提问），这个机制必须实现。

#### E. 启动队列与反压
Slock 的 `agentStartQueue` + `maxConcurrentAgentStarts` + `agentStartIntervalMs` 防止了 spawn 风暴。bytro 如果支持多 agent 并发，应该引入类似的启动调度器。

#### F. Runtime Profile Control / Migration
Slock 的 Runtime Profile Migration 机制允许服务器强制 agent 在恢复正常工作前执行迁移操作：
- 通过特殊前缀的 message ID 识别 migration notice
- 拦截并优先处理，阻止普通 inbox 消息同时投递
- Agent 必须调用特定 MCP tool 确认迁移完成后，普通消息才放行

bytro 可以用类似机制实现：agent 配置热更新、runtime 升级通知、workspace 迁移等。

#### G. 工具调用的标准化元数据
Slock 的 `toolDisplay.ts` 定义了所有工具的元数据：

```js
var TOOL_DISPLAY_METADATA = {
  send_message: { logLabel: "Sending message", activityLabel: "Sending message…", summaryKind: "message_target" },
  bash: { logLabel: "Running command", activityLabel: "Running command…", summaryKind: "command" },
  // ...
};
```

这让 UI 可以统一显示"agent 正在做什么"，而不依赖 Runtime 的输出格式。bytro 应该建立类似的 tool registry。

#### H. 活动探测（Activity Probe）
Slock 解决了"agent 显示 green 但实际卡死"的经典问题：
- Daemon 每 60s 发送心跳
- Server 发送 probe，daemon 回复真实状态
- 若 probe 超时，server 才 fallback 到 synthetic state

bytro 应该引入 server→agent 的 probe 机制，而不是只靠 agent 主动上报。

### 10.2 bytro 与 Slock 的差距

| 维度 | Slock | bytro（当前推测） |
|------|-------|-----------------|
| Runtime 支持 | 7 种（Claude/Codex/Kimi/Cursor/Gemini/Copilot/OpenCode） | 主要 Kimi |
| 进程模型 | 每 agent 独立进程 | 可能单进程多 agent |
| Session 恢复 | 完整（resume + cold-start fallback） | 基础 |
| 消息投递 | 支持 busy 时 steer/gated | 可能仅 idle 投递 |
| 分布式追踪 | 自定义 tracer + 本地 rotation + 上传 | 无 |
| 启动队列 | 全局并发控制 + 速率限制 | 无 |
| Workspace 管理 | 文件浏览 API + skill 扫描 | 基础 |
| 提醒系统 | 本地 cache + 定时器 | 无 |
| Machine Lock | 文件锁防止多 daemon | 无 |

### 10.3 具体架构建议

1. **引入 Driver 抽象层**：即使现在只支持 Kimi，也应该把 spawn/parse/encode/buildPrompt 抽成接口，为未来扩展做准备。

2. **实现 Idle Agent Cache**：agent turn 结束后不要销毁所有状态，保留 `{sessionId, config, workspacePath}`，实现"热休眠→热唤醒"。

3. **强化 MEMORY.md 规范**：在 system prompt 中明确 memory 组织结构，并在 compaction 前触发 agent 自动保存关键状态。

4. **添加 Stall Detection**：如果 agent 超过 N 分钟没有产生任何输出（thinking/text/tool），应该：
   - 标记为 stalled
   - 尝试 graceful kill + restart
   - 如果 inbox 有消息，优先处理消息

5. **引入 Agent 启动调度器**：如果 bytro 支持多 agent，必须有并发启动限制，防止资源耗尽。

6. **实现 Activity Heartbeat + Probe**：agent 主动心跳 + server 被动 probe 的双保险机制。

7. **统一 Event 抽象**：把 Kimi 的 JSON-RPC event、未来可能的其他 Runtime 输出，统一映射为内部事件流（thinking/text/tool_call/tool_output/turn_end/error）。

8. **Runtime Profile / Migration 通道**：预留一条高优先级的控制消息通道，可以插队到普通 inbox 消息之前。

9. **工具调用元数据注册表**：为每个工具定义 logLabel、activityLabel、summaryKind，让 UI 能准确显示 agent 正在执行什么操作。

10. **本地追踪系统**：即使不上传，也应该在本地记录 agent 的生命周期事件（start/deliver/turn_end/crash），用于事后诊断。

---

## 附录：核心代码引用索引

| 功能 | 文件 | 行号范围 |
|------|------|----------|
| Session 恢复/冷启动 | `chunk-FG5JGA67.js` | 4282-4297, 4910-4936 |
| Agent 启动队列 | `chunk-FG5JGA67.js` | 4377-4595 |
| 消息投递策略 | `chunk-FG5JGA67.js` | 5154-5321 |
| Gated Steering | `chunk-FG5JGA67.js` | 5947-6019 |
| Runtime 停滞检测 | `chunk-FG5JGA67.js` | 6023-6084 |
| 进程退出处理 | `chunk-FG5JGA67.js` | 4859-4997 |
| System Prompt 构建 | `chunk-FG5JGA67.js` | 705-1221 |
| Claude Driver | `chunk-FG5JGA67.js` | 1466-1704 |
| Codex Driver | `chunk-FG5JGA67.js` | 1796-2196 |
| Kimi Driver | `chunk-FG5JGA67.js` | 2790-2991 |
| WebSocket 连接 | `chunk-FG5JGA67.js` | 6439-6642 |
| 提醒缓存 | `chunk-FG5JGA67.js` | 6646-6721 |
| Machine Lock | `chunk-FG5JGA67.js` | 6724-6827 |
| 本地 Trace Sink | `chunk-FG5JGA67.js` | 6830-6976 |
| Chat Bridge (MCP Server) | `chat-bridge.js` | 467-1497 |
| CLI 命令实现 | `cli/index.js` | 1-2139 |
