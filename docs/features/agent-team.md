---
feature: agent-team
status: design
created: 2026-05-05
priority: P1
---

# Feature: AgentTeam — 预配置多 Agent 协作团队

## 问题陈述

当前新建对话是"New Chat"一路到底，没有区分工作模式。A2A @mention 机制已经能委托任意 agent，但：

1. **用户体验缺席**：用户不知道"我现在是在和一个 Claude 还是整个团队聊"
2. **AgentTeam 概念不存在**：没有"预配置团队"这个抽象，每次都要手动 @
3. **Orchestrator 层缺少 pipeline gate**：团队流水线（写代码 → 自动触发 review → 反馈给主 agent）需要编排层的主动触发，@mention 模式无法覆盖
4. **主 Agent 的 system prompt 没有团队感知**：Claude 不知道自己在一个团队里工作，不会主动按流程 @

## 目标

1. 新建对话时，选择工作模式：**Solo**（单 Claude CLI）或 **Team**（预配置团队）
2. 预置一个开箱即用的 DevTeam：Claude（架构师 + 主 coder）→ Codex（reviewer）→ OpenCode（UI 辅助）
3. Team 模式下，orchestrator 在 Claude 完成后自动触发 Codex review，review 结果作为 feedback 回传给 Claude
4. 用户可以在 Settings 里查看/修改团队配置（不是本期，记为 P2）

## 非目标

- 用户自建团队（P2）
- 并行多 agent 同时写代码（写操作并行会产生冲突，暂不支持）
- 超过 3 层的嵌套团队
- AgentTeam 跨对话状态共享

---

## 架构设计

### 核心概念

```
AgentTeamConfig {
  id: string           // 'dev-team'
  name: string         // 'Dev Team'
  description: string
  pipeline: AgentStep[]
}

AgentStep {
  profileId: string    // 对应 agent_profile_configs.id
  role: 'primary' | 'reviewer' | 'specialist'
  trigger: 'always' | 'on-code-change' | 'manual'
  feedbackTo: string | null  // 把结果传回哪个 profileId
}
```

### 预置 DevTeam 定义

```typescript
const DEV_TEAM: AgentTeamConfig = {
  id: 'dev-team',
  name: 'Dev Team',
  description: '主 Claude 写代码，Codex 审查，OpenCode 处理 UI',
  pipeline: [
    {
      profileId: 'claude-primary',
      role: 'primary',
      trigger: 'always',
      feedbackTo: null
    },
    {
      profileId: 'codex-reviewer',
      role: 'reviewer',
      trigger: 'agent-mention',     // 由 Claude 主动 @Codex 触发，不再自动检测文件变更
      feedbackTo: 'claude-primary'  // review 结果作为 feedback 传回 Claude
    },
    {
      profileId: 'opencode-ui',
      role: 'specialist',
      trigger: 'manual',            // 用户显式 @OpenCode 才触发
      feedbackTo: null
    }
  ]
}
```

### 工作流（Team 模式）

```
用户发消息 → Claude (primary)
                 ↓ 完成
            Claude 主动 @Codex 请求 review
                 ↓
            Codex review task 创建
                 ↓ review 完成
            review 结果作为 system message 回传
                 ↓
            Claude 收到 feedback，可继续修改
                 ↓ 用户 @OpenCode
            OpenCode 处理 UI 部分
```

> **设计原则**：Codex 的 review **不由 orchestrator 自动触发**。Claude 的 system prompt 中已注入团队配置，Claude 自主决定在何时 `@Codex` 进行 review。这样避免了对所有文件变更都走一遍 review 的噪音，让 primary agent 根据任务复杂度自行判断。

### Orchestrator 改动

当前 `executeTask` 完成后只调用 `extractMemoryCandidates`。Team 模式下需要额外检查 policy（如文件操作权限等），但 **不再自动触发 review pipeline**：

```typescript
// orchestrator.ts
private async runTeamPolicies(
  completedTask: A2ATask,
  completedProfile: AgentProfile,
  teamConfig: AgentTeamConfig,
  baseConfig: SessionConfig,
  executionMode: ExecutionMode,
  webContents: WebContents
): Promise<void> {
  const conversationId = completedTask.conversationId
  // Auto-trigger on code change removed — review is now agent-initiated via @mention.
  this.fileChangeFlags.delete(conversationId)
}
```

