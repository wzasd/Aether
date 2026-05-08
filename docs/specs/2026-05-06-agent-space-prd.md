---
status: draft
owner: bytro
created: 2026-05-06
updated: 2026-05-06
doc_kind: product-requirements
priority: P1
version: v4-merged
merged_from:
  - /Users/wangzhao/Documents/agentWorkSpace/catwork/docs/agent-product-prd.md
  - /Users/wangzhao/Documents/agentWorkSpace/catwork/bytro-app/docs/specs/2026-05-06-agent-space-prd.md
related:
  - ../features/agent-team.md
  - ../features/agent-team-prompts.md
  - ../architecture/ai-provider.md
prototype:
  - /Users/wangzhao/.codex/generated_images/019dfbe3-737a-7ac1-9abc-b1387877efd8/ig_044d5f8c766f78440169faf7f3bfb88194a60a80855f8aa421.png
---

# Agent / Runtime / Team / Task PRD

> 合并版结论：采用 `Agent / Runtime / Team / Task` 四层产品模型，但把 Team 的本质定义为平级 `Agent Space`。Team 是用户可理解的产品命名，Space 是内部语义：一组平级 Agent、Runtime 覆盖、协作策略和动态 Task Graph。

## 1. 审核结论

两份 PRD 的方向一致：都认为当前 `AgentProfile`、CLI Provider、Team 配置和 Task 执行关系被绑得太紧，需要拆成四层。

但合并时必须修正几个风险点：

1. `Team.members` 只描述成员关系还不够，必须有 `policies`。否则 `@All`、自主委托、并行、写权限、review gate 都会散落在 orchestrator 里。
2. Agent Card 不应该写回每个 Agent 的 `systemPrompt`。这会污染用户原始 Prompt，也会在 Team 成员变动时制造同步问题。正确做法是运行时 Prompt Composer 动态注入。
3. 执行展示不应是“时间线”。平级协作天然会分叉、回流、交叉审查，产品对象应是 `Task Graph`。
4. 去掉固定 Pipeline 不代表去掉安全策略。`requireReviewOnCodeChange` 仍然需要，但它应是 Space Policy，不是写死 `Claude -> Codex -> Claude`。
5. `AgentProfile.model` 可以迁移期保留，但必须被定义为 `defaultRuntime.modelId` 的兼容快捷字段，最终运行必须统一走 Runtime Resolver。
6. `@All` 必须默认只读 + 思考输出。`@All` 不等于 fullAuto，也不应继承所有 Agent 的写权限。

## 2. 产品定位

CatWork 是一个本地 AI Agent 协作平台。用户创建多个 AI Agent，为它们配置执行后端 Runtime，将它们组成平级协作空间 Team，然后发起 Task。Task 运行过程中，用户和 Agent 都可以通过 `@mention` 调用其他 Agent，平台负责调度、权限、上下文和可视化。

## 3. 四层产品模型

| 层级 | 概念 | 职责 | 一句话定义 |
|---|---|---|---|
| 1 | Agent | 角色身份 | 这个 AI 是谁 |
| 2 | Runtime | 执行后端 | 用哪个引擎跑 |
| 3 | Team / Space | 协作网络 | 哪些 Agent 在一起、边界是什么 |
| 4 | Task | 运行实例 | 这次具体怎么执行 |

用户心智：

```txt
我创建一个任务
  -> 选择 Solo 或 Team
    -> Solo：选一个 Agent
    -> Team：选一个平级协作空间
  -> 选择起始方式和协作模式
  -> 平台解析 Runtime
  -> 运行中生成动态 Task Graph
```

## 4. 产品目标

1. 将 Agent、Runtime、Team、Task 四层概念清晰分离。
2. Team 从固定 Pipeline 改为去中心化 Network。
3. 支持用户直接 `@AgentName`、`@All` 或 `@capability` 发起协作。
4. 支持 Agent 在运行过程中继续 `@mention` 其他 Agent。
5. 通过 Space Policy 管住安全边界，而不是通过硬编码流程管住协作。
6. 提供 Runtime Override Chain，支持 Task、Team Member、Agent、Session、System 五级解析。
7. 用 Task Graph 展示真实执行结构，而不是把所有事件压成线性时间线。

