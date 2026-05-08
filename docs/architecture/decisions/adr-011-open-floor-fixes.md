# ADR-011: Open Floor 全链路修复记录

**状态**: 已完成
**日期**: 2026-05-08
**作者**: @Coder, @架构设计, @Reveiw工程师, @UI设计专家, @需求文档师, @Cindy

## 背景

Open Floor（自由讨论）是 bytro-app 的多 Agent 协作模式，允许用户和多个 Agent 在同一会话中自由讨论话题，而无需走结构化的任务流水线（Orchestrated 模式）。

2026-05-08，@tomek-rumore 测试发现两个核心问题：
1. **只有 1 个 Agent 回复**（预期所有 Agent 参与讨论）
2. **第二条消息"被吃"**（消息不显示在 UI 中）

经过多 Agent 协作排查，最终定位并修复了 **13 层 bug**（11 层核心 + 1 层重复发送 + 1 层 prompt 人性化）。

## 根因链（按时间线）

| 层 | 位置 | 问题 | 修复 commit | 发现者 |
|---|------|------|-------------|--------|
| L1 | `chatStore.ts:825` | `collaborationMode` 未传入 payload，后端始终走 orchestrated | `b55f9f3` | @UI设计专家 |
| L2 | `agent-runtime.ts:235` | "只说你真正有把握的" → 降低参与门槛 | `3b395ec` | @Reveiw工程师 |
| L3 | `open-floor.ts` | 7 条显式规则过于复杂 | `7e667c4` | @架构设计 |
| L4 | `orchestrator.ts:155` | 后端 mode 未持久化 | `5469f95` | @架构设计 |
| L5 | `AgentStatusBar.tsx` | 模式只读，用户无法切换 | `4160a63` | @UI设计专家 |
| L6 | `chatStore.ts:sendMessage` | `openFloorStates` 发送前未初始化 | `e770cba` | @UI设计专家 |
| L7 | `chatStore.ts:agent_observation` | `message.create` 失败静默吞错 | `22ddf52` | @UI设计专家 |
| L8 | `App.tsx` | `seedDefaults()` 启动时未调用 | `9ed99a1` | @UI设计专家 |
| L9 | `agent-runtime.ts:235` | "判断是否参与" 框架 → Agent 评估后选择静默 | `1ec26e8` | @Reveiw工程师 |
| L10a | `chatStore.ts:closeOpenFloor` | `pendingCollaborationMode` 被清除 | `b611e36` | @架构设计 |
| L10b | `chatStore.ts:sendMessage` | `pendingCollaborationMode` 消费后删除 | `b611e36` | @架构设计 |
| L10c | `chatStore.ts:isFirstMessage` | 用户消息保存被 `isFirstMessage` 挡住 | `b611e36` | @Coder |
| L11 | `chatStore.ts:closeOpenFloor` | `status='closed'` 覆盖新 round 的 `active` | `bc16a2e` | @Reveiw工程师 |
| L12 | `orchestrator.ts:668` | agent_observation 重复发送 | `9070747` | @Coder |
| L13 | `agent-runtime.ts` + `open-floor.ts` | prompt 太任务导向，缺人味 | `3f08f9e` | @tomek-rumore |

## 关键架构决策

### 决策 1：邀请式框架替代判断式框架（L9）

**问题**: Agent 收到 "请判断是否参与讨论" → 先评估 → 多数选择 NO_REPLY 静默
**裁定**: "你是团队成员，直接分享观点" — 不给评估出口
**理由**: Open Floor 鼓励多视角碰撞，Agent 不应该做参与度评估

### 决策 2：动态身份切换而非统一身份（L9 延伸）

**问题**: 要不要把 Agent 的基础身份从"任务执行者"改为"团队成员"？
**裁定**: 不改基础身份，Open Floor 时临时切换
**理由**:
- Orchestrated 和 Open Floor 的 Agent 行为差异是本质性的
- 统一身份会让 orchestrated 模式下的任务执行变得散漫
- 同一个人在公司里开会和独立干活，行为模式不同——不是同一种身份

### 决策 3：前端/后端模式持久化解耦（L4 + L10）

**问题**: `closeOpenFloor` 把 cycle 状态清理和用户偏好清理混在一起
**方案**:
- 后端：`conversationModes` 持久化 mode（不受 cycle 影响）
- 前端：`pendingCollaborationMode` 只读不删（用户偏好保持）
- `openFloorStates` delete 替代 `status='closed'`（防止 round 交叉覆盖）

### 决策 4：Delete 替代 status='closed'（L11）

**问题**: 并发场景下旧 round 的 `status='closed'` 可能覆盖新 round 的 `status='active'`
**方案**: `closeOpenFloor` 直接 delete `openFloorStates[convId]`
**权衡**: delete 在极端并发场景下同样有竞态（旧 round delete 新 round），但出现概率极低
**后续**: Round 级别 ID 隔离作为 P1 防御性改进

## 教训

1. **静默失败是最大的敌人** — 10+ 层 bug 中，多层级是"不出错但也不工作"的静默失败
2. **前端需要日志** — 后端 15 个埋点已接入 logger，但前端 `chatStore` 关键路径没有
3. **状态同步必须解耦** — cycle 状态（`openFloorStates`）和用户偏好（`pendingCollaborationMode`）应该独立管理
4. **Prompt 设计是产品问题** — Agent 是否参与讨论不是技术问题，是 prompt 哲学问题

## 后续工作

- [ ] #21 可观测性 UI：Agent 状态实时可见
- [ ] Round 级别 ID 隔离（并发安全增强）
- [ ] 前端日志系统（`chatStore` 关键路径接入 logger）
- [ ] Open Floor 流式输出（当前是完整推送，改为 token 级流式）
