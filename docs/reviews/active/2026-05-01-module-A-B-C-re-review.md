---
status: active
owner: bytro
last_verified: 2026-05-02
doc_kind: review
scope: module-A-B-C-re-review
source:
  - docs/plans/2026-04-30-module-A-implementation.md
  - docs/plans/2026-05-01-module-B-implementation.md
  - docs/plans/2026-05-01-module-C-implementation.md
---

# Module A/B/C Re-review: Completion Gate

本轮 review 覆盖 Module A、Module B、Module C，以及上一轮遗留问题。Update 2026-05-02: FTS sync、MemoryContent markdown parser 接线、以及 native test runtime 均已复审确认修复。

已确认修复的部分：

- `chatStore.ts` 里原先的 `workspaceId` 重复声明已消失。
- permission/question/error 已基本按 `sessionId -> conversationId` 路由。
- `diff_text` 已生成、传入 `change:record`，并在 `DiffPanel` 展示。
- TaskRail 新建任务已传 `workspace_id`。
- Module C 的 Memory Palace IPC、store、WorkspaceArea 面板、MemoryContent、TaskRail mini 区均已落地。
- Memory Palace DB 条目已注入 Agent 上下文。
- Memory Palace 新建条目默认分类已初始化。
- TaskRail Memory mini 区已主动加载当前 workspace 记忆。
- Home / Cmd+N workspace 创建路径已修复。

## Verification

- Latest verification on 2026-05-01:
  - `pnpm run typecheck`: passed
  - `pnpm test`: passed, 4 test files / 44 tests
  - `pnpm build`: passed
- Latest verification on 2026-05-02:
  - `pnpm run typecheck`: passed
  - `pnpm run build`: passed
  - `pnpm test`: passed, 6 files / 72 tests

Earlier failed verification:

- `pnpm run typecheck`: failed because renderer tests were included in production TS build.
- `pnpm test`: passed, 2 test files / 22 tests.

## Summary

| Priority | Area | Finding | Module |
|---|---|---|---|
| Resolved | Test gate | 标准 `pnpm test` 当前失败 | A/B/C |
| Resolved | MemoryContent markdown | MemoryContent 仍未使用已测试的 markdown parser | C |
| Resolved | Memory FTS | Memory Palace 更新不会同步 FTS 索引 | C |
| Resolved | Typecheck | 测试文件进入生产 TS build | A/B/C |
| Resolved | Agent memory context | Memory Palace 条目不会注入给 Agent | C |
| Resolved | Memory editor | 新建 Memory 条目默认 Core 但无法保存 | C |
| Resolved | TaskRail memory mini | TaskRail Memory mini 区不会主动加载数据 | C |
| Resolved | Workspace scope | Home 仍然创建全局会话 | A |
| Resolved | Workspace scope | Cmd+N 仍可能使用旧 workspace | A |

## Findings

### ~~[P1] 标准测试命令当前失败~~ → Resolved

**File**: `package.json:13`

最新 `pnpm test` 实际运行失败。69 个测试通过、3 个跳过，但 `src/main/core/db.test.ts` 在创建 `better-sqlite3` in-memory DB 时失败：native binding 是用 `NODE_MODULE_VERSION 133` 编译的，而当前 Node runtime 需要 `NODE_MODULE_VERSION 127`。

**Impact**

- A/B/C 不能用标准 test 命令作为完成门槛。
- DB 相关回归测试没有真正跑完。

**Recommendation**

重建或重装当前 Node runtime 对应的 native dependency，然后重跑 `pnpm test`。如果 Electron rebuild 会让本地 Node 测试 ABI 失配，需要把恢复步骤写进开发文档。

Resolution: `better-sqlite3` was rebuilt for the current runtime. Latest `pnpm test` passes with 6 files / 72 tests.

### ~~[P2] MemoryContent 仍未使用已测试的 markdown parser~~ → Resolved

**File**: `src/renderer/src/components/workspace/MemoryContent.tsx:30-47`

`utils/markdown.ts` 里的 `parseMarkdownBlocks` / `parseInlineSpans` 已经有单测，但 MemoryContent 的生产渲染仍使用本地 `renderContent` parser。当前 list 分支还会因为 `inline.slice(1)` 删除 `- item` 的正文。

**Impact**

- 测试覆盖的 parser 没有保护真实 UI。
- 普通 list item 在 Memory Palace 详情里会丢失正文。

**Recommendation**

让 `renderContent` 使用 `parseMarkdownBlocks` / `parseInlineSpans`，或者把真实 renderer 抽成可测试 helper，并为 list item 文本补回归测试。

Resolution: `MemoryContent.renderContent()` now uses `parseMarkdownBlocks` and `parseInlineSpans`; list item rendering uses the parsed block content instead of dropping the first inline span.

### ~~[P2] Memory Palace 更新不会同步 FTS 索引~~ → Resolved

**File**: `src/main/core/db.ts:328-333`

`memory-palace:update` 会修改 `project_memory_items.title/content/kind`，但此前 `memory_fts` 只有 INSERT/DELETE trigger。结果用户编辑 Memory Palace 条目后，`memory:recall` 走 FTS 查询时可能搜到旧内容或搜不到新内容。

**Impact**

- 编辑后的 Memory Palace 内容与 `memory:recall` 搜索结果不一致。
- Agent 或 UI 通过 FTS 检索项目记忆时可能拿到旧结果。

**Recommendation**

补 `AFTER UPDATE` trigger，先 delete old row 再 insert new row，或在 `memory-palace:update` handler 中手动维护 FTS。

Resolution: Schema v8 now adds `proj_mem_au`, and `src/main/core/db.test.ts` covers insert/update/delete FTS sync once the native test runtime is available.