## 5. 非目标

- MVP 不实现多个写权限 Agent 对同一文件的自动冲突合并。
- MVP 不做远程多人协作。
- MVP 不实现复杂的 Agent 自动评分和最优路由模型。
- MVP 不要求完全移除旧 `team_id` / `pipeline` 兼容层。
- MVP 不把 `@All` 设计成批量 fullAuto 执行入口。

## 6. 核心设计决策

### 6.1 Agent 和 Runtime 解耦

Agent 定义身份、能力和工作方式；Runtime 定义执行后端。一个 Agent 可以有默认 Runtime，但在 Team 或 Task 中被覆盖。

### 6.2 Team 是平级协作空间

Team 不再拥有 `role / trigger / feedbackTo` 这类固定流水线字段。Team 只声明成员、成员覆盖配置和协作策略。

内部更准确的名称是 `AgentSpace`：

```txt
Team = AgentSpace 的产品命名
AgentSpace = 平级 Agent 网络 + Runtime 覆盖 + Policy 边界
```

### 6.3 Agent Card 动态注入

平台在运行时把同一 Team 中其他 Agent 的 `whenToUse`、`outputContract`、capabilities 和权限摘要注入到当前 Agent 的最终 prompt 中。

禁止把 Agent Card 持久写回 `systemPrompt`。

### 6.4 Runtime Override Chain

最终 Runtime 由统一 `resolveRuntimeConfig()` 决定：

```txt
Task 临时覆盖
> Team Member 覆盖
> Agent 默认 Runtime
> Session 默认 Runtime
> System 默认 Runtime
```

### 6.5 Mode 不能突破 Policy

Collaboration Mode 是本次 Task 的意图选择。Space Policy 是 Team 的安全上限。Mode 可以更严格，但不能突破 Policy。

### 6.6 Task Graph 是一等对象

每个 Agent 执行都是一个节点，每次 `@mention` / capability routing / feedback 都是一条边。Active Task 应展示动态 Graph，而不是固定 Pipeline 或纯时间线。

## 7. 数据模型

### 7.1 Agent

对应当前代码：`a2a-types.ts -> AgentProfile`  
对应当前表：`agent_profile_configs`

```ts
interface AgentProfile {
  id: string
  workspaceId: string | null
  name: string
  role: string
  description: string | null
  systemPrompt: string | null
  capabilities?: string[]
  whenToUse?: string
  outputContract?: string
  preferredProvider?: string
  model: string
  isEnabled: boolean
  sortOrder: number
}
```

字段语义：

| 字段 | 结论 |
|---|---|
| `systemPrompt` | 只描述 Agent 自身，不应持久写入 Team 成员卡片 |
| `whenToUse` | 用于平台注入，帮助其他 Agent 判断何时 `@` 它 |
| `outputContract` | 用于平台注入，帮助其他 Agent理解返回格式 |
| `capabilities` | 用于 capability routing，例如 `@review`、`@ui` |
| `preferredProvider` | 迁移期兼容字段，语义为默认 Runtime provider |
| `model` | deprecated compatibility field，语义为 `defaultRuntime.modelId` |

长期目标：

```ts
interface AgentProfileV2 {
  id: string
  name: string
  role: string
  description?: string
  systemPrompt?: string
  capabilities: string[]
  whenToUse?: string
  outputContract?: string
  defaultRuntime?: RuntimeBinding
  permissions?: AgentPermission
}
```

### 7.2 Runtime

Runtime 是执行后端，可以是 CLI、ACP、本地服务或云 API。

```ts
interface RuntimeBinding {
  providerId: string
  modelId?: string
  permissionMode?: 'manual' | 'autoEdit' | 'plan' | 'fullAuto'
  workingDirPolicy?: 'workspace' | 'worktree' | 'readonly'
  providerOptions?: Record<string, unknown>
}
```

