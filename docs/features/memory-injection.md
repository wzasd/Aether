---
feature: memory-injection
status: design
created: 2026-05-05
priority: P1
---

# Feature: Memory Injection

## 问题陈述

当前记忆系统有提取但没有注入。`extractCandidates` 在每次 task 完成后从 assistant 消息里用正则捕获候选，用户确认后写入 `project_memory_items`。但这些记忆**从不被注入新对话的起始上下文**，等于白提取。

具体缺口：
- `AgentRuntime.start()` 构建 `fullConfig` 时，`appendSystemPrompt` 只包含 agent 角色描述和 @mention 规则，不包含项目记忆
- `buildContextPacket` 里 `loadProjectMemories` 只在 A2A 委托时被调用（给 sub-agent），主 agent 的第一条消息没有记忆上下文
- 新对话创建时没有任何记忆热身机制

## 目标

1. 新对话开始发送第一条消息时，自动将相关 project memory 注入 system prompt
2. A2A sub-agent 收到任务时，同样注入相关记忆（已有骨架，需完善）
3. 记忆提取质量提升：从纯正则升级为结构化提取（支持代码块、标题提取）

## 非目标

- 向量嵌入 / 语义搜索（FTS 已够用，不引入新依赖）
- 实时记忆更新（每次 token 后重算）
- 跨对话自动归纳（需要 LLM call，单人工具暂不值得）

---

## 架构设计

### 注入时机

```
用户发送消息
    ↓
orchestrator.sendUserMessage()
    ↓
[NEW] buildSessionSystemPrompt(workspaceId, conversationId, userMessage)
    ↓
     ├─ loadProjectMemories(workspaceId) → FTS 检索 top-N 条
     ├─ getLatestSummary(conversationId)  → 上次对话摘要（如有）
     └─ renderMemoryPrompt(memories, summary) → 注入文本
    ↓
AgentRuntime.start({ ...config, appendSystemPrompt: injected })
```

### 注入结构（注入到 system prompt 末尾）

```
---
[PROJECT MEMORY]
以下是该项目的关键记忆，请在回答时参考：

### [decision] 使用 SQLite 替代 PostgreSQL
单人维护，进程内访问，no ORM 开销。

### [convention] 文件变更通过 chokidar 追踪
不要在 renderer 直接写 `.bytro/` 目录，必须走 IPC。

[CONVERSATION CONTEXT]
上次对话摘要（2026-05-04）：
完成了 MCP 客户端集成，配置文件在 ~/.claude/mcp.json。
---
```

### FTS 查询策略

不做语义匹配，用以下两步简单规则：
1. 用用户消息的前 100 字做 FTS 查询，取 top-5
2. 无论查询结果，再追加最近 updated_at 的 top-3 条（"always-on" 记忆）
3. 去重，限总 token < 1500

```typescript
function loadInjectionMemories(workspaceId: string, userMessageHint: string): MemoryItem[] {
  const ftsHits = recallMemory(userMessageHint.slice(0, 100), {
    scope: 'project',
    workspaceId,
    limit: 5
  })
  const recentAlways = getProjectMemoryByWorkspace(workspaceId).slice(0, 3)
  return dedupById([...ftsHits, ...recentAlways]).slice(0, 8)
}
```

---

## 实现计划

### Phase M1：主 Agent 注入

**文件改动：**
- `src/main/ai/orchestrator.ts`
  - `sendUserMessage` 里调用新的 `buildInjectionPrompt` 然后写入 `appendSystemPrompt`
- `src/main/ai/memory-injection.ts`（新文件）
  - `buildInjectionPrompt(workspaceId, conversationId, hint): string`
  - `loadInjectionMemories(workspaceId, hint): MemoryItem[]`

**IPC 变更：** 无，主进程内部。

**数据库变更：** 无。

**验收标准：**
- [ ] 发送第一条消息时，project memory 出现在 Claude 的 system prompt 里
- [ ] memory 条数 > 0 时日志打印 `[memory-injection] injected N items`
- [ ] memory 条数 = 0 时不注入任何额外文本（不增加空白 section）
- [ ] 注入文本估算 token < 1500

### Phase M2：记忆提取质量升级

**现状问题：** `memory-extractor.ts` 只用正则，"决定：xxx" 这类格式才能被捕获，漏率高。

**升级方案：** 增加两种新提取模式，不改现有正则（保持兼容）：

1. **标题提取**：Markdown `##` 和 `###` 标题后的段落，如果段落 > 50 字，作为 convention candidate
2. **代码块上下文**：代码块前一段文字（解释性说明），confidence: medium

```typescript
function extractFromMarkdownHeadings(text: string): ExtractedCandidate[] { ... }
function extractCodeBlockContext(text: string): ExtractedCandidate[] { ... }
```

**验收标准：**
- [ ] 包含 `## 架构决策` 的 assistant 消息能被提取为 decision
- [ ] 提取结果置信度 medium 的条目增多
- [ ] 不破坏现有 27 个 unit test

### Phase M3：记忆提取置信度评分升级

**当前问题：** 所有正则命中统一 `confidence: 'low'`，用户无法优先处理高价值记忆。

**方案：** 基于规则评分（不用 LLM）：
- 出现在 agent role = 'planning'/'architect' 消息里：+1 分
- 内容长度 > 100 字：+1 分
- 含有文件路径 / 代码标识符：+1 分（更具体）
- 命中多个 pattern：+1 分

得分 ≥ 3：`high`；得分 2：`medium`；得分 < 2：`low`

**验收标准：**
- [ ] 候选列表 UI 按 confidence 排序（high 在前）
- [ ] confidence = 'high' 的候选在 sidebar 有区分样式

---

## 不做的事（明确排除）

| 方案 | 排除原因 |
|------|----------|
| 向量数据库（Chroma、pgvector） | 引入新进程依赖，单人工具维护成本不可接受 |
| 每轮消息后重新计算注入 | 性能开销且无必要，对话内上下文窗口已覆盖 |
| LLM 自动归纳记忆 | 需要额外 API call，成本和延迟不可控 |
| 跨工作区共享记忆 | 数据隔离原则，workspace 是边界 |

---

## 相关文件

- `src/main/ai/memory-extractor.ts` — 提取逻辑
- `src/main/ai/orchestrator.ts` — 注入入口
- `src/main/core/memory-index.ts` — DB 查询
- `src/main/ai/context-selector.ts` — A2A 委托时的上下文构建（已有 projectMemories）
- `docs/architecture/memory-system.md` — 记忆系统架构
