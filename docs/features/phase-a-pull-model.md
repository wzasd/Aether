# Phase A: Pull 模型改造 — Agent 工具调用 PRD

**版本**: 1.3  
**日期**: 2026-05-09  
**状态**: ✅ 已合并（commit `0b2f7b0`）  
**变更**: 
- v1.3 — **关键转向**：从"全量注入"改为"Agent 自 fetch via tool use"
- v1.3 — FR-2 重构：`claimAndExecute` 传入 `tools` 替代预注入 `context`
- v1.3 — FR-3 新增：XML `<tool_call>` 格式工具调用循环（轻量实现，provider 层零改动）
- v1.3 — 实现验证：311 pass / 0 fail / 3 skip, tsc 0 errors, build OK
**作者**: @需求文档师  
**关联 ADR**: ADR-013 (Daemon Architecture), ADR-014 (Agent Context Model)

---

## 1. 概述

### 1.1 问题陈述

当前 bytro 2.0 Daemon 的 `onMessageReply` 使用**机械触发模式**：

```typescript
// 当前（push 模型）
private onMessageReply(resident, event) {
  taskQueue.enqueue({
    message: `${payload.agentName} 回复了：\n${payload.content}\n你怎么看？`,
  })
}
```

这导致：
- Agent 看到的是**被裁剪过的孤立上下文**（"某某说了什么，你怎么看？"）
- 每个 reply 都触发新的 task，形成**事件触发链**
- 存在**消息膨胀风险**（N 个 Agent × 5 次上限 = 15-30 条消息）
- Agent 无法像 Slock 那样基于**完整对话历史**自主判断是否回应

### 1.2 目标

将 bytro 从"代码预拼上下文"改为**Agent 自主 fetch**：
- Agent 收到消息 → 调用 `read_messages` 工具获取历史 → 自主决策 → 回复/NO_REPLY
- 与 Slock `message read`、Multica `issue comment list` 机制一致

### 1.3 范围

| 在范围内 | 不在范围内 |
|---------|-----------|
| `runtime-registry.ts` 的 `onMessageReply` 改造 | Agent Memory（Phase B） |
| `claimAndExecute` 的 tools 注入 | Channel 抽象层 |
| `agent-runtime.ts` 的 tool call loop | UI 改动 |
| 测试重写 | 数据库 schema 变更 |

---

## 2. 架构变更

### 2.1 当前模型（Push + 预注入）

```
用户消息 → bus.publish('message:new') 
  → Agent A enqueue → claim → execute → reply
    → bus.publish('message:reply', actorId='A')
      → onMessageReply → Agent B enqueue("A 说了 X，你怎么看？")
        → Agent B claim → execute → reply
          → bus.publish('message:reply', actorId='B')
            → onMessageReply → Agent C enqueue("B 说了 Y，你怎么看？")
              → ... 🔁 循环风险
```

### 2.2 目标模型（Pull + Agent 自 fetch）

```
用户消息 → bus.publish('message:new')
  → Agent A enqueue → claim → execute
    → Agent A: TOOL:read_messages(50) → 拿到完整历史
    → Agent A: "我有话说" → reply
    → bus.publish('message:reply', actorId='A')
      → onMessageReply → 记录到 conversationContext（不做 enqueue！）
        
Agent B 下一次 poll → claim → execute
  → Agent B: TOOL:read_messages(50) → 拿到完整历史（含 A 的回复）
  → Agent B: "A 已经说了我想说的" → NO_REPLY
    → 自然收敛 ✅
```

**关键差异**：
- Push：每个 reply 创建新 task，代码预拼上下文，强制 Agent 回应
- Pull：reply 只丰富上下文，Agent 自己 fetch 历史，自主决策

---

## 3. 功能需求

### FR-1: `onMessageReply` 去 enqueue

**描述**: `onMessageReply` 不再创建新的 follow-up task。

**当前代码**:
```typescript
private onMessageReply(resident, event) {
  if (event.actorId === resident.profile.id) return
  taskQueue.enqueue({
    conversationId: event.conversationId,
    agentProfileId: resident.profile.id,
    message: `${event.payload.agentName} 回复了：\n${event.payload.content}\n\n你怎么看？`,
  })
}
```

**目标代码**:
```typescript
private onMessageReply(resident, event) {
  // 不再 enqueue。Agent 下次 poll 时通过 tool 调用获取完整历史。
  // 可选：记录到 conversationContext 用于调试/可观测性
  this.conversationContexts
    .get(event.conversationId)
    ?.push(event.payload)
}
```

### FR-2: `claimAndExecute` 注入 Tools

**描述**: Agent 执行时，不再预注入 `context`，而是传入 `tools` 让 Agent 自主 fetch。

