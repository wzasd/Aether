---
status: active
owner: bytro
last_verified: 2026-05-07
doc_kind: architecture
applies_to:
  - src/main/ai/orchestrator.ts
  - src/main/ai/agent-runtime.ts
  - src/main/ai/mention-parser.ts
  - src/main/ai/a2a-types.ts
  - src/main/ai/invocation-queue.ts
  - src/main/ai/continuity-capsule.ts
  - src/main/ai/reflow-orchestrator.ts
  - src/main/ai/a2a-memory-distiller.ts
  - src/main/ipc/orchestrator.ts
  - src/renderer/src/stores/chatStore.ts
  - src/renderer/src/stores/a2aStore.ts
  - src/renderer/src/stores/sessionConfigStore.ts
  - src/renderer/src/components/chat/AgentBadge.tsx
  - src/renderer/src/components/chat/ChatInput.tsx
---

# Multi-Agent A2A Orchestration

Date: 2026-05-02

## Implementation Status

### Milestone 1 — Serial orchestration（已完成）

| # | 需求 | 文件 | 状态 |
|---|------|------|------|
| 1 | `messages.agent_profile_id` DB + IPC | `main/core/db.ts`, `main/ipc/conversation.ts` | ✅ |
| 2 | `a2a_tasks` 表持久化 | `main/core/db.ts`, `main/ai/orchestrator.ts` | ✅ |
| 3 | Mention parser（已知 agent 名称，13 条测试） | `main/ai/mention-parser.ts` | ✅ |
| 4 | Orchestrator 串行队列 | `main/ai/orchestrator.ts` | ✅ |
| 5 | Context Packet 构建 | `main/ai/orchestrator.ts:buildContextSnapshot` | ⚠️ 简化版 |
| 6 | Routed AI events（含 agentProfileId/taskId/conversationId） | `main/ai/orchestrator.ts` | ✅ |
| 7 | Agent 徽章显示 | `renderer/.../AgentBadge.tsx`, `MessageList.tsx` | ✅ |
| 8 | 循环检测 + depth/count 限制 + 阻止消息 | `main/ai/orchestrator.ts` | ✅ |
| 9 | mention 输出内去重 | `main/ai/orchestrator.ts` | ✅ |
| 10 | `runtimeKey = conversationId:profileId` | `main/ai/orchestrator.ts` | ✅ |

### Milestone 2 — 已完成（2026-05-07）

| # | 需求 | 文件 | 状态 |
|---|------|------|------|
| M2-1 | 并行执行 | `orchestrator.ts` | ✅ |
| M2-2 | Per-task 流式缓冲区 | `chatStore.ts` (`taskStreams`) | ✅ |
| M2-3 | 完整 Context Packet 选择器 | `context-assembler.ts` | ✅ |
| M2-4 | Memory Palace 候选提取 | `memory-extractor.ts` | ✅ |
| M2-5 | A2A 任务队列 UI | `TaskGraph.tsx`, `AgentActivityPanel.tsx` | ✅ |

### Gap Fill（vs clowder-ai）— 已完成（2026-05-07）

| # | 组件 | 文件 | 说明 |
|---|------|------|------|
| 1 | InvocationQueue | `invocation-queue.ts` | 优先级队列 + 僵尸防御 + 队列位置 + **幂等键去重** |
| 2 | ContinuityCapsule | `continuity-capsule.ts` | Session seal/续传，**`formatContinuationPrompt` 注入 Agent 消息**，**`chainIndex/chainTotal` 链位置** |
| 3 | ReflowOrchestrator | `reflow-orchestrator.ts` | 并行多 Agent 结果聚合 + 状态机 + **AbortController 取消追踪** |
| 4 | ACP switchModel | `agent-runtime.ts` | 动态模型切换，利用 ACP `session/set_model` |
| 5 | A2A Memory Distiller | `a2a-memory-distiller.ts` | Chain-level 记忆蒸馏（跨 Agent 协作惯例） |
| 6 | drainSerialQueue microtask yield | `orchestrator.ts` | `await Promise.resolve()` 修复 feedback task 永久排队 bug |

This document records the target design for Bytro multi-agent orchestration. It is a reference for implementation planning, review, and future iteration.

## Goal

