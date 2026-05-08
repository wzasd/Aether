---
status: active
owner: mochi
last_updated: 2026-05-07
doc_kind: code-review
---

# Phases M, T1-T4, S Code Review

Review scope:

- **新建文件（6 个）**
  - `src/main/ai/memory-injection.ts` — FTS 记忆注入，`buildInjectionPrompt()`
  - `src/main/ai/team-config.ts` — `AgentTeam` 类型定义 + `DEV_TEAM` 常量 + `loadTeams()`/`getTeam()`
  - `src/main/ai/preset-profiles.ts` — 三个预置 Agent 的完整配置（id, systemPrompt, capabilities 等）
  - `src/main/ipc/team.ts` — `team:list` + `team:get` IPC handlers
  - `src/renderer/src/components/NewTaskDialog.tsx` — Solo/Team 模式选择器 UI，localStorage 记忆上次选择

- **修改文件（15 个）**
  - `db.ts` — SCHEMA_VERSION 13→14，conversations 加 team_id，agent_profile_configs 加 capabilities/when_to_use/output_contract，seed 三个 DevTeam 预设 profiles
  - `a2a-types.ts` — AgentProfile 加 capabilities/whenToUse/outputContract，A2ATask 加 pipelineStepId
  - `orchestrator.ts` — M1: sendUserMessage 注入项目记忆；T2: executeTask 后 runTeamPipeline（depth=0 守卫），executePipelineStep 含 feedback 回传；SQL 查询含新列
  - `agent-runtime.ts` — setKnownAgents 改接 AgentProfile[]，动态注入 agent card（preset 团队用静态 prompt，自定义 agent 注入 whenToUse+outputContract）
  - `context-selector.ts` — FileChangeEntry 类型升级（path+status+additions+deletions），loadLatestSummary 取 taskState，renderContextPacket 三段式 Markdown（TASK HANDOFF / TASK PROGRESS / PROJECT MEMORY）
  - `context-selector.test.ts` — 重写为 11 个测试，匹配新格式
  - `ipc/conversation.ts` — Conversation 接口加 team_id，create 接受 team_id，update allowedFields 加 team_id
  - `ipc/index.ts` — 注册 registerTeamIpc()
  - `ipc/agent.ts` — rowToProfile 加新列解析
  - `preload/index.ts` — conversation.create 加 team_id，新 team namespace
  - `chatStore.ts` — Conversation 接口加 team_id，createConversation 接受 team_id
  - `Sidebar.tsx` — handleNewChat→NewTaskDialog，对话列表 Users 图标 team badge
  - `Home.tsx` — Start New Chat→NewTaskDialog
  - `TaskRail.tsx` — 任务列表 Users 图标 team badge
  - `global.d.ts` — ConversationItem 加 team_id，ElectronAPI 加 team namespace

Verification:

- `pnpm run typecheck` — clean（exit code 0）
- `pnpm test` — 149 passed, 3 skipped, 1 pre-existing fail（better-sqlite3 原生模块版本不匹配，非本次引入）

## Findings

### [P1] #1 DB Migration v14 使用 `require()` 动态导入 AI 模块，存在循环依赖风险

**Files:** `src/main/core/db.ts` L602-603

```ts
const { DEV_TEAM } = require('../ai/team-config') as typeof import('../ai/team-config')
const { PRESET_PROFILES } = require('../ai/preset-profiles') as typeof import('../ai/preset-profiles')
```

`db.ts` 是核心基础设施模块，在 `initDatabase()` 时被最早加载。用 `require()` 在 migration 函数内动态导入 AI 模块，虽然避免了顶层循环依赖，但存在以下风险：

1. `team-config.ts` 和 `preset-profiles.ts` 自身可能间接依赖 `db.ts`（当前没有，但未来如果 team 从 DB 加载就会产生循环）
2. `require()` 在 ESM 环境下是 `createRequire` 的产物，虽然当前能用，但不够健壮

**Recommended fix:**

将 `PRESET_PROFILES` 的 seed 数据（id/name/role/model/capabilities/whenToUse/outputContract/systemPrompt）提取为一个纯数据常量文件（如 `preset-seed-data.ts`），不依赖任何 AI 模块。Migration 只导入纯数据。