Agent 自主 `@mention` 通过已有的 `runtime.on('mention')` 机制处理，`dispatchIntents` 统一路由。

### 数据库变更

新增 `conversation_team_config` 字段到 conversations 表：

```sql
ALTER TABLE conversations ADD COLUMN team_id TEXT DEFAULT NULL;
-- NULL = solo, 'dev-team' = DevTeam
```

### IPC 变更

```typescript
// 新增 IPC handler
'conversation:create' payload 增加 teamId?: string

// 新增查询
'team:list' → AgentTeamConfig[]
'team:get' → AgentTeamConfig
```

---

## UI 设计

### NewTask 选择器（Home 页 + Sidebar）

替换当前的"New Chat"/"Start New Chat"按钮为 **模式选择器**：

```
┌─────────────────────────────────┐
│  新建任务                        │
│                                  │
│  ○ Solo Agent                   │
│    Claude Code — 单独工作        │
│                                  │
│  ● Dev Team                     │
│    Claude 架构 + Codex 审查      │
│    + OpenCode UI                 │
│                                  │
│  [开始任务]                      │
└─────────────────────────────────┘
```

- 默认选中上次用的模式（持久化到 localStorage）
- Solo 和 Team 选项卡清晰区分，不要用 radio（视觉太弱）
- Team 模式显示团队成员预览（三个 agent 的 avatar/名字）

### 对话列表标识

TaskRail / Sidebar 的对话条目右侧加小图标区分：
- Solo：无图标（默认）
- Team：🤝 或 `[team]` badge

### SharedConversation 面板（Team 模式）

Team 模式下，SharedConversation 面板应该能看到多个 agent 的发言，用 `AgentBadge` 区分。当前这个组件已有 agentBadge，但 Team 模式启动时要确保 badge 在消息流中可见。

---

## 实现计划

### Phase T1：数据层 + 预置团队定义

**文件：**
- `src/main/ai/team-config.ts`（新）— 团队定义，`loadTeams()`, `getTeam(id)`
- `src/main/core/db.ts` — schema 迁移，conversations 加 team_id 字段
- `src/main/ipc/conversation.ts` — `conversation:create` 接受 teamId 参数

**验收：**
- [ ] `window.api.team.list()` 返回 `[{ id: 'dev-team', name: 'Dev Team', ... }]`
- [ ] 创建带 teamId 的对话，DB 正确写入 team_id

### Phase T2：Orchestrator Pipeline

**文件：**
- `src/main/ai/orchestrator.ts` — `runTeamPipeline()`，`checkFileChanges()`，`createPipelineTask()`
- `src/main/ai/a2a-types.ts` — 新增 `pipelineStepId?: string` 到 A2ATask

**关键逻辑：**
```typescript
// executeTask 末尾，task 成功后
if (task.depth === 0) {
  const teamId = this.getConversationTeamId(conversationId)
  if (teamId) {
    const teamConfig = getTeam(teamId)
    if (teamConfig) await this.runTeamPipeline(task, profile, teamConfig, webContents)
  }
}
```

**验收：**
- [ ] Dev Team 模式下，Claude 写完代码后 Codex review task 自动出现在 SubagentStatus
- [ ] Codex review 完成后，review 摘要作为 system_message 出现在对话流中
- [ ] 无文件变更时 Codex 不触发

### Phase T3：UI — NewTask 选择器

**文件：**
- `src/renderer/src/components/NewTaskDialog.tsx`（新）
- `src/renderer/src/components/sidebar/Sidebar.tsx` — 替换 handleNewChat 调用 NewTaskDialog
- `src/renderer/src/pages/Home.tsx` — 替换 "Start New Chat" 按钮

**验收：**
- [ ] 点击"New Chat"/ "Start New Chat"弹出模式选择器
- [ ] 选择 Solo → 创建普通对话
- [ ] 选择 Dev Team → 创建带 team_id 的对话，SharedConversation 面板可见
- [ ] 上次选择的模式被记住（localStorage）

### Phase T4：TaskRail/Sidebar 团队标识

**文件：**
- `src/renderer/src/components/workspace/TaskRail.tsx`
- `src/renderer/src/components/sidebar/Sidebar.tsx`

**验收：**
- [ ] 带 team_id 的对话在列表里有可辨识标识

