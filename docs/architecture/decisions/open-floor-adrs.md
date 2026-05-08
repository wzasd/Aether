---
adr: 009-011
title: Open Floor Collaboration Architecture
status: implemented
date: 2026-05-08
---

# ADR-009~011: Open Floor 协作模式架构决策

## Overview

三份 ADR 记录 Open Floor（自由讨论）模式从设计到落地的完整架构决策链。覆盖双模协作拓扑（ADR-009）、权限模型（ADR-010）、以及 11 层 bug 定位与修复中暴露的架构教训（ADR-011）。

| ADR | Title | Scope | Risk Level |
|-----|-------|-------|------------|
| ADR-009 | Dual-Mode Collaboration Architecture | 模式切换、广播分发、身份模型 | Architecture |
| ADR-010 | Layered Permission Model | 权限随模式走、open_floor=trusted | Security |
| ADR-011 | Open Floor Bug Fix Retrospective | 11 层 bug 根因 + 架构教训 | Quality |

---

## ADR-009 (Updated): Dual-Mode Collaboration Architecture

### Decision

bytro-app 采用双模协作架构：`orchestrated`（编排模式）和 `open_floor`（自由讨论模式）。两种模式下 Agent 的行为模型本质不同。

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    bytro-app                         │
│                                                      │
│  ┌──────────────┐          ┌──────────────────┐     │
│  │ orchestrated │          │   open_floor      │     │
│  │              │          │                    │     │
│  │ 单一 Agent   │          │ 全部 enabled       │     │
│  │ 任务执行     │          │ Agent 广播讨论     │     │
│  │ 流式输出     │          │ 各自完成推送       │     │
│  │ 事前门禁     │          │ 事后审计           │     │
│  └──────────────┘          └──────────────────┘     │
│                                                      │
│  Agent 身份：模式驱动动态切换                           │
│  orchestrated → "任务执行者"                          │
│  open_floor   → "讨论参与者"                          │
└─────────────────────────────────────────────────────┘
```

### Mode Identity Model (Updated 2026-05-08)

**核心原则**：Agent 身份随模式切换，不强行统一。

| 维度 | Orchestrated | Open Floor |
|------|-------------|------------|
| 身份定义 | 任务执行者 | 团队讨论成员 |
| 触发方式 | 等任务分配 | 看话题直接参与 |
| 输出风格 | 结构化（可带格式） | 自然段落（聊天式） |
| 参与决策 | 路由指派（单 Agent） | 广播 + 自选择 |
| 退出机制 | 任务完成 | 自然结束 |

**为什么不统一身份？**
- 两种模式的 Agent 行为差异是本质性的，不是参数不同
- 强行统一会让 orchestrated 模式下的任务执行变得散漫
- 保持模式差异 = 保持各模式的最佳体验

### Invitation Framing Decision (Key Update)

**旧框架（判断式）**：
```
请根据你的角色判断是否参与讨论。如果觉得相关...
```
→ Agent 先评估再决定 → 默认行为是 NO_REPLY

**新框架（邀请式）**：
```
你是 @name，团队的一员。大家在自由讨论，像朋友聊天一样自然回应就好。
```
→ Agent 直接参与 → 不相关时简短说明即可

**决策理由**：
- "判断是否参与" 的框架本身就在告诉 Agent"先评估，再决定"
- Agent 的第一本能就会是 NO_REPLY（安全默认值）
- 邀请式框架把"参与"作为默认行为，符合 Open Floor 的设计意图

### Mode Persistence Architecture

模式持久化解耦为两层：

```
Frontend (chatStore.ts)              Backend (orchestrator.ts)
┌─────────────────────────┐          ┌──────────────────────────┐
│ pendingCollaborationMode │          │ conversationModes (Map)  │
│ (Record<convId, mode>)  │          │ (Map<convId, mode>)      │
│                         │          │                          │
│ 用户选择 → 设置          │          │ sendMessage 接收 mode    │
│ sendMessage 只读不删     │          │ 持久化到 Map             │
│ closeOpenFloor 不清      │          │ fallback: Map.get(conv)  │
└─────────────────────────┘          └──────────────────────────┘
```

**关键决策**：
- Frontend `pendingCollaborationMode` 是用户偏好，不应随 cycle 结束而清除
- Backend `conversationModes` 是持久化状态，用于 fallback
- 两层解耦防止任一层的清理动作影响另一层

---

## ADR-010: Layered Permission Model

### Decision

Open Floor 用 Slock 式事后审计（trusted），Orchestrated 用 bytro 式事前门禁（双层信任）。权限跟着协作模式走，不是全局开关。

### Detail

| 模式 | 权限模型 | 原因 |
|------|---------|------|
| open_floor | trusted（事后审计） | Agent 是平等讨论参与者 |
| orchestrated | 双层信任 | 单 Agent 执行任务需要把控 |

### 审查在产出物上，不在步骤上

步骤级弹窗制造确认疲劳，不等价于有效审查。审查应该对最终产出物（代码、文档、设计）进行，不是对每一步操作弹窗。

---

## ADR-011: Open Floor 11-Layer Bug Fix Retrospective

### Context

Open Floor 功能代码已实现但从未端到端测试。首次测试时仅 1 个 Agent 回复，第二条消息完全不可见。经过 11 层独立断点的逐层定位和修复，最终实现正确的多 Agent 同步讨论。

### 11 Layers of Bugs

| Layer | Commit | Root Cause | Symptom | Severity |
|-------|--------|-----------|---------|----------|
| L1 | b55f9f3 | `sendMessage` 未传 `collaborationMode` | 后端永远走 orchestrated | CRITICAL |
| L2 | 3b395ec | `agent-runtime.ts` 硬编码覆盖 Open Floor 指令 | "只说你真正有把握的" 与参与原则冲突 | HIGH |
| L3 | 7e667c4 | `open-floor.ts` 7 条显式规则过于保守 | NO_REPLY 成为默认行为 | HIGH |
| L4 | 5469f95 | `orchestrator.ts` 模式回退 | 第二条消息覆盖已存储的模式 | CRITICAL |
| L5 | 4160a63 | AgentStatusBar 模式只读 | 用户无法切换模式 | MEDIUM |
| L6 | e770cba | `openFloorStates` 未初始化 | 前端 guard 静默丢弃所有 observation | CRITICAL |
| L7 | 22ddf52 | `message.create` 静默 catch 吞错 | Agent 回复创建失败无日志 | HIGH |
| L8 | 9ed99a1 | Agent profile 未自动加载 | 新会话无 Agent 可参与 | HIGH |
| L9 | 1ec26e8 | 判断式框架 → Agent 先评估再决定 | 1/6 参与率 | HIGH |
| L10 | b611e36 | `closeOpenFloor` 清除用户模式选择 | 第二条消息不走 Open Floor | CRITICAL |
| L11 | bc16a2e | `sendMessage` 自己消费 `pendingCollaborationMode` + `isFirstMessage` 阻挡消息创建 | 第二条消息完全不可见 | CRITICAL |

### Architecture Anti-Patterns Identified

#### 1. Silent Failure Pattern
```typescript
// ANTI-PATTERN: Silent catch
.catch(() => {})
// FIX: Always log
.catch((err) => { console.error('Failed to create message:', err) })
```
**Impact**: Layers 1, 6, 7, 8 all involved silent failures. Without logging, each layer took 5-20 minutes to diagnose.

#### 2. Premature Cleanup Pattern
```typescript
// ANTI-PATTERN: Clean up user preference as if it were cycle state
closeOpenFloor(convId) {
  delete pendingCollaborationMode[convId]  // ← mode is user preference, not cycle state!
}
// FIX: Separate cycle state from user preference
closeOpenFloor(convId) {
  delete openFloorStates[convId]  // ← cycle state only
  // pendingCollaborationMode stays — user's mode choice persists
}
```

#### 3. Self-Consuming State Pattern
```typescript
// ANTI-PATTERN: Read then delete
const mode = get().pendingCollaborationMode[convId]
set({ pendingCollaborationMode: rest })  // ← consumed on first use!
// FIX: Read only, don't delete
const mode = get().pendingCollaborationMode[convId]
// Mode persists for subsequent messages
```

#### 4. Duplicate Emission Pattern
```typescript
// ANTI-PATTERN: Same event emitted from two code paths
// L621: per-agent emit (correct)
// L668: loop emit after Promise.all (duplicate)
// FIX: Single emission point per event type
```

#### 5. Gatekeeper Guard Without Logging
```typescript
// ANTI-PATTERN: Silent drop
if (state.openFloorStates[convId]?.status !== 'active') break
// FIX: Log the drop reason
if (state.openFloorStates[convId]?.status !== 'active') {
  console.warn('[chatStore] observation blocked: openFloorStates not active', { convId })
  break
}
```

### Key Architectural Lessons

1. **Entry-point validation is as critical as core logic** — 9 out of 11 bugs were at system boundaries (mode passing, state initialization, message creation)
2. **Each layer is an independent fracture point** — 11 layers of bugs stacked, each masking the next. Fixing one revealed the next.
3. **Silent failures are the most expensive bugs** — `.catch(() => {})` and silent guards cost 40+ minutes of debugging
4. **Frontend state needs the same observability as backend** — Task #1 logging was backend-only, but 6/11 bugs were frontend
5. **"Design for failure" means log the failure** — every guard, catch, and state transition needs a log line

### Implementation

See commits b55f9f3 through bc16a2e in the repository. Key files:
- `src/renderer/src/stores/chatStore.ts` — openFloorStates lifecycle, mode persistence
- `src/main/ai/orchestrator.ts` — conversationModes, executeOpenFloor
- `src/main/ai/agent-runtime.ts` — onObservation prompt assembly
- `src/main/ai/open-floor.ts` — participation rules
- `src/renderer/src/components/AgentStatusBar.tsx` — mode toggle UI

### Observability Requirements (Post-mortem)

After this retrospective, the following logging points were added:
1. `[chatStore]` prefix for all frontend chatStore operations
2. Guard drops logged at WARN level with context (convId, agentId, current state)
3. `closeOpenFloor` logged at INFO with retained mode
4. `sendMessage` logged at DEBUG with actual collaborationMode value
5. `message.create` failures logged at ERROR with full error details
