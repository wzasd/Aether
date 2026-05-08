# Open Floor 修复总结

> 记录 2026-05-08 本轮 Open Floor 功能验证中发现的所有问题、根因分析和修复方案。
> 共 12 个 commit，覆盖 11 层 bug + 1 个体验优化。

---

## 问题概述

**验证场景**：用户在 Open Floor（自由讨论）模式下发送消息，期望多个 Agent 同时参与讨论。

**初始现象**：
- 只有 1 个 Agent（Planner）回复，其余 5 个静默
- 第二条消息发送后"被吃"（消息消失）
- 消息"一下子蹦出来"（不是流式/逐条显示）
- 回复语气像任务报告，不像自然聊天

---

## 12 层 Fix 完整记录

### Layer 1: collaborationMode 未穿透 Payload

| 项目 | 内容 |
|------|------|
| **Commit** | `b55f9f3` |
| **文件** | `chatStore.ts:814` |
| **问题** | 前端 `sendMessage` 没传 `collaborationMode` 给后端 |
| **后果** | 后端默认 `'orchestrated'`，Open Floor 模式根本没触发 |
| **修复** | payload 加 `collaborationMode: isOpenFloor ? 'open_floor' : 'orchestrated'` |

### Layer 2: onObservation Prompt 保守

| 项目 | 内容 |
|------|------|
| **Commit** | `3b395ec` |
| **文件** | `agent-runtime.ts:235` |
| **问题** | Agent 被告知"不确定时倾向参与"，但底层仍是评估框架 |
| **修复** | 措辞改为"倾向参与 > 完美" |

### Layer 3: Backend Mode 未持久化

| 项目 | 内容 |
|------|------|
| **Commit** | `5469f95` |
| **文件** | `orchestrator.ts` |
| **问题** | 后端没记住 conversation 的当前模式 |
| **修复** | `conversationModes` 持久化 |

### Layer 4: Open Floor Prompt 冗余

| 项目 | 内容 |
|------|------|
| **Commit** | `7e667c4` |
| **文件** | `open-floor.ts` |
| **问题** | 规则太多，Agent 被约束 |
| **修复** | 精简 prompt，减少显式规则 |

### Layer 5: Mode Toggle UI 缺失

| 项目 | 内容 |
|------|------|
| **Commit** | `4160a63` |
| **文件** | `AgentStatusBar.tsx` |
| **问题** | 用户无法在聊天页切换 Open Floor / Orchestrated |
| **修复** | AgentStatusBar 加 mode 下拉切换 |

### Layer 6: openFloorStates 未初始化

| 项目 | 内容 |
|------|------|
| **Commit** | `e770cba` |
| **文件** | `chatStore.ts` |
| **问题** | 前端 `openFloorStates[conversationId]` 是空的 |
| **后果** | `agent_observation` 事件被 guard 丢弃，用户只看到 system message |
| **修复** | `sendMessage` 时初始化 `openFloorStates` 为 `active` |

### Layer 7: Error Logging 缺失

| 项目 | 内容 |
|------|------|
| **Commit** | `22ddf52` |
| **文件** | `chatStore.ts` |
| **问题** | `message.create` 出错被静默 catch |
| **修复** | 加 `console.error` 日志 |

### Layer 8: 新会话 Agent 为空

| 项目 | 内容 |
|------|------|
| **Commit** | `9ed99a1` |
| **文件** | App 启动逻辑 |
| **问题** | 新对话没有默认 Agent |
| **修复** | App 启动时 `seedDefaults()` |

### Layer 9: Agent 框架——判断式→邀请式

| 项目 | 内容 |
|------|------|
| **Commit** | `1ec26e8` |
| **文件** | `agent-runtime.ts:235` |
| **问题** | Agent 被告知"判断是否参与"，导致集体沉默 |
| **修复** | 框架改为邀请式："直接分享你的观点" |
| **关键变化** | 删"判断是否参与"、加"这不是任务分配"、不给 NO_REPLY 静默出口 |

### Layer 10-A: closeOpenFloor 清除 Mode

| 项目 | 内容 |
|------|------|
| **Commit** | `b611e36` |
| **文件** | `chatStore.ts` |
| **问题** | `closeOpenFloor` 清除了 `pendingCollaborationMode` |
| **后果** | 第二条消息时 mode 丢失，不走 Open Floor |
| **修复** | closeOpenFloor 只关闭 cycle state，不删 mode 选择 |

