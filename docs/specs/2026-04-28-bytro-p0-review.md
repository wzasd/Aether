---
status: historical
owner: bytro
last_verified: 2026-04-30
doc_kind: review-history
current_review: ../../reviews/active/p0-code-review.md
---

# Bytro P0 设计 Review 问题清单

> 日期: 2026-04-28
> 范围: `docs/specs/2026-04-28-bytro-p0-design.md` 与 `docs/modules/*.md`
> 目的: 给主开发在实现前统一修正文档契约，避免按错误接口开工。
> 当前状态: 历史归档。当前未解决问题只看 `docs/reviews/active/p0-code-review.md`。

## 当前结论

这一轮文档已经收敛了不少：模块示例基本切回 React + Zustand，权限模式也开始复用 `manual / autoEdit / plan / fullAuto`。但目前仍不建议直接按文档开工，剩余问题集中在三类：

1. Claude CLI / SDK 的输入协议和进程模式仍有冲突，模块 1 还是最大风险点。
2. conversation search、preload API、AIEvent 契约仍有若干处和当前代码不一致。
3. DB schema 变更写法还需要贴合当前 `src/main/core/db.ts` 和 snake_case 约定。

建议先修 P1，再让主开发进入实现；P2 可以和实现设计一起处理，但需要在开工前明确最终契约。

## 代码实现 Review

> 范围: 当前 `src/main/ai/*`、`src/main/ipc/chat.ts`、`src/preload/index.ts`、`src/renderer/src/stores/chatStore.ts`
> 验证命令: `pnpm exec tsc --build --force --pretty false`、`pnpm build`
> 当前结果: 最新复核见“2026-04-30 代码 Review”。`pnpm build` 通过，但 `pnpm exec tsc --build --force --pretty false` 因 conversation search 类型不一致失败。C1-C6 为历史代码 review 项，当前实现已处理；4/29 收敛记录保留作上下文。

### 2026-04-29 代码侧收敛

本轮针对 manual `node-pty` 路径和流式 UI 收尾做了补丁，以下问题已处理:

- `src/main/ipc/chat.ts`: provider 失败时会按 `error -> done` 顺序发事件，IPC bridge 现在只在 `done` 时解绑，避免 `done` 被提前吞掉。
- `src/renderer/src/stores/chatStore.ts`: manual PTY session 被标记为 persistent session，`done` 只作为 turn boundary，不再把活着的 PTY session 从 `conversationSessionIds` 里删掉；`error` 分支会清理死 session 映射。
- `src/main/ai/providers/claude-cli.ts`: manual PTY 输入改为 bracketed paste，避免多行 prompt 被当成多次 Enter 提前提交。
- `src/main/ai/manual-tui-parser.ts`: 权限 prompt 识别收窄到“存在 active tool 上下文”时才触发，普通 assistant 追问不再轻易误判为 `permission_request`。
- `src/main/ai/event-parser.ts` 与 `src/renderer/src/stores/chatStore.ts`: 对 `tool_start` 做幂等处理，避免 Claude partial/final 双事件或 UI complete/done 间隙导致工具卡片重复展示。

误报澄清:

- `src/main/ipc/chat.ts:17-36` 的 “manual session reuse loses the main-to-renderer event bridge after the first turn” 不是当前 bug。虽然 bridge 会在每个 `done` 后解绑，但 renderer 每次发送消息都会先调用 `chat:startSession`，main 会在 `chat:sendMessage` 前重新注册 `aiEngine.onEvent(session.id, handler)`。对 manual PTY 复用来说，事件桥会按 turn 重建，不会丢第二轮事件。

验收:

- 失败 turn 能稳定到达 renderer 的 `done` 分支并清理状态。
- manual 模式下一轮消息能复用仍然存活的 PTY session。
- manual 模式第二轮发送前会重新注册 main-to-renderer event bridge。
- 多行 prompt 在 manual 模式下作为一次粘贴输入提交。
- 同一个 tool call id 不会在当前回复中展示两次。

