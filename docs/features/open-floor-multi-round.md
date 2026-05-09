# Open Floor 多轮迭代 — 产品需求文档 (PRD)

**版本**: 1.0  
**日期**: 2026-05-09  
**状态**: 草案  
**作者**: @需求文档师  
**相关 ADR**: [ADR-012: Iterative Open Floor for Agent Cross-Visibility](../architecture/decisions/adr-012-iterative-open-floor.md)

---

## 1. 概述

### 1.1 执行摘要

将 Open Floor（自由讨论）从**单轮并行广播**升级为**多轮迭代式群聊**。Round 1 保持现有行为（所有 Agent 并行回复用户消息）；Round 2+ 将上一轮 Agent 的回复注入上下文，使 Agent 能够引用、反驳、补充同事的观点，实现真正的"圆桌讨论"体验。

### 1.2 目标

- **核心目标**: Agent 之间可以互相看见、互相回应，从"6 条平行独白"变成"1 场群聊"
- **体验目标**: 用户感知到 Agent 在"接话"，而非各自独立发表看法
- **技术目标**: 在现有架构上增量实现，不引入常驻进程或消息总线

### 1.3 范围

| 在范围内 | 不在范围内 |
|---------|-----------|
| 多轮迭代执行（max 3 rounds） | Agent 常驻进程（保持临时启动模型） |
| 上下文注入（上一轮回复） | 实时消息总线（保持 IPC 事件） |
| Agent @mention 引用同事 | 自主任务调度（仍由 orchestrator 分配） |
| 防循环机制（5 层） | 持久化对话历史到数据库 |
| UI 轮次显示 | 跨会话记忆共享 |

---

## 2. 问题陈述

### 2.1 当前行为

当前 Open Floor 使用 `Promise.all(parallel)` —— 6 个 Agent 同时运行，每个 Agent 只看到**用户消息**，生成回复后各自独立返回。结果是：

- Agent A 说"应该用 React"
- Agent B 说"应该用 Vue"  
- Agent C 说"从架构角度……"

三个 Agent 永远不会知道彼此说了什么，用户看到的是 6 条互不相关的回复。

### 2.2 目标行为

Round 1 后，Round 2 的 Agent 能看到 Round 1 的回复：

- Agent A: "应该用 React"
- Agent B: "我同意 @AgentA 用 React，但建议加上 Next.js"
- Agent C: "@AgentB 提到 Next.js，从运维角度 SSR 会增加复杂度……"

Agent 之间可以引用、反驳、补充，形成真正的讨论流。

### 2.3 为什么不是 Slock 架构

Slock 的 Agent 是**常驻进程** + **共享消息总线**，bytro 的 Agent 是**临时进程** + **orchestrator 分发**。全量迁移需要：

1. 常驻 Agent 进程（重大架构变更）
2. Pub/Sub 消息总线（新组件）
3. Agent 自调度（复杂编排）

本 PRD 采用**上下文注入**方案，用 ~75 行代码在现有架构上实现 80% 的群聊体验。

---

## 3. 成功指标

| 指标 | 基准值 | 目标值 | 测量方式 |
|------|--------|--------|---------|
| Round 2 Agent 引用率 | 0% | ≥30% | 抽样检查 Round 2 回复中含 `@AgentName` 的比例 |
| 用户感知讨论质量 | N/A | "像群聊" | 定性反馈（内测问卷） |
| 平均响应时间 | ~5s (R1) | ≤10s (R1+R2) | 后端事件日志 |
| Token 消耗增长 | 基准 | ≤+40% | LLM API 用量统计 |
| 意外循环率 | N/A | 0% | 观察 Agent 是否互相抬杠超过 2 轮 |

---

## 4. 用户故事

### US-1: 作为用户，我希望 Agent 能互相讨论

> **As a** bytro 用户  
> **I want** Open Floor 中 Agent 能看到彼此的回复并继续讨论  
> **So that** 我能看到多角度观点的碰撞，而不是 6 条独立独白

**验收标准**:
- [ ] Round 1 所有 Agent 回复用户消息（行为不变）
- [ ] Round 2 中至少一个 Agent 引用/回应 Round 1 的某个回复
- [ ] 引用格式自然（"同意 @Coder 的观点" / "@架构设计 提到的方案有个问题……"）
- [ ] 如果 Agent 没有新观点，可以静默（不强制发言）

### US-2: 作为用户，我希望控制讨论长度

> **As a** bytro 用户  
> **I want** 能随时停止 Open Floor 讨论  
> **So that** 讨论不会无限进行，我不会被信息淹没

