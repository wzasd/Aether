---
status: active
owner: bytro
last_verified: 2026-05-01
doc_kind: review
scope: latest-code-review
---

# 最新代码 Review：Workspace / Module A 收敛

本轮 review 重点检查了 Module A `Task = Conversation`、Workspace Shell、TaskRail、Shared Conversation、Bottom Output、Preview/File 等最新代码。整体实现已经比上一轮前进很多：`conversations` schema v4、`conversation:updateStatus`、TaskRail 切换到 `chatStore`、workspace-scoped New Task 都已经落地。

但当前仍有 4 个 P1 会影响真实任务执行可信度，建议先修，再继续 M8/M9。

Update 2026-05-01: Module B has since added write paths for both `change_count` and `agent_count`, but re-review found they still need session-based conversation attribution. Workspace-scoped creation is still not consistently implemented; Home, Cmd+N, and TaskRail New Task currently create conversations without `workspace_id`.

## 验证结果

- `pnpm run typecheck`: 通过
- `pnpm build`: 通过

## 结论摘要

| Priority | Area | Finding |
|---|---|---|
| P1 | Conversation title | 首条用户标题会被 AI 回复覆盖 |
| P1 | Conversation status | Waiting/Running 状态会写到当前可见会话 |
| P1 | Agent runtime | Agent 执行目录没有绑定当前 workspace |
| P1 | Bottom output | 底部输出面板拖拽手柄不可调整高度 |
| P2 | Home page | Home 创建的是全局会话，不属于当前项目 |
| P2 | TaskRail counters | agent/change 计数永远不会更新（已由 Module B 修复） |

## Findings

### [P1] 首条用户标题会被 AI 回复覆盖

**文件**: `src/renderer/src/stores/chatStore.ts:829-845`

`sendMessage` 已经在首条用户消息发送时调用 `conversation:autoTitle`，这符合 Module A 的产品定义：用户的第一句话就是任务标题。

但 `complete` 分支又用 assistant `fullText` 再次调用 `conversation:autoTitle`。由于 `autoTitle` 不会把 `title_source` 改成 `manual`，所以第一次 AI 回复会覆盖用户任务标题。最终 TaskRail 展示的是 agent 回复开头，而不是用户输入的任务名。

**影响**:

- TaskRail 任务列表失去用户意图语义。
- 用户很难从任务标题判断自己创建了什么任务。
- Module A 的 “首条消息即标题” 验收不成立。

**建议修复**:

- 删除 `complete` 分支里的自动标题逻辑。
- 或仅在 conversation title 为空时才允许 assistant fallback。
- 首选方案：只保留 `sendMessage` 中基于首条用户消息的 `autoTitle`。

### [P1] Waiting/Running 状态会写到当前可见会话

**文件**: `src/renderer/src/stores/chatStore.ts:587-708`

`permission_request`、`ask_user_question`、`confirmPermission`、`answerQuestion` 当前都使用 `currentConversation.id` 更新状态。

这在单会话不切换时看起来可用，但只要用户切到另一条任务，后台任务的权限等待或恢复运行就会写到当前打开的 conversation。代码里已经有 `sessionConversationIds`，但这些路径没有使用它。

**影响**:

- 后台任务可能把前台任务错误标记为 `Waiting`。
- 用户批准后台任务权限时，前台任务可能被错误标记为 `Running`。
- TaskRail 状态会错乱，任务级执行状态不可信。

**建议修复**:

- 增加统一 helper：

```ts
const getConversationIdForSession = (sessionId?: string | null) =>
  sessionId ? sessionConversationIds.get(sessionId) : null
```

- `permission_request` / `ask_user_question` 使用：

```ts
const sessionId = event.sessionId || state.streamingRequestId
const convId = getConversationIdForSession(sessionId)
```

- `confirmPermission` / `answerQuestion` 使用 `pending.sessionId` 反查 conversation，而不是 `currentConversation.id`。

### [P1] Agent 执行目录没有绑定当前 workspace

**文件**: `src/renderer/src/stores/chatStore.ts:498-503`

发送消息时直接使用 `sessionConfigStore.workingDir` 作为 Claude CLI 启动目录。如果用户只在 WorkspaceShell 里选择了项目，但没有单独设置 working dir，Claude 会在 `process.cwd()` 下运行。

与此同时，Explorer、Memory、TaskRail 都认为当前任务属于 workspace 的 `repo_path`。这会造成 UI 和 agent runtime 的项目根目录不一致。

**影响**:

- Agent 可能读错目录。
- Agent 可能把文件改到 app cwd，而不是当前 workspace。
- Memory/Explorer 展示的上下文和实际执行上下文不一致。

**建议修复**:

- `sendMessage` 中优先使用当前 conversation/workspace 的 `repo_path`。
- 仅当 workspace 没有 `repo_path` 时，才 fallback 到 `sessionConfigStore.workingDir`。
- workspace 切换时也可以同步 `sessionConfigStore.workingDir`，但最终发送消息前仍应以 workspace 为准。

推荐优先级：

```ts
workingDir =
  currentConversation.workspace.repo_path ??
  currentWorkspace.repo_path ??
  sessionConfig.workingDir
```

### [P1] 底部输出面板拖拽手柄不可调整高度

**文件**: `src/renderer/src/components/workspace/WorkspaceShell.tsx:129-135`

当前代码渲染了 `react-resizable-panels` 的 `Separator`，但它不在 vertical `Group` / `Panel` 结构里。下面的 `BottomOutput` 是固定 `h-[30%]` 的普通 `div`。

用户会看到 row-resize 光标，但拖拽不会改变底部面板高度。

**影响**:

- M7 Bottom Output 的可调整高度验收不成立。
- 用户会误以为拖拽坏了。
- 未来接真实 terminal/log 时，固定高度会影响可用性。

**建议修复**:

- 在 workspace panel 内增加 vertical `Group`。
- 上方为 workspace content `Panel`。
- 中间为 `Separator`。
- 下方为 `BottomOutput` `Panel`。

结构应类似：

```tsx
<Group orientation="vertical">
  <Panel id="workspace-main" defaultSize="70%" minSize="40%">
    {workspaceArea}
  </Panel>
  <Separator />
  <Panel id="bottom-output" defaultSize="30%" minSize="15%">
    <BottomOutput />
  </Panel>
</Group>
```

### [P2] Home 创建的是全局会话，不属于当前项目

**文件**: `src/renderer/src/pages/Home.tsx:8-10`

TaskRail/New Task 已经要求 `currentWorkspaceId`，并创建 workspace-scoped conversation。但 Home 的 `Start New Chat` 仍然只传 `{ title: 'New Chat' }`。

当前项目下点击 Home CTA 会创建 `workspace_id = null` 的全局会话。随后 TaskRail 按 workspace 过滤时，这条 conversation 不会出现。

**影响**:

- 用户创建后能进入会话，但 TaskRail 看不到它。
- “当前项目下的任务列表” 与实际创建行为不一致。

**建议修复**:

- Home 读取 `currentWorkspaceId`。
- 未选择 workspace 时禁用 CTA 或提示先选择项目。
- 创建时传：

```ts
createConversation({
  workspace_id: currentWorkspaceId,
  title: 'New Task'
})
```

### ~~[P2] TaskRail 的 agent/change 计数永远不会更新~~ → 已修复

**文件**: `src/renderer/src/components/workspace/TaskRail.tsx:112-115`

**Status update 2026-05-01**: partially resolved by Module B. Captured file operations now increment `change_count`, and `subagent_started` now increments/persists `agent_count`; however both paths still need to route by `event.sessionId -> conversationId` to avoid updating the visible conversation for background sessions.

`conversations` 表新增了 `agent_count` / `change_count`，TaskRail 也展示了这两个字段。但当前代码没有任何地方更新它们。

`subagent_started` / `tool_result` 只更新本地 subagent/tool state，没有写回 conversation。结果所有任务长期显示 `0 agents / 0 changes`。

**影响**:

- TaskRail 的任务状态感不足。
- 用户无法从任务列表判断任务规模和变更量。
- Module A/M8 的任务聚合信息没有形成闭环。

**建议修复**:

- 本阶段至少在 `subagent_started` 时更新 `agent_count`。
- `change_count` 可以等 M8 change tracking，但 UI/文档不能宣称真实统计完成。
- 后续 M8 应从 `file_changes` 或写入类 tool event 聚合 `change_count`。

## 建议修复顺序

1. 修 `sessionId -> conversationId` 状态归属，先保证 TaskRail 状态可信。
2. 修 workspace `repo_path -> workingDir`，先保证 agent 在正确项目里执行。
3. 删除 assistant complete 自动标题覆盖逻辑。
4. 改 BottomOutput 为 vertical resizable panel。
5. 修 Home workspace-scoped 创建。
6. 接入 agent_count，change_count 留到 M8 或先明确为 placeholder。

## 当前可以继续推进的方向

在修完 P1 后，可以继续推进：

- M8 Change Tracking：真实 `file_changes`、DiffPanel 数据源、TaskRail `change_count`。
- M9 Settings & Agent：把 SharedConversation 的 mock AgentStrip 替换成真实 agent/session 状态。
- Bottom Output 服务化：从模拟输出升级为 terminal/build/test/diagnostics 的持久输出流。
