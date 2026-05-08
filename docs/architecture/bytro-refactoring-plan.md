# bytro-app 会话-上下文-记忆模块联动重构计划

**Author:** 架构设计  
**Date:** 2026-05-08  
**Status:** Draft — for review  
**Based on:** Thread #all:dc672bc7 discussion + Task #1~#4 deliverables

---

## 1. 现状评估

### 1.1 已完成（坚实基础）

| 模块 | 组件 | 状态 | 质量 |
|------|------|------|------|
| **会话管理** | orchestrator.ts + agent-runtime.ts + invocation-queue.ts | ✅ | 5 个 session bug 已修复（ADR-005~008），runtimeKey 三维模型、cleanup 收敛、permission 精确路由全部落地 |
| **A2A 通信** | dispatchIntents + ReflowOrchestrator + policy-gate | ✅ | Zombie defense、loop detection、depth limit、parallel aggregation 全部就绪 |
| **任务系统** | scheduleTask + executeTask + completion hook | ✅ | Task lifecycle + chain tracking + InvocationQueue 优先级队列 |
| **可观测性** | logging.ts + IPC logs + 16 injection points / 12 event types | ✅ | JSONL 分类日志，intent:dispatched → task:enqueued → task:started → task:completed/failed 完整链路 |
| **记忆存储** | Memory Palace (SQLite FTS) + ContinuityCapsule + A2A Memory Distiller | ✅ | 结构化分类存储、自动提取、FTS 全文搜索、跨 session 续传 |
| **Provider** | BaseCLIProvider + 4 providers (Claude/Codex/Kimi/Gemini) + ACP JSON-RPC | ✅ | 16 CLI 后端统一接入、流式输出、动态模型切换 |
| **Agent 路由** | mention-parser + capability routing + team membership | ✅ | 空格/: /：三合一分隔符、能力标签匹配、@All 广播 |

### 1.2 核心问题：三个强模块，零联动

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  会话管理     │     │  上下文管理   │     │  记忆系统     │
│             │     │             │     │             │
│ orchestrator│ ──→ │ ContextSel. │ ──→ │ MemoryPalace│
│ runtime     │     │ assembleCtx │     │ Capsule     │
│ A2A handoff │     │ token 4000  │     │ FTS         │
│             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       ↑                   ↑                   ↑
       │                   │                   │
       └─── 无反馈 ────────┴─── 无联动 ────────┘