**当前代码**:
```typescript
const context = task.context 
  ? JSON.parse(task.context) as Array<{ role: string; content: string }> 
  : []

const result = await resident.runtime.onObservation({
  conversationId: task.conversationId,
  message: task.message,
  context,  // ← 当前为空数组
  collaborationMode: 'open_floor',
})
```

**目标代码**:
```typescript
// 不再预注入 context，而是传入 tools
const tools = {
  readMessages: async (limit = 50) => {
    const msgs = await db.getMessages(task.conversationId, { limit, order: 'desc' })
    return msgs.map(m => `[${m.role}]: ${m.content}`).join('\n')
  }
}

const result = await resident.runtime.onObservation({
  conversationId: task.conversationId,
  message: task.message,
  tools,    // ← 传入工具，Agent 自己 fetch
  collaborationMode: 'open_floor',
})
```

### FR-3: Tool Call Loop（工具调用循环）

**描述**: `agent-runtime.ts` 的 `generateObservationReply` 改为支持 tool call loop，让 Agent 能调用工具获取历史。

**实现方式**: XML `<tool_call>` 格式（轻量实现，不依赖 provider 层 native tool_use）

**为什么用 XML 而非 native tool_use**：
- 不修改 provider 层（`base-cli-provider.ts` 只需 `parent_tool_use_id` 参数化）
- 所有 LLM provider 兼容（不限于 Claude CLI）
- 解析在 agent-runtime 层完成，不依赖 stream-json 事件格式

**实现**:

```typescript
// agent-runtime.ts
async generateObservationReply(obs: ObservationWithTools): Promise<string> {
  const tempSession = await aiEngine.startSession(fullConfig)
  this.observationSessionId = tempSession.id
  
  try {
    // 构建带 tool 定义的 prompt
    const prompt = this.buildOpenFloorPrompt(obs)
    aiEngine.sendMessage(tempSession.id, prompt)
    
    let reply = ''
    let toolCallCount = 0
    const MAX_TOOL_CALLS = 5
    
    while (toolCallCount < MAX_TOOL_CALLS) {
      const response = await this.waitForResponse(tempSession.id)
      reply = response.text
      
      // 解析 XML 格式的 tool_call
      const toolCall = this.parseToolCall(response.text)
      if (!toolCall) break // Agent 没有调用工具，直接回复
      
      toolCallCount++
      
      // 执行工具
      const toolResult = await this.executeTool(toolCall, obs.tools)
      
      // 将 tool_result 回传给 Agent（作为新的 user 消息）
      const toolResultPrompt = this.formatToolResult(toolCall, toolResult)
      aiEngine.sendMessage(tempSession.id, toolResultPrompt)
    }
    
    return reply
  } finally {
    this.observationSessionId = null
    await aiEngine.endSession(tempSession.id).catch(() => {})
  }
}

// 解析 Agent 回复中的 <tool_call> XML
private parseToolCall(text: string): { name: string; parameters: Record<string, unknown> } | null {
  const match = text.match(/<tool_call>\s*<name>(\w+)<\/name>\s*<parameters>(.*?)<\/parameters>\s*<\/tool_call>/s)
  if (!match) return null
  
  try {
    return {
      name: match[1],
      parameters: JSON.parse(match[2])
    }
  } catch {
    return null // 无效 JSON，忽略 tool call
  }
}

// 执行工具
private async executeTool(
  toolCall: { name: string; parameters: Record<string, unknown> },
  tools: Record<string, ToolHandler>
): Promise<string> {
  const handler = tools[toolCall.name]
  if (!handler) return `Error: unknown tool "${toolCall.name}"`
  
  try {
    const result = await handler(toolCall.parameters)
    return typeof result === 'string' ? result : JSON.stringify(result)
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// 格式化 tool_result 为 prompt
private formatToolResult(
  toolCall: { name: string; parameters: Record<string, unknown> },
  result: string
): string {
  return `<tool_result>\n<name>${toolCall.name}</name>\n<result>${result}</result>\n</tool_result>`
}
```

**Tool 定义（注入到 system prompt）**:

```markdown
你可以使用以下工具获取更多信息：

## read_messages
读取当前对话的历史消息。
参数：
- limit (number, optional): 读取最近 N 条消息，默认 50

使用格式（严格按此 XML 格式输出）：
<tool_call>
<name>readMessages</name>
<parameters>{"limit": 50}</parameters>
</tool_call>

如果你需要看历史再做判断，请先调用此工具。
```

### FR-4: Agent Prompt 更新

**描述**: Agent 的 system prompt 需要引导 Agent 自主 fetch 历史并决策。

**新增 prompt 段落**:
```markdown
## 你的工作方式

1. 收到消息后，先判断是否需要看历史上下文
2. 如果需要，调用 read_messages(limit) 工具获取最近消息
3. 基于完整上下文判断：
   - 你是否需要补充、反对、或进一步讨论？
   - 如果其他 Agent 已经说了你想说的，不需要重复
   - 如果没有实质性新观点，直接回复 NO_REPLY
4. 不需要 @mention 其他 Agent 作为 sign-off（会重新触发循环）
```

