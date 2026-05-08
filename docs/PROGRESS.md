---
last_verified: 2026-05-08 12:05
doc_kind: progress
---

# Project Progress

> **AI agents: 每次任务开始前读这里。** 了解当前状态后，去读对应的 feature 文档。
> **任务完成后必须更新本文件。**

---

## 当前焦点

Bytro P0-P3 核心模块已完成。Phase A-J 已收尾。

**Agent Space Phase 1-5 已实现（2026-05-08）。**

**Session Layer Fixes + Observability 已实现（2026-05-08）：**
- 5 session bugs 全部修复（ADR-005~008 落地）
- @Codex 入口修复（mention-parser 三合一分隔符）
- 结构化日志模块（16 埋点 / 12 事件类型，分类落盘）

剩余工作：
- **Phase 5（体验增强）** — 全部完成 ✅
- 无阻塞项

---

## Phase 总览 (A-S)

| Phase | 内容 | 状态 |
|-------|------|------|
| A | Multi-Model Phase 2 — Codex/Kimi/Gemini Provider | ✅ |
| B | Multi-Model Phase 3 — UI (ModelSelector, Settings, providerStore) | ✅ |
| C | 暗色/亮色主题 | ✅ |
| D | 文件浏览器 | ✅ |
| E | 虚拟滚动 | ✅ |
| F | 对话导出 | ✅ |
| G | 自动更新 | ✅ |
| H | MCP 客户端 | ✅ |
| I | Token/成本统计 | ✅ |
| J | 键盘导航 | ✅ |
| K | 打包发布 | ✅ |
| **M** | **记忆注入（Memory Injection）** | ✅ |
| **T** | **AgentTeam — 预配置多 Agent 团队** | ✅ |
| **S** | **contextSnapshot 结构化升级** | ✅ |

---

## Feature 状态总览

### 已完成

| Feature | 优先级 | 状态 | 下一步 | 文档 |
|---------|--------|------|--------|------|
| Task Execution (Module A) | P0 | ✅ P1 全部修复 | 无 | [→](features/task-execution.md) |
| File Tracking (Module B) | P1 | ✅ B4/B5 已实现 | 无 | [→](features/file-tracking.md) |
| Workspace Shell | P0 | ✅ BottomOutput resize 已修复 | 无 | [→](features/workspace-shell.md) |
| Memory Palace (Module C) | P2 | ✅ Phase 1–6 完成 | C7 cited_by 自动写入（P2） | [→](features/memory-palace.md) |
| Multi-Agent (Module D) | P3 | ✅ Milestone 2 + Gap Fill 完成 | 无 | [→](features/multi-agent.md) |
| xterm Terminal (P1) | P1 | ✅ 完成 | 无 | — |
| Multi-Model Provider | P1 | ✅ Phase A+B 完成 | 无 | [→](features/multi-model.md) |
| Dark/Light Theme | P1 | ✅ Phase C 完成 | 无 | [→](features/theme.md) |
| File Browser | P1 | ✅ Phase D 完成 | 无 | [→](features/file-browser.md) |
| Virtual Scrolling | P1 | ✅ Phase E 完成 | 无 | [→](features/virtual-scrolling.md) |
| Conversation Export | P2 | ✅ Phase F 完成 | 无 | [→](features/conversation-export.md) |
| Auto Update | P1 | ✅ Phase G 完成 | 无 | [→](features/auto-update.md) |
| Credential Encryption | P1 | ✅ 随 Multi-Model Phase 1 完成 | 无 | [→](features/credential-encryption.md) |
| MCP 客户端 | P2 | ✅ Phase H 完成 | 无 | [→](features/mcp-client.md) |
| Token/成本统计 | P2 | ✅ Phase I 完成 | 无 | — |
| 键盘导航 | P2 | ✅ Phase J 完成 | 无 | — |
| **记忆注入** | P1 | ✅ Phase M 完成 | P2 #11 composer 解锁 | [→](features/memory-injection.md) |
| **AgentTeam** | P1 | ✅ Phase T1-T4 完成 | P1 #10 reviewer 竞态 | [→](features/agent-team.md) |
| **contextSnapshot 升级** | P2 | ✅ Phase S 完成 | 无 | [→](features/context-snapshot-upgrade.md) |
| **会话软删除** | P1 | ✅ Phase U 完成 | 无 | [→](features/conversation-delete.md) |
| **Gemini CLI Provider** | P1 | ✅ 完成（含 review 修复） | 无 | [→](reviews/active/2026-05-05-gemini-cli-review.md) |
| **Agent Space** | P1 | ✅ Phase 1-5 完成 | Phase K 打包发布 | — |