Status: **Open**

### [P1] #2 `orchestrator.ts` 与 `ipc/agent.ts` 中 `rowToProfile` 重复定义

**Files:** `src/main/ai/orchestrator.ts` L38-56, `src/main/ipc/agent.ts` L28-46

两处有完全相同的 `AgentProfileRow` 接口 + `parseCapabilities` + `rowToProfile` 函数。DRY 违反——如果以后 `AgentProfile` 增加字段，需要同步改两处。

**Recommended fix:**

提取到共享位置，如 `src/main/ai/profile-utils.ts`：

```ts
export interface AgentProfileRow { ... }
export function parseCapabilities(raw: string | null): string[] { ... }
export function rowToProfile(row: AgentProfileRow): AgentProfile { ... }
```

Status: **Open**

### [P1] #3 `executePipelineStep` 中 feedback 回传逻辑有冗余 DB 查询

**Files:** `src/main/ai/orchestrator.ts` L581-595

```ts
const teamConfig = getTeam(this.getConversationTeamId(conversationId) ?? '')
```

每次 pipeline step 完成后都重新查询 `conversation.team_id`，然后重新加载 team config。在 `runTeamPipeline` 循环中，`teamConfig` 已经作为参数传入了 `executePipelineStep`，但 `executePipelineStep` 内部又重新查了一遍。

**Recommended fix:**

将 `teamConfig` 作为参数传入 `executePipelineStep`，避免冗余 DB 查询：

```ts
private async executePipelineStep(
  conversationId: string,
  teamConfig: AgentTeam,  // 新增参数
  stepIndex: number,
  ...
): Promise<void> {
  // 不再内部查询 teamConfig
}
```

Status: **Open**

### [P2] #4 `NewTaskDialog` 中 `selectedTeamId` 硬编码为 `'dev-team'`

**Files:** `src/renderer/src/components/NewTaskDialog.tsx` L34

```ts
const [selectedTeamId, setSelectedTeamId] = useState<string>('dev-team')
```

当前只有一个 team，硬编码可以工作。但如果未来增加多个 team，用户无法选择。`setSelectedTeamId` 已声明但从未调用——UI 缺少 team 选择器。

**Recommended fix:**

当 `teams.length > 1` 时，渲染 team 下拉选择器：

```tsx
{mode === 'team' && teams.length > 1 && (
  <select
    value={selectedTeamId}
    onChange={(e) => setSelectedTeamId(e.target.value)}
    className="..."
  >
    {teams.map((t) => (
      <option key={t.id} value={t.id}>{t.name}</option>
    ))}
  </select>
)}
```

Status: **Open**

### [P2] #5 `memory-injection.ts` 的 FTS 查询可能抛异常

**Files:** `src/main/ai/memory-injection.ts` L47-56

FTS5 的 `MATCH` 查询对特殊字符敏感（如 `*`、`"` 等）。用户消息的前 100 字符直接作为 FTS 查询词，如果包含 FTS5 语法字符会抛异常。

**Recommended fix:**

对 `queryText` 做 FTS 安全转义（如移除/转义 `*`、`"`、`:` 等 FTS5 特殊字符），或 try-catch 降级为空结果：

```ts
function escapeFtsQuery(text: string): string {
  return text.replace(/["*:+-]/g, ' ').trim()
}
```

Status: **Open**

### [P2] #6 `agent-runtime.ts` 中 `isDevTeamMember` 判断只检查 `claude-primary`

**Files:** `src/main/ai/agent-runtime.ts` L44

```ts
const isDevTeamMember = this.profile.id === 'claude-primary'
```

但 `codex-reviewer` 和 `opencode-ui` 也是 DevTeam 成员，它们的 system prompt 里也有静态团队描述。当前只有 Claude 走静态分支，Codex 和 OpenCode 会走动态注入分支，可能产生重复的 agent card 信息。

**Recommended fix:**