### 2026-04-29 最新代码 Review

本轮复核结论: P0 主链路已经能构建通过，main-to-renderer event bridge、Claude stream-json stdin shape、assistant 落库追加、manual PTY 多行输入、工具卡片重复展示等问题已有收敛。当前剩余问题主要集中在“运行时边界”和“流式工具参数鲁棒性”。

#### R1. [P1] Todo updates can still write to the wrong conversation

位置: `src/renderer/src/stores/chatStore.ts:498-508`

`complete` 已经按 `sessionId -> conversationId` 路由，但 `todo_updated` 仍使用当前 UI 选中的 `state.currentConversation?.id`。如果用户在 Claude 运行期间切换会话，TodoWrite 结果会同步到错误会话。

建议:

- 和 `complete` 一样，优先用 `event.sessionId` 查 `sessionConversationIds`。
- 只有缺失 session 映射时，才 fallback 到 `state.currentConversation?.id`。
- `useTodoStore.getState().onTodoUpdated(event)` 如需持久化上下文，也应接收或推导原始 conversationId。

验收:

- 流式期间切换到另一个 conversation，TodoWrite 结果仍写回发起请求的 conversation。
- 当前 UI 如果不在原 conversation，不应错误显示/覆盖另一条会话的 todo 状态。

#### R2. [P2] Safety timeout clears UI but leaves the Claude session running

位置: `src/renderer/src/stores/chatStore.ts:131-144`

5 分钟 safety timeout 只清空 renderer 流式状态，没有调用 `chat.abort()`，也没有清理 session/conversation 映射。用户看到已经停止，但 Claude 进程可能继续运行并发回 late events，或者下一轮复用一个已经不可信的 session。

建议:

- 超时时读取当前 `streamingRequestId` 并调用 `window.api.chat.abort(sessionId)`。
- 对非 manual session 同步清理 `conversationSessionIds` / `sessionConversationIds`。
- 对 manual persistent session，至少清掉当前 turn 状态，并考虑向 PTY 发送 Ctrl+C 后保留可复用 session。

验收:

- timeout 后不会继续接收并展示上一轮 late events。
- timeout 后下一轮发送不会复用已失效的 print-mode session。

#### R3. [P2] Abort leaves stale pending interactions visible

位置: `src/renderer/src/stores/chatStore.ts:364-375`

中断时只清理 streaming 文本，没有清掉 `pendingPermissions`、`pendingQuestions`、`tools` 和 `currentTurnToolIds`。用户 abort 后仍可能看到旧权限/问题卡片，点击后还会向旧 session 发送响应；manual PTY 场景尤其容易把旧的 `y/n` 或答案写进后续终端状态。

建议:

- abort 时按当前 sessionId 过滤掉对应的 `pendingPermissions` / `pendingQuestions`。
- 重置本轮 `tools`、`currentTurnToolIds`、`turnBoundary` 等 UI 状态。
- 如果后续需要保留历史 tool 展示，应该把“当前 turn 工具状态”和“已完成消息内 tool_calls”分开存储。

验收:

- 点击停止后，旧权限弹窗、问题卡片、运行中工具卡片都不会继续悬挂。
- abort 后再发送新消息，不会把旧 confirm/question 响应写入新 turn。

#### R4. [P2] Stream parser ignores tool input deltas

位置: `src/main/ai/event-parser.ts:173-181`

`content_block_start` 会先发出 `tool_start`，但这时 Claude 的 tool `input` 经常还是空对象；后续 `input_json_delta` 在当前 parser 中被忽略。现在依赖最终 assistant block 再覆盖工具参数，所以流式过程中仍可能短暂显示 `{}`；如果最终 block 因错误/中断缺失，落库的 `tool_calls` 也会保留空参数。

建议:

- 按 Claude content block index/id 维护 tool input buffer。
- 解析 `content_block_delta` 中的 `input_json_delta`，累积 partial JSON。
- buffer 可解析时发一次更新后的 `tool_start`，或新增内部事件 `tool_input_delta` 让 renderer 更新现有工具卡片。