### 待实现

| Feature | 优先级 | 状态 | 下一步 | 文档 |
|---------|--------|------|--------|------|
| 打包发布 | P1 | ✅ Phase K | electron-builder + GitHub Actions | — |

---

## 当前 P1 问题（阻塞进度）

| # | 问题 | 来源 | 状态 |
|---|------|------|------|
| — | 暂无 | — | — |

---

## 当前 P2 问题（待跟进）

| # | 问题 | 来源 |
|---|------|------|
| P2-11 | 首个 task `done` 提前解锁输入 | agent-team review |
| P2-8 | 两侧 memory injection 逻辑不一致（main FTS vs renderer 全量） | agent-team review |

---

## 已完成

- [x] P0 核心：ClaudeCLIProvider, EventParser, node-pty manual mode
- [x] P0 核心：Conversation search/delete/auto-title/manual-title protection
- [x] P0 核心：Usage/subagent/todo visualization
- [x] Memory system：durable files, read models, IPC, store, context injection, summaries, agent sessions
- [x] Module A 核心：Task = Conversation, TaskRail, workspace-scoped New Task, conversations schema v4
- [x] Module B 核心：file_changes 表, changeStore, chatStore tool capture, DiffPanel 真实数据, agent_count 持久化
- [x] A-P1-1–P1-4 修复（2026-05-01）
- [x] Module B 测试：fileChange 工具函数 17 个单测（2026-05-01）
- [x] Module C Phase 1–5：schema v6, IPC, preload, store, UI, TaskRail 迷你区（2026-05-01）
- [x] Module B B4/B5：SessionChangesSummary + DiffPanel 点击跳转（2026-05-01）
- [x] Module C Phase 6：markdown 工具函数 18 测试 + store 18 测试（2026-05-02）
- [x] Module C C8：Tags 编辑 UI（逗号/Enter 添加、× 删除、Backspace 删除末尾）（2026-05-02）
- [x] Module D：Agent Profiles — DB schema v7/v8, IPC, store, chatStore, Settings CRUD, Composer selector, 11 测试（2026-05-02）
- [x] P1 Terminal：xterm.js + node-pty 集成 — IPC, TerminalPanel, BottomOutput tab（2026-05-02）
- [x] P1 Monaco：@monaco-editor/react 替换只读 CodePanel — 编辑、脏状态●、Cmd+S 保存、大文件降级、file:write IPC（2026-05-02）
- [x] Multi-Agent A2A Milestone 1：orchestrator, agent-runtime, mention-parser, a2aStore, AgentBadge, @mention 补全，serial queue，循环检测，agent_profile_id 全链路持久化（2026-05-02）
- [x] 架构文档整理：multi-agent-a2a-orchestration.md 移入 docs/architecture（2026-05-02）
- [x] Multi-Agent A2A Milestone 2（2026-05-02）
- [x] Multi-Model Phase 1: secrets.ts、DB schema v10、ProviderRegistry、BaseCLIProvider、ClaudeCLIProvider 适配、AIEngine 改造、OutputParser、IPC provider handlers、Preload provider namespace、chat/orchestrator 动态校验、agent-runtime providerType 传播（2026-05-03）
- [x] Multi-Model Phase 2 (Phase A): CodexCLIProvider + KimiCLIProvider + GeminiCLIProvider（stub）、各 OutputParser、fixture 测试 21 个、ProviderRegistry 完整注册（2026-05-03）
- [x] Multi-Model Phase 3 (Phase B): providerStore、ModelSelector 重写（Provider + Model 两级下拉、修复 legacy alias bug）、sessionConfigStore 加 providerType、Settings Providers tab（API Key 配置/测试连接）、chatStore 传入 providerType、AgentProfileConfig 补齐 preferredProvider 字段（2026-05-03）
- [x] typecheck 通过，test 127 passed / 3 pre-existing skip（2026-05-03）
- [x] Conversation Export (Phase F)：Markdown/JSON 导出，选项面板，TaskRail 右键菜单 — export.ts, IPC, preload, ConversationExportMenu（2026-05-03）
- [x] Review 三项修复：P1 parser complete/done 事件 + flush()、P2 session resume 按 provider 作用域、P2 agent 编辑表单 provider 选择器（2026-05-03）
- [x] Auto Update (Phase G)：GitHub Releases API 检查 + 启动静默检查 + Settings General 更新 UI — update.ts, IPC, preload, updateStore（2026-05-04）
- [x] Phase C (Dark/Light Theme)、Phase D (File Browser)、Phase E (Virtual Scrolling) 已完成（2026-05-04）
- [x] Phase H (MCP 客户端)：config-file.ts, IPC, preload, BaseCLIProvider buildMcpArgs, Claude/Kimi override, Settings UI, feature doc（2026-05-04）
- [x] Phase I (Token/成本统计)：pricing table, DB schema v13 (provider_id + usage_daily view), usage:summary/totalCost IPC, UsageBar 增强 (缓存命中 + 费用), Settings Usage tab (月度汇总/模型分布/日趋势)（2026-05-05）
- [x] Phase J (键盘导航)：useKeyboardShortcuts hook (Cmd+N/W/K/,/\, Cmd+Shift+T/E/M, Cmd+1~9, Escape abort, Cmd+Enter focus)，TaskRail 键盘导航 (↑↓/Enter/Delete/F2)，无 Monaco 冲突（2026-05-05）
- [x] Phase M（记忆注入）：FTS 记忆注入 buildInjectionPrompt() → orchestrator.sendUserMessage hook，token budget ≤1500（2026-05-05）
- [x] Phase T1（AgentTeam 数据层）：DB v14 migration (team_id + capabilities/when_to_use/output_contract)，preset-seed-data.ts, team-config.ts, ipc/team.ts, preload team namespace, a2a-types 扩展（2026-05-05）
- [x] Phase T2（Orchestrator Pipeline）：runTeamPipeline() + executePipelineStep() + checkFileChanges()，depth=0 守卫，feedbackTo follow-up A2A task（2026-05-05）
- [x] Phase T3（NewTaskDialog UI）：Solo/Team 模式选择器，localStorage 记忆，Sidebar/Home 集成（2026-05-05）
- [x] Phase T4（TaskRail 团队标识）：Users 图标 badge 在 Sidebar + TaskRail（2026-05-05）
- [x] Phase S（contextSnapshot 升级）：FileChangeEntry 类型，三段式 Markdown（TASK HANDOFF / TASK PROGRESS / PROJECT MEMORY），11 测试（2026-05-05）
- [x] Agent Discovery 升级：agent-runtime setKnownAgents(AgentProfile[])，capabilities-based 判断，动态 agent card 注入（2026-05-05）
- [x] Gemini CLI review 修复：P1 startSession session_id 保留 + P2 usage 附着 complete + P2 doneEmitted 提升 + P3 -r 直接控制（2026-05-05）
- [x] AgentTeam review 修复：P1-1 preset-seed-data 提取 + P1-2 profile-utils 去重 + P1-3 teamConfig 传参 + P1-9 team 模式 profile 解析 + P2-7 decisions/blockers 映射 + P2-12 feedbackTo follow-up task + P2-13 空 history 不丢 context（2026-05-05）
- [x] typecheck clean, tests 149 passed / 3 skipped（2026-05-05）
- [x] Phase U（会话软删除）：Schema v16 deleted_at 列 + idx_conv_deleted 索引，purgeExpiredConversations() 冷启动清理，conversation:delete 改软删除，5 个 list 查询加 AND deleted_at IS NULL 过滤，DeleteConfirmDialog 文案更新（2026-05-06）
- [x] **Agent Space Phase 1（Agent / Runtime / Solo Task）**：
  - 类型对齐：renderer `AgentProfileConfig` + preload `global.d.ts` 补齐 `capabilities`/`whenToUse`/`outputContract`/`preferredProvider`
  - Main IPC：`createProfile`/`updateProfile` 持久化新字段到 DB（JSON capabilities）
  - Runtime Resolver（新）：`resolveRuntime()` 单一入口，provider/model 三层 fallback（profile → baseConfig → system default），11 个单测
  - `AgentRuntime.start()` 改用 resolver，移除 scattered inline resolution
  - `chatStore.ts` 移除 renderer 侧重复解析，透传原始 sessionConfig
  - SettingsAgents UI：`WorkspaceArea.tsx` 完整 CRUD（role select + description + capabilities tag input + whenToUse + outputContract），显示 role badge + capability chips
  - NewTaskDialog Solo 模式：水平 agent selector（Default + enabled profiles，圆形首字母头像 + role 色 + hover tooltip + 选中圆点指示），localStorage 记忆上次选择
  - Tests：`agentProfileStore.test.ts` mock 数据含新字段 + capabilities round-trip 测试