Bytro should support multiple Agent Profiles collaborating around one task-level conversation.

The intended model is:

- A `conversation` represents one task or work thread in Bytro.
- All participating agents write into the same conversation timeline.
- Every assistant message can be attributed to an `agent_profile_id`.
- Agent-to-agent delegation can be triggered by explicit `@AgentName: ...` mentions.
- Delegation can run in serial or parallel mode, with serial as the default.
- Project-relevant learnings and decisions can later be distilled into Memory Palace.

The important distinction is that agents share the Bytro conversation, not necessarily one underlying Claude session.

Each Agent Profile may still have its own runtime/session, model, system prompt, and permission mode. The orchestrator is responsible for turning the shared conversation into a carefully selected context packet for the next agent.

## Core Principle

The next agent should see the minimum sufficient context needed to complete its assigned work.

Do not pass the entire conversation history by default. Full history is expensive, noisy, and can confuse role boundaries. Instead, construct a temporary `Context Packet` for every delegation.

## Recommended Runtime Model

Use this shape:

```text
Bytro conversation = shared task workspace
AgentRuntime session = per conversation + per profile execution context
Context Packet = selected task memory passed between agents
Memory Palace = durable project-level knowledge after distillation
```

Runtime identity should be keyed by both conversation and profile:

```text
runtimeKey = `${conversationId}:${profileId}`
```

Avoid using only `profileId -> runtime`, because that would allow one agent session to leak context across unrelated conversations.

## Delegation Flow

```text
User message
  -> orchestrator.sendUserMessage
  -> selected/default AgentRuntime
  -> assistant output is written to the shared conversation
  -> orchestrator parses @mentions
  -> creates A2A task records
  -> builds Context Packet for each target agent
  -> executes target AgentRuntime
  -> target output is written back to the same conversation
```

Example agent output:

```text
@Coder: Implement the upload component described above. Support drag and drop, progress, retry, and cancellation.
```

The orchestrator should:

1. Parse the mention.
2. Resolve the target Agent Profile.
3. Check loop/depth/task-count limits.
4. Create an `a2a_tasks` record.
5. Build the target agent's Context Packet.
6. Execute the task according to the current execution mode.
7. Persist the result as an assistant message with the target `agent_profile_id`.

## Context Packet

A Context Packet is the selected memory and task state sent to the next agent.

Recommended shape:

```ts
interface AgentContextPacket {
  task: {
    fromAgentName: string | null
    toAgentName: string
    instruction: string
  }
  taskState: {
    goal: string
    completed: string[]
    pending: string[]
    decisions: string[]
    blockers: string[]
  }
  relevantMessages: Array<{
    messageId: string
    agentProfileId: string | null
    summary: string
    reason: string
  }>
  projectMemories: Array<{
    id: string
    title: string
    content: string
    relevanceReason: string
  }>
  files?: string[]
}
```

The text injected into the target agent can be rendered from this structure:

```text
[Task]
From: @Planner
To: @Coder
Instruction:
Implement the upload component described above. Support drag and drop, progress, retry, and cancellation.

[Current Task State]
Goal:
Build a reliable upload flow for the current project.

Completed:
- Planner chose a local-first upload queue.
- The target component location is src/components/upload.

Decisions:
- Do not integrate cloud storage in this iteration.
- Support cancellation for large files.

Blockers:
- API contract for upload retry is not finalized.

[Relevant Conversation Context]
- User prefers a compact operational UI rather than a marketing-style flow.
- Reviewer previously warned that large-file cancellation must be handled.

[Relevant Project Memory]
- Project uses existing component conventions under src/components.
- Avoid creating unrelated abstractions unless they reduce real duplication.
```

## What To Include

Prioritize these sources in order:

1. The explicit `@mention` instruction.
2. Current task goal and success criteria.
3. Decisions already made in this conversation.
4. Pending questions or blockers.
5. Recently completed steps that affect the target task.
6. Files, modules, commands, or APIs relevant to the target task.
7. Project memories relevant to the target agent's role.
8. Recent assistant/user messages only when they directly affect the task.

## What To Exclude

Exclude by default:

- Unrelated conversation history.
- Full raw tool logs.
- Large diffs unless the next agent must inspect them.
- Other agents' full long-form reasoning.
- Obsolete decisions unless they prevent repeating a mistake.
- Memory Palace entries with weak relevance.
- Project memory unrelated to the current role or task.

## Role-Sensitive Memory Selection

Different agents need different memory.

Planner should see:

- User goals.
- Product constraints.
- Prior decisions.
- Open questions.
- Scope boundaries.

Coder should see:

- Implementation instructions.
- Relevant files and modules.
- Architecture conventions.
- API contracts.
- Known coding pitfalls.
- Decisions that constrain implementation.

Reviewer should see:

- Requirements and acceptance criteria.
- Risk areas.
- Recent file changes.
- Historical bugs.
- Security, performance, and UX constraints.
- Deviations from project conventions.

## Selection Algorithm

First implementation can use deterministic rules plus keyword search.

Suggested algorithm:

```text
1. Start from the @mention content.
2. Add the target agent role and known relevant files.
3. Build a retrieval query:
   role + mention task + current files + recent decisions + conversation title
4. Retrieve candidate context from:
   - current conversation messages
   - conversation summaries
   - task events
   - file changes
   - Memory Palace/project memory
5. Score candidates:
   score =
     relevance * 0.50 +
     recency * 0.20 +
     roleMatch * 0.20 +
     explicitMention * 0.10
6. Keep within a fixed token budget.
7. Render the Context Packet into the target agent prompt.
```

Later, this can become a dedicated `ContextSelector` service. The first version does not need an LLM selector, but the interface should allow one later.

## Serial And Parallel Execution

Serial is the default.

Serial behavior:

```text
Agent A completes
  -> mentions Agent B
  -> task is queued
  -> Agent B runs after Agent A is done
```

Parallel behavior:

```text
Agent A output contains mentions for Agent B and Agent C
  -> both tasks can run at the same time
  -> renderer must keep separate streaming buffers by task/session/agent
```

Parallel mode requires the event model to include enough routing fields:

```ts
interface RoutedAIEvent {
  conversationId: string
  agentProfileId: string | null
  taskId?: string
  sessionId: string
  type: string
}
```

Without per-task or per-session buffers, parallel outputs will mix together in the renderer.

## Loop Protection

Use multiple safeguards:

- `chain`: full delegation path, such as `['user', 'planner-id', 'coder-id']`.
- `MAX_DELEGATION_DEPTH`, recommended initial value: `5`.
- `MAX_TASKS_PER_CONVERSATION`, recommended initial value: `20`.
- Block if `toProfileId` already appears in `chain`.
- Deduplicate repeated mentions from the same assistant output.
- Do not auto-retry failed tasks unless the user explicitly asks.

When a loop is blocked, write a system message into the conversation:

```text
Detected a delegation loop and blocked @Planner from being invoked again.
```

For Chinese UI:

```text
检测到循环委托，已阻止 @Planner 再次调用。
```

## Persistence Model

Recommended DB additions:

- `messages.agent_profile_id TEXT NULL`
- `a2a_tasks` table for delegation records

`messages` remains the conversation timeline.

`a2a_tasks` records scheduling and execution state:

```text
pending -> working -> completed
pending -> working -> failed
```

The task record should store:

- source profile
- target profile
- original instruction
- context snapshot
- depth
- chain
- execution mode
- status
- result

The message record should store the final visible output.

## Memory Palace Distillation

Agents should not directly dump everything into Memory Palace.

At task completion, use a distillation step to produce memory candidates:

- project decisions
- recurring problems
- stable implementation conventions
- known pitfalls
- user preferences that affect future project work

Those candidates can then be reviewed, accepted, or automatically promoted according to project rules.

This keeps Memory Palace durable and avoids polluting project memory with temporary task chatter.

## Implementation Notes

Important integration requirements:

- Add `agent_profile_id` to both new `messages` table creation and migrations.
- Update message create/load IPC to read and write `agent_profile_id`.
- Key runtimes by `conversationId:profileId`.
- Add `conversationId`, `agentProfileId`, `taskId`, and `sessionId` to routed AI events.
- Start with serial execution if renderer streaming state is still single-buffer.
- Enable parallel only after renderer state is split by active task/session.
- Use a stable mention handle if display names can contain spaces, Chinese characters, or duplicates.

