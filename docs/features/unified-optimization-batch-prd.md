# 统一优化批次 PRD

> 版本: v1.1 | 日期: 2026-05-10 | 作者: @需求文档师
> 状态: Draft | 关联任务: #46-#50 + FR-5

## 1. 概述

### 1.1 背景

本轮修复 Gemini 消息无法展示、Agent 看不到全部队友、Open Floor handler leak、OpenCode Planner 失败等 bug 时，团队发现多个跨 provider 的系统性问题：

- **PATH 探测分散**：每个 provider 各自实现二进制路径探测，Gemini 和 OpenCode 单独写了 `resolveGeminiBinary()` / `resolveOpenCodeBinary()`
- **日志覆盖不均**：Daemon 路径（`claimAndExecute → onObservation`）的 runtime 事件不写 `runtime.log`，可观测性缺口
- **DB 写入重复**：`complete` 和 `agent_observation` 双 handler 各写一次 DB，导致重复记录
- **Compaction Safety 缺失**：System prompt 没有显式 MEMORY.md 自足性指令，context 压缩后 Agent 丢失关键上下文
- **Handler leak 防护 ad-hoc**：`orchestrator.ts` 的 `openFloorCleanups` Map 是临时修复，EventBus 层没有通用防护

### 1.2 目标

将之前讨论的所有优化方案汇总，统一执行，消除跨 provider 的不一致性，提升可观测性和数据一致性。

### 1.3 范围

| 优先级 | 任务 | Task # | 状态 |
|--------|------|--------|------|
| P0 | 统一 PATH 探测 + resolveModel() + permissionFlags trusted | #46 | ✅ 已完成（@架构设计） |
| P1 | runtime.log 统一 — 所有 provider 事件写入 runtime.log | #47 | 🔄 进行中（@Coder） |
| P1 | 单一 DB 写入 — agent_observation 和 complete 只走一条路径 | #48 | ⏳ 待做 |
| P1 | System Prompt Compaction Safety — 加显式 MEMORY.md 自足性指令 | #49 | ⏳ 待做 |
| P1 | Open Floor handler leak 防护制度化 — subscribeBus() 通用机制 | #50 | 🔄 进行中（@UI设计专家） |
| P1 | 工具调用 XML 过滤 + NO_REPLY fallback — reply 内容清洗 | 新增 | ⏳ 待做 |

---

## 2. 问题陈述

### 2.1 P0: PATH 探测 + resolveModel() + permissionFlags（已完成 ✅）

**问题**：Electron 打包后 PATH 不含 `/opt/homebrew/bin`，`spawn('gemini')` / `spawn('opencode')` 报 ENOENT。各 provider 单独实现路径探测，代码重复且容易遗漏。

**已实施修复**（Task #46，@架构设计）：
- `BaseCLIProvider.resolveBinary()` 统一缓存 + `probeBinaryPath()` + `getBinaryCandidates()` 模板方法
- `shouldPassModelFlag(model?)` 统一守卫：`model !== undefined && model !== 'default'`
- `PermissionFlagMap` 类型要求 `trusted` 为必填字段，全部 7 个 provider 已包含

### 2.2 P1: runtime.log 统一

**问题**：Daemon 路径的关键事件（`claimAndExecute`、`onObservation`、`agent_observation`）不写 `runtime.log`。当 Agent 行为异常时，无法从日志回溯完整链路。

**现状**：
- `BaseCLIProvider` 已有 9 个 `writeObservabilityEvent()` 埋点（`runtime:started`、`runtime:terminated`、`runtime:binary_resolved` 等）
- `runtime-registry.ts` 有 `task:started`、`task:completed`、`task:failed`、`task:enqueued`
- **缺失**：`agent_observation` 发出时、`claimAndExecute` 决策过程、`onObservation` handler 调用链

**用户故事**：

> 作为 bytro 开发者，当 Agent 回复异常（如重复、丢失、顺序错乱）时，我希望通过 `runtime.log` 看到完整的事件链路（从 `task:enqueued` → `claimAndExecute` → `runtime:started` → `agent_observation` → `runtime:terminated`），以便快速定位问题环节。

