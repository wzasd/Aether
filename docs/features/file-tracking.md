---
status: complete
priority: P1
last_verified: 2026-05-01
doc_kind: feature
---

# Feature: File Change Tracking（文件变更追踪）

## Why（为什么做）

Agent 修改文件后，用户必须能看到"改了什么"。没有这个，代码审查的核心价值缺失，用户只能盲目接受 Agent 的修改。

**用户故事**：Agent 修改了我的代码文件后，Track Changes 面板能看到改了哪些文件、增删了多少行、具体的 diff 内容。

## What（功能需求）

| 编号 | 需求 | 说明 |
|------|------|------|
| B1 | 捕获 Agent 文件操作 | 监听 `Write`/`Edit`/`Delete` tool call，记录到 `file_changes` 表 |
| B2 | 计算 Diff | Write/Edit 操作前后，计算 diff hunk，存入 `diff_text` |
| B3 | Track Changes 面板展示 | `DiffPanel` 读取当前会话的 `file_changes`，不使用硬编码数据 |
| B4 | 变更摘要 | SharedConversation 中展示 SessionChangesSummary（当前会话所有文件变更聚合） |
| B5 | Follow Suggestions | 点击文件变更卡片 → WorkspaceArea Code 面板打开对应文件 |

## How（设计决策）

**捕获策略**：不用 `fs.watch`，而是在 `chatStore` 内拦截 tool_result 事件流。原因：fs.watch 无法区分是哪个 Agent 改的文件，且有跨平台问题。

**会话归属**：`file_changes.conversation_id` 外键（不是旧设计的 task_id）。与 Module A 的 Task=Conversation 决策对齐。

**MCP 工具名归一化**：MCP 工具名格式为 `mcp__server__ToolName`，需要提取最后一段与 `Write`/`Edit`/`Delete` 匹配。

**agent_count 原子性**：通过 main-process 原子自增持久化，不从 renderer 直接写。

## Status（当前状态）

### 已完成
- [x] `file_changes` 表（schema v5，conversation_id 外键）
- [x] `change:*` IPC handlers（`src/main/ipc/change.ts`）
- [x] Preload `api.change` 桥接
- [x] `changeStore.ts`
- [x] `chatStore` 捕获 Write/Edit/Delete（含 MCP 工具名归一化）
- [x] Write/Edit 行数计算，deleted-file 显示
- [x] `DiffPanel` 读取真实 changeStore 数据（非 SAMPLE_DIFFS）
- [x] `agent_count` 原子自增持久化
- [x] **B4**：SessionChangesSummary 组件（SharedConversation 内的变更聚合折叠栏）
- [x] **B5**：Follow Suggestions——DiffPanel 文件卡片点击打开 Code 面板对应文件

### 待实现

> 无。B4/B5 已完成（2026-05-01）。

### 测试缺口（必须补）
- [ ] `change:record` IPC handler 单测
- [ ] tool-name 归一化逻辑单测
- [ ] Write/Edit 行数计算单测
- [ ] `DiffPanel` 组件测试
- [ ] `change_count` / `agent_count` 计数器集成测试

## Code（代码位置）

| 组件 | 文件 |
|------|------|
| change store | `src/renderer/src/stores/changeStore.ts` |
| chatStore tool capture | `src/renderer/src/stores/chatStore.ts`（tool_result 处理段） |
| change IPC | `src/main/ipc/change.ts` |
| DB schema | `src/main/core/db.ts`（file_changes 表 v5） |
| DiffPanel UI | `src/renderer/src/components/DiffPanel/` |

**相关文档**：
- 设计规格：`docs/design/modules/B-file-change-tracking.md`
- 实现计划：`docs/plans/2026-05-01-module-B-implementation.md`
- Review：`docs/reviews/active/2026-05-01-module-B-code-review.md`