## Suggested First Milestone

Milestone 1 should be serial-only but architected for parallel later:

1. DB and IPC support for `messages.agent_profile_id`.
2. `a2a_tasks` persistence.
3. Mention parser with known enabled agents.
4. Orchestrator serial queue.
5. Context Packet builder using deterministic selection.
6. Routed AI events with agent attribution.
7. Agent badge display in chat messages.
8. Loop detection and blocked-loop system messages.

Milestone 2 can add:

- parallel execution
- per-task streaming buffers
- richer context selector
- Memory Palace candidate extraction at task completion
- UI for active A2A task queue

---

## Milestone 2 Architecture Design

### M2-2: Per-task Streaming Buffers

**问题根源**

当前 chatStore 的流式状态是全局单份：

```typescript
// 当前 chatStore 状态
streamingText: string          // 单个 buffer
thinkingText: string           // 单个 buffer
tools: Record<string, ToolState>
currentTurnToolIds: string[]
streamingRequestId: string | null
```

并行模式下，Agent B 和 Agent C 同时推送 `text_delta` 事件，两者都会写入同一个 `streamingText`，输出混叠。

**目标状态模型**

将 per-conversation 的单份流式状态改为 per-task 的 Map：

```typescript
// 新增
interface TaskStreamState {
  taskId: string
  agentProfileId: string | null
  agentName: string | null
  streamingText: string
  thinkingText: string
  tools: Record<string, ToolState>
  currentTurnToolIds: string[]
  isActive: boolean
}

// chatStore 新增字段
taskStreams: Map<string, TaskStreamState>  // taskId → stream state
```

**路由规则**

每个 `ai:event` 都带有 `taskId`（M1 已实现）。事件处理时，先查 `taskId`，再决定写入哪个 buffer：

```text
收到 ai:event
  有 taskId → 写入 taskStreams[taskId]
  无 taskId → 写入原有全局 buffer（兼容 legacy chat 路径）
```

**渲染规则**

MessageList 中，正在流式输出的任务显示为独立的 streaming bubble，各自带 AgentBadge：

```text
[Planner] ████████ streaming...
[Coder]   ██████ streaming...
```

`complete` 事件触发后，该 taskId 的 stream state 清除，消息持久化到 DB。

**文件变更范围**

| 文件 | 变更 |
|------|------|
| `renderer/src/stores/chatStore.ts` | 新增 `taskStreams: Map<string, TaskStreamState>`；`text_delta`/`tool_start`/`tool_result`/`complete`/`done` 分支按 taskId 路由 |
| `renderer/src/components/chat/MessageList.tsx` | 读取 `taskStreams`，为每个 active stream 渲染 streaming bubble |
| `renderer/src/stores/a2aStore.ts` | 无需改动（任务状态独立） |

**前置条件**：M2-2 必须先于 M2-1 完成。

---

### M2-1: Parallel Execution

**Orchestrator 侧**（已具备骨架）

`orchestrator.ts` 中并行路径已存在：

```typescript
// 当前已有
if (executionMode === 'parallel') {
  this.executeTask(task, targetProfile, baseConfig, executionMode, webContents).catch(() => {})
} else {
  queue.push(task)
}
```

Orchestrator 侧不需要修改。

**Renderer 侧解锁**

M2-2 完成后，在 ChatInput 中将执行模式 toggle 从 disabled 改回可交互：

```typescript
// ChatInput.tsx：恢复 onClick 和样式切换
<button
  onClick={() => setExecutionMode(executionMode === 'serial' ? 'parallel' : 'serial')}
  ...
>
  {executionMode === 'parallel' ? '并行' : '串行'}
</button>
```

`sessionConfigStore.setExecutionMode` 已有，`orchestrator.sendMessage` 的 payload 已携带 `executionMode`，无需额外改动。

**并发限制**

并行模式下，同一 conversationId 的任务仍受 `MAX_TASKS_PER_CONVERSATION = 20` 约束（orchestrator 侧已实现）。不额外限制并发数，由 `executeTask` 自然并发。

---

### M2-3: Context Packet Selector

**模块位置**

新建 `src/main/ai/context-selector.ts`，从 `orchestrator.ts` 的 `buildContextSnapshot` 中分离。

