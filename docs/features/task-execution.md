---
status: in-progress
priority: P0
last_verified: 2026-05-01
doc_kind: feature
---

# Feature: Task Execution（任务即会话）

## Why（为什么做）

这是产品的核心闭环。没有任务管理，用户无法创建和跟踪工作单元。

**架构决策**：Task = Conversation。不存在独立的"任务"实体，TaskRail 就是会话列表。这个决策简化了数据模型，避免了 task 和 conversation 的双重状态同步问题。

**用户故事**：我点击 [+New Task] 开始一次新的工作会话。输入"修复 ToolCall 折叠问题"，这句话自动成为会话标题。Agent 开始响应，状态从 Idle 变为 Running。我在 TaskRail 里能看到所有会话及其状态。

## What（功能需求）

| 编号 | 需求 | 说明 |
|------|------|------|
| A1 | 创建会话 | 点击 [+New Task] → 创建 conversation（status=Idle），显示在 TaskRail |
| A2 | 首条消息即标题 | 用户发送第一条消息后，conversation.title = 该消息前 50 字符 |
| A3 | 状态自动流转 | 发消息→Running，等待权限→Waiting，完成→Done，出错/Stop→Error |
| A4 | 发送消息触发执行 | 输入并发送 → 自动启动 AI session（无需单独"开始"按钮） |
| A5 | TaskRail 展示会话列表 | 按 status 过滤，显示 title/status/时间/agent数/changes数 |
| A6 | 点击会话切换对话 | 点击 TaskRail → SharedConversation 加载对应消息历史 |

## How（设计决策）

**数据层**：`conversations` 表（schema v4）承载所有状态。`file_changes`、agent session 通过 `conversation_id` 关联。

**状态流**：`chatStore` 是唯一写入会话状态的地方。`sessionId → conversationId` 映射解决并发多 session 的状态归属问题。

**标题策略**：`title_source` 字段区分 `user`（用户手动或首条消息）和 `ai`（assistant 回复）。一旦设为 `user`，不再覆盖。

**Workspace 作用域**：会话创建时绑定当前 `workspace_id`，TaskRail 只显示当前 workspace 的会话。

## Status（当前状态）

### 已完成
- [x] conversations schema v4（含 status, title_source, workspace_id, change_count, agent_count）
- [x] TaskRail 切换到 chatStore
- [x] workspace-scoped New Task
- [x] conversation:autoTitle, conversation:updateStatus IPC

### ⚠️ P1 问题（必须修复）

| ID | 问题 | 位置 |
|----|------|------|
| A-P1-1 | AI 回复的 `complete` 分支再次调用 `autoTitle`，覆盖用户首条消息标题 | `chatStore.ts:829-845` |
| A-P1-2 | Waiting/Running 状态写到当前可见会话，而非 sessionId 对应的会话 | `chatStore.ts` |
| A-P1-3 | Agent 启动时未绑定当前 workspace 的 `repo_path` | `chatStore.ts` |

### 待实现
- [ ] Home/Cmd+N 创建的会话需要带 workspace_id（当前为全局会话）
- [ ] agent_count 持久化一致性验证

## Code（代码位置）

| 组件 | 文件 |
|------|------|
| 核心 store | `src/renderer/src/stores/chatStore.ts` |
| 会话状态 IPC | `src/main/ipc/conversation.ts` |
| DB schema | `src/main/core/db.ts`（conversations 表 v4） |
| TaskRail UI | `src/renderer/src/components/TaskRail/` |
| SharedConversation UI | `src/renderer/src/components/SharedConversation/` |

**相关文档**：
- 设计规格：`docs/design/modules/A-task-execution-engine.md`
- 遗留 review：`docs/reviews/active/2026-05-01-latest-code-review.md`