**验收标准**:
- [ ] 用户点击 ⏹ 按钮，所有正在运行的 Agent 立即停止
- [ ] 停止后不再产生新回复
- [ ] 用户插话（发送新消息）触发新一轮讨论

### US-3: 作为用户，我希望知道讨论进行到哪一轮

> **As a** bytro 用户  
> **I want** UI 显示当前是第几轮讨论  
> **So that** 我了解讨论进度，不会被"还没完？"的焦虑困扰

**验收标准**:
- [ ] AgentStatusBar 显示 "Open Floor · R2 · 3 思考中"
- [ ] 每轮回复之间有视觉分隔（如 subtle divider 或 round label）
- [ ] 讨论结束时显示总结（"2 轮讨论，5 条回复"）

### US-4: 作为开发者，我希望架构简单可维护

> **As a** bytro 开发者  
> **I want** 多轮实现在现有 orchestrator 上增量改动  
> **So that** 不引入新的基础设施，降低维护成本

**验收标准**:
- [ ] 不改 Agent 进程模型（仍临时启动）
- [ ] 不改消息总线（仍 IPC 事件）
- [ ] 核心改动集中在 orchestrator.ts（≤40 行）

---

## 5. 功能需求

### FR-1: 多轮迭代执行

**描述**: `executeOpenFloor` 从单轮 Promise.all 改为 for 循环，支持最多 3 轮。

**详细规格**:

```typescript
// 伪代码
async executeOpenFloor(convId, userMessage, profiles) {
  const maxRounds = 3  // 可配置，默认 3
  const allReplies: AgentReply[] = []

  for (let round = 1; round <= maxRounds; round++) {
    // 构建本轮上下文
    const roundContext = round === 1
      ? userMessage
      : buildRoundContext(userMessage, allReplies)

    // 并行执行（每轮内部仍并行）
    const promises = profiles.map(p => runAgent(p, roundContext, round))
    const replies = await Promise.all(promises)

    // 过滤有效回复
    const newReplies = replies.filter(r => r && r.content && r.content !== 'NO_REPLY')
    if (newReplies.length === 0) break  // 全员静默，提前结束

    allReplies.push(...newReplies)

    // 通知前端本轮完成
    emit('open_floor_round_complete', { round, replies: newReplies })
  }
}
```

**关键规则**:
- Round 1 行为与当前完全一致（向后兼容）
- 每轮内部仍是并行（所有 Agent 同时跑）
- 轮与轮之间是顺序的（等 Round 1 全部完成后才启动 Round 2）
- 每轮每个 Agent 最多产生 1 条回复

### FR-2: 上下文注入

**描述**: Round 2+ 的 Agent 输入包含上一轮所有 Agent 的回复。

**详细规格**:

```typescript
function buildRoundContext(userMessage: string, previousReplies: AgentReply[]): string {
  if (previousReplies.length === 0) return userMessage

  const colleagueNotes = previousReplies
    .map(r => `@${r.agentName}: ${r.content}`)
    .join('\n\n')

  return `${userMessage}\n\n--- 同事们的观点 ---\n${colleagueNotes}`
}
```

**关键规则**:
- 只注入**上一轮**的回复，不是完整历史（防 token 爆炸）
- 注入格式为 `@AgentName: content`，便于 Agent @mention 引用
- 当回复过长时，注入摘要（前 100 字）而非全文
- 注入内容作为 observation message 的一部分，不持久化到数据库

### FR-3: Agent 可见性与引用

**描述**: Agent 在 Round 2+ 能看到同事名字和观点，并可以用 @mention 引用。

**详细规格**:

- Round 2+ 的 prompt 追加：
  ```
  上面是同事们对这个话题的观点。你可以：
  - 引用或补充别人的观点（用 @AgentName 提及）
  - 提出不同看法
  - 如果你没有新观点，回复 NO_REPLY
  ```
- Agent 已知同事列表已通过 `runtime.setKnownAgents()` 注入
- @mention 格式与现有 orchestrated 模式一致：`@AgentName: 内容`

### FR-4: 防循环机制（5 层）

**描述**: 防止讨论无限进行或 Agent 互相抬杠。

