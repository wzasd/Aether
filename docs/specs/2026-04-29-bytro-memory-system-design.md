# Bytro 记忆系统设计

> 让不同 agent / 不同模型 / 不同 session 在同一个项目里共享长期知识，同时不污染记忆、不丢上下文、不把 runtime session 当成记忆。

## 一、核心原则（5 条铁律）

1. **代码是最高真相源** — 记忆只能辅助，不能替代读代码。涉及当前实现时，agent 必须回到代码确认。
2. **Project Memory 是共享长期层** — 所有 agent 都读同一份项目记忆，包括技术栈、架构决策、踩坑、约定、错误模式。
3. **Conversation Summary 是任务连续性层** — 会话摘要服务于当前任务恢复、上下文压缩、跨 session 续作。
4. **Agent Memory 是角色/偏好层** — 存 agent 的工作方式、用户偏好、沟通风格，不存太多项目事实。
5. **AgentSession 不是记忆** — Claude CLI session id、Codex resume id 只是运行时通道，可以丢、可以重建。

补充边界：**AgentSession 只保证 provider runtime continuity；跨模型、跨 session、上下文压缩后的认知连续性，必须来自 Project Memory + Conversation Summary + Agent Memory，而不是来自 Claude/Codex 自己的 resume。**

## 二、概念模型

```
Workspace / Project
  ├── Project Memory
  │     技术栈、决策、踩坑、约定、错误模式
  │
  ├── Agent Memories
  │     claude-code.md
  │     codex.md
  │     local-model.md
  │
  ├── Conversations
  │     ├── Messages
  │     ├── Conversation Summaries
  │     └── Agent Sessions
  │           ├── Claude Code session chain
  │           ├── Codex session chain
  │           └── Local model session chain
  │
  └── Memory Index
        FTS / future embedding / search cache
```

对应关系：

| 概念 | 含义 |
|------|------|
| Workspace | 项目单位 |
| Conversation | 用户可见任务线 |
| Agent | Claude Code / Codex / Local model |
| AgentSession | 某个 agent 在某个 conversation 下的运行时通道 |
| MemoryCandidate | agent 提出的待沉淀知识 |
| ProjectMemory | 被确认后的长期项目知识 |

## 三、存储分层

真相源 + 候选队列 + 编译索引 三层。

### 文件层（真相源）

```
.bytro/
  project-memory.md          人可读项目记忆真相源
  agents/
    claude-code.md           Claude Code 角色/偏好记忆
    codex.md                 Codex 角色/偏好记忆
  markers/
    *.yaml                   待确认/已确认的候选记忆
```

### SQLite 层（编译产物 + 结构化数据）

| 表 | 用途 | 性质 |
|----|------|------|
| messages | 消息历史 | 已有 |
| conversations | 会话元数据 | 已有 |
| agent_sessions | agent runtime session chain | 新增 |
| agent_profiles | agent memory read model / cache | 新增 |
| memory_candidates | 候选记忆 | 新增 |
| project_memory_items | 物化后的项目记忆 read model | 新增 |
| conversation_summaries | 会话摘要 | 新增 |
| summary_segments | append-only 摘要 ledger | 新增 |
| memory_fts | FTS5 检索索引 | 新增 |

**关键**：`.bytro/project-memory.md` / `.bytro/agents/*.md` / `.bytro/markers/*.yaml` = 真相源；`project_memory_items`、`agent_profiles` 和 `memory_fts` = 编译产物或 read model，可 rebuild；`conversation_summaries` = 会话压缩 read model；`summary_segments` = 可审计历史。

## 四、三层记忆定义

### 4.1 Agent Memory

**用途**：保持 agent 的角色、性格、工作偏好。

**示例**：

```markdown
# Codex Agent Memory

## Role
- 主要负责代码 review、实现、验证、打包问题定位。

## User Preferences
- 用户喜欢中文沟通。
- 用户希望先 review，再决定是否修改。
- review 结果要写入 review 文档。

## Working Rules
- 修改代码后优先跑 typecheck/build。
- 不要覆盖用户未提交改动。
```

**写入策略**：
- 低风险，可由 agent 提议自动写入
- 涉及用户偏好时最好用户确认
- 不存项目事实，项目事实进入 Project Memory

### 4.2 Project Memory

**用途**：所有 agent 共享的长期项目知识。

**分类**：

| Kind | 含义 |
|------|------|
| decision | 架构决策 |
| lesson | 踩坑教训 |
| convention | 工程约定 |
| fact | 稳定事实 |
| mistake | 以前犯过的错误 |
| open_question | 未决问题 |

**示例**：

```markdown
## M001: Claude stream-json stdin 不能使用 user_message

Status: active
Kind: mistake
Confidence: high
Source: bytro-p0-review

Wrong:
`{ "type": "user_message", "content": "..." }`

Correct:
`{ "type": "user", "message": { "role": "user", "content": [...] } }`

Prevention:
实现 Claude CLI 输入协议前，先检查本地 SDK 类型或跑最小脚本验证。
```

**写入策略**：
- agent 不能直接污染长期项目记忆
- agent 只能提交 candidate
- confirmed 后才 materialize 到 project-memory.md

### 4.3 Conversation Memory

**用途**：保持某个任务线的连续性。

**结构化定义**：

