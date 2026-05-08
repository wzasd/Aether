---
status: active
owner: mochi
last_updated: 2026-05-05
doc_kind: code-review
---

# Gemini CLI Provider Code Review

Review scope:

- `GeminiOutputParser` — 从 stub 升级为真实 stream-json 解析实现
- `GeminiCLIProvider` — 架构重写：one-shot 进程模型 + `-r <sessionId>` 上下文续接
- `gemini-output-parser.test.ts` — 20 个解析器测试
- `provider-registry.ts` — Gemini 注册集成

Verification:

- 20 个 parser 测试全部通过
- `pnpm run typecheck` 干净

## Architecture Summary

Gemini CLI 与 Claude/Codex/Kimi 的核心区别：**one-shot 进程模型**。每条用户消息 spawn 一个新 `gemini` 子进程，通过 `-r <sessionId>` 继续上下文。没有长驻子进程。

这意味着 `GeminiCLIProvider` 必须完全覆盖 `BaseCLIProvider` 的 `sendMessage`（基类假设 stdin 长连接），同时自行管理 session 状态（`geminiSessions` Map）。

## Findings

### [P1] sendMessage 中 resume 首条消息缺少 sessionId

**Files:** `src/main/ai/providers/gemini-cli.ts` L86-153

`sendMessage` 始终调用 `buildStreamJsonArgs(entry.config, true)`，即 `resume=true`。这意味着第一条用户消息也会带上 `-r <sessionId>` 参数。

问题链：

1. `startSession` 生成 `sessionId`（可能是 `crypto.randomUUID()`）
2. `sendMessage` 调用 `buildStreamJsonArgs(config, true)` → args 包含 `-r <uuid>`
3. Gemini CLI 收到一个不存在的 resume ID，行为未定义——可能报错、可能忽略、可能创建新 session 但返回不同的 session_id

对比 Claude provider：Claude 用 `--session-id` (首次) 和 `--resume` (续接) 区分。Gemini 的 `-r` 语义是 "resume"，不应在首条消息使用。

**Recommended fix:**

在 `geminiSessions` 中追踪是否已经收到过 `init` 事件（即是否已有真实的 Gemini session_id）。首条消息不带 `-r`，后续消息使用 parser 从 `init` 事件中提取的真实 `session_id`。

```ts
interface GeminiSessionEntry {
  config: SessionConfig
  parser: GeminiOutputParser
  geminiSessionId: string | null  // 从 init 事件获取
}
```

`sendMessage` 中：

```ts
const hasRealSession = entry.geminiSessionId !== null
const args = this.buildStreamJsonArgs(entry.config, hasRealSession)
if (hasRealSession) {
  // 用真实的 gemini session id，不是 bytro 的 session id
  args.push('-r', entry.geminiSessionId)
}
```

Status: ✅ **Fixed** — tracks real Gemini session_id from `init` event; first message omits `-r`.

### [P1] GeminiOutputParser 不发出 permission_request / ask_user_question 事件

**Files:** `src/main/ai/providers/parsers/gemini-output-parser.ts`

Gemini CLI 在 `--approval-mode auto_edit` 或 `plan` 模式下，遇到需要用户确认的操作时，stream-json 输出中会包含确认请求。当前 parser 的 `switch` 只处理了 `init / message / tool_use / tool_result / result` 五种类型，没有处理 Gemini 的确认请求事件。

这意味着在 `autoEdit` / `plan` 模式下，如果 Gemini 需要用户确认，UI 不会收到 `permission_request` 事件，用户无法响应，会话会卡住或超时。

**Recommended fix:**

1. 确认 Gemini CLI stream-json 输出中确认请求的实际 schema（可能是 `type: "permission_request"` 或其他）
2. 在 parser 中添加对应 case，映射到 `AIEvent.permission_request` 或 `AIEvent.ask_user_question`
3. 补充对应测试

Status: ✅ **Verified not needed** — Gemini CLI stream-json non-interactive mode auto-approves or auto-denies tools. No permission_request events emitted.