验收:

- 工具执行期间参数能逐步或最终稳定展示，不依赖 final assistant block 才修正 `{}`。
- 中断/错误情况下，已收到的工具参数不会全部丢失。

### 2026-04-29 Memory 实现 Review

本轮复核范围: `src/main/ipc/memory.ts`、`src/main/core/memory-*.ts`、`src/main/core/db.ts`、`src/renderer/src/stores/memoryStore.ts`、`src/renderer/src/stores/chatStore.ts`。

验证结果:

- `pnpm exec tsc --build --force --pretty false` 通过。
- `pnpm build` 通过。

结论: memory P0 的表、IPC、preload、renderer store 已经接上，`workspaceId -> repo_path` 的文件边界也比上一轮安全。但仍有几处会破坏“真相源/候选/索引”边界，或让运行时状态写入错误 conversation。

#### M1. [P1] Public createProjectItem still bypasses durable truth source

位置: `src/main/ipc/memory.ts:105-109`

`memory:materializeCandidate` 已经会写 `.bytro/project-memory.md` 后再写 `project_memory_items`，但 preload 仍公开 `memory:createProjectItem`，renderer 可以直接创建 `project_memory_items` read model。这样会绕过 candidate 审核和 durable 文件真相源，导致 SQLite 里出现“长期记忆”，但 `.bytro/project-memory.md` / markers 里没有来源，后续 rebuild 或迁移会丢。

建议:

- `createProjectItem` 不要暴露给 renderer；改为 main 内部函数。
- 所有 project memory read model 写入统一走 `materializeCandidate` 或未来的 `MemoryIndexBuilder.rebuild()`。
- 如需人工编辑 project memory，应编辑 `.bytro/project-memory.md`，然后 rebuild/read-model sync。

验收:

- renderer 侧无法直接写 `project_memory_items`。
- 任意 `project_memory_items` row 都能追溯到 durable source path / candidate / marker。

#### M2. [P1] Todo updates can still persist to the selected conversation

位置: `src/renderer/src/stores/chatStore.ts:562-572`

`complete` 已经用 `event.sessionId -> sessionConversationIds` 路由 assistant 落库，但 `todo_updated` 仍使用 `state.currentConversation?.id`。如果 Claude 运行期间用户切换会话，TodoWrite 结果会同步到当前选中的 conversation，而不是发起请求的 conversation。

建议:

- 和 `complete` 一样按 `event.sessionId` 查原始 `conversationId`。
- `useTodoStore.getState().onTodoUpdated(event)` 如果影响当前 UI，也需要带 conversationId 或只在当前 conversation 匹配时更新展示状态。

验收:

- 流式期间切换会话，TodoWrite 仍写回原 conversation。
- 当前页面不会显示另一条会话的 todo 状态。

#### M3. [P2] Safety timeout still does not abort the provider session

位置: `src/renderer/src/stores/chatStore.ts:133-146`

5 分钟 safety timeout 只清空 renderer 流式状态，没有调用 `chat.abort()`，也没有结束 memory agent session。用户看到 UI 停止，但 Claude 进程可能继续运行并发回 late events，memory 里也可能留下 active runtime session。

建议:

- timeout 时读取当前 `streamingRequestId`，调用 `window.api.chat.abort(sessionId)`。
- 同步调用 `endAgentSessionByExternalId(sessionId)`。
- 清理本轮 pending prompts / tools，避免 late event 复活旧 turn。

验收:

- timeout 后 provider 不再继续生成。
- memory agent session 不会因为 timeout 留在 active。

#### M4. [P2] Abort still leaves stale turn UI state

位置: `src/renderer/src/stores/chatStore.ts:427-439`

abort 现在会中断 Claude 并结束 memory agent session，但仍未清理 `pendingPermissions`、`pendingQuestions`、`tools`、`currentTurnToolIds`。用户停止后旧权限/问题卡片仍可能可见并可点击，工具卡片也可能被下一轮状态复用。

