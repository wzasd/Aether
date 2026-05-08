---
status: active
owner: mochi
last_verified: 2026-04-30
doc_kind: requirements
source: docs/design/mochi-design-reference.md
---

# 功能需求文档

从用户视角定义 Mochi 需要实现的功能能力。按「用户能做什么」组织，不按前端组件划分。

## 当前状态

已完成的是 **UI 骨架**：三列布局、面板标签栏、文件树、代码查看器、Preview iframe、底部输出面板、Settings 面板。聊天功能通过 Claude CLI provider 可用。

以下功能 **尚未实现**：

---

## 模块 A: 任务即会话

> **核心概念**：Task = Conversation。TaskRail 就是会话列表。不存在独立的"任务"实体。

### 用户故事
> 我点击 [+New Task] 开始一次新的工作会话。在 composer 里输入第一句话 "修复 ToolCall 折叠问题"，这句话自动成为会话标题。Agent 开始响应，会话状态从 Idle 变为 Running。我在 TaskRail 里能看到所有会话及其状态。

### 功能需求

| 编号 | 需求 | 说明 |
|------|------|------|
| A1 | 创建会话 | 点击 [+New Task] → 创建 conversation（status=Idle），显示在 TaskRail 中 |
| A2 | 首条消息即标题 | 用户发送第一条消息后，conversation.title = 该消息前 50 字符 |
| A3 | 状态自动流转 | 发消息 → Running，Agent 等待权限 → Waiting，完成 → Done，出错/Stop → Error |
| A4 | 发送消息触发执行 | 用户在 composer 输入并发送 → 自动启动 AI session（不需要单独的"开始"按钮） |
| A5 | TaskRail 展示会话列表 | 按 status 过滤（All/Active/Pending/Done），显示 title/status/时间/agent数/changes数 |
| A6 | 点击会话切换对话 | 点击 TaskRail 中某条会话 → SharedConversation 加载对应消息历史 |

---

## 模块 B: 文件变更追踪

### 用户故事
> Agent 修改了我的代码文件后，Track Changes 面板能看到改了哪些文件、增删了多少行、具体的 diff 内容。而不是现在看到的硬编码示例数据。

### 功能需求

| 编号 | 需求 | 说明 |
|------|------|------|
| B1 | 捕获 Agent 文件操作 | 监听 Agent 的 `Write`/`Edit`/`Delete` tool call，记录到 `file_changes` 表 |
| B2 | 计算 Diff | Write/Edit 操作前后，计算文件 diff hunk，存入 `diff_text` |
| B3 | Track Changes 面板展示 | `DiffPanel` 不再展示硬编码数据，改为读取当前 Task 的 `file_changes` |
| B4 | 变更摘要 | SharedConversation 中展示 SessionChangesSummary（当前 Task 所有文件变更聚合） |
| B5 | Follow Suggestions | 点击文件变更卡片 → WorkspaceArea 的 Code 面板打开对应文件 |

### 当前代码状态

- `file_changes` 表已在 DB schema 中定义 ❌（但从未 INSERT）
- `DiffPanel` 展示硬编码 SAMPLE_DIFFS ❌
- **缺失**：Agent tool call 与文件变更之间没有任何关联逻辑

---

## 模块 C: Memory Palace（记忆殿堂）

### 用户故事
> 我可以在 Memory Palace 面板中记录项目规范、踩过的坑、架构决策。Agent 在对话中可以引用这些记忆。我在 TaskRail 底部也能快速看到最近被引用的记忆条目。

### 功能需求

| 编号 | 需求 | 说明 |
|------|------|------|
| C1 | 记忆条目 CRUD | 创建/编辑/删除 MemoryEntry（title + category + content + tags） |
| C2 | 分类筛选 | 按 core/architecture/conventions/antipatterns/decisions 筛选 |
| C3 | Agent 引用显示 | 每个条目显示哪些 Agent 引用过（citedBy 列表） |
| C4 | MemoryContent 面板 | WorkspaceArea 中的 `type:'memory'` 面板，左右双栏布局 |
| C5 | TaskRail 迷你区 | TaskRail 底部展示 citedBy 最多的前 3 条记忆 |
| C6 | 记忆持久化 | 数据存储（当前用本地 state，后续 SQLite/Supabase） |
| C7 | 内联渲染 | 条目内容用自定义 Markdown 渲染器展示（不依赖外部库） |

### 当前代码状态

- 整个模块 **不存在** ❌
- 现有 `memory_candidates`/`project_memory_items` 表是旧 memory 系统，与新 Memory Palace 设计不同

---

## 模块 D: 多 Agent 协作（P2 范围，本次仅架构预留）

### 用户故事
> 一个 Task 可以有 Planner（分解计划）+ Coder（写代码）+ Reviewer（审查）三个 Agent 协作。Planner 先输出计划，Coder 实现，Reviewer 检查。

### 功能需求（本次只做架构预留）

| 编号 | 需求 | 说明 |
|------|------|------|
| E1 | Agent Profile 配置 | Settings → Agents 面板的配置生效（当前只是 UI 展示） |
| E2 | 角色→Provider 映射 | Planner→Opus, Coder→Sonnet, Reviewer→Haiku |
| E3 | 任务内 Agent 切换 | Composer 的 agent selector 可以指定发送给哪个 Agent |

---

## 优先级排序

| 优先级 | 模块 | 原因 |
|--------|------|------|
| **P0** | A: 任务即会话 | 产品核心闭环：创建会话 → 首条消息即标题 → 发送即执行 → 状态自动流转 |
| **P1** | B: 文件变更追踪 | Agent 改了文件用户却看不到，核心价值缺失 |
| **P2** | C: Memory Palace | 新增完整功能模块，依赖 P0 稳定后做 |
| **P3** | D: 多 Agent 协作 | 架构预留，等单 Agent 流程跑通再做 |

---

## 每个模块的交付物

每个模块产出三份文档：

```
docs/specs/<date>-<module>-requirements.md    # 需求文档（用户故事 + 功能列表）
docs/design/modules/<module>.md               # 设计文档（组件/数据/接口设计）
docs/architecture/<module>.md                 # 架构文档（DB/IPC/Store/Event 流）
```

然后才进入代码实现。