对应当前表：

| 表 | 作用 |
|---|---|
| `provider_configs` | 非敏感配置，如 enabled、binary_path、extra_env |
| `secrets` | API Key 等敏感信息 |

### 7.3 Team / AgentSpace

当前 `AgentTeamConfig.pipeline` 需要演进为 `members + policies`。

待废弃模型：

```ts
interface AgentStep {
  profileId: string
  role: 'primary' | 'reviewer' | 'specialist'
  trigger: 'always' | 'on-code-change' | 'manual'
  feedbackTo: string | null
}
```

目标模型：

```ts
interface AgentSpace {
  id: string
  name: string
  description: string
  members: AgentSpaceMember[]
  policies: AgentSpacePolicy
}

interface AgentSpaceMember {
  id: string
  agentProfileId: string
  runtimeOverride?: RuntimeBinding
  permissions?: AgentPermission
  isEnabled: boolean
  sortOrder: number
}

interface AgentSpacePolicy {
  allowAgentMention: boolean
  allowParallelThinking: boolean
  allowCapabilityRouting: boolean
  allowAgentToDelegate: boolean
  requireReviewOnCodeChange: boolean
  maxParallelAgents: number
  writeMode: 'single-writer' | 'multi-writer-with-approval'
}
```

删除 / 替换规则：

| 原字段 | 处理 | 原因 |
|---|---|---|
| `AgentStep.role` | 删除 | 角色属于 Agent，不属于 Team step |
| `AgentStep.trigger` | 删除 | 固定触发会把 Team 拉回 Pipeline |
| `AgentStep.feedbackTo` | 删除 | feedback 应通过 Task Graph 边表达 |
| `pipeline` | 替换为 `members` | Team 是无序平级网络 |
| `runTeamPipeline` | 迁移为 Policy / routing guard | 自动 review 是策略，不是固定流水线 |

### 7.4 Task / Task Graph

当前 `A2ATask` 可以作为 Task Node 的兼容基础。

```ts
interface AgentTaskNode {
  id: string
  conversationId: string
  spaceId?: string
  parentNodeId?: string
  fromProfileId: string | null
  toProfileId: string
  instruction: string
  contextSnapshot?: string
  status: 'pending' | 'working' | 'completed' | 'failed'
  depth: number
  chain: string[]
  executionMode: 'serial' | 'parallel'
  runtime?: RuntimeBinding
  result?: string
}

interface AgentTaskEdge {
  id: string
  conversationId: string
  fromNodeId?: string
  toNodeId: string
  edgeType: 'user-mention' | 'agent-mention' | 'capability-route' | 'feedback' | 'policy-review'
  label?: string
}
```

Task 级 Runtime 覆盖：

```ts
interface TaskRuntimeOverride {
  providerId?: string
  modelId?: string
  permissionMode?: PermissionMode
}
```

## 8. 核心机制

### 8.1 Prompt Composer

平台每次启动 Agent 前动态组装最终 prompt。**所有 task（含 primary）都必须注入 context snapshot**，不可跳过。

组装顺序：

```txt
Agent 自身 systemPrompt
> Space 成员 Agent Cards
> Space Policy 摘要
> Collaboration Mode 指令
> Runtime / 权限约束提示
> Context Snapshot / Memory        ← 强制：所有 task node 必须携带
> User Instruction
```

Context Snapshot 覆盖范围：

| Task 类型 | 来源 | 必须 |
|-----------|------|:---:|
| Primary task (depth=0) | `sendUserMessage` | ✅ |
| User 初始 @mention | `routeUserInitialMentions` → `routeMention` | ✅ |
| Agent @mention 委托 | `routeMention` | ✅ |
| @All 展开 | `routeMention` @All 分支 | ✅ |
| Pipeline step（兼容期） | `runTeamPipeline` | ✅ |
| Review policy 触发 | `runTeamPipeline` policy-review | ✅ |
| Feedback 回传 | `executePipelineStep` feedbackTo | ✅ |