| 机制 | 实现 | 触发条件 |
|------|------|---------|
| **maxRounds** | `maxRounds = 3`（可配置） | 达到上限强制结束 |
| **每轮限次** | 每 Agent 每轮最多 1 条 | 防止单 Agent 刷屏 |
| **Token 衰减** | R1: 100%, R2: 70%, R3: 50% | 后期回复更短 |
| **全员 NO_REPLY** | `newReplies.length === 0` | 自然收敛提前结束 |
| **用户停止** | ⏹ 按钮 → `stopOpenFloor()` | 人类兜底 |

### FR-5: 用户控制

**描述**: 用户可以随时停止讨论或插话触发新一轮。

**详细规格**:

- **停止**: 点击 ⏹ → `stopOpenFloor(convId)` → abort 所有运行中 Agent → 清理状态
- **插话**: 用户发送新消息 → `sendUserMessage` 检测到 `mode === 'open_floor'` → 先 `stopOpenFloor` 停止旧轮 → 启动新 executeOpenFloor（作为全新 Round 1）

### FR-6: UI 轮次显示

**描述**: 前端显示当前轮次和讨论进度。

**详细规格**:

- AgentStatusBar:
  - 显示 "Open Floor · R{round} · {thinkingCount} 思考中"
  - Round 数字随 `open_floor_round_complete` 事件更新
- 消息列表:
  - 每轮开始时可添加 subtle divider（如 "── Round 2 ──"）
  - 或保持现有流式显示，由时间戳自然区分
- 讨论结束:
  - 后端 emit summary system message（已有）

---

## 6. 非功能需求

### NFR-1: 性能

- Round 1 响应时间不变（~5s）
- Round 2 响应时间 ≤ Round 1（参与 Agent 可能更少）
- 总时间 ≤ 15s（R1 + R2 + overhead）

### NFR-2: Token 预算

- Round 1: 正常预算（与当前一致）
- Round 2: 注入上下文额外消耗 ≤ 500 tokens（6 条摘要 × ~80 tokens）
- Round 3: 如启用，上下文更小（NO_REPLY 过滤后 Agent 更少）

### NFR-3: 可观测性

- 每轮开始/结束记录 observability event
- Round 内容（注入的上下文）记录 DEBUG 级别日志（不含敏感信息）
- Agent NO_REPLY 原因记录（便于调试为什么某 Agent 不参与）

### NFR-4: 向后兼容

- Round 1 行为与当前完全一致
- 现有 `agent_observation` / `open_floor_closed` 事件格式不变
- 新增 `open_floor_round_complete` 事件，前端不处理也不报错

---

## 7. 边界条件与错误场景

### 7.1 边界条件

| 场景 | 预期行为 |
|------|---------|
| 只有 1 个 Agent | Round 1 正常执行，Round 2 看到自己对上一轮的唯一回复 → 可能 NO_REPLY → 结束 |
| 所有 Agent Round 1 NO_REPLY | Round 1 结束后 `newReplies.length === 0` → 立即结束，不发 Round 2 |
| Round 1 完成，Round 2 全部 NO_REPLY | Round 2 结束后 `newReplies.length === 0` → 结束 |
| 用户在 Round 1 进行中点击 ⏹ | `stopOpenFloor` abort 所有运行中 Agent → emit `open_floor_closed` |
| 用户在 Round 2 进行中点击 ⏹ | 同上，立即停止 |
| 用户在 Round 1 进行中发送新消息 | `sendUserMessage` 先 `stopOpenFloor` 旧轮 → 启动新 Round 1 |
| Round 2 某个 Agent 报错 | 该 Agent 跳过，其他 Agent 正常完成 |
| Token 超限 | 注入上下文使用摘要（前 100 字），而非全文 |

### 7.2 错误场景

| 场景 | 检测方式 | 恢复行为 |
|------|---------|---------|
| Agent 陷入互相抬杠 | maxRounds=3 硬限制 | 强制结束 |
| 上下文注入导致 prompt 过长 | Token 计数 / 长度检查 | 截断到前 100 字摘要 |
| Round 2 比 Round 1 更慢 | 超时机制（5 min） | `Promise.race` 超时后结束 |
| 前端未处理 `round_complete` 事件 | 事件是 best-effort | 不影响核心功能 |

---

## 8. 与 Orchestrated 模式差异

