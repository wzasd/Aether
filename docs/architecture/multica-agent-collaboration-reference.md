---
status: reference
owner: bytro
last_verified: 2026-05-08
doc_kind: architecture-reference
source:
  - multica-ai/multica @ de356561bc964ae49e902c54f5903243a32844e7
applies_to:
  - src/main/ai/orchestrator.ts
  - src/main/ai/agent-runtime.ts
  - src/main/ai/invocation-queue.ts
  - src/main/ai/runtime-resolver.ts
  - src/main/ai/provider-registry.ts
  - src/main/ai/acp/acp-provider.ts
  - src/main/ipc/chat.ts
---

# Multica Agent Collaboration Reference

本文记录对 [`multica-ai/multica`](https://github.com/multica-ai/multica) 的调研结论，并和 Bytro 当前 Agent Space / A2A 架构做对比。它不是产品需求文档，而是后续设计 Runtime Inventory、动态模型发现、持久队列时的参考基线。

## Executive Summary

Multica 的核心不是一个"多 Agent 大脑"，而是一个"云端任务系统 + 本地 CLI daemon worker"。它把 Claude、Codex、Gemini、Cursor Agent、OpenCode、Kimi、Kiro 等本地 CLI 注册成可调度 runtime，由 server 负责任务、权限、排队、心跳、状态和实时同步，由 daemon 在用户本机执行 CLI。

Bytro 当前方向不同：Bytro 是本地 AI-native workspace，Agent 协同发生在应用内的 A2A graph、team policy、capability routing、memory distillation 和 reflow aggregation 中。换句话说：

- Multica 强在 runtime 工程、跨 workspace 调度、daemon 心跳、离线恢复、原子 claim 和模型发现。
- Bytro 强在 agent-native 协作语义、`@mention` / `@All`、team-scoped prompt、任务图、反馈链、记忆蒸馏和本地工作台体验。

适合借鉴 Multica 的部分是 runtime/control-plane，不应照搬它的 issue/assignee 产品模型来替换 Bytro 的 A2A orchestration。

## Multica Mental Model

Multica 的协作结构可以拆成三层：

1. **Server control plane**
   - 保存 workspace、issue、comment、chat、agent runtime、agent task。
   - 管理任务排队、权限、状态转移、协作可见性。
   - 通过 heartbeat 告诉 daemon 是否有 pending work、pending cancellation、pending model-list request。

2. **Local daemon execution plane**
   - 扫描本机是否安装各类 CLI。
   - 为每个 workspace 注册可用 runtime。
   - 周期性 poll server，claim task，创建隔离工作目录，启动对应 CLI。
   - 上报 task start / complete / fail、CLI 版本、Multica CLI 版本、模型列表、token usage。

3. **Agent as assignee**
   - Agent 是 issue/comment/chat/autopilot 的 assignee 或 participant。
   - 多 Agent 协作主要来自多个 assignee/task 在同一 workspace 或 issue 上并发工作。
   - Server 用数据库锁和 concurrency limit 避免同一 agent 在同一 issue 上重复抢任务。

关键点：Multica 没有把多个 agent 的中间推理组织成一个应用内任务图；它更像把本地 CLI fleet 化，让多个 CLI worker 可以被 server 安全调度。

## Multica Agent Collaboration

### Runtime Registration

Daemon 启动时从配置和本机环境发现 provider：

- `exec.LookPath` 检测 CLI binary 是否存在。
- `--version` 检测 runtime version。
- 每个 workspace 注册一组 runtime。
- 注册 payload 包含 provider、workspace、runtime version、Multica CLI version、metadata。

主要参考：

- `multica/server/internal/daemon/config.go`
- `multica/server/internal/daemon/daemon.go`
- `multica/server/internal/handler/daemon.go`

### Task Queue And Claim

Server 侧保存 `agent_task`。任务创建后，daemon 通过 poll/heartbeat 发现 pending task，并调用 claim/start/complete/fail API。

Multica 的关键工程点：

- 用数据库事务 claim task。
- 用 `FOR UPDATE SKIP LOCKED` 避免并发 daemon 抢同一任务。
- 尊重 `max_concurrent_tasks`。
- 允许不同 agent 在同一 issue 上并行，但避免同一 `(issue, agent)` 重复执行。
- Daemon 本地还有 slot/semaphore 控制 runtime 并发。

主要参考：

- `multica/server/internal/service/task.go`
- `multica/server/pkg/db/queries/agent.sql`
- `multica/server/internal/daemon/daemon.go`

### Execution Environment

Multica 不直接在项目根目录裸跑 CLI，而是为 task 构建 execution environment：

- 每个 task 有隔离工作目录。
- 注入上下文、skills、workspace 信息。
- 对 Codex 设置 `CODEX_HOME`，便于隔离 sessions。
- Task 运行期间 daemon 轮询 cancellation。
- 完成后上报结果、失败原因、usage。

主要参考：

- `multica/server/internal/daemon/execenv/execenv.go`
- `multica/server/internal/daemon/daemon.go`

## Dynamic Model Discovery

Multica 的模型发现值得重点借鉴。它解决了一个现实问题：server 通常不能主动连到用户本机 daemon，因为 daemon 在 NAT/firewall 后面。所以它用 pending request + heartbeat 的反向拉取模型。

流程：

1. Frontend 请求列出某个 runtime 的模型。
2. Server 创建 pending model-list request。
3. Frontend 每 500ms poll request status，最多等约 30s。
4. Daemon heartbeat 得到 `pending_model_list`。
5. Daemon 在本机调用对应 provider 的模型发现逻辑。
6. Daemon 把结果 report 回 server。
7. Frontend poll 到 completed 后展示模型。

主要参考：

- `multica/server/internal/handler/runtime_models.go`
- `multica/packages/core/runtimes/models.ts`
- `multica/server/internal/daemon/daemon.go`
- `multica/server/pkg/agent/models.go`

### Discovery Strategy By Provider

Multica 不假设所有 CLI 都有统一协议，而是按 provider 适配：

- Claude / Codex / Gemini / Copilot：提供静态候选列表。
- OpenCode：运行 `opencode models` 并解析 stdout。
- Pi：运行 `pi --list-models`，解析 stdout 或 stderr。
- Cursor：运行 `cursor-agent --list-models`，解析 `id - Label` 格式。
- Hermes / Kimi / Kiro：启动临时 ACP 进程，走 `initialize -> session/new`，读取 `availableModels/currentModelId`。
- OpenClaw：优先 `openclaw agents list --json`，失败后 fallback 到文本解析；这里的"模型"更接近 agent name。

这说明"动态读模型"不是单一能力，而是一组 provider adapter。能走 ACP 的尽量走 ACP；不能走协议的用 CLI list command；都没有的才用静态 fallback。

### Actual Used Model

Multica 也会尽量读出实际执行时使用的模型：

- 如果 task 显式配置模型，则传给 CLI。
- 如果没有显式模型，读取 `MULTICA_<PROVIDER>_MODEL` 环境变量。
- 如果仍为空，则不传 `--model`，让 provider 自己选默认。
- Codex 特别处理：如果 JSON-RPC usage 没有模型，会扫描 Codex session JSONL，从 `turn_context` / `token_count` 中补出 model 和 usage。

主要参考：

- `multica/server/internal/daemon/daemon.go`
- `multica/server/pkg/agent/codex.go`

这个策略对 Bytro 很重要：UI 上的"当前模型"应区分"用户显式选择"、"profile 默认"、"provider 默认"、"执行后探测到的实际模型"。

## Bytro Current Comparison

### Bytro Already Stronger In Agent Semantics

Bytro 已经有比 Multica 更 agent-native 的协作层：

- `AgentOrchestrator` 维护 A2A task graph、mention routing、serial/parallel execution。
- `@mention` 和 `@All` 可以从用户输入或 agent 输出中触发。
- Team policy 控制 capability routing、agent delegation、team membership。
- `InvocationQueue` 提供 priority、idempotency、zombie defense。
- `ReflowOrchestrator` 聚合 parallel child task。
- `ContinuityCapsule` 管理 session seal / handoff / resume。
- `A2A Memory Distiller` 提取跨 agent 协作惯例、决策和失败经验。
- ACP `session/set_model` 已接入 `AgentRuntime.switchModel()`。

主要参考：

- `src/main/ai/orchestrator.ts`
- `src/main/ai/agent-runtime.ts`
- `src/main/ai/invocation-queue.ts`
- `src/main/ai/reflow-orchestrator.ts`
- `src/main/ai/continuity-capsule.ts`
- `src/main/ai/a2a-memory-distiller.ts`

### Bytro Currently Weaker In Runtime Inventory

Bytro 的 provider/runtime 管理目前偏应用内配置：

- `ProviderRegistry` 注册 legacy CLI provider 和 ACP provider。
- `RuntimeResolver` 解决 task override、profile preferred provider、session/base config、system default。
- Legacy provider 的模型列表多为静态配置。
- ACP provider 支持 session-level `getAvailableModels(sessionId)` 和 `setModel(sessionId, modelId)`。
- IPC 已有 `chat:getAvailableModels`、`chat:setModel` 等 session model API。

与 Multica 相比，Bytro 还缺少：

- 独立的 runtime inventory 表或缓存。
- provider binary/version/health 的统一探测。
- pre-session 的动态模型发现。
- 模型发现请求状态机：pending/running/completed/failed/stale。
- 执行后记录 actual model 的统一字段。
- 跨 app restart 可恢复的 durable task lease。

主要参考：

- `src/main/ai/provider-registry.ts`
- `src/main/ai/runtime-resolver.ts`
- `src/main/ai/providers/base-cli-provider.ts`
- `src/main/ai/providers/codex-cli.ts`
- `src/main/ai/acp/acp-provider.ts`
- `src/main/ipc/chat.ts`

## Recommended Borrowing Plan

### R1: Runtime Inventory

新增一个 runtime inventory 层，统一描述本机可用 runtime，而不是只靠 provider registry 的静态配置。

建议字段：

- `provider_id`
- `runtime_type`: `cli | acp | cloud`
- `binary_path`
- `runtime_version`
- `detected_at`
- `last_health_check_at`
- `health`: `available | missing | error | auth_required`
- `model_discovery_status`
- `models_json`
- `actual_default_model`
- `metadata_json`

它可以先是内存缓存，后续再落 SQLite。不要一开始引入外部 daemon；Bytro 仍然是 desktop-local app，main process 可以承担 local daemon 的职责。

### R2: Provider Model Discovery Adapter

给 provider 增加可选能力：

```ts
interface ModelDiscoveryCapableProvider {
  listModels(options?: {
    cwd?: string;
    sessionId?: string;
    timeoutMs?: number;
    forceRefresh?: boolean;
  }): Promise<ModelInfo[]>;
}
```

推荐优先级：

1. ACP `availableModels/currentModelId`
2. provider 官方 `--list-models` / `models` 命令
3. provider config 中的 cached models
4. static fallback models

UI 需要标注模型来源：`live`、`cached`、`static`、`actual-runtime`。

### R3: Actual Model Capture

Bytro 后续 token/usage 统计应增加 actual model 维度：

- task requested model
- resolved model before execution
- actual model observed from provider event/session log
- model source

Codex provider 可借鉴 Multica 的 JSONL session scan。Bytro 目前已经有 provider parser 和 usage 统计，适合把 actual model capture 放进 provider output parser 或 task completion metadata。

### R4: Durable Queue Lease

Bytro 的 `InvocationQueue` 已经有 priority、idempotency 和 zombie defense，但主要还是进程内队列。可以借鉴 Multica 的 durable claim 思路，让 `a2a_tasks` 支持 app restart 后恢复。

建议字段：

- `lease_id`
- `leased_at`
- `lease_expires_at`
- `attempt_count`
- `last_error`
- `runtime_session_id`
- `queue_priority`
- `idempotency_key`

Bytro 不一定需要 `FOR UPDATE SKIP LOCKED`，因为当前是单 desktop app 进程。但 lease model 能让 crash/restart、window reload、任务恢复更稳定。

## What Not To Copy

不要直接复制 Multica 的这些部分：

- Server-first workspace/issue/assignee 模型：Bytro 的核心对象是 conversation/task/workspace，不是 issue tracker。
- 外部 daemon 必选架构：Bytro 现在 main process 就能做本地 runtime control plane。
- 将 Agent 协作退化成多个 assignee 并行：Bytro 已经有更丰富的 A2A graph 和 team policy。
- 单纯为了多用户协作引入云端任务 claim：这会提高部署复杂度，并偏离 desktop-local 的产品优势。

## Design Principles For Bytro

- 保持 Bytro A2A orchestrator 作为协作大脑。
- 借鉴 Multica 的 runtime inventory、model discovery、task lease，而不是产品模型。
- Runtime resolution 不应强制把静态默认模型写死；provider 能自己选择默认时，应允许 model 为空，并在执行后记录 actual model。
- 模型下拉要区分 live discovery、cached discovery 和 static fallback。
- ACP provider 是 Bytro 的长期统一协议方向；legacy CLI provider 用 adapter 补齐能力。
- 任何 runtime 探测都必须有 timeout、错误状态和缓存，避免阻塞 Chat UI。

## Source Map

Multica:

- `server/internal/daemon/config.go` — CLI binary/version/env model discovery.
- `server/internal/daemon/daemon.go` — runtime registration, heartbeat, task polling, model-list handling, task execution.
- `server/internal/handler/daemon.go` — daemon/runtime registration endpoint.
- `server/internal/handler/runtime_models.go` — pending model-list request API.
- `server/internal/service/task.go` — task enqueue/claim/start/complete/fail service.
- `server/pkg/db/queries/agent.sql` — SQL claim semantics.
- `server/pkg/agent/models.go` — provider-specific model discovery.
- `server/pkg/agent/codex.go` — Codex session JSONL usage/model scan.
- `packages/core/runtimes/models.ts` — frontend initiate + poll model discovery.

Bytro:

- `src/main/ai/orchestrator.ts` — A2A orchestration, routing, queue drain, reflow, memory distill.
- `src/main/ai/agent-runtime.ts` — runtime wrapper, known-agent prompt injection, model switching.
- `src/main/ai/invocation-queue.ts` — current in-process priority queue.
- `src/main/ai/runtime-resolver.ts` — provider/model resolution priority.
- `src/main/ai/provider-registry.ts` — provider registration.
- `src/main/ai/acp/acp-provider.ts` — ACP session model list and set model.
- `src/main/ai/providers/base-cli-provider.ts` — legacy CLI execution base.
- `src/main/ai/providers/codex-cli.ts` — current Codex static models and execution.
- `src/main/ipc/chat.ts` — model list / set model IPC surface.