```ts
const PRESET_IDS = new Set(['claude-primary', 'codex-reviewer', 'opencode-ui'])
const isDevTeamMember = PRESET_IDS.has(this.profile.id)
```

Status: **Open**

### [P2] #7 `context-selector.ts` 的 `loadLatestSummary` 没有取 `taskState.decisions` 和 `taskState.blockers`

**Files:** `src/main/ai/context-selector.ts` L215-249

`loadLatestSummary` 只解析了 `completedItems` 和 `pendingItems`，但 `AgentContextPacket.taskState` 还有 `decisions` 和 `blockers` 字段，始终为空数组。

**Recommended fix:**

如果 `conversation_summaries` 表有对应字段（如 `risks`/`next_steps`），可以映射到 `decisions`/`blockers`；或者在 `AgentContextPacket` 类型中标注这两个字段为 optional，避免误导。

Status: **Open**

### [P2] #8 `orchestrator.ts` 中 `sendUserMessage` 的 memory injection 与 renderer 侧逻辑不一致

**Files:** `src/main/ai/orchestrator.ts` L110, `src/renderer/src/stores/chatStore.ts`

Main 侧用 `buildInjectionPrompt`（FTS + recent items），renderer 侧用 `buildMemoryContext`（`readProjectMemory` + `memoryPalace.list` + `getLatestSummary` + `getAgentProfile`）。两侧的记忆注入逻辑不一致。

**Recommended fix:**

确认这是有意设计（main 侧轻量 FTS 注入 vs renderer 侧全量上下文构建），如果是，加注释说明两侧职责差异。如果不是，应统一为同一套注入逻辑。

Status: **Open**

## Additional Codex Review Pass

Verification performed:

- `pnpm vitest run src/main/ai/context-selector.test.ts` — 11 tests passed.

### [P1] #9 团队任务不会自动进入 DevTeam orchestrator

**Files:** `src/renderer/src/stores/chatStore.ts` L631-640

新建团队任务只保存了 `team_id`，但发送消息时仍只看全局 `activeProfile`。用户如果没有手动选中 `claude-primary`，代码会走 default chat path，`conversation.team_id` 完全不会被 orchestrator 读取，T2 pipeline 也不会触发。

**Recommended fix:**

团队模式应在创建/发送时固定 primary profile，或 `sendMessage` 根据 `currentConversation.team_id` 推导 `claude-primary`，确保 DevTeam conversation 一定走 orchestrator path。

Status: **Open**

### [P1] #10 `on-code-change` reviewer 触发有竞态

**Files:** `src/main/ai/orchestrator.ts` L481-487

`runTeamPipeline()` 立刻查询 `file_changes` 判断是否触发 reviewer，但 `file_changes` 是 renderer 在收到 `tool_result` 后异步 IPC 记录的。当前调用没有等待，main process 的 runtime `done` 后可能先查到 0 条变更，从而跳过 Codex review。

**Recommended fix:**

文件变更检测最好放到 main/orchestrator 侧同步记录，或让 pipeline 基于 runtime/tool events 的内存状态判断，避免依赖 renderer 侧异步落库时序。

Status: **Fixed** — in-memory `fileChangeFlags` 替代 DB 查询，在 `tool_start` 时同步设置 flag，`isFileTool()` 归一化 MCP tool names 并支持 `Delete`

### [P2] #11 首个 task `done` 会提前解锁输入

**Files:** `src/renderer/src/stores/chatStore.ts` L1273-1308

orchestrator 路径里每个 agent runtime 都会发 `done`，而前端收到任何带 `taskId` 的 `done` 都会把全局 `streamingRequestId` 置空。主任务 `done` 后 pipeline/reviewer 仍可能继续运行，但 UI 已允许用户发送下一条消息，容易让同一 conversation 的 pipeline 和新请求交错。

**Recommended fix:**

把 composer busy 状态绑定到整个 orchestrator task chain，而不是单个 runtime `done`。可以增加 orchestration-level completion event，或只在 active A2A task queue drained 后清空 `streamingRequestId`。

Status: **Open**

### [P2] #12 `feedbackTo` 只显示，不会回传给 primary agent

**Files:** `src/main/ai/orchestrator.ts` L580-592