- [x] **Agent Settings UI 规整（2026-05-08）**：
  - Settings Agents 改为三块分层：基础信息（可编辑）、角色模板（只读预览 + preset/custom 来源标识）、能力配置（默认折叠）
  - 预设 Agent 来源判断抽到 `src/utils/preset-profile-ids.ts`，renderer 与 preset seed 共用，避免重复 Agent 数据源
  - system prompt 从常规编辑表单移出，Settings 只做模板预览；运行时仍由 profile metadata + prompt template + context 注入组装
- [x] **Blocker 修复（2026-05-06）**：
  - P1-10/P1-15：`on-code-change` reviewer 竞态 — 已由 in-memory `fileChangeFlags` + `isFileTool()` 归一化修复（代码已有，review doc 更新）
  - P1-22：`agent:createProfile` SQL INSERT 15 列但只有 14 个占位符 → 补正
  - P2-23：`NewTaskDialog` 接入 `SharedConversation.tsx` 和 `Sidebar.tsx` 真实入口
  - P2-24：Agent 可选字段可清空 — renderer 发送显式 `null`/`[]`，IPC 持久化清空语义，类型链 `| null`
- [x] **Agent Space Phase 2（Team 持久化 + Network 模型）**：
  - DB Migration v17：`team_configs` 表（id, name, description, members JSON, created_at, updated_at）
  - Seeder：将 DEV_TEAM 写入 DB（迁移时自动执行）
  - `team-config.ts` 重构：新增 `TeamMember` 接口（profileId + providerOverride + modelOverride），`loadTeams`/`getTeam` 从 DB 读取，`createTeam`/`updateTeam`/`deleteTeam`/`seedDefaultTeam` CRUD
  - IPC `team:create`/`team:update`/`team:delete` handlers
  - Preload + `global.d.ts` 类型全链路对齐（`members` 字段 + 新 methods）
  - `NewTaskDialog` team preview 改用 `members` 字段 + agent store profile lookup（role 色圆点 + role 标签），不再硬编码 profile names
  - Pipeline → Network 过渡：`rowToTeam()` 从 members 派生 pipeline（全部 manual trigger），`runTeamPipeline` 行为不变但自动触发机制淡化
