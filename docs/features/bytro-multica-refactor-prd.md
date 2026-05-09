# bytro → Multica 架构全量重构 PRD

**版本**: 1.0  
**日期**: 2026-05-09  
**状态**: 草案  
**作者**: @需求文档师  
**决策人**: @tomek-rumore  
**决策日期**: 2026-05-09  
**架构方向**: 完全重写（非渐进改造）

---

## 1. 概述

### 1.1 重构目标

将 bytro-app 从**对话驱动的临时进程模型**重构为**事件驱动的常驻 Daemon 模型**，对齐 Multica 的核心架构：

- **进程模型**: 临时 spawn → Daemon 常驻 + 心跳
- **调度模型**: Orchestrator 同步分配 → 事件总线 + 任务队列 + Claim 模式
- **Agent 可见性**: 批量上下文注入 → 实时消息总线
- **工作单元**: Conversation → Issue + Comment 线程

### 1.2 关键决策（已确认）

| 决策 | 选择 | 影响 |
|------|------|------|
| **进程模型** | Daemon 常驻（Multica Runtime 方式） | Agent 不再冷启动，保留 session |
| **旧模型** | 完全废弃 | Open Floor / Orchestrated 全部重建 |
| **现有修复** | 重写后重新解决 | 22 个 commit 的修复在新架构中重做 |

### 1.3 为什么重构

| 当前痛点 | 目标状态 |
|---------|---------|
| Agent 每次冷启动，无跨会话记忆 | Daemon 常驻，workspace 目录保留上下文 |
| Agent 互不可见（6 条平行独白） | 消息总线，实时共享 |
| Orchestrator 是单点瓶颈 | 事件驱动，去中心化调度 |
| 无任务生命周期（纯讨论） | Issue 状态流转（todo→in_progress→done） |
| 用户必须手动触发 Agent | Agent 可自主 claim 任务 |

### 1.4 重构范围

**在范围内**:
- Agent 进程模型（临时 → Daemon）
- 调度机制（Orchestrator → 事件总线 + TaskQueue）
- 消息存储（emit 事件 → 持久化消息总线）
- 工作单元抽象（Conversation → Issue + Comment）
- 前端渲染模式（批量 → 实时流式）

**不在范围内**:
- Electron 主框架（保留）
- SQLite 数据库（保留，扩展新表）
- React + Zustand 前端栈（保留）
- ACP 协议（保留，作为 Backend 接口之一）
- Tailwind UI 组件（保留）

---

## 2. 架构对比

### 2.1 当前 bytro 架构

```
┌─────────────────────────────────────────────┐
│  Frontend (Electron + React + Zustand)      │
│  - Chat UI                                  │
│  - AgentStatusBar                           │
│  - IPC → window.api.orchestrator           │
└──────────────────┬──────────────────────────┘
                   │ IPC
┌──────────────────▼──────────────────────────┐
│  Main Process (Node.js)                     │
│  ├─ AgentOrchestrator (同步调度)            │
│  │   ├─ sendUserMessage()                  │
│  │   ├─ executeOpenFloor()                │
│  │   │   ├─ Promise.all(6 AgentRuntime)   │
│  │   │   └─ 等全部完成 → emit 事件         │
│  │   └─ executeTask() (Orchestrated)       │
│  ├─ AgentRuntime (临时进程)                 │
│  │   ├─ start() → spawn CLI               │
│  │   ├─ send() → 一次性 prompt             │
│  │   └─ dispose() → 进程销毁               │
│  └─ SQLite DB (conversations, messages)    │
└─────────────────────────────────────────────┘
```

**核心问题**:
- Orchestrator 是同步阻塞的——Promise.all 等全部 Agent 完成
- AgentRuntime 用完即毁——每次从零开始
- 消息不持久化到 DB——只是 emit IPC 事件
- 没有任务队列——无法异步 claim

### 2.2 目标 Multica 式架构