`executePipelineStep()` 找到 `feedbackTo` 后只是 `appendSystemMessage()`，把 reviewer 输出写成系统消息展示/持久化；它没有创建发给 `claude-primary` 的任务，也没有 resume primary runtime。因此 Codex 给 `NEEDS_CHANGES` 时 Claude 不会自动收到并修复，`feedbackTo` 字段的语义没有真正兑现。

**Recommended fix:**

如果 `feedbackTo` 表示自动回传，应创建一个 follow-up A2A task 给目标 profile，并带上 reviewer 输出与原 task context；如果只是展示，则重命名字段或在文档中明确它不是自动执行反馈。

Status: **Open**

### [P2] #13 空 assistant 历史会丢掉 memory/progress context

**Files:** `src/main/ai/context-selector.ts` L276-279

`buildContextPacket()` 在没有 recent assistant messages 时直接 `return packet`，导致后面的 project memories、recent file changes、latest summary/taskState 都不会加载。新委托或早期对话最需要这些上下文时反而拿不到 `PROJECT MEMORY` / `TASK PROGRESS`。

**Recommended fix:**

不要在 `candidates.length === 0` 时提前返回。只跳过 message scoring，继续执行 project memories、file changes、latest summary/taskState 的加载，并补一个 `buildContextPacket` 层测试覆盖“无 assistant 消息但有 memory/summary/file_changes”的场景。

Status: **Open**

## Second Codex Review Pass

Verification performed:

- `pnpm run typecheck` — passed.
- `pnpm vitest run src/main/ai/context-selector.test.ts src/renderer/src/stores/agentProfileStore.test.ts` — 22 tests passed.

### [P1] #14 团队任务仍会在无 active profile 时走 default chat path

**Files:** `src/renderer/src/stores/chatStore.ts` L639-656

本轮为团队模式增加了 primary profile 解析，但条件写成了 `if (teamId && activeProfile)`。这意味着只要全局 `activeProfile` 为空，DevTeam conversation 仍然不会解析 team primary，也不会进入 orchestrator path，和 #9 的核心问题相同。新建团队任务本身没有设置 active profile，ChatInput 的 profile 加载也是异步的，所以用户很容易触发这条路径。

**Recommended fix:**

把 team primary resolution 从 `activeProfile` 条件中移出：只要存在 `team_id` 就读取 team config，并直接用 primary `profileId` 查找/加载 profile。如果本地 profiles 尚未加载，应先 `await agentStore.loadProfiles(workspaceId)`，或让 main/orchestrator 根据 `team_id` 推导 primary profile，避免依赖 renderer 全局选择器状态。

### [P1] #15 `on-code-change` reviewer 触发竞态仍未消除 (merged into #10)

Status: **Fixed** — same fix as #10: in-memory `fileChangeFlags` + `isFileTool()` normalization, verified in 4th pass

### [P2] #16 单个 task `done` 仍会释放整个 composer

**Files:** `src/renderer/src/stores/chatStore.ts` L1292-1327

`done` handler 仍然不区分 `taskId`：即使是 orchestrator 的某个 agent runtime 完成，也会把 `streamingRequestId` 置空并 `clearStreamingTimeout()`。主任务完成后，team pipeline 和 feedback follow-up 可能还在运行或排队，用户此时可以继续发送新消息，造成同一 conversation 内多个 orchestrator 流程交错。

**Recommended fix:**

task-level `done` 只应清理对应 `taskStreams[taskId]`。全局 `streamingRequestId` 应等到 orchestrator 发出 conversation-level completion，例如 `a2a:allTasksCompleted`，或者 active/pending task count 归零后再清空。

Status: **Open**

### [P2] #17 feedback follow-up 仍依赖 renderer 异步持久化的最新 assistant 消息

**Files:** `src/main/ai/orchestrator.ts` L540-555

本轮把 `feedbackTo` 改成创建 follow-up A2A task，这是方向正确的修复。但 feedback 内容来自 `SELECT content FROM messages ... ORDER BY created_at DESC LIMIT 1`。pipeline step 的 assistant message 仍由 renderer 在 `complete` event 后异步写库；main process 等到 `done` 后立即查询 DB，可能查不到 reviewer 输出，或读到上一条 assistant 消息，导致 feedback task 不创建或带错内容。