Agent Card 示例：

```txt
当前协作空间成员：

@Codex Reviewer (code-review)
能力：code-review, security-audit, quality-gate
调用时机：当代码变更需要质量和安全审查时
输出契约：[REVIEW SUMMARY] + APPROVED / NEEDS_CHANGES
权限：read-only, review
用法：@Codex Reviewer: 请审查这次 diff 的安全风险。
```

规则：

- Solo 模式默认不注入其他 Agent Cards。
- Team 模式注入当前 Team 的启用成员。
- Preset Profile 中的静态 teammate 描述只能作为示例，运行时以 Space 注入为准。
- 用户自定义 Profile 不需要知道其他 Agent，平台必须注入。
- 注入内容需要长度限制，避免挤占核心任务上下文。

### 8.2 Mention 自主路由

Agent 或用户可以写：

```txt
@Codex Reviewer: 请审查这次 diff。
@OpenCode UI: 请评估设置页的信息层级。
@review 请检查安全风险。
@All 请从各自角度给出方案。
```

路由步骤：

1. 解析多个 mention。
2. 去重，同一输出中同一目标只触发一次。
3. 限制目标在当前 Team 成员内。
4. 通过 Policy Guard 检查是否允许。
5. 通过 Runtime Resolver 解析实际执行后端。
6. 构造 context snapshot。
7. 创建 Task Node 和 Edge。
8. 按 executionMode / Policy 决定 serial 或 parallel。

### 8.3 防循环机制

| 机制 | 实现 |
|---|---|
| chain 追踪 | `task.chain: string[]` |
| loop 检测 | `chain.includes(toProfileId)` |
| depth 限制 | 默认最大 5 |
| task 数限制 | 默认单对话最大 20 |
| mention 去重 | 单轮输出同名 Agent 只触发一次 |

### 8.4 Capability Routing

能力路由允许用户或 Agent 不指定具体成员，而指定能力。

```txt
@review 请审查这次变更。
@ui 请给出设置页交互建议。
@security 请检查权限风险。
```

匹配规则：

1. 在当前 Team 启用成员中查找 matching capabilities。
2. 如果只有一个候选，直接路由。
3. 如果多个候选，按 Space member sortOrder、Runtime 可用性、权限和负载排序。
4. 如果无法自动决策，向用户展示选择器。
5. 如果没有候选，发送 system message。

### 8.5 Collaboration Mode 与 Policy

Mode 是本次任务的意图：

| Mode | 行为 |
|---|---|
| Direct | 只启动用户明确 `@` 的 Agent |
| Explore | 多 Agent 平级发散，默认只读，平台聚合 |
| Build | 允许 Agent 继续 `@`，可以产出实现 |
| Review | 只启动 review / audit 类 Agent |

Policy 是 Team 的边界：

| Policy | 含义 |
|---|---|
| `allowAgentMention` | 是否允许 Agent 自主 `@` |
| `allowParallelThinking` | 是否允许并行发散 |
| `allowCapabilityRouting` | 是否允许 `@review` 这类能力路由 |
| `requireReviewOnCodeChange` | 代码变更后是否需要 review |
| `maxParallelAgents` | 最大并行 Agent 数 |
| `writeMode` | 写权限策略 |

关系：

- Mode 不能突破 Policy。
- Mode 可以比 Policy 更严格。
- Policy 是 Space-level guard。
- Mode 是 Task-level constraint。

### 8.6 @All 安全规则

`@All` 默认展开当前 Team 中所有启用 Agent，但全部以只读 + 思考输出启动。

规则：

- `@All` 不授予写权限。
- `@All` 不等于 fullAuto。
- `@All` 不继承每个 Agent 的默认写权限。
- 任一 Agent 要写文件、删文件、改依赖或执行高风险命令，必须触发权限确认。
- Explore Mode 下，`@All` 输出只进入方案聚合，不自动应用变更。