| 维度 | Orchestrated | Open Floor（单轮，当前） | Open Floor（多轮，本 PRD） |
|------|-------------|------------------------|--------------------------|
| 触发 | 默认 | AgentStatusBar 下拉 | 同上 |
| Agent 数量 | 主 Agent + 委托 | 所有 enabled Agent | 同上 |
| 执行 | 串行/并行任务链 | 单轮并行广播 | **多轮迭代并行** |
| Agent 可见性 | 通过 task chain | 只看到用户消息 | **看到上一轮同事回复** |
| 互相引用 | 通过 @mention | 无 | **可用 @mention** |
| 输出风格 | 结构化 [PLAN]/[AUDIT] | 自然段落 | **自然段落 + 引用** |
| 终止 | 任务完成 | 全部完成/超时/⏹ | **+ 全员 NO_REPLY / max rounds** |
| 适用场景 | 写代码、审查 | 头脑风暴 | **深度讨论、方案辩论** |

---

## 9. 依赖项

| 依赖 | 状态 | 说明 |
|------|------|------|
| ADR-012 | 已完成 | 架构决策（多轮迭代、上下文注入、防循环） |
| ADR-011 | 已完成 | Open Floor 基础修复（13 层 fix） |
| flushSync 即时渲染 | 已完成 | `09609aa` — 确保 Round 1 回复立即显示 |
| 思考中占位卡片 | 已完成 | `5baac03` — 显示 Agent 思考状态 |
| AgentStatusBar 重构 | 已完成 | `dbfd32a` — 支持模式切换和状态显示 |

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Round 2 Token 超限 | 中 | 高 | 注入摘要（前 100 字）而非全文；token 预算衰减 |
| Agent 互相抬杠无限循环 | 低 | 中 | maxRounds=3 硬限制；NO_REPLY 自然收敛 |
| 速度变慢（串行感） | 低 | 中 | Round 1 不变；Round 2 参与 Agent 更少（NO_REPLY 过滤）|
| 回复质量下降（后期轮次） | 低 | 低 | Token 衰减 → 更短回复；全员 NO_REPLY 提前结束 |
| 前端事件处理复杂化 | 低 | 低 | 新增 `round_complete` 是 best-effort；不处理也不影响 |
| 与现有 prompt 冲突 | 中 | 中 | 角色模板加 Open Floor 覆盖段落（Commit 2） |

---

## 11. 实现检查清单

### Commit 1: 多轮上下文注入（后端，~40 行）

- [ ] `orchestrator.ts`: `executeOpenFloor` 改 for 循环
- [ ] `orchestrator.ts`: 新增 `buildRoundContext()`
- [ ] `orchestrator.ts`: 新增 `open_floor_round_complete` 事件 emit
- [ ] `a2a-types.ts`: 如有需要，更新 `OpenFloorState` 加 `currentRound`

### Commit 2: Prompt 去工具化（~20 行 × 5 模板）

- [ ] 每个 Agent role prompt 模板加 `## Open Floor 讨论模式` 段落
- [ ] 覆盖结构化输出要求（`[PLAN]` / `[AUDIT]`）为自然段落
- [ ] 允许 @mention 引用同事

### Commit 3: UI 轮次显示（~10 行）

- [ ] `chatStore.ts`: 处理 `open_floor_round_complete` 事件
- [ ] `AgentStatusBar.tsx`: 显示当前轮次
- [ ] （可选）消息列表加轮次分隔线

---

## 12. 附录

### A. 术语表

| 术语 | 定义 |
|------|------|
| **Open Floor** | 自由讨论模式，所有 Agent 并行参与 |
| **Round** | 一轮讨论，所有 Agent 同时收到上下文并回复 |
| **上下文注入** | 将上一轮 Agent 回复拼入下一轮 Agent 的输入 |
| **NO_REPLY** | Agent 显式跳过本轮的 sentinel 值 |
| **Orchestrated** | 结构化协作模式（任务流水线） |

### B. 事件清单

| 事件 | 方向 | 触发时机 |  payload |
|------|------|---------|---------|
| `agent_thinking` | Backend → Frontend | Agent 开始思考 | `{conversationId, agentProfileId, agentName}` |
| `agent_observation` | Backend → Frontend | Agent 完成回复 | `{conversationId, agentProfileId, agentName, content}` |
| `open_floor_round_complete` | Backend → Frontend | 一轮全部完成 | `{round, replies: AgentReply[]}` |
| `open_floor_closed` | Backend → Frontend | 讨论结束 | `{conversationId, totalResponses, skippedAgents}` |

### C. 参考文档

- [ADR-012: Iterative Open Floor](../architecture/decisions/adr-012-iterative-open-floor.md)
- [ADR-011: Open Floor Bug Fix Retrospective](../architecture/decisions/adr-011-open-floor-fixes.md)
- [Open Floor 功能设计文档](./open-floor-design.md)
- [Open Floor 用户指南](./open-floor-user-guide.md)