### [P2] GeminiCLIProvider.startSession 绕过了基类的 manual → plan 降级逻辑

**Files:** `src/main/ai/providers/gemini-cli.ts` L64-79

`BaseCLIProvider.startSession` 中有这段逻辑：

```ts
if (config.permissionMode === 'manual' && !this.meta.supportsInteractive) {
  config = { ...config, permissionMode: 'plan' }
}
```

Gemini 的 `supportsInteractive: false`，所以 manual 模式应降级为 plan。但 `GeminiCLIProvider.startSession` 完全覆盖了基类方法，没有包含这个降级逻辑。如果用户选择 manual 模式，会话会以 `permissionFlags.manual = []`（空数组）启动，即不带任何 approval-mode flag，Gemini CLI 的默认行为可能不是预期的。

**Recommended fix:**

在 `startSession` override 中加入同样的降级逻辑：

```ts
if (config.permissionMode === 'manual' && !this.meta.supportsInteractive) {
  config = { ...config, permissionMode: 'plan' }
}
```

或者，考虑不 override `startSession`，而是让基类处理 session 创建，只覆盖 `sendMessage`。

Status: ✅ **Fixed** — `startSession` override includes `manual → plan` downgrade.

### [P2] sendMessage 中进程退出后 session 状态未更新

**Files:** `src/main/ai/providers/gemini-cli.ts` L86-153

`BaseCLIProvider` 的 `emitSessionEvent` 会在收到 `done` 事件时将 session status 设为 `idle`。但 `GeminiCLIProvider` 直接 `this.emit()` 绕过了 `emitSessionEvent`，所以 session 状态永远不会从 `running` 变回 `idle`。

`geminiSessions` Map 中没有 `session` 对象和 `status` 字段，所以 `startSession` 返回的 `Session` 对象的 status 在 `sendMessage` 后永远停留在 `idle`（因为 `sendMessage` 也没设为 `running`）。

这意味着：
- 调用方无法通过 `session.status` 判断 Gemini 是否正在处理
- 如果 UI 依赖 session status 来显示 loading 状态，会不正确

**Recommended fix:**

在 `sendMessage` 开头设 `session.status = 'running'`，在 `done` 事件回调中设回 `idle`。或者复用基类的 `emitSessionEvent` 方法。

Status: ✅ **Fixed** — session status properly managed inline in `sendMessage`: `running` on start, `idle`/`error` on completion, `waiting_permission`/`waiting_question` on interaction events.

### [P2] abort 不杀子进程

**Files:** `src/main/ai/providers/gemini-cli.ts` L155-158

当前 `abort` 只发出 `done` 事件，不 kill 正在运行的 Gemini 子进程。虽然 Gemini 进程是短生命周期的，但如果用户在长时间工具调用期间点 abort，进程会继续运行直到自然结束，期间的工具结果和文本仍会通过 stdout 流入 parser 并触发 UI 事件。

**Recommended fix:**

追踪当前活跃的 child process，在 `abort` 时 kill 它：

```ts
private activeChild = new Map<string, ChildProcess>()

// sendMessage 中：
this.activeChild.set(sessionId, child)

// abort 中：
const child = this.activeChild.get(sessionId)
child?.kill('SIGTERM')
this.activeChild.delete(sessionId)
```

Status: ✅ **Fixed** — `abort` now tracks `activeChild` via `GeminiSessionEntry`, kills with SIGTERM, emits `error` + `done`.

### [P2] GeminiOutputParser.fullText 在 error result 时不清理

**Files:** `src/main/ai/providers/parsers/gemini-output-parser.ts` L108-110

当 `result` 的 `status` 为 `error` 时，parser 直接返回 `error` 事件，不清理 `fullText`。如果后续有新的 turn，`beginTurn` 会清理，但如果 `flush` 在 error 之后被调用（例如进程 exit handler），会发出一个带有上一个 turn 残留文本的 `complete` 事件。