**Recommended fix:**

在 main process 内捕获当前 runtime 的 `complete.fullText`，用这个内存值创建 feedback task；或者把 orchestrator-managed assistant persistence 移到 main，并在持久化成功后再创建 feedback。

Status: **Open**

### [P3] #18 `buildContextPacket` 修复缺少回归测试

**Files:** `src/main/ai/context-selector.test.ts`

#13 的实现已移除早退，代码现在会在无 assistant messages 时继续加载 memory/file changes/summary。但测试仍只覆盖 `renderContextPacket()`，没有覆盖 `buildContextPacket()` 连接 DB 的行为。因此未来如果早退回归，现有 11 个 context-selector 测试仍会通过。

**Recommended fix:**

为 `buildContextPacket()` 增加一条 DB mock 或 test DB 场景：无 assistant messages，但存在 project memory、file_changes、conversation_summary 时，packet 仍应包含 `PROJECT MEMORY` / `TASK PROGRESS` 数据。

Status: **Open**

## Third Codex Review Pass

Verification performed:

- `pnpm run typecheck` — passed.
- `pnpm vitest run src/main/ai/context-selector.test.ts src/renderer/src/stores/agentProfileStore.test.ts` — 23 tests passed.

### [P1] #19 team primary lookup still reads stale profile state after `loadProfiles()`

**Files:** `src/renderer/src/stores/chatStore.ts` L661-668

The fix now calls `await agentStore.loadProfiles(workspaceId)` when profiles are empty, but then immediately reads `agentStore.profiles` from the stale `getState()` snapshot captured before the await. Zustand updates the store state object, not this old snapshot, so a new DevTeam conversation with no previously loaded profiles can still fail to resolve `claude-primary` and fall through to the default chat path.

**Recommended fix:**

After `await agentStore.loadProfiles(workspaceId)`, read fresh state with `useAgentProfileStore.getState().profiles`, or have `loadProfiles()` return the loaded profiles. For team conversations, consider resolving the primary in main/orchestrator from `team_id` so this flow is not coupled to renderer profile cache timing.

Status: **Fixed** (4th pass verified: fresh `useAgentProfileStore.getState().profiles` is read after `loadProfiles()`)

### [P1] #20 composer can remain locked after orchestrator completion

**Files:** `src/renderer/src/stores/chatStore.ts` L1310-1318

The task-level `done` handler now correctly avoids releasing the global composer for individual runtime turns, but no replacement conversation-level completion signal was added. `streamingRequestId` is set to `orch:${conversationId}` before `orchestrator.sendMessage()`, and all orchestrator runtime `done` events include `taskId` and now `break` early. Once the entire orchestrator promise resolves, no code clears `streamingRequestId`, so the composer can remain in streaming/stop mode indefinitely.

**Recommended fix:**

Emit an orchestration-level completion event from main after `runTeamPipeline()` and `drainSerialQueue()` finish, or clear the global stream state in `chatStore.sendMessage()` after `await window.api.orchestrator.sendMessage(...)` returns. Keep task-level `done` scoped to `taskStreams`.

Status: **Fixed** (4th pass verified: global orchestrator streaming state is cleared after awaited `orchestrator.sendMessage()`)

### [P2] #21 main-process file-change flag misses normalized/delete tool names

**Files:** `src/main/ai/orchestrator.ts` L37, L162-164, L504-507

The new in-memory `fileChangeFlags` avoids the renderer DB race for exact `Write`/`Edit`/`NotebookEdit`, but it does not match the renderer's file-change detector. Renderer normalizes MCP-style names and treats `Delete` as a file operation; main only checks exact `event.toolName` membership and excludes `Delete`. A delete-only change, or a namespaced file operation like `mcp__fs__Write`, can still skip the `on-code-change` reviewer.

**Recommended fix:**