```
┌─────────────────────────────────────────────┐
│  Frontend (Electron + React + Zustand)      │
│  - Chat UI (实时流式渲染)                    │
│  - Issue Board (看板视图)                    │
│  - IPC → window.api.bus / window.api.queue   │
└──────────────────┬──────────────────────────┘
                   │ IPC
┌──────────────────▼──────────────────────────┐
│  Main Process                               │
│  ├─ EventBus (消息总线)                     │
│  │   ├─ Subscribe(EventNewComment, handler) │
│  │   ├─ Subscribe(EventTaskClaimed, handler)│
│  │   └─ Publish(event) → all subscribers    │
│  ├─ TaskQueue (任务队列)                    │
│  │   ├─ Enqueue(task)                      │
│  │   ├─ Claim(runtimeID) → task            │
│  │   └─ Complete(taskID, result)           │
│  ├─ AgentDaemon (常驻进程管理)              │
│  │   ├─ registerRuntime(agent, workspace)  │
│  │   ├─ heartbeat() (15s)                  │
│  │   ├─ pollTasks() (3s)                   │
│  │   └─ executeTask(task) → spawn CLI      │
│  └─ SQLite DB                               │
│      ├─ issues (工作单元)                   │
│      ├─ comments (消息流)                   │
│      ├─ tasks (执行队列)                    │
│      ├─ runtimes (Daemon 注册表)            │
│      └─ conversations (保留兼容)            │
└─────────────────────────────────────────────┘
```

**关键变化**:
- Orchestrator 被拆成 EventBus + TaskQueue
- AgentRuntime 升级为 AgentDaemon（常驻）
- 消息持久化到 comments 表
- 新增 Issue 作为工作单元

---

## 3. 迁移路径（4 Phase）

### Phase 1: 消息总线 + 持久化（2-3 天）

**目标**: 不改进程模型，先让消息持久化 + 事件驱动

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 EventBus | `src/main/core/event-bus.ts` | 内存事件总线（Pub/Sub） |
| 消息持久化 | `messages` 表扩展 | Agent 回复也存 messages 表 |
| Open Floor 改事件驱动 | `orchestrator.ts` | Round 1 Agent A 完成 → emit → 触发 Round 2 |
| 前端实时渲染 | `chatStore.ts` | WebSocket 式实时追加（已有 flushSync） |

**验收标准**:
- [ ] Agent A 回复后立即显示在 UI
- [ ] Agent B 能看到 Agent A 的回复（通过 DB，不是上下文注入）
- [ ] 用户刷新页面后能看到完整对话历史

### Phase 2: TaskQueue + Claim 模式（3-4 天）

**目标**: 引入任务队列，Agent 从"被分配"变成"主动认领"

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 TaskQueue | `src/main/core/task-queue.ts` | 内存队列 + DB 持久化 |
| 新增 Task 表 | `src/main/db/schema.sql` | tasks(id, issue_id, agent_id, status, payload) |
| Agent 改 Claim | `agent-runtime.ts` | 新增 `claimTask()` + `pollQueue()` |
| Orchestrator 改调度器 | `orchestrator.ts` | 从"直接执行"变成"创建任务 + 等 Agent claim" |

**验收标准**:
- [ ] 用户发消息 → 创建 task → 进入队列
- [ ] Agent 主动 poll → claim task → 执行
- [ ] 多个 Agent 可以竞争 claim 同一个 task

### Phase 3: Daemon 常驻进程（5-7 天）

**目标**: Agent 从临时进程变成常驻 Daemon

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 AgentDaemon | `src/main/daemon/` | 独立进程/线程，常驻运行 |
| 心跳机制 | `src/main/daemon/heartbeat.ts` | 每 15s 报告状态 |
| Runtime 注册表 | `runtimes` 表 | daemon_id, agent_id, status, last_seen_at |
| Sweeper | `src/main/daemon/sweeper.ts` | 清理 stale runtime |
| Workspace 隔离 | `src/main/daemon/exec-env.ts` | 每个 task 独立工作目录 |

**验收标准**:
- [ ] Daemon 启动后持续运行
- [ ] 心跳正常，Sweeper 能检测 offline
- [ ] Task 执行保留上下文（ResumeSessionID）

### Phase 4: Issue + Comment 模型（3-4 天）