**接口定义**

```typescript
// src/main/ai/context-selector.ts

export interface AgentContextPacket {
  task: {
    fromAgentName: string | null
    toAgentName: string
    instruction: string
  }
  taskState: {
    goal: string
    completed: string[]
    pending: string[]
    decisions: string[]
    blockers: string[]
  }
  relevantMessages: Array<{
    messageId: string
    agentProfileId: string | null
    content: string
    reason: string
  }>
  projectMemories: Array<{
    title: string
    content: string
  }>
  recentFileChanges: string[]
}

export interface ContextSelectorOptions {
  conversationId: string
  fromAgentName: string | null
  toAgentName: string
  toAgentRole: string
  instruction: string
  tokenBudget: number  // 默认 4000
}

export function buildContextPacket(opts: ContextSelectorOptions): AgentContextPacket
export function renderContextPacket(packet: AgentContextPacket): string
```

**选择算法（确定性规则，无 LLM）**

```text
1. 提取关键词
   keywords = tokenize(instruction) ∪ { toAgentRole }

2. 收集候选消息
   candidates = 最近 20 条 assistant 消息（按 created_at DESC）

3. 按角色过滤
   - role = 'planning'  → 保留含"目标/决策/约束/scope"的消息
   - role = 'implementation' → 保留含文件路径/API/函数名的消息
   - role = 'review' → 保留含"变更/风险/测试/问题"的消息
   - default → 不过滤

4. 评分
   score = keywordOverlap(msg, keywords) * 0.50
         + recencyScore(msg.created_at) * 0.20
         + roleMatch(msg.agent_profile_role, toAgentRole) * 0.20
         + (instruction 中显式提到 msg 内容) * 0.10

5. 按 token 预算截取
   按 score DESC 排序，累计 token 估算（字符数 / 3.5），不超过 tokenBudget * 0.6

6. 加载项目记忆
   读取 workspace project-memory.md，截取前 tokenBudget * 0.3 字符

7. 加载最近文件变更
   取最近 5 条 file_changes（按 created_at DESC），仅保留 path 字段

8. 渲染为纯文本注入
```

**渲染模板**

```text
[任务委托]
来自：@{fromAgentName}
目标：@{toAgentName}
指令：
{instruction}

[当前任务上下文]
{relevantMessages 按时间正序，格式：[@AgentName] {content 前 300 字}}

[最近文件变更]
{recentFileChanges}

[项目记忆]
{projectMemories}
```

**Orchestrator 集成**

`buildContextSnapshot` 替换为 `buildContextPacket` + `renderContextPacket`：

```typescript
// orchestrator.ts
import { buildContextPacket, renderContextPacket } from './context-selector'

private buildContextSnapshot(conversationId: string, fromAgentName: string, toProfile: AgentProfile, instruction: string): string {
  const packet = buildContextPacket({
    conversationId,
    fromAgentName,
    toAgentName: toProfile.name,
    toAgentRole: toProfile.role,
    instruction,
    tokenBudget: 4000
  })
  return renderContextPacket(packet)
}
```

---

### M2-4: Memory Palace Candidate Extraction

**触发时机**

A2A 任务完成时（`updateTaskStatus(task.id, 'completed')`），在 orchestrator 内触发一次提炼。

**提炼来源**

从该任务对应的 assistant 消息中提取候选：

```text
扫描 fullText（任务输出），识别以下模式：
- "决定..." / "选择..." / "采用..." → 决策类（kind: 'decision'）
- "注意..." / "避免..." / "不要..." → 反模式类（kind: 'antipattern'）
- "约定..." / "规范..." / "统一..." → 惯例类（kind: 'convention'）
```

用关键词匹配（无 LLM），置信度设为 `'low'`，进入 candidates 表等待用户审核。

**实现位置**

新建 `src/main/ai/memory-extractor.ts`：

```typescript
export interface MemoryCandidateInput {
  workspaceId: string
  conversationId: string
  messageId: string
  agentRole: string
  fullText: string
}

export function extractCandidates(input: MemoryCandidateInput): Array<{
  kind: string
  title: string
  content: string
  confidence: 'low' | 'medium'
}>
```