Share the same normalization/tool classification logic between renderer and main, or add a main-side helper equivalent to `normalizeToolName()` with `Write`, `Edit`, `Delete`, and `NotebookEdit` covered.

Status: **Fixed** (4th pass verified: main-side `isFileTool()` normalizes `mcp__...__Tool` names and includes `Delete`)

## Fourth Codex Review Pass (2026-05-05)

### Scope

Re-reviewed the fixes for:

1. **#19** team primary lookup stale Zustand profile snapshot
2. **#20** orchestrator completion never releasing the composer
3. **#21** main-process file-change flag missing normalized/delete tool names

### Result

No new P1/P2 findings for the three rechecked fixes.

### Verification

- `pnpm run typecheck` — passed
- `pnpm vitest run src/main/ai/context-selector.test.ts src/renderer/src/stores/agentProfileStore.test.ts src/renderer/src/utils/fileChange.test.ts` — passed, 40 tests

### Residual Risk

- **[P3] #18 remains open:** the regression test at `src/main/ai/context-selector.test.ts` still exercises `renderContextPacket()` with a manually constructed packet. It documents the `buildContextPacket()` early-return bug, but does not call `buildContextPacket()` against DB-backed memory / summary / file-change fixtures, so a future early-return regression in the builder would still pass.

## Fifth Codex Review Pass (2026-05-06)

### Scope

Reviewed Phase 1 follow-up changes around:

1. Agent profile discovery fields (`capabilities`, `whenToUse`, `outputContract`) through types, IPC, persistence, and Settings UI.
2. Centralized runtime resolution via `resolveRuntime()`.
3. Renderer flow for agent selection in Settings / new task entry points.

### Findings

### [P1] #22 Custom agent creation crashes at SQL prepare/run

**Files:** `src/main/ipc/agent.ts` L40-42

The `agent:createProfile` INSERT names 15 columns but only provides 14 placeholders, while `.run()` passes 15 values. This causes custom agent creation from Settings Agents to fail at runtime, so the new CRUD path is not usable despite renderer store mock tests passing.

**Recommended fix:**

Add the missing placeholder to the `VALUES` list and add a main-process or DB-backed regression test that exercises `agent:createProfile` with the new metadata fields.

Status: **Fixed** — INSERT VALUES placeholder count corrected (14→15)

### [P2] #23 `NewTaskDialog` selector is unreachable

Status: **Fixed** — wired into `SharedConversation.tsx` and `Sidebar.tsx` with `createConversation({ is_draft: 1, team_id })` on confirm

### [P2] #24 Optional agent metadata cannot be cleared

Status: **Fixed** — renderer sends explicit `null` for cleared text fields and `[]` for capabilities; IPC handler persists `NULL`/`"[]"` correctly; `PatchProfileData` types accept `| null`

## Sixth Codex Review Pass (2026-05-07)

### Scope

Re-reviewed fixes for:

1. **#22** custom agent creation SQL placeholder mismatch
2. **#23** `NewTaskDialog` reachability from real new-task entry points
3. **#24** clearable optional agent metadata

Verification:

- `pnpm run typecheck` — passed
- `pnpm vitest run src/renderer/src/stores/agentProfileStore.test.ts src/main/ai/runtime-resolver.test.ts` — passed, 23 tests

### Findings

### [P1] #25 Default agent selection persists invalid profile id

**Files:** `src/renderer/src/components/NewTaskDialog.tsx` L74-80

The dialog uses the sentinel string `default` for the Default option, then writes it into `activeProfileId`. `chatStore.createConversation()` always forwards `activeProfileId` as `agent_profile_id`, so choosing Default attempts to insert `agent_profile_id = 'default'` into `conversations`. With foreign keys enabled and no `agent_profile_configs.id = 'default'`, the normal default new-task path can fail before navigation.

**Recommended fix:**

Keep `'default'` as a local UI/localStorage sentinel if useful, but convert it to `null` before calling `setActiveProfile()`. Also consider guarding `chatStore.createConversation()` so only real profile IDs are forwarded as `agent_profile_id`.

Status: **Open**

### [P2] #26 Default model option still cannot clear model override

**Files:** `src/renderer/src/components/workspace/WorkspaceArea.tsx` L712-721