建议:

- abort 时按当前 sessionId 过滤 pending permission/question。
- 重置本轮 `tools` 和 `currentTurnToolIds`。
- 如需保留历史工具展示，应只从已持久化 message 的 `tool_calls` 渲染，不复用当前 turn 状态。

验收:

- 点击停止后不再显示旧权限、问题、运行中工具。
- 下一轮发送不会继承上一轮工具状态。

#### M5. [P2] Tool input delta is still ignored during stream parsing

位置: `src/main/ai/event-parser.ts:173-181`

`content_block_delta` 目前只处理 `text_delta` 和 `thinking_delta`，没有处理 Claude stream 的 `input_json_delta`。这意味着 tool 参数仍依赖最终 assistant block 来覆盖初始 `{}`；如果最终 block 缺失或中断，UI 和落库的 `tool_calls` 仍可能保留空参数。

建议:

- 按 content block index/id 累积 `input_json_delta`。
- 可解析时更新已有 `tool_start`，或新增内部 `tool_input_delta` 事件。

验收:

- 工具参数在流式过程中能逐步/最终稳定展示。
- 中断或错误时，已接收的参数片段不会全部丢失。

### 2026-04-30 代码 Review

本轮复核范围: conversation search 类型、memory IPC / 文件边界、Todo 事件归属、Claude stream tool input parser。

验证结果:

- `pnpm exec tsc --build --force --pretty false` 失败。
- `pnpm build` 通过。

结论: production build 仍能产出包，但类型检查已经不干净；同时 memory 真相源边界和 marker 文件写入边界还需要收紧。以下为当前需要处理的问题。

#### N1. [P0] Typecheck fails on conversation search result type

位置: `src/renderer/src/components/ConversationSearch.tsx:26-27`

`conversation.search` 的 preload / global 类型声明为 `Promise<ConversationItem[]>`，但 main 实际返回的是搜索结果形状:

```typescript
{
  id: string
  title: string | null
  snippet: string
  matchedAt: number
  rank: number
}
```

UI 里把返回值强转成 `SearchResult[]`，`pnpm exec tsc --build --force --pretty false` 已经报错:

```text
Conversion of type 'ConversationItem[]' to type 'SearchResult[]' may be a mistake...
```

建议:

- 新增共享类型，例如 `ConversationSearchResult`。
- 将 `src/main/ipc/conversation.ts`、`src/preload/index.ts`、`src/renderer/src/types/global.d.ts`、`ConversationSearch.tsx` 的返回类型统一。
- 不要用 `as SearchResult[]` 掩盖接口漂移。

验收:

- `pnpm exec tsc --build --force --pretty false` 通过。
- conversation search UI 仍能展示 `snippet / matchedAt`。

#### N2. [P1] Public project item create bypasses durable memory source

位置: `src/main/ipc/memory.ts:105-109`

`memory:materializeCandidate` 已经会先写 `.bytro/project-memory.md`，再写 `project_memory_items` read model；但 `memory:createProjectItem` 仍通过 preload 暴露给 renderer。renderer 因此可以直接写 SQLite read model，绕过 candidate 审核和 durable 文件真相源。后续 rebuild / 迁移时，这类“长期记忆”没有 `.bytro/project-memory.md` 或 marker 来源，可能直接丢失。

建议:

- 移除 renderer 可调用的 `memory:createProjectItem`。
- `createProjectMemoryItem` 只作为 main 内部索引器 / materializer 的实现细节。
- renderer 新增长期记忆时统一走 candidate -> materialize -> index 流程。

验收:

- `src/preload/index.ts` 和 `global.d.ts` 不再公开 `createProjectItem`。
- 任意 `project_memory_items` row 都能追溯到 durable source path / candidate / marker。

#### N3. [P1] Marker filename can escape `.bytro/markers`

位置: `src/main/core/memory-fs.ts:90-100`

