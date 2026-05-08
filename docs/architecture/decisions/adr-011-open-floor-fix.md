# ADR-011: Open Floor 协作模式 — 11 层 Bug 修复与架构决策

> 状态：已采纳 | 日期：2026-05-08 | 作者：Cindy（@架构设计 复审）

## 背景

bytro-app v0.1.0 引入 Open Floor（自由讨论）模式，允许所有 Agent 同时参与讨论而非仅主 Agent 回复。初次上线后完全不可用：1/6 Agent 回复，5 个静默，第二条消息消失。

## 决策

### 发现过程：13 层 bug 链

经过系统排查，发现 13 层互锁的 bug，分为 4 类：

**机制层（L1-L8）**：消息传输链断裂
- `collaborationMode` 从未从前端传到后端
- Prompt 覆盖：硬编码指令覆盖了 Open Floor 系统 prompt
- 模式持久化缺失：第二条消息回退 orchestrated
- 规则冲突：7 条冗余规则互相矛盾
- UI 缺失：用户无法在对话中切换模式
- 状态初始化缺失：agent_observation 事件全被丢弃
- 错误静默：message.create 失败不可见
- Agent 未种入：首次启动无 Agent

**框架层（L9）**：Agent 身份定义错误
- Agent 被置于"判断是否参与"的评估者角色 → 默认选择静默
- 修复：改为"你是团队成员，直接分享"的邀请式框架

**持久化层（L10-L11）**：模式选择丢失
- `closeOpenFloor` 清除了用户的模式选择
- `sendMessage` 自己消费了 pending mode
- `isFirstMessage` gate 挡住了非首条消息的保存

**体验层（L12-L13）**：回复质量
- 批量推送：全部 Agent 回复同时出现 → 改为逐个推送
- Prompt 风格：任务报告式 → 改为 Slock 聊天式

### 架构裁定

1. **模式持久化双写**：前端用 `pendingCollaborationMode`（用户意图），后端用 `conversationModes`（持久化）。前端不消费、不清除；后端持久化作为 fallback。

2. **Open Floor cycle 隔离**：`closeOpenFloor` 删除 state entry 而非设为 'closed'，避免竞态覆盖新 round。并发场景的 round ID 隔离为 P1 后续改进。

3. **Agent 身份不统一**：不将 Open Floor 和 Orchestrated 的 Agent 身份合并。两种模式用不同的 system prompt 注入。动态身份切换（按需加载 open_floor 段落）为后续迭代。

4. **流式体验**：每个 Agent 完成时立即推送 observation 事件，不等全部完成。前端事件处理不做批处理。

5. **Prompt 哲学**：参与 > 完美。从"判断是否参与"→"邀请参与"→"像群聊一样自然说话"。不限制字数，不用结构化格式。

## 后果

**正面**：
- Open Floor 功能可用：消息发送、Agent 回复、模式切换、多轮对话
- Agent 回复更自然（Slock 聊天风格）
- 日志埋点到位（`[chatStore]` 前缀）

**负面**：
- 11 层 bug 发现依赖密集人工排查（缺少前端日志系统）
- 并发竞态防御不完整（需 round ID 隔离）

**待办**：
- 前端文件日志系统
- Agent role prompt 模板加 open_floor 段落
- Round ID 并发隔离
- Per-agent 可观测性 UI