The edit form exposes a `Default model` option with an empty value, but save maps an empty `editModel` to `undefined`, which the IPC update handler skips. Profiles with an existing model cannot clear that model override, so the UI can still show stale model/provider pairings after selecting the default model option.

**Recommended fix:**

Give model the same explicit clear semantics as the other optional fields: if a previously populated model is cleared, send `model: null` (and update IPC/types to accept it), or remove the `Default model` option if model is intentionally required.

Status: **Open**

## Positive Observations

1. **DB Migration 健壮**：v14 用 `addMissingColumn` + `SELECT 1 ... WHERE id = ?` 幂等检查，不会重复 seed
2. **Team Pipeline 防循环**：`depth === 0` 守卫 + `detectLoop` 链路检测 + `MAX_DELEGATION_DEPTH` 三重保护
3. **IPC 层完整闭环**：`team:list/get` → preload → global.d.ts → renderer，类型全链路一致
4. **NewTaskDialog UX**：localStorage 记忆上次选择模式，team 预览展示 pipeline 成员
5. **Context Packet 三段式渲染**：TASK HANDOFF → TASK PROGRESS → PROJECT MEMORY，空 section 自动省略
6. **测试覆盖**：12 个测试覆盖了 render 分支（空 section 省略、截断、排序）
7. **Preset Profiles 质量**：三个 agent 的 systemPrompt 非常详细，包含职责边界、输出格式、委托规则
8. **Feedback 回传**：pipeline step 完成后自动将 reviewer 输出反馈给 `feedbackTo` 指定的 agent

## Resolution Summary

| Severity | Count | Fixed | Open |
|----------|-------|-------|------|
| P1 | 11 | 5 | 6 |
| P2 | 14 | 3 | 11 |
| P3 | 1 | 0 | 1 |
| **Total** | **26** | **8** | **18** |

**Open items requiring action (by priority):**

1. **[P1]** #1 DB Migration `require()` 循环依赖风险 — 提取纯数据 seed 文件
2. **[P1]** #2 `rowToProfile` 重复定义 — 提取到 `profile-utils.ts`
3. **[P1]** #3 `executePipelineStep` 冗余 DB 查询 — 传入 `teamConfig` 参数
4. **[P1]** #9 团队任务不会自动进入 DevTeam orchestrator — 团队 conversation 固定 primary profile 或由 `team_id` 推导
5. **[P1]** #14 团队任务仍会在无 active profile 时走 default chat path — team primary resolution 从 activeProfile 条件中移出
6. **[P1]** #25 Default agent selection persists invalid profile id — 将 `default` UI sentinel 转成 `null`，避免写入 `agent_profile_id`
7. **[P2]** #4 `NewTaskDialog` 硬编码 teamId — 多 team 时渲染选择器
8. **[P2]** #5 FTS 查询特殊字符异常 — 转义或 try-catch
9. **[P2]** #6 `isDevTeamMember` 判断不完整 — 改为 Set 检查
10. **[P2]** #7 `decisions`/`blockers` 始终为空 — 映射或标 optional
11. **[P2]** #8 两侧 memory injection 逻辑不一致 — 确认意图并加注释
12. **[P2]** #11 首个 task `done` 会提前解锁输入 — 等 orchestrator task chain 完成后再释放 composer
13. **[P2]** #12 `feedbackTo` 只显示不回传 — 创建 follow-up A2A task 或调整字段语义
14. **[P2]** #13 空 assistant 历史会丢掉 memory/progress context — 移除提前 return 并补测试
15. **[P2]** #16 单个 task `done` 仍会释放整个 composer — task-level done 只清理对应 taskStreams
16. **[P2]** #17 feedback follow-up 仍依赖 renderer 异步持久化的最新 assistant 消息 — 用内存值创建 feedback task
17. **[P2]** #26 Default model option still cannot clear model override — model 字段使用显式清空语义或移除默认选项
18. **[P3]** #18 `buildContextPacket` 修复缺少回归测试 — 增加 DB mock 场景覆盖无 assistant messages + 有 memory/summary