`readMarker` / `writeMarker` 直接把 renderer 传入的 `filename` 拼到 markers 目录下，没有 `basename` / 后缀校验，也没有 `assertInside`。因为 preload 暴露了 `memory.readMarker` 和 `memory.writeMarker`，恶意或错误 payload 可以使用 `../project-memory.md`、`../../package.json` 等名字读写 markers 目录外的文件。

建议:

- 增加 `assertSafeMarkerName(name)`，要求:
  - `basename(name) === name`
  - 只允许 `[A-Za-z0-9_.-]+`
  - 必须以 `.yaml` 结尾
- `readMarker` / `writeMarker` 构造 target 后调用 `assertInside(markersDir, target)`。

验收:

- `../`、绝对路径、非 `.yaml` 文件名都被拒绝。
- 合法 marker 文件仍可正常读写。

#### N4. [P1] Todo updates still route to the selected conversation

位置: `src/renderer/src/stores/chatStore.ts:660-670`

`complete` 已经按 `event.sessionId -> sessionConversationIds` 路由 assistant 落库，但 `todo_updated` 仍使用当前 UI 选中的 `state.currentConversation?.id`。如果 Claude 运行期间用户切换会话，TodoWrite 结果会同步到错误 conversation。

建议:

- 为 `todo_updated` 事件补 `sessionId`，或确保 main 转发时附带 sessionId。
- 在 renderer 中优先用 `event.sessionId` 查 `sessionConversationIds`。
- 只有缺失 session 映射时，才 fallback 到当前 conversation。

验收:

- 流式期间切换会话，TodoWrite 仍写回发起请求的 conversation。
- 当前 UI 不会显示/覆盖另一条会话的 todo 状态。

#### N5. [P2] Stream parser still ignores tool input deltas

位置: `src/main/ai/event-parser.ts:173-181`

Claude stream 里工具参数经常先以空对象出现在 `content_block_start`，真实参数随后通过 `input_json_delta` 分片到达。当前 parser 仍只处理 `text_delta` 和 `thinking_delta`，导致工具参数依赖最终 assistant block 修正；如果最终 block 缺失或中断，UI 和落库的 `tool_calls` 会保留 `{}`。

建议:

- 按 content block index / tool id 维护 tool input buffer。
- 解析 `content_block_delta` 的 `input_json_delta`，累积 partial JSON。
- 可解析时更新已有 tool card，可以复用幂等 `tool_start`，也可以新增内部 `tool_input_delta` 事件。

验收:

- 工具执行期间参数不再长时间显示 `{}`。
- 中断或错误时，已收到的工具参数片段不会全部丢失。

### C1. [已修复][P1] Main process never forwards AI session events to renderer

位置:

- `src/main/ipc/chat.ts:7-14`
- `src/main/ai/engine.ts:45-48`

Renderer 通过 `window.api.chat.onEvent` 监听 `ai:event`，但 `chat:startSession` 只调用 `aiEngine.startSession(config)` 并返回 session，没有把该 session 的 provider event 绑定到 `BrowserWindow.webContents.send('ai:event', event)`。`ClaudeCLIProvider` 的 stdout parser 只 `emit(event:${sessionId})`，如果 main IPC 不订阅并转发，renderer 永远收不到 `text_delta / complete / done`，会一直停在乐观流式状态直到 5 分钟 safety timeout。

建议:

- 在 `chat:startSession` 中获取 `BrowserWindow.fromWebContents(event.sender)`。
- session 创建成功后调用 `aiEngine.onEvent(session.id, handler)`，在 handler 里 `webContents.send('ai:event', { ...event, sessionId: session.id })`。
- 在 `chat:endSession`、窗口关闭、provider exit/done 后调用 `offEvent` 清理 handler，避免泄漏。

验收:

- 发送消息后 renderer 能收到 `system_init / text_delta / complete / done`。
- 切换/关闭窗口不会留下悬挂 listener。

### C2. [已修复][P1] Claude CLI stdin message shape is still wrong

位置: `src/main/ai/providers/claude-cli.ts:80-85`

