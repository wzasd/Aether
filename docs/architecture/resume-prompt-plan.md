# ResumePrompt 技术方案

## 背景

bytro-app 的 spawn provider（Kimi/Codex/Gemini 等）每轮对话后进程退出，第二轮无法通过 `--resume <sessionId>` 恢复上下文。`supportsCrossTurnResume` PR 已阻止 stale session ID 传递，但 spawn provider 因此失去了跨 turn 上下文记忆。

Slock 0.48.0 引入了 **resumePrompt** 机制：agent resume 时注入上下文恢复文本，让 agent 知道之前的对话状态。bytro-app 需要对齐这个机制。

## 目标

- 对 **spawn provider**（`supportsCrossTurnResume = false`）：每轮新 spawn 时注入 resumeContext 文本，替代 `--resume session ID`
- 对 **PTY/stateful provider**（`supportsCrossTurnResume = true`）：保持现有 `--resume` 机制不变
- resumeContext 有 **token 硬上限**（默认 800 tokens），防止挤占正常 system prompt

## 方案概述

```
Turn 1: User message → AgentRuntime(spawn) → execute → 生成 resumeContext → 存储
Turn 2: User message → 读取 resumeContext → 注入 AgentRuntime.start() appendSystemPrompt → 新 spawn
```

## 改动范围

### 1. Orchestrator 层 — 存储与传递 resumeContext

**新增状态** (`orchestrator.ts`):
```typescript
private resumeContexts: Map<string, string> = new Map()
// Key: `${conversationId}:${profile.id}:${providerType}`
```

**捕获时机** (`executeTask` finally/catch 块):
- 任务完成后，从 `accumulatedOutput`、`task.status`、`terminalError` 生成结构化 resumeContext
- 任务失败后，记录错误原因和未完成事项
- 仅对 `supportsCrossTurnResume = false` 的 provider 存储

**传递时机** (`sendUserMessage` orchestrated 分支):
- 读取 `resumeContexts`（同 `primarySessionIds` 的 key 规则）
- 若 provider 不支持 resume，且存在 resumeContext，注入 `SessionConfig.appendSystemPrompt`

### 2. AgentRuntime 层 — 接收与注入

**`AgentRuntime.start()`**:
- `SessionConfig` 新增可选字段 `resumeContext?: string`
- 若存在 `resumeContext`，拼接到 `appendSystemPrompt` 末尾：
  ```
  ## 上一轮上下文摘要

  <resumeContext>

  请基于以上上下文继续工作。
  ```

### 3. ResumeContext 生成逻辑

**输入**:
- `accumulatedOutput`: agent 上一轮完整输出文本
- `task.status`: 'completed' | 'failed'
- `terminalError`: 错误信息（如有）
- `pendingMentionDispatch`: 是否有未完成的 @mention 委托
- `childTasks`: 子任务完成情况（从 DB 查询）

**输出格式**（结构化文本，便于 LLM 理解）:
```markdown
- 状态: 已完成 / 失败 / 中断
- 主要工作: <accumulatedOutput 的前 300 字符摘要>
- 关键决策: <从输出中提取的决策点>
- 未完成事项: <未完成的工具调用 / 子任务>
- 错误信息: <如有>
```

**Token 控制**:
- 硬上限 800 tokens（按字符数估算：1 token ≈ 4 字符，上限 3200 字符）
- 超长时截断 `accumulatedOutput`，优先保留"未完成事项"和"错误信息"

### 4. Provider 层 — 无改动

Spawn provider 的 `buildStreamJsonArgs` / `buildManualArgs` 继续忽略 `_resume` 参数，不传递 `--resume`。resume 完全通过文本注入实现。

## 数据流

```
[Turn 1 结束]
executeTask
  ├─ accumulatedOutput = "完成了代码审查，发现 3 个问题..."
  ├─ task.status = "completed"
  └─ generateResumeContext() → "状态: 已完成。主要工作: 完成 PR-4 代码审查..."
       └─ resumeContexts.set(key, context)

[Turn 2 开始]
sendUserMessage
  ├─ provider = Kimi (supportsCrossTurnResume = false)
  ├─ resumeContext = resumeContexts.get(key)
  └─ SessionConfig = { ..., appendSystemPrompt: "...\n\n## 上一轮上下文摘要\n..." }
       └─ AgentRuntime.start(config)
            └─ systemPromptParts.push(resumeContextBlock)
```

## 与现有机制的衔接

| 机制 | 作用范围 | 与 resumePrompt 的关系 |
|------|---------|----------------------|
| `primarySessionIds` + `--resume` | PTY provider（Claude/OpenCode） | 保持不变，resumePrompt 不影响 |
| `supportsCrossTurnResume` | 区分 provider 类型 | resumePrompt 仅对 false 的 provider 生效 |
| `ContinuityCapsule` | 任务链级 session 恢复 | resumePrompt 是 capsule 的文本化补充 |
| `Memory Injection` | workspace 级长期记忆 | resumePrompt 是 turn 级短期记忆，互补 |
| `context-assembler.ts` | 对话历史注入 | resumePrompt 浓缩历史，减少 token 消耗 |

## 实现步骤

1. **新增 `generateResumeContext()` 工具函数**
   - 文件：`src/main/ai/resume-context.ts`
   - 输入：task, accumulatedOutput, terminalError
   - 输出：结构化文本，带 token 截断

2. **修改 `orchestrator.ts`**
   - 新增 `resumeContexts` Map
   - `executeTask` 完成后调用 `generateResumeContext()` 并存储
   - `sendUserMessage` 读取并注入 `SessionConfig`

3. **修改 `agent-runtime.ts`**
   - `start()` 接收 `resumeContext` 并注入 system prompt

4. **修改 `provider.ts`**
   - `SessionConfig` 新增 `resumeContext?: string`

5. **测试**
   - 单元测试：`resume-context.test.ts`
   - 集成测试：`orchestrator-resume.test.ts`

## Token 预算估算

以典型 system prompt 为例：
- Base system prompt: ~1500 tokens
- Agent card / team members: ~500 tokens
- Memory injection: ~800 tokens
- **resumeContext: ~800 tokens（上限）**
- 总计: ~3600 tokens（在 128k/200k context window 内安全）

## 备选方案

**方案 B：不走 resumeContext，直接扩大 context-assembler 的 history limit**
- 缺点：每轮都注入完整历史，token 爆炸；spawn provider 的进程生命周期短，history 可能不完整

**方案 C：让 spawn provider 自己管理 session 文件**
- 缺点：依赖 CLI 内部实现，Kimi/Codex 等不一定支持；换 provider 时 session 丢失

## 建议

采用本方案（resumePrompt 文本注入），理由：
1. 与 Slock 0.48.0 对齐，架构一致
2. 不依赖 CLI 内部 session 持久化，provider 无关
3. token 可控，可精确决定保留哪些上下文
4. 和 `supportsCrossTurnResume` 机制完美互补
