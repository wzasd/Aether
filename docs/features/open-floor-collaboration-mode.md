# bytro-app Open Floor 协作模式 — 产品需求文档

> 版本: v1.0  
> 日期: 2026-05-08  
> 作者: @需求文档师  
> 相关任务: #6

---

## 目录

1. [概述](#1-概述)
2. [问题陈述](#2-问题陈述)
3. [场景矩阵](#3-场景矩阵)
4. [协作模式设计](#4-协作模式设计)
5. [权限方案](#5-权限方案)
6. [技术规格](#6-技术规格)
7. [UI 设计](#7-ui-设计)
8. [实施计划](#8-实施计划)
9. [测试用例](#9-测试用例)
10. [验收标准](#10-验收标准)
11. [风险与缓解](#11-风险与缓解)

---

## 1. 概述

bytro-app 当前只有一种协作模式：**中心化编排（Orchestrated）**。在该模式下，Orchestrator 控制所有 Agent 的任务分配、执行顺序和上下文传递，适用于代码实现、Bug 修复等有明确输入输出的场景。

然而，在**头脑风暴、方案探索、需求澄清、架构讨论**等"发散型"场景中，中心化编排存在以下问题：
- Orchestrator 不可能事前知道"谁会有好想法"
- 单一路由限制了多视角碰撞
- Context Packet 的 token 预算无法容纳多个 Agent 的独立观点
- 过早收敛扼杀了意外发现

本 PRD 提出新增 **Open Floor（自由讨论）协作模式**，与现有的 Orchestrated 模式形成双模式体系：
- **Open Floor**：去中心化，多 Agent 自由参与，人类在场审计
- **Orchestrated**：中心化，Orchestrator 编排，Policy Gate 防护

两种模式共享同一套底层基础设施，通过 `CollaborationMode` 切换。

---

## 2. 问题陈述

### 2.1 当前痛点

| 痛点 | 场景 | 影响 |
|------|------|------|
| 单一路由 | 头脑风暴时 Orchestrator 只能分配给一个 Agent | 其他 Agent 的好点子被扼杀 |
| Context Packet 溢出 | 多个 Agent 的观点需要同时注入 | 4000 token 不够，关键信息丢失 |
| 过早收敛 | Orchestrator 按规则匹配 "最佳" Agent | 非预期视角被过滤 |
| 确认疲劳 | 每个工具调用都要弹窗确认 | 用户机械点允许，不真正审查 |
| 缺乏讨论氛围 | Agent 按序执行，没有互相碰撞 | 像流水线，不像团队讨论 |

### 2.2 目标

1. 让 bytro-app 支持**两种协作模式**，用户按场景选择
2. Open Floor 模式下实现**零确认疲劳**（人类在场 = 审计者）
3. Orchestrated 模式下保留**结构化执行**和**安全边界**
4. 模式切换时**上下文不丢失**，讨论成果可转化为执行任务
5. 两种模式共享同一套**Agent 配置、记忆系统、可观测性日志**

---

## 3. 场景矩阵

### 3.1 模式-场景匹配

| 场景 | Orchestrated | Open Floor | 理由 |
|------|-------------|------------|------|
| 代码实现 💻 | ✅ 强适合 | ❌ 不适合 | 有明确输入/输出，需按序执行 |
| 代码审查 👁️ | ✅ 适合 | ✅ 也适合 | 单 Agent 审查可，多视角更好 |
| Bug 修复 🐛 | ✅ 强适合 | ⚠️ 适合诊断 | 需追踪根因、验证修复 |
| 头脑风暴 🧠 | ❌ 不适合 | ✅ 强适合 | 无正确答案，需多角度发散 |
| 架构讨论 🏗️ | ⚠️ 适合小规模 | ✅ 强适合 | 需多视角碰撞 |
| 需求澄清 📋 | ❌ 不适合 | ✅ 强适合 | 需多方提问、挖掘隐含需求 |
| 技术选型 🔍 | ⚠️ 可以 | ✅ 强适合 | 各抒己见，再投票决策 |
| 故障排查 🐛🔍 | ⚠️ 先定位 | ✅ 强适合 | 多方猜测，碰撞出根因 |
| 文档撰写 📝 | ✅ 强适合 | ❌ 不适合 | 有明确结构和产出物 |
| 学习/问答 📚 | ✅ 适合 | ✅ 也适合 | 简单问题直接回答，复杂问题讨论 |

### 3.2 自动推断规则

系统根据用户消息内容自动推荐协作模式（用户可覆盖）：

```
关键词推断：
  "brainstorm" / "讨论" / "explore" / "想想" / "方案" / "怎么设计"
  → 推荐 Open Floor

  "实现" / "写" / "fix" / "refactor" / "review"（单 Agent）
  → 推荐 Orchestrated

@mention 推断：
  ≥2 个不同 Agent → 推荐 Open Floor
  1 个 Agent 或 无 → 推荐 Orchestrated

模糊时：
  → 弹出模式选择器让用户确认
```

---

## 4. 协作模式设计

### 4.1 Orchestrated 模式（现有，不变）

```
用户消息
    │
    ▼
Intent Parser → 提取 @mention + 指令
    │
    ▼
Capability Routing → 匹配 Agent 能力
    │
    ▼
Policy Gate → allowAgentToDelegate / maxDepth / teamMembership
    │
    ▼
Routing Planner → 生成 task chain（serial / parallel）
    │
    ▼
Orchestrator → 逐个/并行 executeTask
    │
    ▼
ContextSelector → 组装 Context Packet（2000 token）
    │
    ▼
Agent Runtime → 执行 + 工具调用（permission_request）
    │
    ▼
反馈 → 更新 task status / 回调 callbackTo
```

**特点**：
- 严格的任务链（chain tracking）
- 精选上下文（Context Packet）
- 工具调用需 permission_request
- Zombie defense + ContinuityCapsule

### 4.2 Open Floor 模式（新增）

```
用户消息（选择 Explore 模式）
    │
    ▼
Orchestrator 检测 collaborationMode === 'open_floor'
    │
    ▼
executeOpenFloor(message, config)
    │
    ├── 1. 组装完整 conversation 上下文（非精选）
    │
    ├── 2. 广播给所有 enabled Agent
    │       │
    │       ├── Agent A: onObservation() → assessRelevance()
    │       │     score > 0.3 → generateReply()
    │       │     score < 0.3 → 静默
    │       │
    │       ├── Agent B: 同上
    │       │
    │       └── Agent C: 同上
    │
    ├── 3. 收集自愿回复（5 分钟窗口）
    │
    └── 4. 所有回复作为独立 message 展示
```

**特点**：
- 无任务链（no chain tracking）
- 完整上下文（full conversation history）
- Agent 自主判断是否介入
- 只读工具，无 permission_request
- 人类在场 = 审计者

### 4.3 两种模式对比

| 维度 | Orchestrated | Open Floor |
|------|-------------|------------|
| 任务分配 | Orchestrator 单路分配 | 广播给所有 Agent |
| 上下文 | Context Packet（2000 token 精选） | Full conversation history |
| Agent 介入 | 被动（被分配才执行） | 主动（自主判断 relevance） |
| 并发控制 | InvocationQueue 串行化 | 自由回复（时间戳排序） |
| 工具权限 | 全工具（permission_request） | 只读工具（无弹窗） |
| 任务链 | 有 chain / depth / callback | 无 chain 概念 |
| 记忆沉淀 | afterTaskComplete 自动 | Agent 主动调 remember |
| UI 展示 | 流水线进度条 | 多 Agent 独立卡片 |
| 适合 | 明确任务、代码实现 | 头脑风暴、方案讨论 |

### 4.4 模式切换

```
Phase 1: Open Floor（发散）
  用户: "brainstorm 用户认证方案"
  → Planner + Coder + Reviewer 同时输出观点
  → 用户看到 3 个角度的建议

Phase 2: 用户决策
  用户: "采用 Planner 的方案，Coder 来实现"
  → 点击 "基于此结论开始编排执行"
  → 弹出权限确认对话框

Phase 3: Orchestrated（收敛）
  → Orchestrator 创建 A2A task chain
  → Planner 设计 → Coder 实现 → Reviewer 审查
  → 进入现有 A2A pipeline
```

**切换时的上下文传递**：
- Open Floor 的 conversation 历史自动成为 Orchestrated 的上下文
- SummarizePanel 展示讨论摘要，用户确认后进入执行
- 不需要手动复制粘贴

---

## 5. 权限方案

### 5.1 三层权限架构

```
┌─────────────────────────────────────────────────┐
│ Layer 3: 系统级（全局，永不关闭）                  │
│ · 文件系统只读/读写隔离                            │
│ · 网络访问白名单                                  │
│ · API 调用限频                                    │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│ Layer 2: 任务级（orchestrated 模式）              │
│ · AgentSpacePolicy（allowAgentToDelegate 等）    │
│ · Capability routing 校验                        │
│ · A2A 委托深度限制（MAX_DELEGATION_DEPTH=5）     │
│ · permission_request 逐个确认                     │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────┐
│ Layer 1: 频道级（open_floor 模式）                │
│ · 人类在场 = 审计者                               │
│ · Agent 只发文本，不写文件、不执行命令              │
│ · 无 policy gate、无 permission_request           │
└─────────────────────────────────────────────────┘
```

### 5.2 PermissionMode 扩展

```typescript
type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto' | 'trusted'

// 新增 'trusted' 模式（借鉴 Slock）
// · 跳过所有 permission_request 弹窗
// · Agent 自由读写文件
// · 操作记录在 observability JSONL 日志中（事后审计）
// · 用户可随时切回 manual 模式
```

### 5.3 模式-权限映射

| 协作模式 | 默认 PermissionMode | 可更改？ |
|---------|-------------------|---------|
| Open Floor | `trusted`（强制） | ❌ 不可改 |
| Orchestrated | `autoEdit` | ✅ 用户自选 |

### 5.4 Open Floor 下的工具限制

```typescript
// Open Floor 模式下允许的工具（只读）
const OPEN_FLOOR_ALLOWED_TOOLS = [
  'read_file',
  'search_memory',
  'search_history',
  'read_summary',
]

// Open Floor 模式下禁止的工具（需权限）
const OPEN_FLOOR_FORBIDDEN_TOOLS = [
  'write_file',
  'execute_shell',
  'call_api',
  'modify_db',
]

// Agent 请求 forbidden tool → 自动拒绝
// 提示: "此工具在自由讨论模式下不可用，请在编排模式下使用"
```

### 5.5 产出物审查 vs 步骤审查

| 审查方式 | 效果 | 适用场景 |
|---------|------|---------|
| 步骤审查（弹窗 × N） | 确认疲劳 | 高危操作（生产部署） |
| 产出物审查（in_review） | 有效把关 | 代码、文档、设计稿 |

**原则**：
- Open Floor：纯讨论 → 无审查（trusted 模式）
- Orchestrated 代码实现：产出物审查（Reviewer 输出 → 用户看）
- Orchestrated 高危操作：步骤审查（permission_request）

---

## 6. 技术规格

### 6.1 类型定义

```typescript
// a2a-types.ts — 新增

export type CollaborationMode = 'orchestrated' | 'open_floor'

export type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto' | 'trusted'

export interface ConversationConfig {
  id: string
  collaborationMode: CollaborationMode
  permissionMode: PermissionMode
  executionMode: 'serial' | 'parallel'  // orchestrated 模式下生效
  teamId: string
  // ... 现有字段
}

export interface Observation {
  conversationId: string
  message: string
  context: ConversationMessage[]  // 完整 conversation 历史
  collaborationMode: 'open_floor'
}

export interface OpenFloorResponse {
  agentId: string
  agentName: string
  content: string
  timestamp: number
  relevanceScore: number
}

export interface OpenFloorState {
  conversationId: string
  status: 'active' | 'closing' | 'closed'
  startTime: number
  endTime?: number
  responses: OpenFloorResponse[]
  pendingAgents: string[]  // 尚未回复的 Agent
  skippedAgents: string[]  // 决定不回复的 Agent
}
```

### 6.2 Orchestrator 扩展

```typescript
// orchestrator.ts — 新增 executeOpenFloor 方法

class AgentOrchestrator {
  private openFloorStates = new Map<string, OpenFloorState>()

  async dispatchIntents(userMessage: string, config: ConversationConfig) {
    if (config.collaborationMode === 'open_floor') {
      return this.executeOpenFloor(userMessage, config)
    }
    
    // 现有 orchestrated 逻辑（不变）
    const plan = await this.routingPlanner.plan(intents)
    for (const task of plan.tasks) {
      await this.executeTask(task)
    }
  }

  async executeOpenFloor(message: string, config: ConversationConfig) {
    // 1. 创建 Open Floor 状态
    const state: OpenFloorState = {
      conversationId: config.id,
      status: 'active',
      startTime: Date.now(),
      responses: [],
      pendingAgents: [],
      skippedAgents: [],
    }
    this.openFloorStates.set(config.id, state)

    // 2. 组装完整 conversation 上下文
    const context = await this.assembleFullConversationContext(config.id)

    // 3. 广播给所有 enabled Agent
    const agents = this.getEnabledAgents(config.teamId)
    const promises = agents.map(async (agent) => {
      try {
        const response = await agent.pushObservation({
          conversationId: config.id,
          message,
          context,
          collaborationMode: 'open_floor',
        })

        if (response.reply) {
          state.responses.push({
            agentId: agent.id,
            agentName: agent.name,
            content: response.reply,
            timestamp: Date.now(),
            relevanceScore: response.relevanceScore,
          })
        } else {
          state.skippedAgents.push(agent.id)
        }
      } catch (err) {
        logger.warn(`Open Floor: ${agent.name} failed to respond`, err)
      }
    })

    // 4. 等待回复（5 分钟超时）
    await Promise.race([
      Promise.all(promises),
      this.delay(5 * 60 * 1000),  // 5 分钟
    ])

    // 5. 标记关闭
    state.status = 'closed'
    state.endTime = Date.now()

    // 6. 发送所有回复到 conversation
    for (const response of state.responses) {
      await this.sendAgentMessage(config.id, response)
    }

    return state
  }

  async stopOpenFloor(conversationId: string) {
    const state = this.openFloorStates.get(conversationId)
    if (state && state.status === 'active') {
      state.status = 'closing'
      // 不再接受新回复，已有的回复仍发送
    }
  }
}
```

### 6.3 Agent Runtime 扩展

```typescript
// agent-runtime.ts — 新增 onObservation

class AgentRuntime {
  async onObservation(obs: Observation): Promise<{ reply?: string; relevanceScore: number }> {
    // 1. 评估相关性
    const relevance = await this.assessRelevance({
      topic: obs.message,
      myCapabilities: this.profile.capabilities,
      myCurrentLoad: this.invocationQueue.length,
      myInterests: this.profile.whenToUse,
    })

    if (relevance.score < 0.3) {
      return { relevanceScore: relevance.score }
      // 静默，不回复
    }

    // 2. 生成回复（使用 Open Floor 专用 system prompt）
    const reply = await this.generate({
      messages: [
        { role: 'system', content: this.profile.systemPrompt },
        { role: 'system', content: OPEN_FLOOR_INSTRUCTION },
        ...obs.context,
        { role: 'user', content: obs.message },
      ],
      // Open Floor 模式下限制工具
      availableTools: OPEN_FLOOR_ALLOWED_TOOLS,
    })

    return { reply, relevanceScore: relevance.score }
  }

  private async assessRelevance(params: {
    topic: string
    myCapabilities: string[]
    myCurrentLoad: number
    myInterests: string
  }): Promise<{ score: number }> {
    // 基于能力的简单评分
    // 实际实现可用 LLM 判断
    const capabilityMatch = params.myCapabilities.some(cap =>
      params.topic.toLowerCase().includes(cap.toLowerCase())
    )
    
    const loadFactor = Math.max(0, 1 - params.myCurrentLoad / 5)  // 负载越高，分数越低
    
    let score = 0
    if (capabilityMatch) score += 0.5
    score += loadFactor * 0.3
    score += 0.2  // 基础参与意愿
    
    return { score: Math.min(1, score) }
  }
}
```

### 6.4 Open Floor System Prompt

```typescript
// prompts/open-floor.ts

export const OPEN_FLOOR_INSTRUCTION = `
你是自由讨论（Open Floor）的参与者。当前处于自由讨论模式，规则如下：

1. **自主判断**：阅读话题后，判断自己是否有独特见解
   - 如果有 → 回复你的观点
   - 如果别人已经说完了你想说的 → 静默（不要重复）
   - 如果不相关 → 静默

2. **独特视角**：你的回复应该体现你的专业视角
   - Planner：从架构、规划角度
   - Coder：从实现、技术角度
   - Reviewer：从安全、质量角度
   - UI设计专家：从交互、体验角度

3. **简短有力**：自由讨论中不要写长篇大论，3-5 句话表达核心观点

4. **可追问**：如果其他 Agent 的观点引发你的思考，可以补充

5. **工具限制**：此模式下你只能使用只读工具（read_file, search_memory, search_history, read_summary）
   - 不能写文件、不能执行命令、不能调用 API

6. **结束信号**：如果讨论已充分、已达成共识，回复 "[EOD]"（End of Discussion）

记住：质量 > 数量。一个有价值的观点胜过十个泛泛之谈。
`
```

### 6.5 前端 Store 扩展

```typescript
// stores/chatStore.ts — 新增 openFloor 状态

interface ChatStore {
  // ... 现有字段
  
  // Open Floor 状态
  openFloorStates: Record<string, OpenFloorState>
  
  // Actions
  startOpenFloor: (conversationId: string) => void
  addOpenFloorResponse: (conversationId: string, response: OpenFloorResponse) => void
  closeOpenFloor: (conversationId: string) => void
  stopOpenFloor: (conversationId: string) => void
}
```

---

## 7. UI 设计

### 7.1 NewTaskDialog — 模式选择器

```
┌──────────────────────────────────────────────────────┐
│  New Conversation                                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  [协作模式]                                          │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ 🔨 编排模式   │  │ 🧠 自由讨论   │  ← 选中态     │
│  │              │  │              │    蓝边框       │
│  │ Agent 按流水 │  │ 多 Agent 自由 │                 │
│  │ 线执行任务   │  │ 参与讨论      │                 │
│  │              │  │              │                 │
│  │ 适合：代码实 │  │ 适合：头脑风  │                 │
│  │ 现、Bug修复  │  │ 暴、方案讨论  │                 │
│  └──────────────┘  └──────────────┘                 │
│                                                      │
│  [Agent 选择器（自由讨论模式下默认全选）]              │
│  [✓ Planner] [✓ Coder] [✓ Reviewer] [✓ UI设计专家]  │
│                                                      │
│  [权限模式]（编排模式下显示）                         │
│  [autoEdit ▼]                                       │
│    ├─ manual    — 每个操作弹窗确认                    │
│    ├─ autoEdit  — 写文件自动允许（默认）              │
│    ├─ plan      — 先出 plan，确认后批量执行           │
│    ├─ fullAuto  — 全自动化（高风险）                  │
│    └─ trusted   — 全部跳过（Slock 模式）              │
│                                                      │
│  [初始话题]                                          │
│  ┌──────────────────────────────────────────────┐   │
│  │ brainstorm 用户认证方案...                      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│                                    [开始讨论]        │
└──────────────────────────────────────────────────────┘
```

**交互细节**：
- 选中 `自由讨论` 时：Agent 选择器默认全选，权限模式隐藏
- 选中 `编排模式` 时：Agent 选择器变回单选/多选，权限模式显示
- 自动推断：根据消息内容推荐模式（用户可覆盖）

### 7.2 ChatInput — 模式感知

```
自由讨论模式激活时：
┌─────────────────────────────────────────┐
│ 🧠 自由讨论模式 · 所有 Agent 可见        │ ← 蓝色提示条
│                                         │
│ [输入你的问题...]                [发送]  │
│                                         │
│ @mention 支持 · 按 Enter 发送            │
└─────────────────────────────────────────┘

编排模式激活时：
┌─────────────────────────────────────────┐
│ 🔨 编排模式 · autoEdit                   │ ← 灰色提示条
│                                         │
│ [@Agent 选择器]  [串行 ⇄ 并行]           │
│                                         │
│ [输入你的问题...]                [发送]  │
└─────────────────────────────────────────┘
```

### 7.3 MessageList — Open Floor 消息展示

```
┌──────────────────────────────────────────────┐
│ 🧠 自由讨论 · 3 个 Agent 已回复 · 窗口已关闭   │ ← 标题条
├──────────────────────────────────────────────┤
│                                              │
│ ┌────────────────────────────────────────┐   │
│ │ 🧠 Planner  ▍蓝色左边框                │   │
│ │                                        │   │
│ │ 建议从用户旅程出发：                    │   │
│ │ 1. 邮箱注册 → 验证 → 设置密码          │   │
│ │ 2. OAuth（GitHub/Google）快速登录       │   │
│ │                                        │   │
│ │ 🔗 引用  ·  👍 有用  ·  💬 追问        │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ ┌────────────────────────────────────────┐   │
│ │ 💻 Coder  ▍琥珀色左边框                │   │
│ │                                        │   │
│ · OAuth 最省事，GitHub 10 行代码搞定     │   │
│ · 建议 P0：邮箱 + OAuth                  │   │
│ │                                        │   │
│ │ 🔗 引用  ·  👍 有用  ·  💬 追问        │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ ┌────────────────────────────────────────┐   │
│ │ 👁️ Reviewer  ▍绿色左边框               │   │
│ │                                        │   │
│ │ OAuth PKCE 流程是必须的，不然有 CSRF    │   │
│ │ 风险。参考 RFC 7636。                   │   │
│ │                                        │   │
│ │ 🔗 引用  ·  👍 有用  ·  💬 追问        │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ [🔨 基于此结论开始编排执行]                  │
│ [🧠 保留讨论，继续自由模式]                  │
└──────────────────────────────────────────────┘
```

### 7.4 SummarizePanel — 讨论收束

```
┌──────────────────────────────────────────┐
│ 🧠 讨论收束                               │
│                                          │
│ 讨论已结束。以下是关键观点摘要：            │
│                                          │
│ 📌 Planner：邮箱+OAuth+手机号三种方式      │
│ 📌 Coder：P0 邮箱+OAuth，P1 手机号        │
│ 📌 Reviewer：OAuth 必须加 PKCE            │
│                                          │
│ [🔨 基于此结论开始编排执行]                │
│ [📝 忽略讨论，重新开始]                    │
│ [🧠 保留讨论，继续自由模式]                │
└──────────────────────────────────────────┘
```

### 7.5 ConversationHeader — 模式指示器

```
┌──────────────────────────────────────────┐
│ 🔨 编排模式 · Planner → Coder → Reviewer │
│                                          │
│ 或                                       │
│                                          │
│ 🧠 自由讨论 · 3 Agent 参与 · 剩余 2:34   │
└──────────────────────────────────────────┘
```

### 7.6 TaskGraph — Open Floor 降级

```
编排模式下：显示完整 task chain 图

自由讨论模式下：
┌──────────────────────────────────────────┐
│ 🧠 自由讨论中 — 3 个 Agent 已回复        │
│ 此模式不跟踪任务链                        │
│                                          │
│ [Planner] [Coder] [Reviewer]             │
│   ✅        ✅       ✅                   │
└──────────────────────────────────────────┘
```

---

## 8. 实施计划

### 8.1 任务拆分

| 编号 | 任务 | 负责人 | 依赖 | 工作量 |
|------|------|--------|------|--------|
| T1 | PRD 撰写与评审 | @需求文档师 | — | 1 天 |
| T2 | `a2a-types.ts` 类型扩展 | @Coder | T1 | 0.5 天 |
| T3 | `orchestrator.ts` Open Floor 分支 | @Coder | T2 | 1 天 |
| T4 | `agent-runtime.ts` onObservation | @Coder | T2 | 1 天 |
| T5 | Open Floor System Prompt | @需求文档师 | T1 | 0.5 天 |
| T6 | `NewTaskDialog.tsx` 模式选择器 | @Coder / @UI设计专家 | T1 | 0.5 天 |
| T7 | `ChatInput.tsx` 模式感知 | @Coder / @UI设计专家 | T1 | 0.5 天 |
| T8 | `MessageItem.tsx` Open Floor 标记 | @Coder / @UI设计专家 | T1 | 0.5 天 |
| T9 | `TaskGraph.tsx` 降级展示 | @Coder / @UI设计专家 | T1 | 0.5 天 |
| T10 | `chatStore.ts` Open Floor 状态 | @Coder / @UI设计专家 | T1 | 0.5 天 |
| T11 | 集成测试 | @Reveiw工程师 | T3-T10 | 1 天 |
| T12 | 文档更新 | @需求文档师 | T11 | 0.5 天 |

### 8.2 并行路径

```
Week 1:
  Day 1: T1 (PRD) → T2 (类型扩展)
  Day 2-3: T3 + T4 (后端) || T6-T10 (前端)
  Day 4: T5 (Prompt) || T11 (测试准备)
  Day 5: T11 (集成测试) + T12 (文档)
```

### 8.3 零 DB 改动确认

| 改动项 | 是否需 DB Migration | 替代方案 |
|--------|-------------------|---------|
| `CollaborationMode` | ❌ 否 | `conversation_config` 已有扩展字段 |
| `PermissionMode` | ❌ 否 | 同上 |
| `OpenFloorState` | ❌ 否 | 内存状态 + 前端 store |
| `message.collaborationMode` | ❌ 否 | 可选字段，JSON 存储 |

---

## 9. 测试用例

### 9.1 功能测试

| ID | 场景 | 步骤 | 预期结果 |
|----|------|------|---------|
| TC-01 | 启动 Open Floor | 用户选择"自由讨论"，输入话题，点击发送 | 所有 enabled Agent 收到 observation，开始生成回复 |
| TC-02 | Agent 相关性判断 | 输入 "OAuth2 实现"，Coder 和 Planner 有能力匹配 | Coder 和 Planner 回复，UI设计专家静默 |
| TC-03 | Agent 静默 | 输入 "OAuth2 实现"，UI设计专家相关性 < 0.3 | UI设计专家不回复，skippedAgents 包含其 ID |
| TC-04 | 超时关闭 | 启动 Open Floor，5 分钟内无 Agent 回复 | 窗口自动关闭，显示"无 Agent 回复" |
| TC-05 | 用户停止 | 启动 Open Floor，用户点击"停止讨论" | 不再接受新回复，已有回复仍展示 |
| TC-06 | 工具限制 | Open Floor 模式下 Agent 请求 write_file | 自动拒绝，提示"自由讨论模式下不可用" |
| TC-07 | 模式切换 | Open Floor 结束后点击"开始编排执行" | 弹出权限确认，确认后创建 A2A task chain |
| TC-08 | 自动推断 | 输入 "brainstorm 用户认证" | 系统推荐 Open Floor 模式 |
| TC-09 | 手动覆盖 | 系统推荐 Open Floor，用户选择编排模式 | 按用户选择执行 |
| TC-10 | 权限模式 | Orchestrated 模式下切换 PermissionMode | 工具调用行为按新模式执行 |

### 9.2 边界测试

| ID | 场景 | 预期结果 |
|----|------|---------|
| TC-11 | 0 个 enabled Agent | 提示"至少选择一个 Agent" |
| TC-12 | 所有 Agent 静默 | 显示"无 Agent 参与讨论" |
| TC-13 | 同一 conversation 连续 Open Floor | 每次独立，不累积状态 |
| TC-14 | Open Floor 中用户发送新消息 | 视为新话题，重新广播 |
| TC-15 | Agent Runtime crash | 其他 Agent 不受影响，Orchestrator 记录错误 |

### 9.3 性能测试

| ID | 场景 | 指标 |
|----|------|------|
| TC-16 | 10 个 Agent 同时参与 Open Floor | 所有 Agent 在 5 分钟内完成回复 |
| TC-17 | 100 轮 Open Floor 消息 | 无内存泄漏，状态正确清理 |
| TC-18 | 超大 conversation 历史（1000+ 消息） | Open Floor 上下文组装 < 1s |

---

## 10. 验收标准

### 10.1 功能验收

- [ ] 用户可以在 NewTaskDialog 中选择 `orchestrated` 或 `open_floor` 模式
- [ ] Open Floor 模式下，多个 Agent 可以并行回复
- [ ] 每个 Agent 的回复作为独立消息展示，带 AgentBadge 和颜色区分
- [ ] Open Floor 模式下 Agent 只能使用只读工具
- [ ] Open Floor 模式下无 permission_request 弹窗
- [ ] 用户可以随时停止 Open Floor 讨论
- [ ] 讨论结束后可以一键切换到 Orchestrated 模式执行
- [ ] 模式切换时 conversation 上下文不丢失
- [ ] Orchestrated 模式下 PermissionMode 可选（manual/autoEdit/plan/fullAuto/trusted）
- [ ] 系统根据消息内容自动推荐协作模式

### 10.2 质量验收

- [ ] 代码覆盖率达到 80% 以上
- [ ] 所有测试用例通过
- [ ] 无内存泄漏（通过 100 轮压力测试）
- [ ] UI 响应时间 < 100ms（模式切换、消息渲染）
- [ ] 文档完整（API 文档、用户指南、开发者指南）

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Agent 全部静默 | 中 | 用户体验差 | 确保至少 2-3 个 Agent 有能力匹配常见话题；降低 relevance 阈值 |
| Open Floor 消息过长 | 高 | 界面混乱 | 限制每条回复 500 字；支持展开/收起 |
| 确认疲劳转移 | 低 | 用户不信任 | Orchestrated 默认 autoEdit；Open Floor 强制 trusted |
| 模式切换上下文丢失 | 低 | 讨论成果浪费 | SummarizePanel 自动摘要；conversation 历史自动传递 |
| Agent 幻觉在 Open Floor 中扩散 | 中 | 错误观点被采纳 | 显示 Agent 来源；用户可追问验证；Review 模式可介入 |
| 前端改动影响现有功能 | 低 | 回归 bug | 充分测试 Orchestrated 模式（确保不变）；渐进式发布 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| Open Floor | 自由讨论模式，多 Agent 自主参与，无 Orchestrator 编排 |
| Orchestrated | 编排模式，Orchestrator 控制任务分配和执行顺序 |
| CollaborationMode | 协作模式枚举：'orchestrated' \| 'open_floor' |
| PermissionMode | 权限模式枚举：'manual' \| 'autoEdit' \| 'plan' \| 'fullAuto' \| 'trusted' |
| Observation | 推送给 Agent 的消息，包含话题和上下文 |
| Relevance Score | Agent 评估自身与话题相关性的分数（0-1） |
| SummarizePanel | 讨论收束面板，汇总 Open Floor 输出并提供模式切换 |

## 附录 B：参考文档

- [Task #3: Slock Agent 通信方式技术方案](/docs/specs/slock-agent-communication.md)
- [Task #5: 会话-上下文-记忆模块重构计划](/docs/plans/bytro-refactoring-plan.md)
- [bytro-app A2A 类型定义](/src/main/ai/a2a-types.ts)
- [bytro-app Orchestrator](/src/main/ai/orchestrator.ts)
- [bytro-app Agent Runtime](/src/main/ai/agent-runtime.ts)

---

*本文档由 @需求文档师 撰写，经 @tomek-rumore 确认，供 @Coder、@UI设计专家、@Reveiw工程师 参考实现。*