**Recommended fix:**

在 error result 分支中清理 `fullText`：

```ts
case 'result': {
  if (parsed.status === 'error') {
    this.fullText = ''
    return [{ type: 'error', error: parsed.error ?? 'Gemini CLI error' }]
  }
  // ...
}
```

Status: ✅ **Fixed** — `fullText` cleared in error result branch; subsequent `flush()` returns empty.

### [P3] text_delta 的 id 字段使用 sessionId 而非 message 级别 id

**Files:** `src/main/ai/providers/parsers/gemini-output-parser.ts` L82-84

`text_delta` 事件的 `id` 字段设为 `this.sessionId`。对比 Claude provider，`text_delta.id` 通常用于标识当前 assistant message（用于增量拼接），而不是 session。

当前所有 text_delta 共享同一个 session id，如果 consumer 用 `id` 来做增量拼接的 key，不会出问题（因为同一 turn 内 id 一致），但语义上不够精确。

**Impact:** 低。当前消费端可能不依赖此字段做 message 级别区分。

Status: ✅ **Fixed** — `beginTurn()` now assigns `this.messageId = randomUUID()`; `text_delta` events use this per-turn id.

### [P3] GeminiLine 类型定义缺少 timestamp 字段

**Files:** `src/main/ai/providers/parsers/gemini-output-parser.ts` L6-45

所有 Gemini stream-json 行都包含 `timestamp` 字段（测试 fixture 可见），但 `GeminiLine` 联合类型的各接口都没有声明 `timestamp`。虽然 parser 不使用 timestamp，但类型定义与实际数据不一致，未来如果需要 timestamp 会需要修改。

**Impact:** 低。不影响当前功能。

Status: ✅ **Fixed** — `timestamp` added to all `GeminiLine` union member interfaces.

### [P3] buildStreamJsonArgs 不传递 appendSystemPrompt

**Files:** `src/main/ai/providers/gemini-cli.ts` L37-48

`SessionConfig` 有 `appendSystemPrompt` 字段，Claude provider 通过 `--append-system-prompt` 传递。Gemini CLI 如果支持类似功能（如 `--system-instruction`），当前未传递。

**Impact:** 低。Gemini CLI 可能不支持此参数，但应在文档中注明。

Status: ⏸️ **Deferred** — Gemini CLI may not support an equivalent flag; verify when docs are available.

### [P3] 测试缺少 tool_result 带 content 的场景

**Files:** `src/main/ai/providers/parsers/__tests__/gemini-output-parser.test.ts`

`FIXTURE_TOOL_RESULT` 没有 `content` 字段。parser 代码中 `parsed.content ?? ''` 处理了这种情况，但测试没有覆盖 tool_result 带 content 的路径。同样缺少 `status: 'error'` 的 tool_result 测试。

**Recommended fix:**

补充两个测试 case：
1. `tool_result` 带 `content` 字段
2. `tool_result` 带 `status: 'error'`

Status: ✅ **Fixed** — added tests for `tool_result` with `output` field and `status: 'error'`.

### [P3] 测试缺少 result 无 stats 字段的场景

**Files:** `src/main/ai/providers/parsers/__tests__/gemini-output-parser.test.ts`

当 `result` 不包含 `stats` 时，parser 应只发出 `complete + done`，不发出 `usage`。当前测试只覆盖了有 stats 的情况。

**Recommended fix:**

补充 `result` 无 `stats` 的测试 case。

Status: ✅ **Fixed** — added test for `result` without `stats` (emits `complete + done`, no `usage`).

## Positive Observations

1. **One-shot 架构决策正确**：Gemini CLI 确实是 one-shot 模式，覆盖 `sendMessage` 是必要的。基类的长连接 stdin 模型不适用。

2. **approval-mode flag 修正到位**：`yolo / auto_edit / plan` 是 Gemini CLI 的正确 flag 值，原 `auto` 无效。