```

**具体症状：**

| # | 症状 | 根因 | 影响 |
|---|------|------|------|
| 1 | Agent 拿到的上下文"没有延续感" | ContextSelector 每次独立评分，不感知 Capsule 里的上次决策 | 用户每次开对话都要重复交代背景 |
| 2 | A2A handoff 时子 Agent 从零开始 | 子 Agent 的 Context Packet 不走父 Agent 的记忆链 | deep chain 时每层都丢失上层决策 |
| 3 | Memory Palace 存了但用不上 | Agent 没有 `search_memory` 能力，FTS 索引对 Agent 透明 | 记忆只对下次 ContextSelector 有用，Agent 自己翻不了 |
| 4 | Capsule 封印不产出结构化摘要 | seal 时只存 ballState，不提取 keyDecisions/pendingQuestions | resume 时注入全量历史，token 膨胀 |
| 5 | 跨 conversation 决策不可见 | Memory Palace 条目缺少 conversationId/chainId 关联 | 新 conversation 讨论同一模块时不知道已有决策 |
| 6 | Observability 事件不进记忆 | task:failed 等关键事件只写日志 | 故障模式无法积累为"教训"记忆 |

---

## 2. 目标架构

### 2.1 核心原则

1. **不改模块本身** — orchestrator、runtime、MemoryPalace、Capsule 各自逻辑不变
2. **加一层胶水** — 在模块之间建立数据流和反馈环
3. **先止血后增强** — P0 只改 ContextSelector 的注入策略，一天见效
4. **Agent 赋权** — 给 Agent 开 3 个工具，让它能主动搜索记忆和历史

### 2.2 目标状态：三模块联动闭环

```
用户消息
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                Unified Context Orchestrator                  │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Capsule Digest│   │ Memory FTS   │   │ Chain Context │  │
│  │ (上次决策摘要) │   │ (相关记忆搜索) │   │ (A2A chain 链)│  │
│  └──────┬───────┘   └──────┬───────┘   └───────┬───────┘  │
│         │                  │                    │          │
│         └──────────────────┼────────────────────┘          │
│                            ▼                               │
│                  Context Packet (≤2000 token)              │
│                  · 最近 3 轮对话                             │
│                  · Top 5 相关记忆                            │
│                  · Capsule 决策摘要                          │
│                  · 当前 chain 上下文                         │
└────────────────────────────┬──────────────────────────────┘
                             ▼
                       Agent 执行
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Post-Execution Feedback                    │
│                                                             │
│  Agent 输出 ──→ memory-extractor ──→ Memory Palace          │
│                      │                    │                 │
│                      │         ┌──────────┴──────────┐     │
│                      │         │ · conversationId     │     │
│                      │         │ · chainId            │     │
│                      │         │ · agentProfileId     │     │
│                      │         │ · scope (affected)   │     │
│                      │         └─────────────────────┘     │
│                      │                                      │
│                      ▼                                      │
│              ContinuityCapsule.seal({                        │
│                keyDecisions: [...],  ← 结构化摘要            │
│                pendingQuestions: [...],                     │
│                newMemoryIds: [...],   ← 关联新记忆           │
│                affectedFiles: [...]                         │
│              })                                             │
│                      │                                      │
│                      ▼                                      │
│              下次 Context Packet 自动包含                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 四个联动点

```
联动 1: 记忆 → 上下文 (MemoryPalace → ContextSelector)
  ContextSelector 组装时自动搜索 chain 关联记忆 + Capsule 决策摘要

联动 2: 会话 → 记忆 (orchestrator → MemoryPalace)
  Task 完成后自动提取决策/发现，写入 Memory Palace（带 conversationId/chainId）

联动 3: A2A Handoff → 记忆传递 (orchestrator → child Task)
  创建子任务时携带 relevantMemoryIds + chainDigest，子 Agent 启动时自动注入

联动 4: Observability → 记忆 (logging → MemoryPalace)
  task:failed / runtime:crashed 等关键事件自动建 finding 类型记忆
```

### 2.4 Agent 工具扩展（Agent Empowerment）

给 Agent 开放 3 个新工具，对接已有的存储层（不改存储，只开访问通道）：

| 工具 | 内部调用 | 功能 |
|------|---------|------|
| `search_memory(query)` | `memory_fts` FTS5 | 搜索项目知识库 |
| `search_history(keyword)` | `messages_fts` FTS5 | 搜索历史消息 |
| `read_summary()` | `conversation_summaries` | 读取当前对话摘要 |
| `remember(category, title, content, tags)` | Memory Palace upsert | Agent 主动沉淀知识 |

---

## 3. 模块-架构对应表

### 3.1 需改动的代码模块

| 模块文件 | 改动类型 | 改动内容 | 优先级 |
|---------|---------|---------|--------|
| `src/main/ai/context-selector.ts` | **增强** | 新增 chain-aware 记忆搜索 + Capsule digest 注入 + token budget 2000 | P0 |
| `src/main/ai/continuity-capsule.ts` | **增强** | seal 时生成 `keyDecisions`/`pendingQuestions`/`newMemoryIds` 摘要 | P1 |
| `src/main/ai/orchestrator.ts` | **轻改** | task 完成后调 memory-extractor + A2A handoff 时传 relevantMemoryIds + capsuleDigest | P1 |
| `src/main/ai/memory-extractor.ts` | **增强** | 提取时关联 conversationId/chainId/agentProfileId/scope | P1 |
| `src/main/ai/agent-runtime.ts` | **新增** | 注入 3 个 Agent tool: search_memory/search_history/read_summary/remember | P1 |
| `src/main/ai/a2a-types.ts` | **扩展** | PlannedTask 加 `relevantMemoryIds`/`capsuleDigest` 字段 | P1 |
| `src/main/core/logging.ts` | **轻改** | task:failed/runtime:crashed 事件自动写 Memory Palace finding | P2 |
| `src/main/db/schema.ts` | **扩展** | memory_entries 加 `chain_id`/`scope` 列（如不存在） | P2 |