### 8.7 Review Policy

去中心化 Team 不再写死 `on-code-change -> Codex -> feedbackTo Claude`，但 review 仍然可以作为 Policy 存在。

如果 `requireReviewOnCodeChange = true`：

1. 写权限 Agent 修改文件后，平台标记当前 Task Graph 为 `review_required`。
2. 平台优先通过 capability routing 找 `code-review` Agent。
3. Review 节点通过 `policy-review` edge 接入 Task Graph。
4. Review 结果不固定回传某个 Primary，而是进入 Graph，用户和相关 Agent 都可见。
5. 是否阻塞任务完成由后续 `reviewGateMode` 决定，MVP 可先做提示不强阻塞。

### 8.8 Runtime Resolver

伪代码：

```ts
function resolveRuntimeConfig(input: {
  taskOverride?: RuntimeBinding
  teamMemberOverride?: RuntimeBinding
  agentDefault?: RuntimeBinding
  compatibilityProfile?: { preferredProvider?: string; model?: string }
  sessionDefault?: RuntimeBinding
  systemDefault: RuntimeBinding
}): RuntimeBinding {
  return (
    input.taskOverride ??
    input.teamMemberOverride ??
    input.agentDefault ??
    fromCompatibilityFields(input.compatibilityProfile) ??
    input.sessionDefault ??
    input.systemDefault
  )
}
```

要求：

- `AgentRuntime.start()` 不再直接用 `profile.preferredProvider || config.providerType` 作为最终选择。
- Active Task Node 必须记录 resolved runtime。
- Runtime 不可用时进入 `waiting` 或 `failed`，并提供修复入口。

## 9. 产品界面

### 9.1 信息架构

```txt
Settings
├── Agents      管理 AI 角色
├── Runtimes    管理执行后端
├── Teams       管理平级协作空间
└── Policies    管理全局安全默认值
```

### 9.2 Agents 页面

列表展示：

- Agent 名称、角色、能力标签。
- 默认 Runtime。
- 启用状态。
- 是否可被 `@mention`。

编辑表单：

- `name`
- `role`
- `description`
- `systemPrompt`
- `whenToUse`
- `outputContract`
- `capabilities`
- `defaultRuntime`
- `isEnabled`

### 9.3 Runtimes 页面

展示所有 Provider / Runtime：

- 名称、类型、状态。
- CLI binary path。
- API Key 状态。
- 可用模型。
- Permission mode 支持。
- Test connection。

Runtime 类型：

| 类型 | 说明 |
|---|---|
| CLI | 本地命令行工具 |
| ACP | Agent Communication Protocol backend |
| Cloud | 云端 API |

### 9.4 Teams 页面

Team 页面展示平级网络，而非 Pipeline。

必须包含：

- Team 名称和描述。
- 成员 Agent 网格。
- 每个成员的 Runtime Override。
- 每个成员的权限覆盖。
- Team Policy 设置。
- 网络拓扑可视化，节点无主从层级。

页面文案：

```txt
Agent 会根据任务和上下文自主 @ 其他成员。这里配置的是成员、权限和边界，不是执行顺序。
```

### 9.5 New Task 页面

Mode 选择：

- Solo Agent
- Team

Solo 模式：

- 横向图标选择器选择 Agent。
- Hover 展开显示 Agent 名称、角色、默认 Runtime。
- 支持本次任务 Runtime Override。

Team 模式：

- 横向图标选择器选择 Team。
- Hover 展开显示 Team 名称、成员数、Policy 摘要。
- 展示 Team 成员 chips。
- 选择 Collaboration Mode：Direct / Explore / Build / Review。
- 开关：允许 Agent 继续 `@` 其他 Agent。
- 支持自定义起始 `@mention`。

横向选择器建议：

- 默认圆形图标 48x48。
- Hover 展开到约 180px，显示名称和 Runtime / 成员数。
- 选中态用边框和小圆点。
- 必须支持键盘导航。