- [x] **Agent Space Phase 3a-b（Task 级 Runtime 覆盖）**：
  - `A2ATask` 新增 `providerOverride?: string` + `modelOverride?: string`
  - `resolveRuntime()` 新增 `overrides` 参数（Priority 1，最高优先级）
  - `AgentRuntime.start(config, overrides?)` 透传覆盖
  - `orchestrator.sendUserMessage()` 接受 `overrides` 参数，create task 时存储，executeTask 时传给 runtime
  - IPC `orchestrator:sendMessage` payload 验证并透传 overrides（provider 有效性校验）
  - Phase 3c（UI）：`NewTaskDialog` 可折叠"Runtime 覆盖"区 — Provider 下拉 + 联动 Model 下拉，onConfirm 存入 `chatStore.pendingTaskOverrides`，`sendMessage` 消费并透传到 IPC
- [x] **Agent Space Phase 2-3 补齐（2026-05-07）**：
  - Phase 2：Space Policy（v18 migration `policies_json` 列、`AgentSpacePolicy` 类型含 7 个字段、DEV_TEAM 默认策略 `requireReviewOnCodeChange: true`、IPC/preload 全链路）
  - Phase 3 Prompt Composer：`orchestrator.executeTask()` 按 team_id 加载成员 profiles，`runtime.setKnownAgents(teamProfiles)` team-scoped 注入；Solo 模式传入空数组不注入
  - Phase 3 Policy Guard：`routeMention()` 校验 `allowAgentToDelegate`（禁止 Agent 自主委托）、team membership（目标必须在 Team 内）
  - Phase 3 Capability Routing：`findProfilesByCapability()` 按 capability tag 匹配（`@review`/`@ui`），单候选直路、多候选按 sortOrder 选首并通知；`allowCapabilityRouting` policy 控制