### 3.2 不改动的模块

| 模块 | 原因 |
|------|------|
| `invocation-queue.ts` | 队列逻辑完整，无需联动改动 |
| `policy-gate.ts` | 策略校验独立，不在联动范围内 |
| `reflow-orchestrator.ts` | 并行聚合逻辑完整 |
| `providers/*` | Provider 层与上下文联动无关 |
| `chatStore.ts` | Renderer 层，本次不改 |

### 3.3 新增文档

| 文档 | 位置 | 内容 |
|------|------|------|
| `bytro-refactoring-plan.md` | `docs/architecture/` | 本文件 |
| (更新) `observability-logging.md` | `docs/architecture/` | 补充 P2 memory integration |
| (更新) `memory-system.md` | `docs/architecture/` | 补充 Agent tool 和联动机制 |
| (更新) `multi-agent-a2a-orchestration.md` | `docs/architecture/` | 补充 A2A handoff 记忆传递 |

---

## 4. 重构实施计划

### Phase 0: 上下文止血（本周，1-2天）

**目标**：让 Agent 拿到的上下文有"延续感"，立竿见影。

**改动范围**：仅 `context-selector.ts`

```
当前: assembleContext(conversationId, instruction)
  → 全量历史 FTS + Memory FTS + file_changes
  → tokenBudget: 4000 → 全部一次注入

改为: assembleContext(conversationId, instruction, { chainId?, taskDepth? })
  → 最近 3 轮对话（而非 20 轮）
  → Memory FTS 搜索时自动过滤 chainId（同 chain 记忆优先）
  → 注入 Capsule 的 keyDecisions 摘要（如有，≤500 token）
  → tokenBudget: 2000（精简化）
```

**验收**：
- 同一个 conversation 连续两次对话，第二次 Agent 能引用第一次的决策
- token 使用量从 4000 降到 2000，deep chain 时不膨胀

**风险**：极低。纯增量改动，不影响现有逻辑。

---

### Phase 1: 联动骨架（下周，3-5天）

**目标**：建立会话→记忆→上下文的完整数据流。

**改动文件**（4 个）：

1. **`continuity-capsule.ts`**：seal 时生成结构化摘要
```typescript
interface CapsuleDigest {
  keyDecisions: string[]      // 本轮关键决策（≤3 条）
  pendingQuestions: string[]  // 未解决问题（≤3 条）
  newMemoryIds: string[]      // 本轮新沉淀的记忆 ID
  affectedFiles: string[]     // 变更的文件列表
}
```

2. **`memory-extractor.ts`**：提取时关联上下文
```typescript
// 当前提取的记忆补充：
source: {
  conversationId: string
  chainId?: string
  agentProfileId: string
  taskId: string
}
scope: string[]  // 影响的文件/模块路径
```

3. **`orchestrator.ts`**：两处轻改
- `executeTask` 完成后 → 调 memory-extractor 提取决策 → 写入 Memory Palace
- `dispatchIntents`(A2A handoff) → 子任务携带 `relevantMemoryIds` + `capsuleDigest`

4. **`a2a-types.ts`**：扩展 PlannedTask
```typescript
interface PlannedTask {
  // ... 现有字段
  relevantMemoryIds?: string[]
  capsuleDigest?: string
}
```

5. **`agent-runtime.ts`**：注入 4 个 Agent tool
- `search_memory(query)` → FTS 搜 Memory Palace
- `search_history(keyword)` → FTS 搜 messages
- `read_summary()` → 读 conversation_summaries
- `remember(category, title, content, tags)` → 写入 Memory Palace

