---
status: gap-fill-complete
priority: P3
last_verified: 2026-05-07
doc_kind: feature
---

# Feature: Multi-Agent Collaboration（多 Agent 协作）

## Why（为什么做）

复杂任务用单个 Agent 效率有限。让 Planner 分解计划、Coder 实现代码、Reviewer 审查变更，各 Agent 专职分工，能处理更复杂的工程任务。

## What（功能需求）

| 编号 | 需求 | 状态 |
|------|------|------|
| D1 | Agent Profile 配置生效（Settings → Agents 真正影响运行时） | ✅ |
| D2 | 角色→Provider 映射（Planner/Coder/Reviewer 各用不同 model） | ✅ |
| D3 | 任务内 Agent 切换（Composer `@` 触发自动补全） | ✅ |
| D4 | Agent 自主 `@mention` 委托（输出含 `@AgentName:` 时自动路由） | ✅ |
| D5 | 串行执行队列 + 循环检测 | ✅ |
| D6 | 消息 Agent 来源徽章显示 | ✅ |
| D7 | 完整 Context Packet 选择器（关键词评分 + 角色过滤 + token 预算） | ✅ |
| D8 | Memory Palace 候选提取（任务完成自动提炼决策/惯例/反模式） | ✅ |
| D9 | Per-task 流式缓冲区（并行多 Agent 输出不混叠） | ✅ |
| D10 | 并行执行模式解锁 | ✅ |
| D11 | A2A 任务队列 UI（Agent Activity Panel） | ✅ |
| D12 | InvocationQueue 优先级队列 + 僵尸防御 + **幂等键去重** | ✅ |
| D13 | ContinuityCapsule 会话封印/续传 + **`formatContinuationPrompt` 注入** + **`chainIndex/chainTotal`** | ✅ |
| D14 | ReflowOrchestrator 并行结果聚合 + **AbortController 取消追踪** | ✅ |
| D15 | ACP 动态模型切换（`session/set_model`） | ✅ |
| D16 | Chain-level Memory Distillation | ✅ |
| D17 | drainSerialQueue microtask yield（修复 feedback task 永久排队） | ✅ |
| D18 | Observability 日志接入（orchestrator 12 种事件埋点 + IPC 读取接口） | ✅ |

## Status（当前状态）

✅ **Milestone 2 + Gap Fill 完成。** 多 Agent 协作全部功能可用，A2A 编排能力超越 clowder-ai 基线。

- 5-Layer Pipeline：Intent → Policy → Routing → Context → Task Execution
- Serial/Parallel 执行模式
- Chain Callback（completionHooks + feedback task）
- InvocationQueue 优先级队列 + 僵尸防御 + 幂等键去重
- ContinuityCapsule 会话封印/续传（`formatContinuationPrompt` 注入 Agent 消息，`chainIndex/chainTotal` 链位置追踪）
- ReflowOrchestrator 并行多 Agent 结果聚合 + AbortController 取消追踪
- ACP 动态模型切换（`session/set_model`）
- Chain-level Memory Distillation
- drainSerialQueue microtask yield（修复 feedback task 永久排队 bug）
- Observability 日志接入（orchestrator 12 种事件埋点 + IPC 读取接口，详见 `docs/architecture/observability-logging.md`）

详见架构文档：
- `docs/architecture/multi-agent-a2a-orchestration.md`
- `docs/architecture/acp-protocol-leverage.md`
- `docs/architecture/a2a-memory-bridge.md`

## Code（代码位置）

- 主调度器：`src/main/ai/orchestrator.ts`
- Agent 运行时：`src/main/ai/agent-runtime.ts`
- Mention 解析：`src/main/ai/mention-parser.ts`
- Context Packet 选择器：`src/main/ai/context-selector.ts`
- Memory 候选提取：`src/main/ai/memory-extractor.ts`
- 优先级队列：`src/main/ai/invocation-queue.ts`
- 会话胶囊：`src/main/ai/continuity-capsule.ts`
- 结果聚合器：`src/main/ai/reflow-orchestrator.ts`
- 链级记忆蒸馏：`src/main/ai/a2a-memory-distiller.ts`
- 日志核心：`src/main/core/logging.ts`
- 日志 IPC：`src/main/ipc/logs.ts`
- 前端状态：`src/renderer/src/stores/a2aStore.ts`
- 流式缓冲：`src/renderer/src/stores/chatStore.ts` (`taskStreams`)
- Agent 徽章：`src/renderer/src/components/chat/AgentBadge.tsx`
- Agent 活动面板：`src/renderer/src/components/workspace/AgentActivityPanel.tsx`
