---
feature: context-snapshot-upgrade
status: design
created: 2026-05-05
priority: P2
---

# Feature: contextSnapshot 结构化升级

## 问题陈述

当前 `contextSnapshot` 是 `renderContextPacket` 输出的纯文本字符串，拼在 sub-agent 任务消息头部。问题：

1. **信息不完整**：只有关键词匹配的历史消息 + 项目记忆 + 文件路径，没有"Claude 在这次任务中已经做了什么"
2. **格式脆弱**：纯文本，下游 agent 解析依赖 LLM 理解，结构不一致
3. **token 浪费**：`relevantMessages` 把消息内容 slice(0, 500) 截断传过去，Codex 看到的是碎片
4. **工具执行历史缺失**：Codex 不知道 Claude 已经读了哪些文件、跑了哪些命令，可能重复

**关键洞察**：不需要完整工具历史（会爆炸），需要的是**结构化的任务摘要**：做了什么、改了什么、当前状态是什么。

## 目标

1. `contextSnapshot` 从纯文本升级为结构化 Markdown（对 LLM 更友好的固定格式）
2. 补充"已完成步骤"和"已变更文件"的完整列表（从 `file_changes` 表取，不是猜）
3. token budget 内的信息密度更高（去掉截断碎片，改为摘要）
4. 为 Team pipeline 的 feedback 消息格式提供标准化基础

## 非目标

- 完整工具调用历史传输（序列化体积太大，维护成本高）
- 实时工具状态追踪（需要改 engine 层，本期不动）
- 跨对话的上下文传递（scope = 当前对话）

---

## 架构设计

### 升级后的 contextSnapshot 格式

```markdown
[TASK HANDOFF]
From: Claude (implementation)
To: Codex (review)
Instruction: 审查刚才对 auth 模块的改动，重点关注安全性

[TASK PROGRESS]
Goal: 实现用户登录的 JWT 验证
Completed:
- 创建了 src/main/auth/jwt.ts，实现 sign/verify
- 修改了 src/main/ipc/chat.ts，加了 token 校验中间件
- 更新了 DB schema v14，users 表加 token_hash 字段

Changed Files (3):
- src/main/auth/jwt.ts [added] +87 -0
- src/main/ipc/chat.ts [modified] +23 -5
- src/main/core/db.ts [modified] +12 -0

[PROJECT MEMORY]
### [decision] 使用 SQLite 替代 PostgreSQL
进程内访问，无外部依赖，单人维护。

### [convention] IPC 校验在 main process
不信任 renderer 传来的数据，所有 payload 在 main 校验。
```

### 数据来源

| 字段 | 来源 | 现有 or 新增 |
|------|------|-------------|
| From/To/Instruction | `AgentContextPacket.task` | 现有 |
| Goal | 用 `getLatestSummary().summary` 或 instruction 本身 | 现有 |
| Completed | `getLatestSummary().completed_items` JSON | 现有（已写入但未用） |
| Changed Files | `file_changes` 表按 `conversation_id` 查询 | 现有 |
| Project Memory | `project_memory_items` FTS 查询 | 现有 |

**结论：数据都有，只需要重新组织渲染逻辑。**

### `renderContextPacket` 重构

```typescript
export function renderContextPacket(packet: AgentContextPacket): string {
  const sections: string[] = []

  // Section 1: Task Handoff（必有）
  sections.push(renderTaskSection(packet.task))

  // Section 2: Task Progress（有数据才渲染）
  const progressSection = renderProgressSection(packet.taskState, packet.recentFileChanges)
  if (progressSection) sections.push(progressSection)

  // Section 3: Project Memory（有数据才渲染）
  if (packet.projectMemories.length > 0) {
    sections.push(renderMemorySection(packet.projectMemories))
  }

  return sections.join('\n\n')
}
```

### `AgentContextPacket` 字段补充

`taskState` 已有 `completed: string[]`、`pending: string[]` 字段但从未被填充。需要：

1. `buildContextPacket` 里调用 `getLatestSummary(conversationId)` 取 `completed_items`
2. `recentFileChanges` 升级：现在只有路径，升级为 `{ path, status, additions, deletions }`

```typescript
// 现在
recentFileChanges: string[]

// 升级后
recentFileChanges: Array<{
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
}>
```

---

## 实现计划

### Phase S1：AgentContextPacket 类型升级

**文件：**
- `src/main/ai/context-selector.ts`
  - `AgentContextPacket.recentFileChanges` 类型改为对象数组
  - `loadRecentFileChanges` 查询加 status/additions/deletions
  - `buildContextPacket` 里填充 `taskState.completed` 和 `taskState.pending`

**验收：**
- [ ] `buildContextPacket` 返回的 packet 里 `recentFileChanges` 含 status 字段
- [ ] `taskState.completed` 从 conversation_summaries 取到数据（如有）

### Phase S2：renderContextPacket 重构

**文件：**
- `src/main/ai/context-selector.ts`
  - `renderContextPacket` 拆分为 `renderTaskSection`, `renderProgressSection`, `renderMemorySection`
  - 输出格式改为上述 Markdown

**验收：**
- [ ] A2A 委托的 contextSnapshot 包含 `[TASK HANDOFF]`、`[TASK PROGRESS]`、`[PROJECT MEMORY]` 三个 section
- [ ] 无文件变更时 `[TASK PROGRESS]` 的 Changed Files 部分不渲染
- [ ] 无 project memory 时整个 `[PROJECT MEMORY]` section 不渲染
- [ ] token 估算 < 2000（现有测试加 token 上限断言）

### Phase S3：context-selector 测试覆盖

当前 `context-selector.ts` 没有专项测试。

**文件：**
- `src/main/ai/context-selector.test.ts`（新建）

**测试案例：**
- 无消息时返回最小 packet
- 有文件变更时 renderContextPacket 包含 Changed Files section
- token budget 超出时 relevantMessages 被截断
- projectMemories 超出 budget 时被截断

---

## 与其他 feature 的关系

- **memory-injection.md**：M1 的 `buildInjectionPrompt` 和 S2 的 `renderMemorySection` 共用同一个 `renderMemoryBlock` 工具函数，避免重复
- **agent-team.md**：Team pipeline 的 feedback 消息复用升级后的 contextSnapshot 格式，保持一致

---

## 相关文件

- `src/main/ai/context-selector.ts` — 主改动
- `src/main/ai/context-selector.test.ts` — 测试（新建）
- `src/main/ai/orchestrator.ts` — 调用方
- `src/main/core/memory-index.ts` — DB 查询来源