- [x] **Agent Space Phase 4（Task Graph）**：
  - DB v19：`agent_task_edges` 表（id, conversation_id, from_node_id, to_node_id, edge_type, label, created_at）+ 索引
  - `a2a-types.ts`：`AgentTaskEdge` + `EdgeType` 类型
  - `orchestrator`：`persistEdge()` + `getActiveGraph()` 返回 `{ nodes, edges }`
  - Edge 创建：user-mention（初始任务）、agent-mention（委托）、capability-route（能力路由），label 记录 @mention 目标
  - IPC `task:getActiveGraph` + preload 全链路
  - UI：`TaskGraph.tsx` — 节点卡片（agent name + status badge + instruction + incoming edges），按 depth 缩进分层，实时 poll 刷新，嵌入 `ChatPage`
- [x] **Agent Space Phase 5（体验增强）**：
  - 5a：`TeamTopology.tsx` — SVG 圆形网络布局，圆心 Team hub + 卫星成员节点，role 色填充 + 首字母，hover tooltip 展开能力标签和 Runtime override 标记；集成到 `NewTaskDialog` team preview 替换旧列表
  - 5b：`TaskGraph` 增强 — All/Active/Done 三态过滤、collapsible 面板、edge type 色标图例、status 变化 pulse 动画、parallel 模式 ∥ 标记
  - 5c：ACP Runtime — `RuntimeType` 类型（'cli' | 'acp' | 'cloud'）+ `ProviderMeta.runtimeType` 字段扩展
- [x] **PRD 验收标准补齐（AC #3, #6）**：
  - AC #3：`NewTaskDialog` Team 模式新增初始 @mention textarea，`chatStore.pendingInitialMentions` 在首次 sendMessage 时 prepend 到消息内容
  - AC #6：`routeMention` 检测 `@All`（不区分大小写），展开为全部 team member → 各建 parallel task + `[READ-ONLY MODE]` 前缀指令 + edge 标记
  - ~~AC #11：`requireReviewOnCodeChange` 自动 review 策略已移除，改为 Agent 自主 @mention 触发 review~~
- [x] **Phase K（打包发布）**：
  - electron-builder.yml：macOS dmg + zip（arm64/x64），GitHub Releases publisher，hardenedRuntime + entitlements
  - resources/entitlements.mac.plist：allow-unsigned-executable-memory、allow-jit、disable-library-validation
  - .github/workflows/release.yml：push→check（typecheck/build/test），tag v*→package（arm64+x64 matrix）→ GitHub Release
  - package.json scripts：dist（arm64 本地）、dist:all（arm64+x64 本地）