**验收标准**：
- [ ] `agent_observation` 发出时写入 `runtime.log`（含 `conversationId`、`agentProfileId`、`contentType`）
- [ ] `claimAndExecute` 决策写入（含 `reason`：idle_hit / fresh_start / resume_fallback）
- [ ] `onObservation` handler 调用写入（含 `handlerName`、`duration_ms`）
- [ ] 日志可通过 `readLogs({ source: 'runtime', after: timestamp })` 查询

**改动预估**：~30 行（`runtime-registry.ts` + `daemon.ts`）

### 2.3 P1: 单一 DB 写入

**问题**：`complete` 事件和 `agent_observation` 事件各触发一次 `message:create`，导致同一 Agent 回复在 DB 中有两条记录。前端用 `message.id` 去重是 ad-hoc 修复，不是根本解决方案。

**现状**：
- `chatStore.ts` 的 `handleAIEvent` 对 `complete` 事件调用 `message:create`
- `daemon.ts` 的 `onObservation` handler 也调用 `message:create`
- 两条路径写入相同内容，但 `id` 不同 → DB 两条记录 → 前端需去重

**用户故事**：

> 作为 bytro 用户，当 Agent 回复一条消息时，我希望 DB 中只有一条对应的 message 记录，而不是两条重复记录，以避免 UI 渲染闪烁和数据统计偏差。

**验收标准**：
- [ ] 每个 Agent 回复只产生一条 DB message 记录
- [ ] `complete` 事件是唯一的 DB 写入触发点
- [ ] `agent_observation` 不再触发 `message:create`（改为仅更新 UI 状态）
- [ ] 现有 `message.id` 去重逻辑可作为防御性兜底保留

**改动预估**：~20 行（`daemon.ts` 移除 `agent_observation` 的 `message:create` 调用）

### 2.4 P1: System Prompt Compaction Safety

**问题**：当 context window 接近上限时，LLM 会进行 context compaction（压缩历史对话）。压缩后 Agent 丢失关键上下文（如项目结构、团队约定、当前任务状态），因为 System prompt 没有显式指示"MEMORY.md 是恢复入口"。

**现状**：
- `agent-runtime.ts` 的 system prompt 包含角色描述、工具列表、协作规则
- `agent-memory.ts` 在启动时加载 MEMORY.md 注入 system prompt
- **缺失**：没有"压缩后先读 MEMORY.md"的显式指令

**用户故事**：

> 作为 bytro Agent，当我的 context 被压缩时，我希望系统提示词告诉我"先读 MEMORY.md 恢复上下文"，以便我不会丢失项目关键信息，继续正确执行任务。

**验收标准**：
- [ ] System prompt 包含 Compaction Safety 章节：
  ```
  ## Context Recovery
  If your context was compressed, read your MEMORY.md first to recover:
  - Current task and progress
  - Key project decisions and conventions
  - Team member roles and capabilities
  NEVER assume you have full context after compression.
  ```
- [ ] 该章节在 `agent-runtime.ts` 的 `buildSystemPrompt()` 中注入
- [ ] 该章节在 `agent-memory.ts` 的模板中也有对应指引

**改动预估**：~20 行（`agent-runtime.ts` + `agent-memory.ts`）

### 2.5 P1: Open Floor handler leak 防护制度化

**问题**：`orchestrator.ts` 的 `openFloorCleanups` Map 是临时修复，只在 orchestrator 层防止重复注册。EventBus 层没有通用防护，其他使用 `bus.on()` 的地方仍可能 leak。

**现状**：
- `event-bus.ts` 只有 `on()` / `off()` / `emit()` — 标准 EventEmitter 接口
- `orchestrator.ts` 在 `executeOpenFloor` 开始前手动 unsubscribe 旧 handler
- **缺失**：EventBus 没有 `subscribeWithKey()` 或 `subscribeOnce()` API

**用户故事**：

