---
feature: agent-a2a-output-scan
status: design
priority: P1
doc_kind: feature
created: 2026-05-07
---

# Feature: Agent A2A Output Scanning — Agent 输出中自动检测 @mention 并路由

## 问题陈述

当前 Bytro 的 A2A 路由依赖用户显式输入 `@AgentName:` 触发。Agent 之间无法自主协作——Claude 写了一堆代码后想交给 Codex review，必须等用户手动 @Codex。这违背了"Agent 可以@另一个 agent 处理问题"的设计意图。

Clowder AI 的解决方式是：**Agent 输出完成后扫描文本，发现行首 @mention 就自动追加到执行队列**。Bytro 需要引入相同的机制。

## 目标

1. Agent 输出文本中出现**行首 @mention** 时，自动路由到目标 agent，无需用户手动触发
2. 被路由的 agent 输出写入**统一对话时间线**，所有参与者共享上下文
3. 深度限制 + ping-pong 检测防止无限递归
4. Agent Activity 面板正确显示 `AgentA → AgentB` 的 handoff 关系

## 非目标

- 行内 @mention 路由（如"你可以找 @Codex 看看"这种非行首的）— 仅用于 UI 提示，不自动触发
- Agent 输出中的代码块内 @mention 不触发路由
- 跨 conversation 的 A2A（每个 conversation 独立）
- 用户消息中的 @mention 逻辑不变（已有 `mention-parser.ts`）

---

## 架构设计

### 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│  AgentRuntime.start() 完成                                    │
│        ↓                                                      │
│  scanAgentOutput(fullResponseText, profile.id)               │
│        ↓                                                      │
│  发现行首 @mention → 构建 A2ATask → 注入 Orchestrator Queue   │
│        ↓                                                      │
│  Orchestrator.drainSerialQueue() 消费队列                     │
│        ↓                                                      │
│  目标 AgentRuntime.start() → 输出写入统一时间线               │
│        ↓                                                      │
│  再次扫描 → 可能发现新的 @mention → 追加队列                  │
└─────────────────────────────────────────────────────────────┘
```

关键概念：

| 概念 | 说明 |
|------|------|
| **Output Scanner** | 从 agent 完整输出中提取行首 @mention 的函数 |
| **Worklist** | Orchestrator 中维护的串行执行数组，支持动态追加 |
| **Unified Timeline** | 所有 agent（含被@的）输出都写入 `messages` 表，共享上下文 |
| **A2A Handoff** | Agent A 的输出触发 Agent B 执行的过渡事件 |
| **Depth** | A2A 委托深度，根任务 depth=0，每跳 +1 |
| **Ping-Pong Streak** | A→B→A→B 的循环检测，基于实质性输出长度判断 |

### 与现有 Orchestrator 的集成

当前 Orchestrator 已有 `serialQueues` 用于串行执行，但它是预先生成的。新机制改为**动态 worklist**：

```typescript
// 当前：预先生成所有任务
serialQueue = [task1, task2, task3]
for task in serialQueue: execute(task)

// 新机制：动态扩展
worklist = [initialTask]
for (let i = 0; i < worklist.length; i++) {
  const result = await execute(worklist[i])
  const mentions = scanAgentOutput(result.text, worklist[i].profileId)
  for (const m of mentions) {
    if (depth < MAX && !isPingPong(m)) {
      worklist.push(buildA2ATask(m))
    }
  }
}
```

---

## 详细设计

### 1. Output Scanner — `src/main/ai/agent-output-scanner.ts`

新模块，负责从 agent 输出中提取行首 @mention。

#### 扫描规则

1. **剥离代码块**：` ```...``` ` 内的内容不参与扫描
2. **行首匹配**：仅匹配行首（可带前导空白）的 `@mention`
3. **长匹配优先**：`@Codex` 优先于 `@C`，避免前缀误命中
4. **Token boundary**：`@Codex123` 不算命中 `@Codex`
5. **过滤自调用**：Agent A 输出中的 `@A` 不路由
6. **上限**：单条消息最多触发 2 个 A2A 目标（避免 spam）

```typescript
export interface ScannedMention {
  targetProfileId: string
  targetName: string
  mentionText: string    // 原始 @mention 文本
  lineContent: string    // 整行内容（用于上下文理解）
}

export function scanAgentOutput(
  text: string,
  currentProfileId: string,
  availableProfiles: AgentProfile[]
): ScannedMention[]
```

#### 扫描算法

```
输入: text, currentProfileId, availableProfiles
输出: ScannedMention[]