`sendMessage` writes `{ type: 'user_message', content }` to stream-json stdin. 本地 `@anthropic-ai/claude-code` SDK 写入用户消息的形状是:

```json
{
  "type": "user",
  "session_id": "",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "..." }]
  },
  "parent_tool_use_id": null
}
```

With the current shape, CLI input is likely ignored or rejected.

建议:

- 使用已验证的 JSONL shape。
- 或者直接委托 SDK 处理输入协议，避免手写 stream-json stdin。

验收:

- 不再向 CLI 写入 `type: "user_message"`。
- 最小 smoke test 能证明 `sendMessage(...)` 后 CLI 实际产生 assistant/result 事件。

### C3. [已修复][P1] Process exit/error does not emit terminal events

位置: `src/main/ai/providers/claude-cli.ts:55-61`

`child.on('exit')` only deletes the session, and stderr/spawn errors are ignored. If Claude exits before emitting a `result` line, fails to spawn, or dies with an error, renderer never receives `error` or `done`; the UI remains in streaming state until the 5-minute timeout. This is especially likely when `claude` is not installed, the working directory is invalid, or the CLI rejects the input.

建议:

- Listen for `child.on('error')` and emit `{ type: 'error', error: message }` plus `{ type: 'done', id: sessionId }`.
- On `exit`, if no `done` has been emitted for the session, emit `done`; if exit code is non-zero, emit `error` first.
- Consider buffering stderr for a short diagnostic message.

验收:

- CLI spawn failure or non-zero exit clears renderer streaming state promptly.
- 用户能看到失败原因，而不是无限“运行中”。

### C4. [已修复][P1] Completed assistant messages can be saved to the wrong conversation

位置: `src/renderer/src/stores/chatStore.ts:458-490`

On `complete`, the store persists the assistant reply to `state.currentConversation.id`, not the conversation that originally sent the request. If the user switches conversations while streaming, the reply is written into the newly selected conversation.

建议:

- 在 `sendMessage` 时维护 `requestId -> conversationId` 映射。
- `complete` 时按 requestId 找原始 conversationId 落库。

验收:

- 流式期间切换会话不会把 assistant 回复写入错误 conversation。

### C5. [已修复][P1] Persisted assistant reply is not appended to UI state

位置: `src/renderer/src/stores/chatStore.ts:473-490`

The `message.create` promise is fire-and-forget and its returned assistant message is never appended to `messages`; immediately after that, `streamingText` is cleared. A successful response can disappear from the UI until the conversation is reloaded.

建议:

- `message.create(...)` 成功后，如果当前仍在同一会话，把返回的 assistant message append 到 `messages`。
- 如果用户已经切走，只更新对应 conversation 的元数据，不污染当前 `messages`。
- 可以先用 optimistic assistant message 替换流式气泡，再用 DB 返回值修正 id / created_at。

验收:

- 回复完成后，当前会话里立即显示持久化后的 assistant message，不需要手动刷新。

### C6. [已修复][P2] Assistant parser drops all but the first content block

位置: `src/main/ai/event-parser.ts:56-74`

`parseAssistant` only inspects `content[0]`. Claude assistant messages can contain multiple blocks, such as text plus `tool_use` or thinking plus text, so later blocks will be dropped and the UI can miss tool calls or text.

建议:

- 像 `parseResult` 一样返回 `AIEvent[]`。
- 遍历 `data.message.content` 中的每个 block，为每个 `text / thinking / tool_use` 生成事件。
- 保留 block 顺序，避免工具调用和文本显示错序。

验收:

- 单条 assistant message 中多个 content block 都能映射成 UI 事件。
- text + tool_use、thinking + text 的组合不会丢失。

### 代码侧建议处理顺序

1. 先补齐 main → renderer 的 AI event 转发链路。
2. 修正 Claude CLI stdin message shape，或改用 SDK 输入协议。
3. 给 provider 的 spawn error / exit 补 `error + done` 终止事件。
4. 修复 renderer 的 `requestId/sessionId -> conversationId` 映射和 assistant message append。
5. 让 EventParser 支持 assistant 多 content blocks。