```typescript
type ConversationSummary = {
  conversationId: string
  summary: string
  completedItems: string[]
  pendingItems: string[]
  changedFiles: string[]
  decisions: string[]
  risks: string[]
  nextSteps: string[]
  fromMessageId: string
  toMessageId: string
}
```

**恢复会话时，agent 需要看到**：
- 最近摘要
- 最近 N 条消息
- 当前 pending items
- 当前风险
- 相关 project memory

## 五、记忆生命周期

不要让 agent 直接写长期记忆。用 candidate 流程。

```
发现重要信息
  ↓
captured 候选记忆
  ↓
normalized 结构化整理
  ↓
approved 用户确认 / 高置信规则确认
  ↓
materialized 写入 project-memory.md / agent memory / docs
  ↓
indexed 编译进 SQLite FTS
```

**状态机**：

```typescript
type MemoryCandidateStatus =
  | 'captured'
  | 'normalized'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'materialized'
  | 'indexed'
```

**规则**：
- explicit 用户明确说"记住" → 可自动 approved
- inferred 模型推断 → needs_review
- 影响所有 agent 的项目记忆 → 必须确认
- 只影响当前会话的摘要 → 自动写

## 六、启动时上下文组装

每个 agent 启动或发送消息前，Bytro 组装 prompt：

```
1. Agent Profile
   这个 agent 的角色、偏好、工作方式

2. Project Memory
   当前项目最相关的决策、踩坑、约定

3. Conversation Summary
   当前会话摘要、待办、风险、最近进展

4. Recent Messages
   最近 N 条原始消息

5. Relevant Recall
   根据当前任务检索出来的相关记忆/文档/历史错误

6. Code Context
   当前任务需要时，agent 再读真实代码
```

公式：

```
system prompt =
  agent memory
  + project memory
  + conversation summary
  + recall snippets
  + current user request
```

## 七、检索入口

统一成一个 recall 接口，不暴露一堆分散工具。

```typescript
recall(query: string, {
  scope: 'agent' | 'project' | 'conversation' | 'all',
  mode: 'lexical' | 'semantic' | 'hybrid',
  depth: 'summary' | 'raw',
  limit: number
})
```

**P0 只做**：
- mode = lexical
- scope = project / conversation / all
- depth = summary

**以后再加**：
- semantic embedding
- hybrid RRF
- raw message search
- cross-project global memory

## 八、数据库最小设计

```sql
CREATE TABLE memory_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_conversation_id TEXT,
  source_message_id TEXT,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_memory_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  source_path TEXT,
  source_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversation_summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  completed_items TEXT,
  pending_items TEXT,
  changed_files TEXT,
  risks TEXT,
  next_steps TEXT,
  from_message_id TEXT,
  to_message_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_session_id TEXT,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE agent_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source_path TEXT,
  source_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, agent_id)
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  title,
  content,
  kind,
  content='project_memory_items',
  content_rowid='rowid'
);
```

## 九、写入规则

| 信息类型 | 写入位置 | 是否需要确认 |
|---------|---------|------------|
| 用户说"记住这个项目规则" | project memory candidate | 是，或明确指令自动确认 |
| agent 推断的踩坑 | memory candidate | 是 |
| build/debug 已验证事实 | memory candidate | 可高置信自动确认，但保留撤回 |
| 用户沟通偏好 | agent memory candidate | 轻确认 |
| 当前任务进度 | conversation summary | 自动 |
| Claude/Codex resume id | agent_sessions | 自动 |
| 搜索索引 | memory_fts | 自动 rebuild |

## 十、P0 实现路线

分 4 步做，不要一口吃成完整系统。

### P0.1：身份模型

**实现**：
- agent_sessions 表
- conversation_summaries 表
- agent_profiles（agent memory 文件读写）
- project_memory_items 表
- memory_candidates 表

**目标**：
- 先把 Conversation 和 AgentSession 分开
- 先让会话摘要可持久化

### P0.2：手动/半自动记忆

**实现**：
- "记住这个" → memory_candidate
- 确认 → project-memory.md
- rebuild → memory_fts

**目标**：
- 项目记忆能沉淀，但不会被 agent 随便污染

### P0.3：启动注入

**实现**：
- agent 启动 / sendMessage 前自动加载：
  - agent profile
  - project memory top N
  - conversation summary
  - recent messages

**目标**：
- 换模型、换 session、上下文压缩后还能续上

### P0.4：会话摘要

**实现**：
- 每隔 N 条消息 / 任务结束 / 上下文压缩前
- 生成 conversation summary
- 写入 conversation_summaries

**目标**：
- 不依赖 Claude --resume 作为唯一连续性

## 十一、P1/P2 演进

**P1**：
- Memory Candidates UI
- Memory Review Feed
- summary_segments append-only ledger
- project-memory.md 自动导出
- FTS 搜索结果可引用来源

**P2**：
- embedding
- semantic / hybrid recall
- cross-project global memory
- raw message search
- LSM compaction
- Memory Hub 页面

## 最终架构一句话

> AgentSession 负责运行连续性；ConversationSummary 负责任务连续性；ProjectMemory 负责项目长期知识；AgentMemory 负责角色和偏好；MemoryCandidate 负责防污染；MemoryIndex 负责找得到。

先做轻量版，但边界按终态设计。这样以后加 Claude Code、Codex、本地模型、多项目记忆、embedding 检索，都不会推倒重来。