3. **Parser 映射完整**：`init → system_init`、`message(assistant) → text_delta`、`tool_use → tool_start`、`tool_result → tool_result`、`result → usage + complete + done` 的映射逻辑清晰，与 AIEvent 类型对齐。

4. **50 字符分块合理**：`TEXT_CHUNK_SIZE = 50` 的分块策略与 Claude provider 的 `--include-partial-messages` 增量输出对齐，UI 侧可以统一处理。

5. **flush 逻辑正确**：处理了进程正常退出但未收到 `result` 事件的边界情况。

6. **测试覆盖面好**：15 个测试覆盖了主要路径和边界情况（空行、非法 JSON、长文本分块、跨消息累积）。

## Second Pass (2026-05-05)

Re-verified all findings against current code. Original P1/P2/P3 fixes confirmed correct. Found **2 new issues** (1 P2, 1 P3). One previously reported P3 was a false alarm.

### [P2-NEW] abort 后 exit handler 重复发出 error + done 事件

**Files:** `src/main/ai/providers/gemini-cli.ts` L220-231 (abort) + L191-217 (exit handler)

`abort()` 发出 `error + done` 事件，但没有设 `doneEmitted = true`。`doneEmitted` 是 `sendMessage` 的局部变量（L140），abort 无法访问。当被 kill 的子进程退出时，`child.on('exit')` handler 检查 `doneEmitted` 仍为 false，会再发一组 `error + done`。

结果：UI 收到两次 `error` 和两次 `done`，可能导致重复的错误提示或状态闪烁。

**Recommended fix:**

将 `doneEmitted` 提升到 `GeminiSessionEntry` 中：

```ts
interface GeminiSessionEntry {
  session: Session
  config: SessionConfig
  parser: GeminiOutputParser
  geminiSessionId: string | null
  activeChild: ChildProcess | null
  doneEmitted: boolean
}
```

`sendMessage` 开头设 `entry.doneEmitted = false`，stdout 解析和 exit handler 中检查/设置 `entry.doneEmitted`。`abort` 中设 `entry.doneEmitted = true`。

Status: **Open — 未修复**

Status after fourth pass: ✅ **Fixed** — `doneEmitted` now lives on `GeminiSessionEntry`, and abort / child error paths set it before emitting terminal events.

### [P3-NEW] buildStreamJsonArgs + sendMessage 的 `-r` 替换模式脆弱

**Files:** `src/main/ai/providers/gemini-cli.ts` L116-125

当前 resume 逻辑是"先让 `buildStreamJsonArgs` 用 Bytro 内部 sessionId 加 `-r`，再用 `lastIndexOf('-r')` 替换成 Gemini 真实 sessionId"。这依赖：

1. `buildStreamJsonArgs` 总是最后加 `-r`（在 permission flags 之后）
2. permission flags 中不包含 `-r` 子串

当前 permission flags 是 `--approval-mode`，不会包含 `-r`，所以实际安全。但如果未来 flags 变化，或 `buildStreamJsonArgs` 逻辑调整，替换可能命中错误位置。

**Recommended fix:**

不在 `buildStreamJsonArgs` 中加 `-r`，改为在 `sendMessage` 中根据 `isResume` 直接追加：

```ts
const args = this.buildStreamJsonArgs(entry.config, false) // 始终 resume=false
if (isResume && entry.geminiSessionId) {
  args.push('-r', entry.geminiSessionId)
}
```

这样 `buildStreamJsonArgs` 不再负责 resume 逻辑，`sendMessage` 完全控制 `-r` 参数。

Status: **Open — 未修复**

Status after fourth pass: ✅ **Fixed** — `buildStreamJsonArgs()` no longer adds `-r`; `sendMessage()` appends the real Gemini resume id explicitly when available.

### ~~[P3-NEW] parser error result + exit handler 双重 error~~ — 误报

二次审查时重新分析，发现此问题是**误报**。实际事件序列：