### 9.6 Active Task

Active Task 展示动态 Task Graph。

节点：

- User。
- Agent Task。
- Tool Call。
- Review。
- Feedback。

边：

- user mention。
- agent mention。
- capability route。
- policy review。
- feedback。

节点状态：

- pending。
- thinking。
- running。
- waiting。
- completed。
- failed。

节点详情：

- instruction。
- context snapshot。
- resolved runtime。
- permission mode。
- tool calls。
- output。
- related files。

### 9.7 Shared Conversation

Shared Conversation 仍是文本主通道，但必须支持多 Agent 平级协作：

- 每条 Agent 消息显示 AgentBadge。
- Composer 支持多个 `@mention`。
- Agent 消息中的 `@mention` 可触发子任务。
- 消息可以跳转到 Task Graph 节点。
- Graph 节点可以反向定位消息。

## 10. IPC / API

### 10.1 Agent APIs

| Channel | Params | Return | 状态 |
|---|---|---|---|
| `agent:listProfiles` | `workspaceId?` | `AgentProfile[]` | 已实现 |
| `agent:createProfile` | profile input | `AgentProfile` | 已实现，需补齐 capability/defaultRuntime 语义 |
| `agent:updateProfile` | `id, patch` | `AgentProfile` | 已实现，需补齐 validation |
| `agent:deleteProfile` | `id` | `void` | 已实现 |

### 10.2 Runtime APIs

| Channel | Params | Return | 状态 |
|---|---|---|---|
| `provider:list` | none | Provider status list | 已实现 |
| `provider:configure` | provider config | `void` | 已实现或部分实现 |
| `provider:setApiKey` | `providerId, key` | `void` | 已实现 |
| `provider:testConnection` | `providerId` | `{ ok, version?, error? }` | 需要统一 |

### 10.3 Team / Space APIs

| Channel | Params | Return | 状态 |
|---|---|---|---|
| `team:list` | none | `AgentSpace[]` | 当前硬编码，需持久化 |
| `team:get` | `id` | `AgentSpace | null` | 当前硬编码，需持久化 |
| `team:create` | `{ name, description, members, policies }` | `AgentSpace` | 待实现 |
| `team:update` | `id, patch` | `AgentSpace` | 待实现 |
| `team:delete` | `id` | `void` | 待实现 |
| `team:addMember` | `teamId, member` | `AgentSpace` | 待实现 |
| `team:removeMember` | `teamId, memberId` | `AgentSpace` | 待实现 |

### 10.4 Task Graph APIs

| Channel | Params | Return | 状态 |
|---|---|---|---|
| `task:createNode` | node input | `AgentTaskNode` | 可由现有 A2A 兼容 |
| `task:getActiveGraph` | `conversationId` | `{ nodes, edges }` | 待实现 |
| `task:abortNode` | `nodeId` | `void` | 待实现 |
| `task:abortGraph` | `conversationId` | `void` | 当前 abort 可演进 |

## 11. 数据库建议

MVP 可以先兼容旧表，但目标结构如下。

