# Open Floor 修复日志

> 2026-05-08 | 13 commits | 13 层 bug 发现与修复

## 问题概述

Open Floor（自由讨论）模式上线后完全不可用：
- 第一条消息：1/6 Agent 回复，5 个静默
- 第二条消息：完全消失（"被吃了"）
- Agent 回复没有人味，像任务报告

## 根因链（13 层）

### 机制层（L1-L8）：消息发不出去 / Agent 不回复

| # | Commit | 根因 | 修复 |
|---|--------|------|------|
| 1 | `b55f9f3` | `collaborationMode` 从未从前端传到后端 | sendMessage payload 新增字段 |
| 2 | `3b395ec` | agent-runtime 硬编码"只说你真正有把握的"覆盖 Open Floor prompt | 对齐为"倾向参与" |
| 3 | `5469f95` | 后端只读 `collaborationMode` 参数，第二条消息回退 orchestrated | `conversationModes` 持久化 |
| 4 | `7e667c4` | Open Floor prompt 7 条冗余规则互相冲突 | 精简为 3 行核心指导 |
| 5 | `4160a63` | AgentStatusBar 只读标签，用户无法切换模式 | 改为可点击下拉菜单 |
| 6 | `e770cba` | 前端 `openFloorStates` 从未初始化 → 所有 agent_observation 被 guard 丢弃 | sendMessage 前初始化 state |
| 7 | `22ddf52` | `message.create` 失败被静默 catch，错误不可见 | 加 console.error 日志 |
| 8 | `9ed99a1` | `seedDefaults` 从未自动调用，首次启动无 Agent | App.tsx + WorkspaceArea 启动时调用 |

### 框架层（L9）：Agent 被置于评估者角色

| # | Commit | 根因 | 修复 |
|---|--------|------|------|
| 9 | `1ec26e8` | onObservation 用"判断是否参与"框架 → Agent 先评估再决定 → 倾向于静默 | 改为"你是团队成员，直接分享观点"邀请框架 |

### 持久化层（L10-L11）：第二条消息的 3 个互锁 bug

| # | Commit | 根因 | 修复 |
|---|--------|------|------|
| 10a | `b611e36` | `closeOpenFloor` 删除了 `pendingCollaborationMode` → 用户模式选择丢失 | 只清 cycle state，保留 mode |
| 10b | `bc16a2e` | `sendMessage` 自己消费了 `pendingCollaborationMode` → 第一条用完就没了 | 只读不删 |
| 11 | `bc16a2e` | `isFirstMessage` gate 挡住了非首条消息的 `message.create` → 消息不保存不显示 | 移到 if 块外 |

### 体验层（L12-L13）

| # | Commit | 根因 | 修复 |
|---|--------|------|------|
| 12 | `9070747` | agent_observation 在 Promise.all 后批量发送 → 所有回复同时出现 | 每个 Agent 完成时立即 emit |
| 13 | `3f08f9e` | Prompt 过于正式/任务化 → 回复像工作报告 | 全面改写为聊天式 Slock 风格 |

## 架构流程（修复后）

```
用户发消息（Open Floor）
  │
  ├─ 前端 (chatStore.ts)
  │   ├─ sendMessage: 读取 pendingCollaborationMode（不删除）
  │   ├─ 初始化 openFloorStates[convId] = active
  │   ├─ message.create → 保存用户消息到 DB → 追加到 UI
  │   └─ IPC → orchestrator.sendUserMessage({ collaborationMode: 'open_floor' })
  │
  ├─ 后端 (orchestrator.ts)
  │   ├─ conversationModes.set(convId, 'open_floor')  ← 持久化
  │   ├─ executeOpenFloor:
  │   │   ├─ 并行启动 6 个 AgentRuntime
  │   │   ├─ 每个 Agent 完成 → 立即 emit agent_observation  ← 流式体验
  │   │   ├─ Promise.all 等待全部完成或超时
  │   │   └─ emit open_floor_closed + 总结
  │   └─ appendSystemMessage → 系统消息事件
  │
  └─ 前端事件处理
      ├─ agent_observation: guard(openFloorStates[conv].status === 'active') → 创建消息
      ├─ open_floor_closed: closeOpenFloor → delete openFloorStates（保留 pendingCollaborationMode）
      └─ system_message: appendSystemMessage → 追加系统消息
```

## Prompt 哲学

### v1（判断式）❌
> "请根据你的角色判断是否参与讨论。记住：只说你真正有把握的。"

问题：Agent 被置于评估者角色 → 先评估 → 默认静默

### v2（邀请式）⚠️
> "你是 @name（role），请就话题发表你的专业看法（3-5 句话）。"

问题：虽然去掉了判断，但"发表专业看法"仍太正式

### v3（聊天式）✅
> "你是 @name，团队的 role。大家在聊这个话题，你也说说你的想法吧——像平时群里聊天一样，不用太正式。"

配合系统 prompt：
- 用自然段落，不要结构化格式
- 可以说"我觉得"、"有意思"、"换个角度看"
- 可以提问、质疑、补充
- 参与 > 完美

## 已知待改进

- [ ] 每个 Agent role prompt 模板加 `open_floor` 小节（P1）
- [ ] Round ID 隔离（防并发 closeOpenFloor 竞态，P1）
- [ ] 前端日志系统（文件而非 console，P1）
- [ ] #21 per-agent 可观测性 UI（P2）
- [ ] Open Floor 真正的 token 流式输出（P2）

## 相关文档

- ADR-009: Open Floor 架构决策（需更新）
- `src/main/ai/prompts/open-floor.ts` — Open Floor 系统指令
- `src/main/ai/agent-runtime.ts` — Agent 运行时 observation 处理
- `src/renderer/src/stores/chatStore.ts` — 前端状态管理（消息/Open Floor）
- `src/main/ai/orchestrator.ts` — 后端编排器
