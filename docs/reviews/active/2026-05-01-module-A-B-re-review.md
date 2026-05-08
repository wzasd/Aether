---
status: active
owner: bytro
last_verified: 2026-05-01
doc_kind: review
scope: module-A-B-re-review
source:
  - docs/plans/2026-04-30-module-A-implementation.md
  - docs/plans/2026-05-01-module-B-implementation.md
---

# Module A/B Re-review: 收尾检查

本轮 review 针对 Module A（Task = Conversation / Workspace Shell 收敛）和 Module B（File Change Tracking）做收尾检查。结论：当前不能标记完成。

阻塞原因有两类：

- `pnpm run typecheck` 当前失败，代码不能进入完成状态。
- A/B 的会话归属、等待状态路由、错误状态路由、diff 展示、workspace-scoped 创建仍有验收缺口。

## Verification

- `pnpm run typecheck`: failed on 2026-05-01
  - `src/renderer/src/stores/chatStore.ts(564,15): error TS2451: Cannot redeclare block-scoped variable 'workspaceId'.`
  - `src/renderer/src/stores/chatStore.ts(607,15): error TS2451: Cannot redeclare block-scoped variable 'workspaceId'.`
- `pnpm test`: passed on 2026-05-01
  - 2 test files passed
  - 10 tests passed

## Summary

| Priority | Area | Finding | Module |
|---|---|---|---|
| P0 | Typecheck | 当前代码无法通过 typecheck | A/B |
| P1 | Status routing | 等待状态仍会写到当前可见会话 | A |
| P1 | Resume routing | 权限/问题恢复仍会更新错误会话 | A |
| P1 | Error routing | `error` 事件忽略 `sessionId` | A |
| P1 | Diff visibility | Track Changes 没有记录或展示 diff 内容 | B |
| P2 | Workspace scope | 新建任务没有绑定当前 workspace | A |

## Findings

### [P0] 当前代码无法通过 typecheck

**File**: `src/renderer/src/stores/chatStore.ts:607-608`

同一个 `try` block 里已经在上面声明过 `workspaceId`，这里再次 `const workspaceId` 会触发 TS2451。当前 `pnpm run typecheck` 失败，所以 Module A/B 不能标完成。

**Impact**

- TypeScript build 失败。
- 当前分支无法通过最基础的完成门槛。

**Recommendation**

把第二个变量改名，或复用前面的 `workspaceId`。

### [P1] 等待状态仍会写到当前可见会话

**File**: `src/renderer/src/stores/chatStore.ts:788-812`

`permission_request` 和 `ask_user_question` 仍然用 `state.currentConversation?.id` 更新 `Waiting`。后台会话发出权限/提问事件时，会把当前打开的会话改成 `Waiting`，而不是事件所属会话。

**Impact**

- TaskRail 状态会错写。
- 后台任务等待权限时，前台会话可能被错误标记为 Waiting。
- Module A 的任务状态可信度不成立。

**Recommendation**

像 `tool_result` / `subagent_started` 一样，通过 `event.sessionId -> sessionConversationIds` 路由到原始 conversation。

### [P1] 权限/问题恢复仍会更新错误会话

**File**: `src/renderer/src/stores/chatStore.ts:655-682`

用户确认权限或回答问题后，代码用 `currentConversation` 设置 `Running`。如果等待的是后台 session，当前打开的会话会被错误恢复，真正等待的会话仍停在 `Waiting`。

**Impact**

- 用户批准后台任务后，TaskRail 上的真实任务状态不会恢复。
- 当前可见会话可能被错误标为 Running。

**Recommendation**

使用 pending item 里的 `sessionId` 反查 `conversationId`，再更新对应 conversation 状态。

### [P1] `error` 事件忽略 `sessionId`

**File**: `src/renderer/src/stores/chatStore.ts:1049-1057`

main process 会给所有 AI event 附加 `sessionId`，但 `error` 分支只看 `event.id || state.streamingRequestId`。解析器产生的 error 事件没有 `id`，后台 session 出错时可能不会更新原会话，甚至可能把当前 streaming 会话标成 `Error`。

**Impact**

- 后台失败不会正确反映到对应任务。
- 当前任务可能被错误标记为 Error。

**Recommendation**

优先使用 `event.sessionId`，再 fallback 到 `event.id` / `state.streamingRequestId`。

### [P1] Track Changes 没有记录或展示 diff 内容

**File**: `src/renderer/src/stores/chatStore.ts:748-755`

Module B 需求要求计算并展示 diff，但当前只记录 `path` / `status` / `additions` / `deletions`，`diff_text` 没有生成，也没有传给 `change:record`。`DiffPanel` 也只展示文件卡片。

**Impact**

- 用户只能看到“改了哪个文件”，看不到“具体改了什么”。
- `file_changes.diff_text` 字段形同虚设。
- Module B 的核心验收项“Track Changes 面板能看到具体 diff 内容”不成立。

**Recommendation**

- 在捕获 Write/Edit/Delete 时生成 `diff_text`。
- `change:record` 传入并持久化 `diff_text`。
- `DiffPanel` 展示 diff 内容，至少支持新增、删除、修改的文本块。

### [P2] 新建任务没有绑定当前 workspace

**File**: `src/renderer/src/App.tsx:79-84`

TaskRail / Cmd+N 创建 conversation 时没有传 `workspace_id`，但 App 又按当前 workspace 加载会话列表。新建项会先被本地插入，之后重新加载当前 workspace 时消失，而且 DB 里也失去 workspace 归属。

**Impact**

- 当前 workspace 下创建的新任务可能变成全局会话。
- 切换或刷新列表后，用户看不到刚创建的任务。
- Workspace-scoped conversation 的产品定义不一致。

**Recommendation**

创建任务时传入当前 `currentWorkspaceId`：

```ts
createConversation({
  title: 'New Task',
  workspace_id: currentWorkspaceId ?? undefined
})
```

如果产品决定允许全局会话，需要同步修改列表加载策略和文档定义；否则应统一 workspace-scoped 创建。

## Required Before Marking Complete

- Fix the P0 typecheck failure.
- Re-route permission/question Waiting and Running updates through `sessionId -> conversationId`.
- Re-route error handling through `event.sessionId`.
- Generate, persist, and render `diff_text` for file changes.
- Decide workspace-scope behavior for New Task, then make App/TaskRail/Home/docs consistent.
- Re-run `pnpm run typecheck`.
- Re-run `pnpm test`.