**目标**: 从 Conversation 升级到 Issue + Comment

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 Issue 表 | `src/main/db/schema.sql` | issues(id, title, status, assignee_id, workspace_id) |
| 新增 Comment 表 | `src/main/db/schema.sql` | comments(id, issue_id, author_id, content, parent_id) |
| 前端 Issue Board | `src/renderer/` | 新增看板视图（Kanban） |
| 状态流转 | `src/main/core/issue-lifecycle.ts` | todo → in_progress → in_review → done |

**验收标准**:
- [ ] 可以创建 Issue
- [ ] 可以 assign 给 Agent
- [ ] Agent 回复变成 Comment
- [ ] 状态流转正常

---

## 4. 详细改动清单

### 4.1 新增文件

| 文件 | 职责 | Phase |
|------|------|-------|
| `src/main/core/event-bus.ts` | 内存事件总线 | P1 |
| `src/main/core/task-queue.ts` | 任务队列 + Claim | P2 |
| `src/main/daemon/agent-daemon.ts` | 常驻 Daemon | P3 |
| `src/main/daemon/heartbeat.ts` | 心跳上报 | P3 |
| `src/main/daemon/sweeper.ts` | Stale runtime 清理 | P3 |
| `src/main/daemon/exec-env.ts` | 工作目录隔离 | P3 |
| `src/main/core/issue-lifecycle.ts` | Issue 状态机 | P4 |
| `src/renderer/src/components/board/IssueBoard.tsx` | 看板视图 | P4 |

### 4.2 修改文件

| 文件 | 改动 | Phase |
|------|------|-------|
| `src/main/ai/orchestrator.ts` | 拆分为 EventBus + TaskQueue 调度 | P1-P2 |
| `src/main/ai/agent-runtime.ts` | 加 Claim + Poll 能力 | P2 |
| `src/renderer/src/stores/chatStore.ts` | 实时流式渲染 | P1 |
| `src/main/core/db/schema.sql` | 新增 issues, comments, tasks, runtimes 表 | P2-P4 |

### 4.3 删除/废弃

| 文件 | 原因 | Phase |
|------|------|-------|
| `executeOpenFloor()` 同步逻辑 | 改事件驱动 | P1 |
| `AgentRuntime` 临时进程模型 | 升级 Daemon | P3 |

---

## 5. 数据模型变更

### 5.1 新增表

```sql
-- Issues（工作单元）
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo', -- todo, in_progress, in_review, done, cancelled
  assignee_id TEXT, -- agent_profile_id or null
  priority TEXT DEFAULT 'medium',
  created_at INTEGER,
  updated_at INTEGER
);

-- Comments（消息流）
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  author_id TEXT, -- user or agent profile id
  author_type TEXT, -- 'human' | 'agent'
  content TEXT NOT NULL,
  parent_id TEXT, -- thread reply
  created_at INTEGER
);

-- Tasks（执行队列）
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  agent_id TEXT,
  status TEXT DEFAULT 'pending', -- pending, claimed, running, completed, failed
  payload TEXT, -- JSON: prompt, context, etc
  result TEXT,
  claimed_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER
);

-- Runtimes（Daemon 注册表）
CREATE TABLE runtimes (
  id TEXT PRIMARY KEY,
  daemon_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  status TEXT DEFAULT 'online', -- online, offline, stale
  last_seen_at INTEGER,
  created_at INTEGER
);
```

### 5.2 兼容性

- `conversations` 表保留，作为 Comment 的 fallback
- `messages` 表保留，Open Floor 模式继续可用
- 新增表不影响现有功能

---

## 6. 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 重构期间无法交付 | 高 | 高 | Phase 拆分，每 Phase 可独立交付 |
| 257 个测试大面积失败 | 高 | 高 | 每 Phase 保持测试通过，逐步迁移 |
| Daemon 进程管理复杂 | 中 | 中 | 先做单 Daemon，后续再考虑多 Daemon |
| 事件总线性能瓶颈 | 低 | 中 | 内存总线足够支撑本地场景 |
| SQLite 并发写冲突 | 中 | 中 | 使用 WAL 模式 + 队列序列化写 |
| 前端实时渲染卡顿 | 低 | 中 | 虚拟列表 + 节流 |

---

## 7. 验收标准