## P1 必须先修

### 1. 总览和模块 1 的进程架构互相冲突

位置: `docs/specs/2026-04-28-bytro-p0-design.md:30-33`

总览写的是 P0 使用 `child_process.spawn`，并明确说 `stream-json` 已提供完整双向 JSON 协议，不需要 PTY。但 `docs/modules/ai-provider.md` 已经改成“双模式启动”：`plan / autoEdit / fullAuto` 用 child_process，`manual` 用 `node-pty`。

这个冲突会让实现出现两种相反路线：按总览做会跳过 manual 权限审批路径，按模块 1 做又会违反总览架构决策。

建议:

- 如果确认 manual 模式必须 PTY，总览同步改为“双模式”:
  - `plan / autoEdit / fullAuto`: `child_process + -p + stream-json`
  - `manual`: `node-pty + 交互式 CLI`
- 如果最终决定不用 PTY，则从模块 1 删除 PTY 设计，并补充已验证的 JSON control protocol。

验收:

- 总览和模块 1 对进程模式的描述一致。
- 文档明确 manual 权限审批到底由 PTY、SDK `canUseTool`，还是 raw CLI control protocol 承担。

### 2. stream-json stdin 示例仍是错误协议形状

位置: `docs/modules/ai-provider.md:105-108`

模块 1 仍写 stdin 发送:

```json
{"type":"user_message","content":"..."}
```

但本地 `@anthropic-ai/claude-code` SDK / CLI 的 stream-json 用户输入形状是:

```json
{
  "type": "user",
  "session_id": "",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "..." }]
  },
  "parent_tool_use_id": null
}
```

按当前文档实现，CLI 很可能不会消费用户消息。

建议:

- 把文档里的 stdin 示例改成真实 JSONL shape。
- 或者明确不手写 raw stdin，改为复用 SDK `query()` / `streamInput()` 维护协议兼容。
- 如果仍选择 raw CLI，补一个最小验证脚本记录实际输入/输出样例。

验收:

- 文档不再出现 `type: "user_message"`。
- 用户消息、权限响应、问题回答的输入 shape 都来自已验证协议。

### 3. 搜索 SQL 表名仍与实际 schema 不匹配

位置: `docs/modules/conversation-management.md:35-43`

实际 DB 创建的是 `messages_fts`，当前代码里的 `conversation:search` 也查询 `messages_fts`。文档仍使用不存在的 `fts_messages`，并且 `snippet()` / `MATCH` 也引用了这个表名。按文档实现会直接 SQL 报错。

建议 SQL:

```sql
SELECT
  c.id,
  c.title,
  snippet(messages_fts, 0, '<<', '>>', '...', 32) AS snippet,
  m.created_at AS matchedAt,
  bm25(messages_fts) AS rank
FROM messages_fts
JOIN messages m ON m.rowid = messages_fts.rowid
JOIN conversations c ON c.id = m.conversation_id
WHERE messages_fts MATCH ?
ORDER BY rank
LIMIT 20;
```

验收:

- 表名统一为 `messages_fts`。
- join 使用 `m.rowid = messages_fts.rowid`。
- `snippet()` 的表名和列索引与 `src/main/core/db.ts` 中 FTS 表定义一致。

## P2 需要收敛

### 4. 选择器示例使用了不存在的 preload API 和类型导出

位置: `docs/modules/selectors.md:14-38`

当前 preload 只暴露 namespaced `window.api`，没有 `window.api.invoke`。`src/renderer/src/types/global.d.ts` 里也没有可从 `@renderer/types/global` 导入的 `PermissionMode` 模块类型。照文档示例写会遇到运行时 `window.api.invoke is not a function` 或 TS import 失败。

建议:

- 文档改为新增并使用 `window.api.dialog.openDirectory()`。
- preload / global.d.ts 增加对应 namespaced API:

```typescript
dialog: {
  openDirectory: () => Promise<string | null>
}
```