- [x] **Agent A2A Output Scan Review 修复（2026-05-07）**：
  - P1：serial queue 在 parallel root 运行后始终 drain，防止 agent-scan 任务永远排队
  - P2：彻底移除 dead `requireReviewOnCodeChange` policy — `runTeamPolicies()` / `policy_review` intent / routing / UI toggle / edge type 全链路清理
  - P2 补充：preset seed data 中 `claude-primary` systemPrompt 和 `codex-reviewer` whenToUse 的"系统自动触发"文案同步清理；DB migration v23 自动修复已存在 DB 中的旧 prompt
  - P3：`a2a_tasks.source` 字段持久化 — DB migration v22 + `persistTask()` 写入 + `rowToTask()` 恢复
- [x] **A2A Gap Fill（vs clowder-ai，2026-05-07）**：
  - Phase 1：`invocation-queue.ts` — 优先级队列（3 级 priority）、僵尸防御（10min threshold）、队列位置追踪 + `a2a:taskQueued` IPC + TaskGraph badge
  - Phase 2：`continuity-capsule.ts` — `ContinuityCapsuleManager`（create/seal/complete/handoff/isSessionResumable），DB schema v24 `continuity_capsules` 表
  - Phase 3：`reflow-orchestrator.ts` — `ReflowGroup` + `ReflowOrchestrator`（createGroup/onChildComplete/onChildFail/tryAggregate/buildAggregationMessage），anti-cascade 守卫（max 2 failures），5min timeout guard
  - Phase 4：`agent-runtime.ts` `switchModel()` — ACP `session/set_model` 集成，`orchestrator.ts` `executeTask()` 中调用
  - Phase 5：`a2a-memory-distiller.ts` — `ChainMemoryDistillate` + 正则模式提取（decision/convention/failure），`drainSerialQueue()` 完成后触发
  - Phase 6：架构文档更新 — `multi-agent-a2a-orchestration.md` 更新，新增 `acp-protocol-leverage.md` + `a2a-memory-bridge.md`
  - typecheck clean，tests 237 passed / 3 skipped（db.test.ts pre-existing `better-sqlite3` NODE_MODULE_VERSION mismatch）
- [x] **Session Layer 修复（5 bugs）**：
  - ADR-005/006/007/008 全部落地
  - Permission 精确路由（requestId，修复 CRITICAL 权限广播泄露）
  - Runtime key 三维模型（`conv:profile:taskId`，修复并行任务碰撞）
  - Lifecycle cleanup 收敛（7 条终止路径 → 1 个 `cleanupRuntime`）
  - Feedback 上下文组合（父 agent 记忆不再丢失）
- [x] **@Codex 入口修复**：mention-parser 支持空格/:/：三合一分隔符 + orchestrator 规则统一
- [x] **Observability 日志模块**：
  - `src/main/core/logging.ts` — JSONL 结构化日志（写入 `app.getPath('logs')`）
  - `src/main/ipc/logs.ts` — IPC 读取接口
  - console bridge 同步写入 `app.log`
  - 16 个埋点覆盖 12 种 typed events
  - 分类日志文件：runtime.log / task.log / permission.log / feedback.log / intent.log
- [x] **文档补全**：
  - `docs/architecture/decisions/session-layer-adrs.md` — ADR-005~008 完整决策记录
  - `docs/architecture/slock-agent-communication-reference.md` — Slock↔bytro 通信模型参考
  - `docs/architecture/observability-logging.md` — 更新（intent:dispatched 事件 + 排查流程）
  - `docs/features/multi-agent.md` — 更新（D18 observability 行）
- [x] **Multica Agent 协同参考文档（2026-05-08）**：
  - 调研 `multica-ai/multica` daemon/runtime/task queue/model discovery 机制，并与 Bytro Agent Space 对比
  - 新增 `docs/architecture/multica-agent-collaboration-reference.md`，作为 Runtime Inventory、动态模型发现、durable queue lease 后续设计参考

---

## 更新约定

完成一项工作后，agent 必须：
1. 将对应条目从"当前 P1 问题"移除或标记已修
2. 在"已完成"列表加一行
3. 更新 Feature 状态总览中的状态和下一步
4. 更新 `last_verified` 日期