> 作为 bytro 开发者，当我在 EventBus 上注册 handler 时，我希望有 `subscribeWithKey(conversationId, handler)` API 自动防止同一 key 重复注册，而不是每个调用方自己管理 cleanup。

**验收标准**：
- [ ] `EventBus` 新增 `subscribeWithKey(key, event, handler)` 方法
- [ ] 同一 `key` 重复调用时，自动 unsubscribe 旧 handler 再注册新 handler
- [ ] `orchestrator.ts` 的 `openFloorCleanups` Map 改用 `subscribeWithKey()`
- [ ] 其他 `bus.on()` 调用点评估是否需要迁移

**改动预估**：~40 行（`event-bus.ts` + `orchestrator.ts`）

### 2.6 P1: 工具调用 XML 过滤 + NO_REPLY fallback

**问题**：`waitForReplyWithStreaming` 返回的 `fullText` 包含 tool_call XML 原始标签，导致两层问题：
1. **展示层**：前端直接渲染 `<?tool_call>` XML 标签，体验很差
2. **逻辑层**：`fullText` 含 XML → `result.reply` 被判为空或格式异常 → 走 `[NO_REPLY]` 分支 → 消息消失

这是"6 个 Agent 只有 4 个回复"的根因之一——Planner/Codex 的 tool_call 循环中只调工具不输出文字，`lastReply` 为空 → `[NO_REPLY]`。

**现状**：
- `agent-runtime.ts` 的 `waitForReplyWithStreaming` 返回 `fullText`（含所有原始输出）
- `generateObservationReply` 的 tool_call 循环结束后，如果 `lastReply` 为空，直接返回无 reply
- 前端没有 XML 过滤逻辑

**用户故事**：

> 作为 bytro 用户，当 Agent 执行了工具调用后，我希望看到工具执行结果的摘要，而不是空白（NO_REPLY）或原始 XML 标签，以便了解 Agent 做了什么。

**验收标准**：
- [ ] `waitForReplyWithStreaming` 累积 `text_delta`，`complete` 时返回纯文本而非 `fullText`
- [ ] tool_call 循环结束后 `lastReply` 为空但有 `tool_result` 时，生成工具执行摘要作为 fallback reply
- [ ] fallback reply 取第一个 tool_result 的前 100 字符，而非硬编码 `[工具调用完成]`
- [ ] `agent_silent` 事件记录 silent 原因（纳入 #47 runtime.log 统一）

**改动预估**：~30 行（`agent-runtime.ts`）

**依赖**：FR-2（单一 DB 写入）——如果 `complete` 是唯一 DB 写入点，`reply` 必须已经过 XML 清洗

---

## 3. 功能需求

### FR-1: runtime.log 统一（Task #47）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-1.1 | `agent_observation` 发出时写入 `runtime.log` | P1 |
| FR-1.2 | `claimAndExecute` 决策过程写入（idle_hit / fresh_start / resume_fallback） | P1 |
| FR-1.3 | `onObservation` handler 调用写入（handlerName + duration_ms） | P1 |
| FR-1.4 | 所有新埋点使用 `writeObservabilityEvent()` 统一格式 | P1 |

### FR-2: 单一 DB 写入（Task #48）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-2.1 | `complete` 事件是唯一的 DB message 写入触发点 | P1 |
| FR-2.2 | `agent_observation` 不再触发 `message:create` | P1 |
| FR-2.3 | 前端 `message.id` 去重逻辑保留作为防御性兜底 | P2 |

### FR-3: System Prompt Compaction Safety（Task #49）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-3.1 | System prompt 包含 "Context Recovery" 章节 | P1 |
| FR-3.2 | 章节内容引导 Agent 压缩后先读 MEMORY.md | P1 |
| FR-3.3 | `agent-memory.ts` 模板包含对应指引 | P1 |

### FR-4: EventBus subscribeWithKey（Task #50）