- 将 `PermissionMode` 放到 renderer 可导入的 shared 类型文件，例如 `src/renderer/src/types/ai.ts`，或在 `sessionConfigStore.ts` 本地定义同名 union。

验收:

- 示例代码不再调用 `window.api.invoke(...)`。
- 示例中的 `PermissionMode` 能被 TypeScript 正常导入或本地解析。

### 5. AI 状态事件契约仍和现有 AIEvent 不一致

位置: `docs/modules/ai-status-visualization.md:101-112`

文档开头说模块 4 只消费内部 `AIEvent`，但 Subagent 部分仍定义 `hook_started / hook_response`，Todo 部分仍从 `text_delta` 文本里解析 markdown checkbox。当前 `src/main/ai/types.ts`、`src/renderer/src/types/global.d.ts` 和 `chatStore` 已经使用的是:

- `todo_updated`
- `subagent_started`
- `subagent_stopped`
- `subagent_completed`

建议:

- 模块 1 的 EventParser 统一产出现有 AIEvent:
  - `todo_updated`
  - `subagent_started`
  - `subagent_stopped`
  - `subagent_completed`
- 模块 4 只消费这些内部事件。
- 不要在 UI store 里再次解析 CLI raw hook 或 assistant markdown。
- 如果 raw CLI 暂时无法稳定提供 Subagent / Todo，则 P0 降级为“有事件则显示，无事件则隐藏”。

验收:

- 模块 4 文档不再把 `hook_started / hook_response` 作为 UI store 直接消费事件。
- Todo 数据源优先来自 `todo_updated`，而不是从 `text_delta` 猜 markdown checkbox。

### 6. 标题保护字段命名和 schema 位置还没落到实际工程约定

位置:

- `docs/modules/conversation-management.md:80-87`
- `docs/modules/conversation-management.md:153`

文档设计了 `titleManuallySet`，但实际 SQLite schema 在 `src/main/core/db.ts`，现有列名都是 snake_case。照当前文档实现，容易在 DB 层引入 camelCase 字段，或者把 schema 改到不存在的 `src/main/db/` 路径。

建议:

- DB 字段使用 snake_case:

```sql
title_manually_set INTEGER NOT NULL DEFAULT 0
```

- 文档里的 schema 修改位置改为 `src/main/core/db.ts`。
- 如果 renderer 需要 camelCase，明确 IPC 层负责映射:
  - DB: `title_manually_set`
  - Renderer: `titleManuallySet`

验收:

- 文档中 schema 变更指向 `src/main/core/db.ts`。
- DB 字段名使用 snake_case，和现有表结构一致。
- 自动标题和手动标题更新路径明确区分。

## 已收敛的历史问题

以下问题上一轮 review 中出现过，本轮复核时文档已有明显修正，不再作为当前主阻塞:

- 模块 2/3/4 大量 Vue / Pinia 示例已改为 React + Zustand。
- 权限模式命名已基本统一到 `manual / autoEdit / plan / fullAuto`。
- 自动标题已经补充手动保护思路，但字段命名和 schema 位置仍需按本轮 P2 修正。

## 建议处理顺序

1. 先统一模块 1 的进程模式：child_process、PTY、SDK `canUseTool` 三者只能留下清晰的一套边界。
2. 修正 stream-json stdin 协议示例，必要时补 spike 结果。
3. 修正 conversation search SQL 表名和 snippet 语句。
4. 修正 selectors 的 preload API 示例和 `PermissionMode` 类型来源。
5. 统一模块 4 的 AIEvent 契约。
6. 修正标题保护字段命名和 schema 文件路径。

## 当前可继续保留的方向

- P0 拆成 4 个模块是合理的。
- 模块 1 作为基础依赖是合理的，但必须先稳定协议和事件契约。
- 选择器、对话管理、状态可视化可以并行，但应依赖明确的 shared types / preload API / AIEvent。
- SQLite FTS5、conversation_usage、conversation_todos 等已有 schema 可以继续作为后续实现基础。