**验收**：
- Planner 做完架构决策 → Coder 接手时自动拿到决策摘要
- Agent 可以主动调 `search_memory("认证模块")` 查到之前的决策
- Capsule resume 时注入结构化摘要而非全量历史

**风险**：中。改 5 个文件，但都是增量（新增字段 + 新增方法），不破坏现有契约。

---

### Phase 2: 闭环增强（下下周，3-5天）

**目标**：完成最后的反馈环，让系统"越用越聪明"。

**改动文件**（2 个）：

1. **`logging.ts`**：Observability → Memory
```typescript
writeObservabilityEvent('task:failed', { taskId, error, conversationId, chainId })
// 自动附带:
if (event.type === 'task:failed' || event.type === 'runtime:crashed') {
  await memoryPalace.upsert({
    kind: 'finding',
    title: `[Auto] Task ${taskId} failed: ${error.slice(0, 100)}`,
    content: fullError,
    tags: ['auto', 'failure', errorType],
    source: 'observability',
    conversationId, chainId
  })
}
```

2. **`db/schema.ts`**：扩展 schema（如需要）
- `memory_entries` 加 `chain_id` TEXT 列
- `memory_entries` 加 `scope` TEXT 列（JSON array）
- `continuity_capsules` 加 `digest_json` TEXT 列

**验收**：
- `task:failed` 事件自动在 Memory Palace 留记录
- 下次 Agent 讨论同一模块时，ContextSelector 自动注入之前的失败教训
- 跨 conversation 决策关联可查询

**风险**：低。DB migration 是增列，不影响现有查询。

---

### Phase 3: 智能化（后续迭代，按需）

**目标**：语义检索 + 自动记忆关联。

**候选方向**：
1. ContextSelector 用 embedding 替代 TF-IDF 关键词评分
2. 跨 conversation 自动关联相同 scope 的记忆
3. Agent profile 偏好学习（记录每个 Agent 常查什么类型的上下文，预注入）
4. A2A handoff 时自动生成"chain brief"（链级别的上下文摘要）

**不在本次重构范围内**，作为技术雷达跟踪。

---

### Phase 4: 混合协作拓扑（新增，2-3 天）

**目标**：在现有中心化 A2A pipeline 之外新增去中心化 Open Floor 模式，让 bytro 同时支持「自由讨论」和「流水线执行」两种协作方式。

**动机**：bytro 当前只有中心化 A2A 一种协作模式。头脑风暴、方案探索、架构讨论等发散型场景下，单一 Agent 执行 + Orchestrator 分配的模式反而扼杀创意。需要借鉴 Slock 的去中心化经验——多 Agent 自主观察、自主介入、自由碰撞。

**核心设计**：

```typescript
type CollaborationMode = 'orchestrated' | 'open_floor'
```

```
用户消息
    │
    ▼
┌─────────────────────────────────────────────┐
│           Collaboration Mode Router          │
│                                             │
│  · 关键词推断 (brainstorm/讨论/explore)      │
│  · @mention 数量推断 (≥2 → open_floor)       │
│  · 用户显式选择 (NewTaskDialog 模式卡片)     │
│                                             │
│         ┌───────────────┴───────────────┐    │
│         ▼                               ▼    │
│    open_floor                       orchestrated
│  (去中心化自由讨论)                (中心化流水线执行)
└─────────────────────────────────────────────┘
```

**open_floor 模式特征**：

| 维度 | open_floor | orchestrated (现有) |
|------|-----------|-------------------|
| 任务分配 | 广播给所有 team member | Orchestrator 单路分配 |
| Agent 介入 | 主动（自己判断 relevance） | 被动（被分配才执行） |
| 上下文 | 完整 conversation 历史 | ContextPacket（精选 ≤2000 token） |
| 并发控制 | 自由回复（时间戳排序） | InvocationQueue 串行化 |
| 权限模型 | trusted（零审批，事后审计） | 双层信任（会话级 + 边界审批） |
| chain tracking | 无 chain | 有 chain |
| 记忆沉淀 | Agent 主动调 `remember` | `afterTaskComplete` 自动提取 |
| 适合场景 | 头脑风暴、方案讨论、诊断 | 代码实现、流水线执行、审查 |

