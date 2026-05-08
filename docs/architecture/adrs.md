---
adr: 002
title: AgentTeam Pipeline 触发模型
status: proposed
date: 2026-05-05
---

# ADR-002: AgentTeam Pipeline 触发模型

## 背景

需要决定 AgentTeam 的 pipeline 如何触发 sub-agent（特别是 Codex reviewer），以及 feedback 如何回传主 agent。

有三种候选方案：

### 方案 A：纯 @mention（现有机制扩展）
Claude 的 system prompt 里写明"写完代码要 @Codex review"，靠 Claude 自己 @。

**问题**：Claude 可能忘记，或者 @了但 task content 不规范。不可靠，不一致。

### 方案 B：Orchestrator 自动 pipeline（本 ADR 采用）
Orchestrator 在 primary agent task 完成后，主动检查是否有文件变更，有则创建 reviewer task，reviewer 完成后把结果作为 system_message 推回对话。

**优点**：确定性触发，不依赖 LLM 行为，日志可追踪。  
**缺点**：orchestrator 变复杂，需要 team_id 在 DB 里持久化。

### 方案 C：用户手动触发 review
在 UI 加"Request Review"按钮，点了才触发 Codex。

**问题**：摩擦太高，失去自动化价值。

## 决策

采用方案 B。

理由：
- 一致性是 team 模式的核心价值。如果触发不一致，用户感知就是"team 模式和 solo 没区别，只是慢了"
- Orchestrator 已有 `serial queue` 机制，pipeline task 复用相同模型
- feedback 以 `system_message` 形式出现，不污染对话流，用户可见但不可 @reply

## 约束

- Pipeline 只在 `task.depth === 0` 触发，防止 review task 再触发 pipeline（循环）
- `trigger: 'on-code-change'` 检测通过查询 `file_changes` 表实现，不解析 Claude 输出
- Reviewer 失败不阻塞：发 system_message 告知，Claude 继续工作

---

# ADR-003: 记忆注入时机

## 背景

记忆可以在以下时机注入：
1. 对话创建时（一次性）
2. 每条用户消息发送前
3. 每次 Agent task 开始前

## 决策

采用方案 2（每条用户消息发送前，限定在 `depth=0` 即主 agent）。

理由：
- 方案 1 太早：对话创建时没有用户意图，FTS 无从查起
- 方案 2 合适：用户消息是最好的 FTS hint，注入前 100 字查记忆
- 方案 3 冗余：sub-agent 已通过 contextSnapshot 获得项目记忆，无需双重注入

约束：
- 只在 `task.depth === 0` 注入（主 agent 第一层）
- 注入 token < 1500，超出截断
- 注入内容放在 `appendSystemPrompt` 末尾，不改 user message 本身

---

# ADR-004: contextSnapshot 格式

## 背景

contextSnapshot 格式影响 sub-agent 的信息理解质量。纯文本 vs 结构化 Markdown。

## 决策

使用结构化 Markdown，固定 Section 名称，每 section 有否渲染逻辑。

理由：
- 固定格式让 LLM 预期在哪里找什么信息（[TASK HANDOFF] 是委托，[PROJECT MEMORY] 是背景知识）
- 有否渲染避免空 section（"[PROJECT MEMORY]\n（无）"这类噪音）
- token 效率更高：摘要比截断碎片信息密度高