| ID | 需求 | 优先级 |
|----|------|--------|
| FR-4.1 | `EventBus` 新增 `subscribeWithKey(key, event, handler)` | P1 |
| FR-4.2 | 同一 key 重复调用自动 unsubscribe 旧 handler | P1 |
| FR-4.3 | `orchestrator.ts` 迁移到 `subscribeWithKey()` | P1 |
| FR-4.4 | 其他 `bus.on()` 调用点评估迁移必要性 | P2 |

### FR-5: 工具调用 XML 过滤 + NO_REPLY fallback

| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| FR-5.1 | `waitForReplyWithStreaming` 累积 `text_delta`，`complete` 返回纯文本而非 `fullText` | P1 | ✅ 已完成（@Cindy） |
| FR-5.2 | tool_call 循环结束后 `lastReply` 为空但有 `tool_result` 时，生成工具执行摘要作为 fallback reply | P1 | ✅ 已完成（@Cindy） |
| FR-5.3 | `insideToolCall` 标志在 `complete`/`error`/`done` 事件时重置为 `false`（防御性） | P1 | ✅ 已完成（@Cindy） |
| FR-5.4 | `waitForReply` 非 5 分钟超时保护 | P2 | ✅ 已完成（@Cindy） |
| FR-5.5 | `agent_silent` 事件记录 silent 原因（纳入 #47） | P1 | ⏳ 待做 |

---

## 4. 非功能需求

| ID | 需求 | 标准 |
|----|------|------|
| NFR-1 | 日志性能 | 新增埋点不增加 >5% 的消息处理延迟 |
| NFR-2 | 向后兼容 | 所有改动向后兼容，不破坏现有 IPC/API 契约 |
| NFR-3 | 测试覆盖 | 每项优化有对应单元测试，整体测试通过率 ≥ 99% |
| NFR-4 | 改动量控制 | 单项改动 ≤ 50 行，总改动 ≤ 200 行 |

---

## 5. 实施计划

### Phase 1: 已完成 ✅

| 任务 | 负责人 | 状态 |
|------|--------|------|
| #46: PATH 统一 + resolveModel() + permissionFlags | @架构设计 | ✅ done |

### Phase 2: 日志 + DB + Compaction Safety + XML 过滤（并行）

| 任务 | 负责人 | 预估 | 依赖 | 状态 |
|------|--------|------|------|------|
| #47: runtime.log 统一 | @Coder | ~30 行 | 无 | 🔄 in_progress |
| #48: 单一 DB 写入 | @Reveiw工程师 | ~20 行 | FR-5.1（XML 过滤前置） | ⏳ |
| #49: Compaction Safety | @Coder | ~20 行 | 无 | ⏳ |
| FR-5.1: 流式文本过滤 | @Cindy | ~20 行 | 无 | ✅ done |
| FR-5.2: Fallback reply 摘要 | @Cindy | ~10 行 | FR-5.1 | ✅ done |
| FR-5.3: insideToolCall 重置 | @Cindy | ~5 行 | 无 | ✅ done |
| FR-5.4: waitForReply 超时保护 | @Cindy | ~5 行 | 无 | ✅ done |
| FR-5.5: agent_silent 事件 | @Coder | ~5 行 | #47 | ⏳ |

FR-5.2/5.3/5.5 可与 #47/#48/#49 并行执行，FR-5.1 已完成。

### Phase 3: EventBus 防护

| 任务 | 负责人 | 预估 | 依赖 |
|------|--------|------|------|
| #50: subscribeWithKey | @UI设计专家 | ~40 行 | 无 |

可与 Phase 2 并行。

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| FR-2 单一 DB 写入导致某些场景消息丢失 | 低 | 高 | 保留前端 `message.id` 去重兜底；E2E 验证所有 provider |
| FR-4 subscribeWithKey 改变 EventBus 语义 | 低 | 中 | `subscribeWithKey` 是纯增量 API，不改变 `on()`/`off()` 行为 |
| FR-3 Compaction Safety 指令被 LLM 忽略 | 中 | 低 | 指令放在 System prompt 末尾（高权重位置）；配合 MEMORY.md 自足性设计 |
| 日志写入量增加影响性能 | 低 | 低 | `writeObservabilityEvent()` 已有 level 推断，debug 级别不写生产日志 |
| FR-5.2 fallback 摘要信息量不足 | 低 | 低 | 取 tool_result 前 100 字符而非硬编码；极端情况兜底 `[已完成工具调用]` |
| FR-5.3 insideToolCall 重置遗漏 | 低 | 中 | 在 `complete`/`error`/`done` 三处统一重置，覆盖所有退出路径 |