**Agent 自主介入判断**：

```typescript
// agent-runtime.ts — 每个 Agent 自主评估是否参与讨论
async assessRelevance(observation: {
  topic: string
  myCapabilities: string[]
  myCurrentLoad: number
}): Promise<{ score: number; reason: string }> {
  // 1. 能力匹配度 (0-1)
  // 2. 当前负载 (越低越倾向于参与)
  // 3. 话题新鲜度 (避免重复发言)
  // 得分 ≥ 0.3 → 参与讨论；< 0.3 → 静默
}
```

**讨论收束机制**：

```
open_floor 讨论 (5 min 窗口)
    │
    ├── Agent A: 观点1
    ├── Agent B: 观点2
    ├── Agent C: 观点3
    │
    ▼ (超时或用户手动收束)
    
SummarizePanel:
  "3 个 Agent 已回复。以下是关键观点摘要..."
  [🔨 基于此结论开始编排执行] [🧠 继续讨论]
      │
      ▼
  切换到 orchestrated 模式 → Planner 整合方案 → Coder 实现
```

**权限模型（ADR-010）**：

```
open_floor → trusted（零审批，只读工具，事后审计）
orchestrated → 双层信任
  L1: 会话级信任（任务范围内自动通过）
  L2: 边界审批（越界操作弹窗确认）
  + 用户可选 PermissionMode: manual | autoEdit | plan | trusted
```

**UI 改动（利用现有 80% 基础设施）**：

| 组件 | 文件 | 改动 | 工作量 |
|------|------|------|--------|
| ChatInput | `ChatInput.tsx` | 读 `collaborationMode`，open_floor 时显示指示条 + 隐藏 Agent/执行选择器 | 小 |
| MessageItem | `MessageItem.tsx` | 新增 `collaborationMode` prop，open_floor 消息显示 `🧠` 标记 | 极小 |
| TaskGraph | `TaskGraph.tsx` | 检测 open_floor → 显示"讨论中"状态条 | 小 |
| NewTaskDialog | `NewTaskDialog.tsx` | Explore 按钮已存在，只需确认正确传递 `collaborationMode` | 极小 |

**后端改动**：

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `orchestrator.ts` | 新增 `executeOpenFloor()` 分支 + `broadcastToAgents()` | 中 |
| `agent-runtime.ts` | 新增 `onObservation()` + `assessRelevance()` | 中 |
| `a2a-types.ts` | 新增 `CollaborationMode` 类型 | 极小 |
| `policy-gate.ts` | open_floor 模式下跳过（或新增 `PermissionMode.trusted`） | 极小 |

**改动原则**：
- ❌ 不改 DB schema
- ❌ 不改 ACP 协议
- ❌ 不改 routing-planner
- ✅ 只改 orchestrator 分支 + agent-runtime 介入判断
- ✅ 前端 4 个组件小改动，无新组件

**验收**：
- 用户发送 "brainstorm 认证方案" → 自动进入 open_floor 模式，多 Agent 并行回复
- Agent 判断不相关 → 静默，不产生噪音
- 讨论超时 → 自动收束，显示 SummarizePanel
- 收束后一键切换到 orchestrated → Planner 基于讨论结论开始执行
- open_floor 模式下无 permission_request 弹窗

**风险**：低。纯增量改动，不影响现有 A2A pipeline。open_floor 分支独立，出问题只影响新模式。

**相关 ADR**：
- ADR-009: 双模协作架构（orchestrated | open_floor）
- ADR-010: 分层权限模型（三层信任 + PermissionMode）

---

### Phase 5: Provider 层统一（Open Floor 落地后，1-2 天）

**目标**：移除 5 个 legacy CLI Provider 的 per-provider parser，全部收敛到 ACP JSON-RPC 统一协议。