```sql
CREATE TABLE agent_spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  policies_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE agent_space_members (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES agent_spaces(id) ON DELETE CASCADE,
  agent_profile_id TEXT NOT NULL REFERENCES agent_profile_configs(id) ON DELETE CASCADE,
  runtime_override_json TEXT,
  permissions_json TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE agent_task_nodes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  space_id TEXT,
  parent_node_id TEXT,
  from_agent_profile_id TEXT,
  to_agent_profile_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  chain TEXT NOT NULL DEFAULT '[]',
  execution_mode TEXT NOT NULL DEFAULT 'serial',
  runtime_json TEXT,
  context_snapshot TEXT,
  result TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE TABLE agent_task_edges (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_node_id TEXT,
  to_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

兼容规则：

- `conversations.team_id` 迁移期继续保留，UI 展示为 Team / Space。
- `a2a_tasks` 可以作为 `agent_task_nodes` 的兼容实现。
- 旧 `pipeline` 配置可转换为 members，`trigger/feedbackTo` 不进入新模型。
- 旧 DevTeam 的自动 review 行为转为 `requireReviewOnCodeChange` policy。

## 12. 用户故事

### US-1 创建 Agent

用户可以创建 Agent，定义角色、提示词、能力、调用时机、输出契约和默认 Runtime。

验收：

- 可填写 `name / role / systemPrompt / whenToUse / outputContract / capabilities`。
- 可选择默认 Runtime。
- 创建后出现在 Agent 列表和 Team 成员候选中。
- Agent 名称在同一 workspace 或全局范围内避免冲突。

### US-2 配置 Runtime

用户可以注册或配置 CLI / ACP / Cloud Runtime。

验收：

- 可查看 Runtime 是否安装、是否有 API Key。
- 可配置 binary path / extra env。
- 可测试连接。
- Runtime 可被 Agent、Team Member、Task 引用。

### US-3 创建 Team 网络

用户可以创建 Team，添加多个平级 Agent，并配置成员 Runtime 覆盖和 Policy。

验收：

- Team 不设置 `role / trigger / feedbackTo`。
- 可添加/移除成员。
- 可为成员配置 Runtime Override。
- 可配置 Space Policy。
- 页面提示 Team 是协作网络，不是执行顺序。

### US-4 发起 Task

用户可以选择 Solo 或 Team 发起任务，并选择 Collaboration Mode。

验收：

- Solo 可选单个 Agent。
- Team 可选协作空间。
- 可临时覆盖 Runtime。
- 可输入多个 `@mention`。
- Task 开始后展示 Task Graph。

### US-5 Agent 自主路由

Agent 可以通过 `@AgentName: instruction` 委托其他 Agent。

验收：

- mention 被解析并生成 Task Node / Edge。
- 路由目标限制在当前 Team 内。
- loop / depth / task count guard 生效。
- Policy 禁止时不触发，并显示提示。

### US-6 运行时 Agent Card 注入

Team 模式下，平台运行时注入其他成员的 Agent Card。

验收：

- 不修改数据库里的 `systemPrompt`。
- 注入内容来自当前 Team 成员。
- 用户自定义 Profile 也能获得注入。
- Preset Prompt 与注入冲突时，以注入为准。

### US-7 @All 发散

用户可以 `@All` 让所有成员并行给出观点。

验收：

- 默认只读 + 思考输出。
- 写操作必须触发权限确认。
- Explore Mode 不自动应用变更。
- 输出进入 Task Graph 并可被聚合查看。

## 13. MVP 范围

### In

- Agent CRUD 补齐 `whenToUse / outputContract / capabilities`。
- Runtime Resolver 统一入口。
- Team 从 hardcoded pipeline 演进到 members + policies。
- Dev Team 迁移为 Dev Space。
- Prompt Composer 动态注入 Agent Cards。
- 用户和 Agent 多 `@mention` 路由。
- `@All` 只读发散。
- Active Task 基础 Graph 视图。
- 防 loop / depth / task count。
- Review policy 基础状态。

### Out

- 高级 Team 拖拽拓扑编辑。
- 多写 Agent 自动冲突合并。
- 全自动最佳 Agent 选择评分系统。
- 跨项目共享 Team。
- Agent prompt 模板市场。

## 14. 实施路线图

### Phase 1：Agent / Runtime / Solo Task

- Agent 表单补齐 capabilities、whenToUse、outputContract。
- Runtime Resolver。
- `AgentProfile.model` / `preferredProvider` 兼容映射。
- Solo Task 走 resolved runtime。
- 横向 Agent 选择器。

### Phase 2：Team Network

- Team 持久化。
- `pipeline -> members + policies`。
- Dev Team 兼容迁移。
- Team member Runtime Override。
- Team 选择器。

### Phase 3：Prompt Composer 与 Mention Guard

- Space-aware Prompt Composer。
- Agent Card 运行时注入。
- Policy Guard。
- 多 mention 去重。
- capability mention 基础版。

### Phase 4：Task Graph

- Node / Edge 数据结构。
- Active Task Graph UI。
- 消息与节点互跳。
- Review policy edge。

### Phase 5：体验增强

- Team 网络拓扑视图。
- Graph 动画和筛选。
- Task 级 Runtime Override UI。
- ACP Runtime 扩展。

## 15. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | mention routing 交互延迟 < 100ms；Prompt Composer 不阻塞 UI |
| 安全 | API Key 加密；IPC 输入校验；写操作受权限控制 |
| 可靠性 | loop/depth/task count guard 必须在 main process 生效 |
| 可扩展性 | Runtime 类型可扩展；Team member 不假设固定角色 |
| 可用性 | Agent/Team 横向选择器支持键盘导航 |
| 可观察性 | 每个 Task Node 记录 resolved runtime、status、result |

## 16. 验收标准

1. 用户可以创建或查看 Dev Space，成员以平级 Agent 展示。
2. Team 配置不再要求 `role / trigger / feedbackTo`。
3. 用户可以在 New Task 中输入多个 `@mention`。
4. Agent 输出 `@OtherAgent: ...` 后，平台能创建子任务节点。
5. Policy 禁止 Agent 自主委托时，mention 不触发并显示提示。
6. `@All` 默认不能写文件；写操作必须权限确认或阻止。
7. Runtime 解析遵守 Task > Team Member > Agent > Session > System。
8. `AgentRuntime.start()` 不再直接绕过 Runtime Resolver。
9. Team 模式下 Agent Cards 运行时注入，不写回 `systemPrompt`。
10. Active Task 展示 Graph，能看到节点、边、状态和 resolved runtime。**每个 task node 启动时必须携带 context snapshot（TASK HANDOFF + 相关消息 + 项目记忆 + 文件变更 + 任务进度）。**
11. 代码变更后，如果开启 Review Policy，Graph 中出现 review required / review running / review completed 状态。
12. 旧 Dev Team 固定 Pipeline 在迁移期仍可兼容运行，直到 Dev Space 稳定。

## 17. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 去掉 Pipeline 后自动 review 行为丢失 | 用户失去质量门 | 用 `requireReviewOnCodeChange` policy 替代固定 trigger |
| Agent Card 注入过长 | Token 成本增加 | 限制 whenToUse / outputContract 长度，按 mode 精简注入 |
| Agent 不按 mention 格式输出 | 路由失败 | 注入格式示例，提供容错解析和手动重试 |
| Team 只有 members 没有 policies | 安全逻辑分散 | MVP 必须加入基础 policies |
| 多 Agent 写同一文件 | 冲突和覆盖 | MVP 默认 single-writer 或写操作审批 |
| Runtime Override 层级多 | 用户困惑 | Active Task 节点展示 resolved runtime 和来源 |

## 18. 开放问题

1. Review Policy 是强制阻塞任务完成，还是只作为风险提示？
2. Capability Routing 多候选时默认自动选，还是让用户确认？
3. Agent 输出中的 `@mention` 是否总是自动触发，还是高风险任务需要用户批准？
4. Explore Mode 是否需要 Synthesizer 节点聚合多 Agent 输出？
5. Team 是否在 UI 上继续叫 Team，还是逐步改叫 Space / Agent Space？

## 19. 产品原则

- Agent 平级：产品视觉和调度模型不预设主从关系。
- Runtime 独立：Agent 是角色，Runtime 是后端，两者可组合但不等同。
- Policy 管边界：平台不硬编码流程，但必须硬编码安全边界。
- Graph 表真实：真实协作结构用 Task Graph 表示，不伪装成线性 pipeline。
- Prompt 不污染：用户原始 `systemPrompt` 不被 Team 注入改写。
- 用户可控：用户可以指定起点、限制委托、查看每个节点的输入输出和 Runtime。