Orchestrator 在 `executeTask` 的成功路径中调用，调用 `memory:createCandidate` IPC（已有）写入候选。

**不自动 materialize**：候选进入 `MemoryCandidate` 表，状态为 `captured`，由用户在 Memory Palace UI 中手动审核/接受。

---

### M2-5: A2A Task Queue UI

**显示位置**

在 TaskRail 底部、Memory Palace 区域上方，新增 **Agent Activity** 折叠区：

```text
┌─────────────────────────────┐
│ Tasks list                  │
├─────────────────────────────┤
│ ▼ Agent Activity        [2] │  ← 当前活跃 task 数
│   [Planner] planning... ●   │  ← working 状态，● 动态点
│   [Coder]   ✓ completed     │  ← completed 状态
│   [Reviewer] ✗ failed       │  ← failed 状态
├─────────────────────────────┤
│ ▼ Memory Palace         [5] │
└─────────────────────────────┘
```

**数据来源**

读取 `useA2AStore` 中当前 conversationId 的 tasks，仅显示最近 10 条（按 `createdAt DESC`）。

**实时更新**

`onA2ATaskCreated` / `onA2ATaskCompleted` 已在 chatStore init 时订阅并更新 `a2aStore`，UI 直接消费 store 即可，无需额外 IPC。

**组件位置**

新建 `src/renderer/src/components/workspace/AgentActivityPanel.tsx`，在 `TaskRail.tsx` 中引入。

**文件变更范围**

| 文件 | 变更 |
|------|------|
| `renderer/.../AgentActivityPanel.tsx` | 新建，显示 task 列表 |
| `renderer/.../TaskRail.tsx` | 引入 AgentActivityPanel，插入 Memory Palace 区域之前 |

---

### M2 实现顺序

依赖关系决定顺序：

```text
M2-2（per-task buffer）
  → M2-1（并行执行解锁）
  → M2-5（任务队列 UI，依赖 a2aStore，可独立推进）

M2-3（Context Packet 选择器，纯主进程，可独立推进）
  → M2-4（Memory Palace 候选提取，依赖 M2-3 的 fullText 处理）
```

推荐顺序：M2-3 → M2-4 → M2-2 → M2-1 → M2-5

---

## Gap Fill Architecture（vs clowder-ai）

### InvocationQueue — 优先级任务队列

**问题**：旧实现用纯数组 `Map<string, A2ATask[]>` 做串行队列，无优先级、无僵尸防御、无队列位置追踪。

**新实现**：`InvocationQueue` 提供 per-conversation 优先级队列。

```typescript
interface QueuedTask {
  task: A2ATask
  priority: number        // 0 = user-initiated, 1 = feedback, 2+ = deep-chain
  enqueuedAt: number
}
```

- **优先级策略**：用户直接消息 > feedback 回调 > 深层链式委托（depth > 2）
- **僵尸防御**：每 60 秒扫描 `processing` Map，任务 stuck in `working` > 10 分钟自动标记 `failed` 并触发 completion hook
- **队列位置**：`enqueue()` 返回 position，renderer 通过 `a2a:taskQueued` 事件显示 `#N` badge

文件：`src/main/ai/invocation-queue.ts`（18 测试）

---

### CollaborationContinuityCapsule — 会话连续性胶囊

**问题**：旧实现仅用 `primarySessionIds: Map<string, {sessionId, fingerprint}>` 做 depth=0 主 Agent 的 session 续传，无状态机，无法处理 handoff 场景。

**新实现**：`ContinuityCapsuleManager` 为每个 A2A task 创建胶囊，追踪完整会话生命周期。

```typescript
type BallState = 'in_progress' | 'completed' | 'needs_handoff' | 'needs_owner'

interface SessionSeal {
  sessionId: string
  sessionSeq: number      // monotonic sequence within session
  checkpointAt: number
}

interface CollaborationContinuityCapsule {
  id: string
  taskId: string
  parentCapsuleId?: string
  a2aDepth: number
  ballState: BallState
  seal?: SessionSeal
}
```