**动机**：bytro 当前 Provider 层是双轨：16 个 ACP backend（统一 JSON-RPC）+ 5 个 legacy CLI（各自的自定义 parser）。legacy CLI 的 per-provider parser 是重复代码，维护成本高。ACP 已覆盖 4/5 的 legacy Provider。

**当前状态**：

```
ACP backend (16 个，统一 JSON-RPC/stdio)
  claude-acp ✅    codex-acp ✅    kimi-acp ✅    opencode-acp ✅
  codebuddy-acp, qwen-acp, goose-acp, auggie-acp, copilot-acp,
  droid-acp, cursor-acp, kiro-acp, hermes-acp, vibe-acp,
  qoder-acp, snow-acp

Legacy CLI (5 个，各自自定义 parser)
  claude-cli     → 有 claude-acp 替代 ✅ 可删
  codex-cli      → 有 codex-acp 替代 ✅ 可删
  kimi-cli       → 有 kimi-acp 替代 ✅ 可删
  opencode-cli   → 有 opencode-acp 替代 ✅ 可删
  gemini-cli     → 无 ACP 等效 ❌ 暂留
```

**三步路线**：

```
Step 1（短期，Open Floor 落地后立即）:
  ACP 优先 + Legacy 降级 fallback
  改 provider-registry.ts：ACP 可用时走 ACP，不可用时降级到 legacy CLI
  
  改动: 1 文件 (provider-registry.ts)
  风险: 零（行为不变，只改优先级）

Step 2（短期，ACP 验证稳定 1-2 周后）:
  删除 4 个 legacy CLI provider + 4 个 parser:
    rm src/main/ai/providers/claude-cli.ts
    rm src/main/ai/providers/codex-cli.ts
    rm src/main/ai/providers/kimi-cli.ts
    rm src/main/ai/providers/opencode-cli.ts
    rm src/main/ai/providers/parsers/claude-output-parser.ts
    rm src/main/ai/providers/parsers/codex-output-parser.ts
    rm src/main/ai/providers/parsers/kimi-output-parser.ts
    rm src/main/ai/providers/parsers/opencode-output-parser.ts
  
  保留 gemini-cli.ts + gemini-output-parser.ts（唯一 survivor）
  
  收益: ~800 行重复代码删除
  风险: 低（gemini-cli 保留，其余 4 Provider 有 ACP 等效）

Step 3（长期，Gemini 推出 ACP 支持后）:
  删除最后一个 legacy CLI → 移除 base-cli-provider.ts
  所有 Provider 100% ACP
  
  收益: ~400 行代码删除
  新 Provider 接入成本从「写 Provider 类 + parser」降到「acp-backends.ts 加 15 行配置」
```

**关键设计原则**：
- CLI spawn 传输层保留（ACP 也用 spawn，进程隔离不变）
- 去掉的是 per-provider parser，不是 CLI 进程本身
- 外部 CLI 的隐藏价值是维护外包——Provider 官方修 bug，bytro 零成本受益

**不在 Phase 5 范围内**：
- 自建 ACP Server 替代外部 CLI（评估中，需等 ACP 生态更成熟）
- 直接 HTTP 调 Provider API（维护成本高，当前不划算）

**验收**：
- 4 个 legacy CLI 文件 + 4 个 parser 文件已删除
- typecheck + build + 244 tests 全部通过
- Claude/Codex/Kimi/OpenCode 四个 Provider 在 ACP 模式下功能无损

**风险**：极低。每步独立可回滚，ACP fallback 保证兼容。

---

## 5. 风险与回滚

### 5.1 核心风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Context Packet token 从 4000 降到 2000 后 Agent 信息不足 | 中 | 中 | Phase 0 加 `[CTX:NEED]` pull 出口作为安全阀 |
| memory-extractor 自动写入噪音记忆 | 中 | 低 | 写入 `captured` 状态，仍需用户审核；加置信度阈值 |
| A2A handoff 传 memoryIds 导致 prompt 膨胀 | 低 | 中 | 硬限制：最多传 5 个 memoryId，每个摘要 ≤200 token |