### FR-5: 自然收敛检测

**描述**: 当所有 Agent 连续两轮 NO_REPLY 时，自动关闭 conversation。

**规则**:
```typescript
// 检测逻辑
const allSilent = residents.every(r => 
  r.lastReplyTime === null || // 从未回复
  r.consecutiveNoReply >= 2    // 连续两次 NO_REPLY
)

if (allSilent) {
  bus.publish({ type: 'open_floor:closed', reason: 'natural_convergence' })
}
```

---

## 4. 非功能需求

### NFR-1: 向后兼容

- `onObservation` 接口扩展：新增可选 `tools` 参数，现有调用不受影响
- `context` 参数保留但不再由 `claimAndExecute` 预注入
- 现有 Orchestrated 模式不受影响

### NFR-2: 性能

- `getConversationMessages` 查询需要索引支持：`idx_messages_conversation_created`
- DB 查询设安全上限（50 条，对齐 Slock/Multica 默认行为）防止极端 IO 情况

### NFR-3: 可观测性

- `onMessageReply` 改为记录日志而非 enqueue
- 保留 `conversationContexts` 用于调试
- **tool call 日志**（必须）：`console.debug(`[AgentRuntime] ${profile.name} tool_call: ${name}(${args})`)`

---

## 5. 测试需求

### 测试重写清单

| 测试文件 | 改动 | 说明 |
|----------|------|------|
| `runtime-registry.test.ts` | 重写 | `onMessageReply` 不再 enqueue；`claimAndExecute` 传 tools 而非 context |
| `daemon.test.ts` | 适配 | 验证 tool 注入行为 |
| `orchestrator-open-floor.test.ts` | 适配 | 验证 Agent tool call 流程 |
| `agent-runtime.test.ts` | 新增 | 验证 tool call loop |

### 新增测试场景

- [ ] Agent 调用 `read_messages` 工具获取历史
- [ ] Agent 获取历史后选择 NO_REPLY
- [ ] Agent 获取历史后选择回复
- [ ] Tool call 失败时优雅降级（直接基于当前消息回复）
- [ ] 自然收敛检测（全员 NO_REPLY 后关闭）
- [ ] DB limit = 50 时返回正确数量的消息

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Tool call 循环出错 | 中 | 高 | 超时保护 + 降级到直接回复 |
| LLM 不调用工具直接回复 | 中 | 中 | Prompt 强化引导 + 观察调整 |
| Agent 不回复（全 NO_REPLY） | 低 | 中 | 自然收敛检测 + 用户可重触发 |
| 测试重写遗漏 | 中 | 中 | 全面覆盖 runtime-registry + agent-runtime 测试 |
| `parseToolCall` 正则误匹配 | 中 | 中 | 锚定到回复末尾，避免代码块误匹配 |

---

## 7. 验收标准

- [x] `onMessageReply` 不再 enqueue follow-up task
- [x] `claimAndExecute` 传入 `tools` 替代预注入 `context`
- [x] Agent 能调用 `read_messages` 工具获取对话历史
- [x] Agent 基于自主获取的历史决策（NO_REPLY 或回复）
- [x] Tool call 失败时有降级机制
- [x] `parseToolCall` 正则锚定到回复末尾（原始实现已包含 `$`）
- [x] 自然收敛检测生效（全员 NO_REPLY 后关闭）
- [x] 所有测试通过（含 tool call loop 测试）
- [x] Typecheck 0 errors

---

## 8. 实现检查清单

- [ ] `runtime-registry.ts`: 删除 `onMessageReply` 的 enqueue 逻辑
- [ ] `runtime-registry.ts`: `claimAndExecute` 传入 `tools` 替代 `context`
- [ ] `runtime-registry.ts`: 添加 `getConversationMessages()` 作为 tool handler
- [ ] `agent-runtime.ts`: `generateObservationReply` 支持 tool call loop
- [ ] `agent-runtime.ts`: 处理 `tool_start` 事件并执行对应 tool
- [ ] `agent-runtime.ts`: 发送 `tool_result` 回 LLM 并等待最终回复
- [ ] `agent-runtime.ts`: 更新 prompt 模板（引导 Agent 使用工具）
- [ ] `a2a-types.ts`: 扩展 `Observation` 类型（新增 `tools` 字段）
- [ ] 测试: 重写 `runtime-registry.test.ts`
- [ ] 测试: 新增 `agent-runtime.test.ts`（tool call loop）
- [ ] 测试: 适配 `daemon.test.ts`
- [ ] 测试: 新增自然收敛测试