---

## 7. 验证计划

### 7.1 单元测试

| 优化项 | 测试用例 |
|--------|----------|
| FR-1 | `runtime-registry.test.ts`: 验证 `claimAndExecute` 写入日志 |
| FR-2 | `daemon.test.ts`: 验证 `agent_observation` 不触发 `message:create` |
| FR-3 | `agent-runtime.test.ts`: 验证 system prompt 包含 "Context Recovery" |
| FR-4 | `event-bus.test.ts`: 验证 `subscribeWithKey` 重复调用自动 unsubscribe |
| FR-5 | `agent-runtime.test.ts`: 验证 tool_call 后 `lastReply` 为空时生成 fallback 摘要 |

### 7.2 E2E 验证

1. 发送消息 → 检查 `runtime.log` 有完整事件链路
2. Agent 回复 → 检查 DB 只有一条 message 记录
3. Context 压缩后 → Agent 仍能正确执行（读 MEMORY.md 恢复）
4. Open Floor 多轮 → 无重复 handler / 重复消息
5. Agent tool_call 后 → 不显示 XML / 空 reply 有 fallback 摘要

---

## 8. P2 后续优化（本次不做）

| 优化 | 说明 | 预估 |
|------|------|------|
| Copilot per-turn spawn 对齐 Slock | Task #43 | ~80 行 |
| Cursor per-turn spawn 对齐 Slock | Task #44 | ~80 行 |
| Codex JSON-RPC → per-turn spawn | Task #45 | ~60 行 |
| AgentDriver interface（ADR-017 Phase 2） | 统一 provider 接口 | ~160 行 |
| resume_or_fresh 统一 | session resume 失败自动 fallback | ~50 行 |
| 前端 error 事件展示 | 当前 error 事件只清 streaming 状态 | ~20 行 |
| Model Refresh staleTime 缓存 | 避免每次打开 Settings 都调 `listModels()` | ~15 行 |
| 版本号格式统一 | `detect()` 返回值解析标准化 | ~10 行 |

---

## 附录 A: Provider 现状对比

| Provider | Transport | Custom sendMessage | Custom resolveBinary | Custom buildEnv | Parser |
|----------|-----------|-------------------|---------------------|-----------------|--------|
| Claude | stream-json (persistent) | ❌ (base) | ❌ (base) | ✅ ANTHROPIC_API_KEY | ClaudeOutputParser |
| Codex | per-turn spawn | ✅ | ❌ (base) | ✅ OPENAI_API_KEY | CodexOutputParser |
| Copilot | per-turn spawn | ✅ | ❌ (base) | ✅ ANTHROPIC_API_KEY | ClaudeOutputParser |
| Cursor | per-turn spawn | ✅ | ❌ (base) | ✅ ANTHROPIC_API_KEY | ClaudeOutputParser |
| Gemini | per-turn spawn (stdin) | ✅ | ❌ (base) | ✅ GEMINI_API_KEY | GeminiOutputParser |
| Kimi | per-turn spawn | ✅ | ❌ (base) | ❌ (CLI 自管) | KimiOutputParser |
| OpenCode | per-turn spawn | ✅ | ✅ `~/.opencode/bin/` | ❌ (空) | OpenCodeOutputParser |

**关键发现**：只有 Claude 使用 base class 的持久 stream-json transport。其他 6 个 provider 都 override `sendMessage` 实现 per-turn spawn，但实现方式各不相同（positional arg / `-p` flag / `--prompt` flag / stdin pipe）。