### 7.1 整体验收

- [ ] Agent 常驻运行（Daemon 模式）
- [ ] Agent 主动 claim 任务（不是被动分配）
- [ ] Agent 回复实时可见（消息总线）
- [ ] Issue 状态流转完整（todo → done）
- [ ] 看板视图可用（Kanban）
- [ ] 所有 257 个测试通过
- [ ] 新增测试覆盖 EventBus + TaskQueue + Daemon

### 7.2 每 Phase 验收

**P1 验收**:
- [ ] EventBus 能 publish/subscribe
- [ ] Agent 回复持久化到 messages 表
- [ ] 前端实时显示新消息

**P2 验收**:
- [ ] TaskQueue 能 enqueue/claim/complete
- [ ] Agent 主动 poll 并 claim task
- [ ] 任务状态流转正确

**P3 验收**:
- [ ] Daemon 启动后持续心跳
- [ ] Sweeper 能检测 offline runtime
- [ ] Task 执行保留上下文

**P4 验收**:
- [ ] Issue CRUD 完整
- [ ] Comment 线程化
- [ ] 看板视图渲染正常

---

## 8. 回滚方案

### 8.1 每 Phase 回滚

每 Phase 都是独立的 commit chain，可以单独 revert：

```bash
# P1 回滚
git revert HEAD~3..HEAD  # 撤销 P1 commits
# 回退到：orchestrator 同步模式 + emit 事件

# P2 回滚
git revert HEAD~4..HEAD  # 撤销 P2 commits
# 回退到：P1 事件总线（保留消息持久化）
```

### 8.2 数据库回滚

- 新增表（issues, comments, tasks, runtimes）不影响旧表
- 旧数据保留，回滚后旧功能继续工作
- 如果需要清理：DROP TABLE 新增表即可

### 8.3 紧急回滚

```bash
# 快速回滚到重构前
git checkout pre-refactor-branch
# 或
git reset --hard <pre-refactor-commit>
```

---

## 9. 时间线

| Phase | 工作 | 预估时间 | 负责人 |
|-------|------|---------|--------|
| P1 | 事件总线 + 消息持久化 | 2-3 天 | @Coder |
| P2 | TaskQueue + Claim 模式 | 3-4 天 | @Coder |
| P3 | Daemon 常驻进程 | 5-7 天 | @Coder + @架构设计 |
| P4 | Issue + Comment 模型 | 3-4 天 | @Coder + @UI设计专家 |
| Review | 代码审查 + 测试 | 2-3 天 | @Reveiw工程师 |
| **总计** | | **15-21 天** | |

---

## 10. 附录

### A. 术语映射

| bytro 旧术语 | Multica 新术语 | 说明 |
|-------------|---------------|------|
| Conversation | Issue | 工作单元 |
| Message | Comment | 消息/回复 |
| AgentRuntime | Runtime | Agent 执行环境 |
| Orchestrator | EventBus + TaskQueue | 调度系统 |
| Open Floor | Issue 评论区讨论 | 自由讨论模式 |
| Orchestrated | Task 执行链 | 结构化任务 |

### B. 参考文档

- [Multica CLI and Daemon Guide](/Users/wangzhao/Documents/agentWorkSpace/catwork/multica/CLI_AND_DAEMON.md)
- [Multica CLAUDE.md](/Users/wangzhao/Documents/agentWorkSpace/catwork/multica/CLAUDE.md)
- [ADR-012: Iterative Open Floor](../architecture/decisions/adr-012-iterative-open-floor.md)
- [Open Floor 多轮 PRD](./open-floor-multi-round.md)

### C. 关键决策待确认

1. **是否保留 Open Floor 模式？** 还是全部改为 Issue + Comment？
2. **Daemon 是单进程还是多进程？** 每个 Agent 一个 Daemon 还是一个 Daemon 管理所有 Agent？
3. **TaskQueue 是内存队列还是 DB 队列？** 内存快但丢数据，DB 持久但慢
4. **Issue 和 Conversation 是并存还是迁移？** 旧 conversation 数据怎么处理？

---

**下一步**: 等 @tomek-rumore 确认本 PRD，然后按 Phase 执行。