1. stripped = text.replace(/```[\s\S]*?```/g, '')
2. 为每个 availableProfiles 构建 mentionPatterns（含 name + 可能的 aliases）
3. patterns 按长度降序排序
4. for each line in stripped.split('\n'):
     trimmed = line.trimStart()
     if !trimmed.startsWith('@'): continue
     for each pattern in patterns (longest first):
       if trimmed.startsWith(pattern):
         rest = trimmed.slice(pattern.length)
         if rest[0] 是字母/数字/下划线: continue  // token boundary 失败
         if pattern 对应 profileId == currentProfileId: continue
         result.push({ targetProfileId, targetName, ... })
         if result.length >= 2: break all
         break  // longest-match: 当前位置已锁定
5. return result
```

### 2. Worklist 动态扩展 — `src/main/ai/orchestrator.ts`

修改 `drainSerialQueue` 为支持中途追加。

```typescript
private async drainSerialQueue(
  conversationId: string,
  executionMode: ExecutionMode,
  webContents: WebContents
): Promise<void> {
  const worklist = this.serialQueues.get(conversationId) ?? []
  
  for (let i = 0; i < worklist.length; i++) {
    const task = worklist[i]
    const result = await this.executeTask(task, executionMode, webContents)
    
    // === 新增：Agent 输出扫描 ===
    const mentions = scanAgentOutput(
      result.text,
      task.toProfileId,
      this.getTeamMembers(conversationId)
    )
    
    for (const mention of mentions) {
      if (task.depth >= MAX_DELEGATION_DEPTH) {
        this.emitSystemInfo(conversationId, `A2A depth limit (${MAX_DELEGATION_DEPTH}) reached`)
        continue
      }
      
      if (this.isPingPong(task.chain, mention.targetProfileId)) {
        this.emitSystemInfo(conversationId, `Ping-pong detected, blocking ${mention.targetName}`)
        continue
      }
      
      // 创建新 task 并追加到 worklist
      const newTask = this.buildA2ATaskFromScan(
        conversationId,
        task,
        mention,
        result.text
      )
      worklist.push(newTask)
      
      // 通知 UI
      this.emitHandoff(conversationId, task.toProfileId, mention.targetProfileId)
    }
    
    // 写入统一时间线（见 §3）
    await this.persistAgentOutput(conversationId, task, result)
  }
  
  this.serialQueues.delete(conversationId)
}
```

### 3. 统一对话时间线

当前问题：主 agent 输出走正常消息流，被 @的 agent 走 `A2ATask` 记录，两者分离。

**目标**：所有 agent 输出都写入 `messages` 表，用 `agent_profile_id` 区分来源。

```typescript
private async persistAgentOutput(
  conversationId: string,
  task: A2ATask,
  result: { text: string; toolCalls?: ToolCall[] }
): Promise<void> {
  const db = getDb()
  
  db.prepare(`
    INSERT INTO messages (conversation_id, role, content, agent_profile_id, created_at)
    VALUES (?, 'assistant', ?, ?, ?)
  `).run(conversationId, result.text, task.toProfileId, Date.now())
  
  // 同时更新 A2ATask 记录（保持向后兼容）
  db.prepare(`
    UPDATE a2a_tasks SET status = 'completed', result = ?, completed_at = ?
    WHERE id = ?
  `).run(result.text, Date.now(), task.id)
}
```

**关键改动**：
- `AgentRuntime` 完成输出后，**不再只通过 IPC 发送给 renderer**，而是先写入 `messages` 表
- Renderer 通过已有的消息加载机制看到新消息（可能需要刷新或 push 通知）
- Agent 启动时读取对话历史，自然包含其他 agent 的输出

### 4. 深度限制与 Ping-Pong 检测

**深度限制**：
- `MAX_DELEGATION_DEPTH = 5`（已存在）
- 根任务 depth=0，每 A2A 一跳 +1
- 超过限制时 emit system_info，不阻断用户消息

**Ping-Pong 检测**：

```typescript
function isPingPong(chain: string[], nextProfileId: string): boolean {
  // chain: ['claude', 'codex', 'claude', 'codex']
  // 检查末尾是否形成 A→B→A→B 模式（streak >= 3 对）
  if (chain.length < 3) return false
  
  const last3 = chain.slice(-3)
  const newChain = [...last3, nextProfileId]
  
  // 检测 A-B-A-B 模式
  const len = newChain.length
  if (len >= 4) {
    const a = newChain[len - 4]
    const b = newChain[len - 3]
    const c = newChain[len - 2]
    const d = newChain[len - 1]
    if (a === c && b === d && a !== b) return true
  }
  return false
}
```

> 简单版：连续 3 次在 2 个 agent 之间来回，就判定 ping-pong。Clowder 的复杂版基于"实质性工具调用"判断，但 Bytro 先做简单版。

### 5. Agent Activity Panel 更新

A2A handoff 事件需要通知 UI：

```typescript
// 新增 IPC 事件
'a2a:handoff' → {
  conversationId: string
  fromProfileId: string
  toProfileId: string
  triggerMessageId?: string  // 可选：触发 handoff 的消息 ID
}
```

UI 收到后：
1. 在 Agent Activity Panel 中画一条 `from → to` 的边
2. Edge type = `agent-mention`
3. Label = `@${toName}`

---

## 边界情况与决策

| 情况 | 处理方式 |
|------|----------|
| Agent 输出多行 @mention | 每行独立扫描，但总数上限 2 个目标 |
| Agent 输出中 @自己 | 过滤自调用，不路由 |
| 目标 agent 未启用/不存在 | emit system_info 告知用户，不阻断流程 |
| 深度超限 | emit system_info，agent 输出正常显示 |
| Ping-pong 检测命中 | emit system_info，阻断本次 A2A，agent 输出正常显示 |
| 用户消息和 A2A 同时排队 | 用户消息优先（公平门控，可选实现） |
| Agent 输出中有 @mention 但用户正在打字 | 先完成 A2A，不中断用户输入 |
| Solo 模式下 agent @mention | 正常触发 A2A，Solo/Team 模式不影响输出扫描 |

---

## 实现计划

### Phase 1: Output Scanner（纯新增，无风险）

**文件：**
- `src/main/ai/agent-output-scanner.ts`（新）— 扫描逻辑
- `src/main/ai/agent-output-scanner.test.ts`（新）— 单元测试

**验收：**
- [ ] `scanAgentOutput()` 正确识别行首 @mention
- [ ] 代码块内的 @mention 被忽略
- [ ] 长匹配优先（`@Codex` 优先于 `@C`）
- [ ] 自调用被过滤
- [ ] 总数上限 2 个
- [ ] 全部边界情况有测试

### Phase 2: Worklist 动态扩展

**文件：**
- `src/main/ai/orchestrator.ts` — 修改 `drainSerialQueue`
- `src/main/ai/a2a-types.ts` — `A2ATask` 增加 `source: 'user' \| 'agent-scan'`

**关键改动：**
```typescript
// a2a-types.ts
export interface A2ATask {
  // ...existing fields
  source: 'user' | 'agent-scan'  // 区分用户触发 vs agent 输出扫描触发
}
```

**验收：**
- [ ] Claude 输出 `@Codex: review this` → Codex 自动执行
- [ ] Codex 输出中无 @mention → 队列正常结束
- [ ] 深度超限 → 显示 system_info，不触发路由

### Phase 3: 统一时间线

**文件：**
- `src/main/ai/orchestrator.ts` — `persistAgentOutput()`
- `src/main/ai/agent-runtime.ts` — 完成输出后调用 persist
- `src/main/core/db.ts` — 确认 `messages.agent_profile_id` 已存在

**验收：**
- [ ] Codex 的回复出现在对话流中
- [ ] Codex 回复带正确的 AgentBadge
- [ ] 重新打开对话，历史消息中可见所有 agent 输出

### Phase 4: Ping-Pong 检测

**文件：**
- `src/main/ai/orchestrator.ts` — `isPingPong()`

**验收：**
- [ ] A→B→A→B 被检测并阻断
- [ ] A→B→C→A 不被误判（不是 ping-pong）
- [ ] 阻断时 UI 显示 system_info

### Phase 5: Agent Activity Panel 更新

**文件：**
- `src/main/ipc/orchestrator.ts` — 转发 `a2a:handoff` 事件
- `src/renderer/src/stores/a2aStore.ts` — 消费 handoff 事件
- `src/renderer/src/components/workspace/AgentActivityPanel.tsx` — 渲染 handoff 边

**验收：**
- [ ] Claude → Codex 的 handoff 正确显示
- [ ] Edge type = `agent-mention`

---

## 与现有系统的兼容性

| 系统 | 影响 | 处理 |
|------|------|------|
| `mention-parser.ts` | 无 | 用户输入的 @mention 逻辑不变 |
| `AgentRuntime.start()` | 新增回调 | 执行完成后调用 scanner |
| `a2a_tasks` 表 | 保留 | 继续记录，新增 `source` 字段 |
| `messages` 表 | 新增写入 | 所有 agent 输出写入 |
| `chatStore.ts` | 最小改动 | 确保 agent 消息正确显示 |

---

## 相关文件

- **新增**: `src/main/ai/agent-output-scanner.ts`
- **新增**: `src/main/ai/agent-output-scanner.test.ts`
- **修改**: `src/main/ai/orchestrator.ts`
- **修改**: `src/main/ai/a2a-types.ts`
- **修改**: `src/main/ai/agent-runtime.ts`
- **修改**: `src/main/ipc/orchestrator.ts`
- **修改**: `src/renderer/src/stores/a2aStore.ts`
- **修改**: `src/renderer/src/components/workspace/AgentActivityPanel.tsx`
- **参考**: `docs/features/multi-agent.md`
- **参考**: `docs/features/agent-team.md`
- **参考**: `docs/architecture/multi-agent-a2a-orchestration.md`