1. Parser 收到 `result { status: 'error' }` → 发出 `error` 事件，`fullText = ''`（L121 已清理）
2. 进程退出，code=0，stderr 为空 → `cleanExit = true`
3. `flush()` → `fullText` 为空 → 返回 `[]`
4. `doneEmitted` 仍为 false → 补发 `{ type: 'done' }`

最终事件序列：`error` → `done`。这是**正确的行为**——error 后需要 done 来结束 turn。不存在双重 error。

Status: **Closed — 误报**

## Third Pass (2026-05-05)

Re-reviewed the current implementation after Gemini CLI configuration was completed.

Verification run:

- `pnpm vitest run src/main/ai/providers/parsers/__tests__/gemini-output-parser.test.ts` — ✅ 20 tests passed
- `pnpm run typecheck` — ✅ passed

### [P1-NEW] Re-starting a saved Gemini session clears the real Gemini resume id

**Files:** `src/main/ai/providers/gemini-cli.ts` L70-93, `src/renderer/src/stores/chatStore.ts` L679-721

The renderer keeps a `conversationId:providerType → sessionId` mapping and passes that same Bytro session id back into `chat:startSession` on the next turn. That means Gemini's `startSession()` is called again with an existing `config.sessionId`.

However, `GeminiCLIProvider.startSession()` always overwrites `geminiSessions[sessionId]` with a fresh entry:

```ts
this.geminiSessions.set(sessionId, {
  session,
  config: sessionConfig,
  parser: new GeminiOutputParser(),
  geminiSessionId: null,
  activeChild: null
})
```

The first turn correctly captures the real Gemini `session_id` from the `init` event, but the second `startSession()` resets `geminiSessionId` to `null` before `sendMessage()` runs. As a result `isResume` is false, `-r <geminiSessionId>` is omitted, and Gemini starts a fresh conversation every turn.

This breaks the main one-shot design goal: "每条消息启一个新进程，用 `-r <sessionId>` 继续上下文".

**Recommended fix:**

When `startSession()` receives an existing `sessionId`, reuse the existing `GeminiSessionEntry` and update only mutable config fields, preserving `geminiSessionId`.

```ts
const existing = this.geminiSessions.get(sessionId)
if (existing) {
  existing.config = sessionConfig
  existing.session.config = sessionConfig
  existing.session.status = 'idle'
  return existing.session
}
```

If the provider should support app restarts later, persist the real Gemini `session_id` separately from the Bytro session id.

Status: **Open — 未修复**

Status after fourth pass: ✅ **Fixed** — `startSession()` reuses an existing `GeminiSessionEntry`, updates config in place, and preserves the captured Gemini `session_id`.

### [P2-NEW] Gemini usage event is not persisted or aggregated

**Files:** `src/main/ai/providers/parsers/gemini-output-parser.ts` L124-139, `src/renderer/src/stores/chatStore.ts` L1195-1255 and L1336-1338

`GeminiOutputParser` emits usage as a standalone `usage` event, then emits `complete` without `usage`.

The renderer's `usage` case only updates `chatStore.usage`:

```ts
case 'usage': {
  set({ usage: event.usage })
  break
}
```

Actual durable usage handling lives under the `complete` case and only runs when `event.usage` is present. That path updates `useUsageStore`, writes `usage.create(...)`, and stores usage metadata on the assistant message.

So Gemini token stats appear transiently in local state but are not written to the usage table, not aggregated by `useUsageStore`, and not attached to the assistant message. Codex and OpenCode avoid this by attaching usage directly to `complete`.

**Recommended fix:**

Prefer aligning Gemini with existing parser behavior by attaching stats to `complete`:

```ts
events.push({
  type: 'complete',
  id: this.sessionId,
  fullText: savedText,
  usage
})
```

Alternatively, teach the renderer's standalone `usage` case to route/persist usage using `event.sessionId → conversationId`, but that duplicates logic already present in the `complete` path.

Status: **Open — 未修复**

Status after fourth pass: ✅ **Fixed** — `GeminiOutputParser` now attaches token stats to the `complete` event and no longer emits a standalone `usage` event for successful results.