- **create**：task 开始前创建，记录 depth 和 parent 关系
- **seal**：`runtime.start()` 返回后，用 `sessionId` + `sessionSeq=0` 封印
- **complete**：task 成功/失败时更新 `ballState`
- **handoff**：Agent → Agent 转移时标记 `needs_handoff`
- **isSessionResumable**：seal < 30 分钟且 ballState 为 `in_progress`/`needs_handoff` 时可续传
- **持久化**：`continuity_capsules` 表（DB schema v24）

**ACP 优势**：clowder-ai 只能用 `--resume <sessionId>` 恢复；Bytro 通过 ACP `session/load` 可恢复完整会话状态 + `setModel` + `setConfigOption`。

文件：`src/main/ai/continuity-capsule.ts`

---

### ReflowOrchestrator — 多 Agent 结果聚合

**问题**：旧实现中并行 @mention 的子 Agent 完成后各自创建独立 feedback task，父 Agent 收到多条独立消息，无聚合。

**新实现**：`ReflowOrchestrator` 管理并行多 Agent 的结果聚合。

```typescript
interface ReflowGroup {
  id: string
  callbackToProfileId: string    // 聚合结果回传的目标 Agent
  triggerTaskId: string
  childTaskIds: Set<string>
  completedResults: Map<string, PartialResult>
  timeoutAt: number
  state: ReflowState             // pending → running → partial|done|timeout|failed
}
```

**使用场景**：
- Agent A 输出中同时 @mention B 和 C，且 A 需要等 B 和 C 都完成后继续
- `dispatchIntents()` 创建 parallel plan 且 `scheduledTaskIds.length > 1` 时自动创建 ReflowGroup
- `completionHook` 将子结果路由到 `handleChildComplete()` → `ReflowOrchestrator`

**状态机**：
- `running`：等待子任务完成
- `done`：全部子任务成功
- `partial`：部分成功（≤2 失败）
- `failed`：>2 失败（anti-cascade 守卫）
- `timeout`：超过 5 分钟未全部完成

**聚合消息格式**：

```markdown
以下 2 个 Agent 的并行任务已完成：

✅ **Coder**:
[output truncated...]

❌ **Reviewer**:
[error output...]

请查看所有结果并决定下一步行动。
```

文件：`src/main/ai/reflow-orchestrator.ts`

---

### ACP Protocol 深度利用

Bytro 使用 ACP（Agent Communication Protocol，JSON-RPC 2.0 over stdio）作为统一协议层，而 clowder-ai 使用原始 CLI。这带来以下编排层优势：

| 能力 | clowder-ai (CLI) | Bytro (ACP) |
|------|------------------|-------------|
| 会话生命周期 | `--resume <sessionId>` 不稳定 | `session/new`, `session/load`, `session/close` 标准化 |
| 动态模型切换 | 不支持 | `session/set_model` |
| 运行时配置 | 环境变量 | `config_option_update` |
| 权限流 | 自定义解析 | 标准化 `request_permission` |
| 结构化事件 | 流式文本解析 | `agent_message_chunk`, `tool_call`, `usage_update` |

**已在编排层使用**：
- `AgentRuntime.switchModel()` → `aiEngine.setModel()` → ACP `session/set_model`
- `AgentRuntime.start()` 中 `resolveRuntime()` 透传 provider/model 到 ACP `session/new`
- `primarySessionIds` 续传通过 ACP `session/load` 恢复（而非 CLI `--resume`）

---

### A2A Memory Distiller — 链级记忆蒸馏

**问题**：`memory-extractor.ts` 只在单个 Agent 任务完成后提取候选，无法识别跨 Agent 协作惯例和项目级决策。

**新实现**：`A2AMemoryDistiller` 在整个 A2A 委托链完成后触发 chain-level 提取。

**触发时机**：`drainSerialQueue()` 结束后，若 `rootCapsule.ballState === 'completed'` 且无活跃任务。

**提取内容**：
- `a2a_chain_summary`：Agent 协作链结构（`Planner → Coder → Reviewer`）
- `a2a_convention`：跨 Agent 协作惯例（正则模式匹配）
- `a2a_lesson`：失败教训（失败任务 + 错误模式提取）

**TODO**：当前使用轻量级正则提取；未来替换为轻量 LLM 调用（Haiku 4.5）做语义摘要。

文件：`src/main/ai/a2a-memory-distiller.ts`