### ~~[P0] typecheck 仍失败：测试文件进入生产 TS build~~ → Resolved

**File**: `tsconfig.web.json:14`

`tsconfig.web.json` 的 `include` 曾把 `src/renderer/src/**/*.test.ts` 一起纳入 `tsc --build`，Vitest 类型声明触发 TS18028。

**Impact**

- 当前分支无法通过最基础的完成门槛。
- A/B/C 不能标记完成。

**Recommendation**

- 生产 web tsconfig 排除测试文件，例如 `**/*.test.ts` / `**/*.test.tsx`。
- 或拆出 test tsconfig。
- 同时建议显式设置现代 `target`。

Resolution: renderer production typecheck now excludes test files, and latest `pnpm run typecheck` passes.

### ~~[P1] Memory Palace 条目不会注入给 Agent~~ → Resolved

**File**: `src/renderer/src/stores/chatStore.ts:223-225`

Module C 文档说 Memory Palace 写入 `project_memory_items` 后会被 `buildMemoryContext` 自动注入，但这里实际只读取 `.bytro/project-memory.md` 文件。Memory Palace 的 IPC 写的是 DB 表，不会同步到这个文件，所以用户在 UI 里写的记忆不会进入后续 Agent 上下文。

**Impact**

- Module C 的核心用户故事不成立：用户在 Memory Palace 里写入的规范，Agent 后续不会自动获得。
- TaskRail / MemoryContent 看起来可用，但 Agent 运行上下文没有接上同一份数据。

**Recommendation**

让 `buildMemoryContext` 同时读取 `project_memory_items`，或把 Memory Palace 写入同步到 `.bytro/project-memory.md`。如果产品定义是 DB 为主，则优先改 `buildMemoryContext` 使用 `memory:listProjectItems` / 新 IPC 读取 DB 条目并格式化注入。

Resolution: `buildMemoryContext` now reads `window.api.memoryPalace.list(workspaceId)` and injects formatted DB-backed Memory Palace entries.

### ~~[P1] 新建 Memory 条目默认 Core 但无法保存~~ → Resolved

**File**: `src/renderer/src/components/workspace/MemoryContent.tsx:123-138`

新建条目时 `editDraft.category` 是 `undefined`，select UI 显示默认 `core`，但并没有写入 draft。保存按钮只检查 title/content，用户填完直接点 Save 时会进入 `!editDraft.category` 分支并静默 return。除非用户手动切换一次分类，否则新建失败。

**Impact**

- Memory Palace 的 P0 CRUD 新建路径不可用或非常容易失败。
- 用户没有错误反馈，会以为保存按钮坏了。

**Recommendation**

新建时初始化 draft：

```ts
setDraft({ category: 'core', title: '', content: '' })
```

或在保存时 fallback：

```ts
category: (editDraft.category ?? 'core') as MemoryCategory
```

Resolution: `startEditing()` now initializes new-entry draft data with `{ category: 'core', title: '', content: '' }`.

### ~~[P1] TaskRail Memory mini 区不会主动加载数据~~ → Resolved

**File**: `src/renderer/src/components/workspace/TaskRail.tsx:30-36`

TaskRail 直接读取 `memoryPalaceStore.items` 来展示 top memories，但这里没有按当前 workspace 调用 `loadItems`。如果用户还没打开过 MemoryContent，store 为空，TaskRail 底部会一直显示 `No entries yet`，即使 DB 里已有记忆条目。

**Impact**

- Module C 的 TaskRail mini 区验收不成立。
- 用户看不到已有记忆的 top 3 摘要。

**Recommendation**

TaskRail 读取 `currentWorkspaceId`，在 workspace 变化时调用 `loadItems(currentWorkspaceId)`。同时注意不要和 MemoryContent 的加载策略互相覆盖出错。

Resolution: TaskRail now reads `currentWorkspaceId` and calls `loadItems(currentWorkspaceId)` when it changes.

### ~~[P2] Home 仍然创建全局会话~~ → Resolved

**File**: `src/renderer/src/pages/Home.tsx:8-10`

TaskRail 和 Cmd+N 已传 `workspace_id`，但 Home 的 `Start New Chat` 仍只传 title。当前 App 会按 workspace 过滤 conversation list，这条从 Home 创建的会话会成为 `workspace_id = null` 的全局会话，刷新或切换后可能从当前项目任务列表消失。

**Impact**

- 当前 workspace 下创建的新任务可能变成全局会话。
- 会话创建入口行为不一致。

**Recommendation**

Home 读取 `currentWorkspaceId` 并传入：

```ts
createConversation({
  title: 'New Chat',
  workspace_id: currentWorkspaceId ?? undefined
})
```

Resolution: Home now reads `currentWorkspaceId` and passes it to `createConversation`.

### ~~[P2] Cmd+N 仍可能使用旧 workspace~~ → Resolved

**File**: `src/renderer/src/App.tsx:40-68`

快捷键创建会话使用了 `currentWorkspaceId`，但 `handleKeyDown` 的 dependency list 没有包含它。切换 workspace 后，keydown handler 可能仍闭包旧 workspace id，导致 Cmd+N 创建到错误项目下。

**Impact**

- Cmd+N 可能把任务创建到错误 workspace。
- 与 TaskRail 新建按钮行为不一致。

**Recommendation**

把 `currentWorkspaceId` 加入 `useCallback` dependency list。

Resolution: `currentWorkspaceId` is now included in the `handleKeyDown` dependency list.

## Required Before Marking Complete

- ~~Wire MemoryContent to the tested markdown parser.~~ ✅
- ~~Rebuild native dependencies so `pnpm test` passes in the current runtime.~~ ✅
- Re-run `pnpm run typecheck`.
- Re-run `pnpm test`.
- Re-run `pnpm build`.