### [P2-NEW] spawn error and abort paths can still double-emit terminal events

**Files:** `src/main/ai/providers/gemini-cli.ts` L138-217 and L220-230

The earlier abort finding still applies, and the same local-state problem exists in the child `error` handler. Both handlers emit `error + done`, but `doneEmitted` is a `sendMessage()` local variable and neither handler sets it.

When the killed or failed child later reaches the `exit` handler, `doneEmitted` can still be false and the provider can emit another terminal sequence. For `abort()`, this is deterministic enough to affect UI behavior: users can see duplicate stop/error handling. For process startup failures, Node typically emits an `error` event and lifecycle events around the failed child; relying on a local flag that is not updated is brittle.

**Recommended fix:**

Move `doneEmitted` onto `GeminiSessionEntry`, set it before every manual terminal emission, and have `abort()` call `entry.parser.cancelTurn()` before killing the child.

Status: **Open — 未修复**

Status after fourth pass: ✅ **Fixed** — `doneEmitted` now lives on `GeminiSessionEntry`, and abort / child error paths set it before emitting terminal events.

### [P3-NEW] Parser test name does not assert the new message id

**Files:** `src/main/ai/providers/parsers/__tests__/gemini-output-parser.test.ts` L236-256

The test named `beginTurn assigns a new messageId for each turn` collects ids from `complete` events after `flush()`. But Gemini `complete.id` is currently the Gemini session id (`this.sessionId`), not `messageId`, so the test never checks the behavior its name describes.

This does not break runtime behavior because `text_delta.id` is tested separately, but it can hide future regressions in `beginTurn()`.

**Recommended fix:**

Capture `text_delta.id` before each `flush()` and assert those ids differ across turns.

Status: **Open — 未修复**

Status after fourth pass: **Still open** — test still collects ids from `complete` events instead of `text_delta` events.

## Fourth Pass (2026-05-05)

Re-reviewed the fixes for the three newly reported findings.

Verification run:

- `pnpm vitest run src/main/ai/providers/parsers/__tests__/gemini-output-parser.test.ts` — ✅ 20 tests passed
- `pnpm run typecheck` — ✅ passed

### Re-check Results

1. **[P1] Gemini resume id is lost between turns** — ✅ Fixed
   - `startSession()` now reuses existing entries for the same Bytro session id.
   - The real Gemini `session_id` is preserved across turns and `sendMessage()` appends `-r <geminiSessionId>` directly.

2. **[P2] Usage is transient only** — ✅ Fixed
   - Gemini stats are now embedded in `complete.usage`, matching the renderer's durable usage path.
   - The parser test was updated to assert there is no separate `usage` event.

3. **[P2] Terminal events can double emit** — ✅ Fixed
   - `doneEmitted` is stored in `GeminiSessionEntry`.
   - Child `error` and `abort()` set `entry.doneEmitted = true` before emitting `error + done`, so the later `exit` handler returns early.

4. **[P3] `-r` replacement pattern is brittle** — ✅ Fixed
   - `buildStreamJsonArgs()` no longer adds `-r`.
   - `sendMessage()` appends the real Gemini resume id explicitly when available.

5. **[P3] parser test name does not assert message id** — Still open
   - The test still reads ids from `complete` events. This is non-blocking because runtime behavior is covered by `uses message-level id for text_delta, not sessionId`.

## Updated Resolution Summary

| Severity | Original | Fixed | Current open |
|----------|----------|-------|--------------|
| P1 | 2 | 3 | 0 |
| P2 | 4 | 6 | 0 |
| P3 | 4 | 3 fixed + 2 deferred | 2 |
| **Total** | **10** | **12** | **2** |

**Open items requiring action:**

1. **[P3]** `appendSystemPrompt` 未传递 — deferred，待 Gemini CLI 文档确认
2. **[P3]** parser test `beginTurn assigns a new messageId for each turn` does not assert the message id it names.