### 5.2 回滚策略

每个 Phase 独立可回滚：
- Phase 0：`context-selector.ts` 加 feature flag，出问题关 flag 回旧路径
- Phase 1：agent tools 按 tool 粒度开关，出问题禁单个 tool
- Phase 2：DB migration 只增列不删列，回滚只需代码不调新列

---

## 6. 验收总览

| Phase | 核心指标 | 验收方法 |
|-------|---------|---------|
| P0 | 第二次对话 Agent 引用第一次决策 | 人工测试：同一 conversation 两轮对话 |
| P0 | Context token ≤ 2000 | `logs:read` 检查注入量 |
| P1 | Handoff 时子 Agent 拿到父决策 | @Planner 做决策 → @Coder 实现 → Coder 引用决策 |
| P1 | Agent 主动搜索记忆成功 | Agent 调 `search_memory("认证")` 返回 FTS 结果 |
| P1 | Capsule resume 注入摘要而非全量 | `--resume` 后检查 prompt 大小 |
| P2 | task:failed 自动建记忆 | 人工触发失败 → 检查 Memory Palace 新增条目 |
| P2 | 跨 conversation 记忆可见 | 两个 conversation 讨论同一模块 → 第二个能搜到第一个的决策 |
| P4 | "brainstorm 认证方案" 触发 open_floor 多 Agent 回复 | 发送关键词消息 → 验证多 Agent 并行输出 |
| P4 | open_floor 下无 permission_request 弹窗 | 检查 open_floor 讨论全程无弹窗 |
| P4 | 讨论收束 → SummarizePanel → 切换到 orchestrated | 超时或手动收束 → 验证 SummarizePanel + 模式切换 |
| P4 | Agent 判断 irrelevant → 静默 | irrelevant Agent 在 open_floor 中不产生任何消息 |
| P5 | 删除 4 legacy CLI provider 后 typecheck + build + tests 全通过 | 244 tests pass，Claude/Codex/Kimi/OpenCode ACP 模式功能无损 |
| P5 | 新 Provider 接入 ≤ 15 行配置 | 在 acp-backends.ts 添加配置即可，无需写 parser |

---

## Appendices

### A. 相关文档索引

- `docs/architecture/decisions/session-layer-adrs.md` — ADR-005~010
- `docs/architecture/slock-agent-communication-reference.md` — Slock 通信模型参考
- `docs/architecture/observability-logging.md` — 日志模块
- `docs/architecture/memory-system.md` — 记忆系统
- `docs/architecture/multi-agent-a2a-orchestration.md` — A2A 编排
- `docs/features/open-floor-collaboration-mode.md` — Open Floor 模式 PRD（Task #6）
- `docs/PROGRESS.md` — 项目进度

### B. 讨论记录

本重构计划基于 Thread #all:dc672bc7 的以下讨论：
- Slock vs bytro 通信模型对比 → push+pull 混合上下文
- Agent 检测和模型选择 → 三层 fallback 架构
- ACP 协议实现 → JSON-RPC 2.0 over stdio
- 上下文感知改造 → push+pull 混合 + [CTX:NEED] 声明
- 记忆系统匹配 → 双层记忆模型 + Agent 主动记忆
- 三模块割裂诊断 → 加胶水层实现联动闭环
- Agent 发现与跨 Agent 协作 → Slock Registry vs bytro AgentProfile
- 去中心化 vs 中心化协作 → 双模协作架构 (open_floor + orchestrated)
- 权限模型 → 审查在产出物上，不在步骤上 → 分层信任 + PermissionMode
- CLI 连接机制 → ACP JSON-RPC 2.0 over stdio + 三层 fallback
- Daemon vs spawn-per-task → 场景不同工具不同，不加 daemon
- Provider 层统一 → 去 legacy parser，保留 ACP + CLI spawn 传输层