---

## 边界情况与决策

| 情况 | 处理方式 |
|------|----------|
| Codex review 失败 | 不阻塞，发 system_message 告知，Claude 继续工作 |
| Claude 未 @Codex（无 review）| 允许，Claude 自主决定是否需要 review |
| Solo 模式下手动 @Codex | 正常走现有 A2A 逻辑，不受 team pipeline 影响 |
| 团队中某 agent 未安装（Codex CLI 不存在） | provider init 时检测，启动失败发 system_message |
| feedback loop（Codex review 触发 Claude 修改，再触发 Codex）| 由 Claude 自主控制，通过 chain 检测防止循环 |

---

## 预置 Agent Profiles（需要在 DB 初始化时插入）

> **完整提示词见** [agent-team-prompts.md](./agent-team-prompts.md)。本节只列数据结构。

`AgentProfile` 扩充三个字段支持 agent 互相发现：

```typescript
interface AgentProfile {
  // --- 现有字段 ---
  id: string
  name: string
  role: string
  model: string
  preferredProvider?: string
  systemPrompt: string | null
  // --- 新增字段 ---
  capabilities: string[]   // 能力标签，用于 agent card 展示和未来能力路由
  whenToUse: string        // 一句话：什么时候该调用我（注入给其他 agent）
  outputContract: string   // 期望输出格式描述（注入给调用方）
}
```

```typescript
const PRESET_PROFILES: AgentProfile[] = [
  {
    id: 'claude-primary',
    name: 'Claude',
    role: 'implementation',
    model: 'claude-opus-4-5',
    preferredProvider: 'claude-cli',
    capabilities: ['architecture', 'implementation', 'planning', 'delegation'],
    whenToUse: '所有任务的起点。负责理解需求、制定方案、实现代码、协调团队。',
    outputContract: '[TASK SUMMARY] 包含完成项、变更文件、遗留问题。',
    systemPrompt: `<见 agent-team-prompts.md — Agent 1>`
  },
  {
    id: 'codex-reviewer',
    name: 'Codex',
    role: 'review',
    model: 'codex-latest',
    preferredProvider: 'codex-cli',
    capabilities: ['code-review', 'security-audit', 'quality-gate'],
    whenToUse: '当有代码变更需要质量和安全把关时。由系统自动触发，也可由 Claude 主动委托。',
    outputContract: '[REVIEW SUMMARY] + APPROVED / NEEDS_CHANGES 结论。',
    systemPrompt: `<见 agent-team-prompts.md — Agent 2>`
  },
  {
    id: 'opencode-ui',
    name: 'OpenCode',
    role: 'ui',
    model: 'gpt-4o',
    preferredProvider: 'opencode-cli',
    capabilities: ['ui-implementation', 'css', 'responsive-design', 'interaction'],
    whenToUse: '当需要处理组件样式、布局、响应式设计、交互动画时。由 Claude 主动委托触发。',
    outputContract: '[UI IMPLEMENTATION] 包含修改文件、改动摘要、完整可替换的组件代码。',
    systemPrompt: `<见 agent-team-prompts.md — Agent 3>`
  }
]
```

### Agent 互相发现机制

Claude 的 system prompt 已**静态内嵌**完整的团队成员描述（见 agent-team-prompts.md），包含每个 agent 的调用时机和期望输出。这是设计意图：

- Claude 是唯一需要感知整个团队的 agent（它是协调者）
- Codex 和 OpenCode 角色专一，不需要委托他人，不注入 team member 信息
- 动态 agent card 注入（`AgentRuntime` 层）保留给**用户自定义 agent** 场景（P2），预置团队用静态 prompt 效果更可预期

---

## 相关文件

- `src/main/ai/orchestrator.ts`
- `src/main/ai/a2a-types.ts`
- `src/main/ai/preset-profiles.ts`（新建，包含 PRESET_PROFILES 常量）
- `src/main/core/db.ts`
- `src/renderer/src/components/workspace/TaskRail.tsx`
- `src/renderer/src/components/workspace/SharedConversation.tsx`
- `src/renderer/src/stores/chatStore.ts`
- `docs/features/agent-team-prompts.md` — 完整提示词真相来源
- `docs/features/multi-agent.md`
- `docs/architecture/multi-agent-a2a-orchestration.md`
