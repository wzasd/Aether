# Open Floor 自由讨论 — 功能设计文档

**版本**: 1.0
**日期**: 2026-05-08
**状态**: 已实现（13 层 fix 全部闭环）

## 概述

Open Floor（自由讨论）是 bytro-app 的两种协作模式之一。与结构化的 Orchestrated 模式（任务流水线）不同，Open Floor 模拟**团队群聊**——用户发消息后，所有启用的 Agent 并行收到话题，各自从专业视角发表看法。

## 两种模式对比

| 维度 | Orchestrated | Open Floor |
|------|-------------|------------|
| 触发方式 | 发消息（默认） | AgentStatusBar 下拉切换 |
| Agent 行为 | 等任务 → 执行 → 报告 | 看话题 → 思考 → 参与 |
| 输出方式 | 结构化（[PLAN]、[SUMMARY]） | 自然段落（像聊天） |
| Agent 数量 | 主 Agent + 委托 | 所有启用的 Agent |
| 执行模型 | 串行/并行任务链 | 并行广播 |
| 适用场景 | 写代码、审查、规划 | 头脑风暴、架构讨论 |

## 架构

```
┌──────────────────────────────────────────────────────┐
│                      Frontend                        │
│                                                      │
│  AgentStatusBar ──→ setPendingCollaborationMode()    │
│  ChatInput ──→ sendMessage(convId, content)          │
│  chatStore ──→ openFloorStates[convId] = {active}   │
│            ──→ window.api.orchestrator.sendMessage()  │
│                                                      │
│  ai:event handler:                                   │
│    agent_observation → guard(status==='active')      │
│                     → message.create + append        │
│    open_floor_closed → closeOpenFloor(convId)        │
└──────────────────────┬───────────────────────────────┘
                       │ IPC
┌──────────────────────▼───────────────────────────────┐
│                      Backend                         │
│                                                      │
│  orchestrator.sendUserMessage()                      │
│    ├─ mode = collaborationMode ?? stored ?? 'orch'   │
│    ├─ store in conversationModes                     │
│    └─ if mode === 'open_floor':                      │
│         stopOpenFloor(convId)  # stop prev round     │
│         executeOpenFloor(convId, content)             │
│                                                      │
│  executeOpenFloor():                                  │
│    ├─ Load all enabled agent profiles                │
│    ├─ Start AgentRuntime per agent                   │
│    ├─ runtime.onObservation({message, context})      │
│    ├─ Per-agent completion → emit agent_observation  │
│    ├─ Wait all (with timeout)                        │
│    ├─ Summary → appendSystemMessage                  │
│    └─ emit open_floor_closed                         │
└──────────────────────────────────────────────────────┘
```

## 数据流

1. 用户在 AgentStatusBar 下拉选择 "Open Floor"
   → `setPendingCollaborationMode(convId, 'open_floor')`

2. 用户发消息
   → 前端读取 `pendingCollaborationMode[convId]`
   → 初始化 `openFloorStates[convId] = { status: 'active' }`
   → 发送 IPC 调用 `orchestrator:sendMessage`，带 `collaborationMode: 'open_floor'`

3. 后端接收
   → `collaborationMode ?? conversationModes.get(convId) ?? 'orchestrated'`
   → 存储 mode 到 `conversationModes`
   → 进入 `executeOpenFloor` 分支

4. 并行广播
   → 加载所有 enabled profiles
   → 每个 profile 启动 AgentRuntime
   → 调用 `runtime.onObservation()` 发送话题和上下文

5. Agent 回复
   → 每个 Agent 完成后立即 emit `agent_observation` 事件
   → 前端收到后通过 guard 检查 `openFloorStates[convId].status === 'active'`
   → 创建 message + 追加到 UI

6. 结束
   → 所有 Agent 完成（或超时）
   → emit `open_floor_closed` 事件
   → 前端 `closeOpenFloor` → delete `openFloorStates[convId]`

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/renderer/src/stores/chatStore.ts` | 前端状态管理：sendMessage、openFloorStates、guard |
| `src/main/ai/orchestrator.ts` | 后端编排：sendUserMessage、executeOpenFloor |
| `src/main/ai/agent-runtime.ts` | Agent 运行时：onObservation、prompt 构建 |
| `src/main/ai/prompts/open-floor.ts` | Open Floor 系统提示词 |
| `src/main/ai/prompts/agent-roles/*.ts` | Agent 角色提示词模板 |
| `src/renderer/src/components/chat/AgentStatusBar.tsx` | 模式切换 UI |

## Prompt 设计哲学

### Slock 参考

Slock Agent prompt：`你是 #channel 的成员。有人说话时，如果你 relevant 就参与讨论。`

核心：**Agent 是团队成员，不是任务执行者。**

### bytro 实现

**框架层**（`agent-runtime.ts` onObservation message）：
```
你是 @name，团队的一员。大家在聊上面的话题，你也说说你的想法吧
——像平时群里聊天一样，不用太正式。
```

**系统层**（`open-floor.ts` 系统提示词）：
```
你是自由讨论的参与者。把讨论当成群聊——自然参与，简短有力。
可以说"我觉得"、"有意思"、"换个角度看"。
不需要结构化格式，不需要得出结论，只需要让讨论更丰富。
参与 > 完美。
```

**角色层**（各 Agent role prompt 的 Open Floor 段落）：
```
## Open Floor 讨论模式

自由讨论时你是团队成员不是任务执行者：
- 像同事聊天一样自然回应，不用结构化格式
- 可以提问、质疑、补充别人
- 简短直接，不追求面面俱到
```

## 修复历史

13 层 fix，详见 [ADR-011](../architecture/decisions/adr-011-open-floor-fixes.md)。

简要时间线：
1. L1-L8：机制 bug（参数丢失、状态未初始化、静默吞错）
2. L9：框架 bug（判断式→邀请式）
3. L10a-c：三条"第二条消息被吃"的根因（mode 被清 + 消费 + isFirstMessage gate）
4. L11：race condition（delete 替代 status='closed'）
5. L12：重复发送（删 batch emit，只保留 per-agent）
6. L13：prompt 人性化（对齐 Slock 聊天风格）