### Layer 10-B: sendMessage 消费 Mode

| 项目 | 内容 |
|------|------|
| **Commit** | `bc16a2e`（合入） |
| **文件** | `chatStore.ts` |
| **问题** | `sendMessage` 读完 `pendingCollaborationMode` 就删了 |
| **后果** | 第一条消息用完 mode 就没了，第二条自然看不到 |
| **修复** | 只读不删 |

### Layer 10-C: isFirstMessage 挡后续消息

| 项目 | 内容 |
|------|------|
| **Commit** | `bc16a2e`（合入） |
| **文件** | `chatStore.ts` |
| **问题** | `isFirstMessage` guard 挡住非首条消息的 `message.create` |
| **后果** | 第二条及以后的消息从不保存到 DB/UI |
| **修复** | `message.create` 移到 `isFirstMessage` 块外 |

### Layer 11: Race Condition

| 项目 | 内容 |
|------|------|
| **Commit** | `bc16a2e` |
| **文件** | `chatStore.ts` |
| **问题** | `closeOpenFloor` 设 `status='closed'` 会覆盖新 round 的 `'active'` |
| **修复** | delete state 替代 'closed' |

### Layer 12: 重复发送

| 项目 | 内容 |
|------|------|
| **Commit** | `9070747` |
| **文件** | `orchestrator.ts` |
| **问题** | `agent_observation` 有重复发送点 |
| **后果** | 消息"一下子蹦出来" |
| **修复** | 删掉重复发送循环，改为 per-agent 即时发送 |

### Layer 13: Prompt 人性化

| 项目 | 内容 |
|------|------|
| **Commit** | `3f08f9e` |
| **文件** | `agent-runtime.ts` |
| **问题** | 回复像任务报告，不像自然聊天 |
| **修复** | "发表专业看法 3-5 句话" → "像平时群里聊天一样自然参与" |

---

## 根因分类

### 1. 参数传递缺失（Layer 1）
- `collaborationMode` 未传 → 后端永远走 orchestrated

### 2. 状态管理错误（Layer 6, 10-A, 10-B, 10-C, 11）
- `openFloorStates` 未初始化 → observation 被丢弃
- `pendingCollaborationMode` 被误删 → 第二条消息 mode 丢失
- `isFirstMessage` guard 范围过大 → 后续消息不保存
- `closeOpenFloor` 设 'closed' → 覆盖新 round

### 3. Prompt 框架问题（Layer 2, 4, 9, 13）
- 判断式框架 → Agent 先评估再决定 → 集体沉默
- 任务执行者身份 → 回复像报告
- 规则过多 → 约束过度

### 4. 架构设计缺失（Layer 3, 5, 7, 8）
- 模式未持久化
- UI 缺少 mode 切换入口
- 日志缺失
- 新会话无默认 Agent

### 5. 后端实现问题（Layer 12）
- 重复发送循环
- per-agent 即时发送缺失

---

## 关键教训

1. **前端状态管理是 Open Floor 的薄弱环节**：`openFloorStates` / `pendingCollaborationMode` / `isFirstMessage` 三处状态交互复杂，容易互相影响。

2. **Prompt 框架比措辞更重要**：从"判断是否参与"改成"直接分享观点"的效果，远大于改几个形容词。

3. **Agent 身份定义决定行为模式**：任务执行者 vs 团队成员，回复风格完全不同。

4. **日志是排查效率的关键**：没有前端日志，11 层 bug 花了 40 分钟才逐层定位。

5. **测试消息的选择影响判断**：用"你好"测参与度会得出错误结论，应该用实质讨论话题。

---

## 待办（P1）

- [ ] Round ID 隔离：并发场景下防止旧 round 的 close 影响新 round
- [ ] 前端日志系统：不依赖 DevTools，写文件到 `app.getPath('logs')`
- [ ] 各 Agent role prompt 人格化：加聊天风格段落
- [ ] 流式输出：从 Promise 模式改为 Streaming 模式
- [ ] 可观测性 UI #21：显示每个 Agent 的参与状态

---

*文档版本: 2026-05-08*
*作者: @需求文档师*
*相关: ADR-011 (Open Floor 架构决策), docs/open-floor-design.md (技术设计)*
