# Phase B: Agent Memory — 个体 MEMORY.md PRD

**版本**: 1.0  
**日期**: 2026-05-09  
**状态**: 待执行  
**作者**: @需求文档师  
**前置依赖**: Phase A 完成（commit `0b2f7b0`）  
**关联 ADR**: ADR-014 (Agent Context Model)

---

## 1. 概述

### 1.1 问题陈述

当前 bytro Agent 是"无状态"的——每次对话都是**从零开始**：
- Agent 不知道之前会话中做过的决策
- Agent 不了解用户偏好或项目约定
- 跨会话没有知识积累

Slock 的 Agent 有 `MEMORY.md`（工作区笔记），跨会话保持记忆。bytro 需要对齐。

### 1.2 目标

每个 Agent 拥有**持久化私有记忆**，跨会话积累知识：
- 启动时加载 MEMORY.md 注入 system prompt
- 对话结束时基于规则更新 MEMORY.md（零 token 成本）
- 对齐 Slock agent workspace 模式

### 1.3 范围

| 在范围内 | 不在范围内 |
|---------|-----------|
| `~/.bytro/agents/{profileId}/MEMORY.md` 文件系统存储 | LLM reflect 更新（P2，可选） |
| Agent 启动时加载 memory | 跨 Agent 共享 memory |
| 对话结束时规则驱动更新 | UI 界面展示 memory |
| 并发写入安全 | 记忆搜索/检索优化（P2） |

---

## 2. 架构设计

### 2.1 目录结构

```
~/.bytro/agents/
├── {profileId-1}/
│   ├── MEMORY.md          ← 入口索引（Agent 启动时加载）
│   └── notes/             ← 按主题分文件（可选扩展）
│       ├── decisions.md   ← 架构决策记录
│       └── preferences.md ← 用户偏好积累
├── {profileId-2}/
│   ├── MEMORY.md
│   └── notes/
```

### 2.2 Memory 生命周期

```
AgentRuntime.start()
  → AgentMemory.load(profileId)
  → 读取 MEMORY.md 内容
  → 注入到 systemPrompt 末尾（完整注入，对齐 Slock/Multica）

Agent 执行 onObservation()
  → systemPrompt 包含: role prompt + memory content + 当前对话
  → Agent 基于记忆和上下文做决策

对话结束 / 用户显式反馈
  → AgentMemory.update(profileId, entry)
  → 追加到 MEMORY.md（规则驱动，零 token 成本）
  → 写入文件系统（Promise 队列保护）
```

---

## 3. 功能需求

### FR-1: `AgentMemory` 模块（新增）

**描述**: 新增 `src/main/daemon/agent-memory.ts` 模块，负责 MEMORY.md 的读写。

**接口设计**:

```typescript
// src/main/daemon/agent-memory.ts

interface MemoryEntry {
  summary: string      // 关键信息摘要
  category: 'decision' | 'preference' | 'context' | 'feedback'
  timestamp: string    // ISO 8601
}

class AgentMemory {
  private basePath: string // ~/.bytro/agents/
  private writeQueue = new Map<string, Promise<void>>()

  /** Agent 启动时加载记忆 */
  async load(profileId: string): Promise<string> {
    const file = this.getMemoryPath(profileId)
    if (!fs.existsSync(file)) {
      await this.initialize(profileId)
    }
    return fs.readFileSync(file, 'utf-8')
  }

  /** 首次创建 MEMORY.md */
  private async initialize(profileId: string): Promise<void> {
    const dir = path.join(this.basePath, profileId)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    
    const template = `# @${profileId}

## Role

## Key Knowledge

## Active Context
- Currently working on:
- Last interaction:
`
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), template, { mode: 0o600 })
  }

  /** 追加记忆条目 */
  async append(profileId: string, entry: MemoryEntry): Promise<void> {
    // 队列化：上一个写入完成后再写下一个
    const prev = this.writeQueue.get(profileId) ?? Promise.resolve()
    const next = prev.then(() => this.doAppend(profileId, entry))
    this.writeQueue.set(profileId, next)
    return next
  }

  private async doAppend(profileId: string, entry: MemoryEntry): Promise<void> {
    const file = this.getMemoryPath(profileId)
    const content = `\n## ${entry.timestamp}\n- [${entry.category}] ${entry.summary}\n`
    fs.appendFileSync(file, content)
  }

  private getMemoryPath(profileId: string): string {
    // 路径遍历防护
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profileId)) {
      throw new Error('Invalid profileId')
    }
    return path.join(this.basePath, profileId, 'MEMORY.md')
  }
}
```

### FR-2: Agent 启动时加载 Memory

**描述**: `AgentRuntime.start()` 启动时加载 MEMORY.md，注入到 system prompt。

**实现**:

```typescript
// agent-runtime.ts
async start(): Promise<void> {
  // ... 现有启动逻辑 ...
  
  // 加载 Agent 私有记忆
  const memoryContent = await agentMemory.load(this.profile.id)
  
  // 注入完整 memory（对齐 Slock，不做截断）
  const memoryContent = await agentMemory.load(this.profile.id)
  
  this.systemPrompt = [
    this.profile.systemPrompt,
    OPEN_FLOOR_INSTRUCTION,
    `## 你的记忆\n\n${memoryContent}`,
  ].join('\n\n')
  
  // ... 启动 session ...
}
```

### FR-3: 对话结束时更新 Memory

**描述**: 对话结束时，基于规则更新 MEMORY.md（零 token 成本）。

**触发时机**:
- Daemon `checkConversationsComplete()` 检测到全员 NO_REPLY
- 用户点击「结束讨论」

**规则驱动更新**:

```typescript
// daemon.ts
async checkConversationsComplete(): Promise<void> {
  // ... 检测逻辑 ...
  
  if (allSilent) {
    // 对话结束，触发 memory 更新
    for (const [profileId, resident] of this.registry.runtimes) {
      const entry = this.buildMemoryEntry(resident, conversationId)
      await agentMemory.append(profileId, entry)
    }
    
    bus.publish({ type: 'open_floor:closed', reason: 'natural_convergence' })
  }
}

private buildMemoryEntry(
  resident: ResidentRuntime, 
  conversationId: string
): MemoryEntry {
  const task = this.getLastTask(resident.profile.id, conversationId)
  
  return {
    summary: this.summarizeReply(task.result),
    category: this.categorizeEntry(task),
    timestamp: new Date().toISOString(),
  }
}

private summarizeReply(reply: string): string {
  // 方案 A：取前 200 字符 + 省略号
  return reply.slice(0, 200).replace(/\n/g, ' ') + '...'
}

private categorizeEntry(task: Task): MemoryEntry['category'] {
  if (task.result.includes('decided') || task.result.includes('决策')) {
    return 'decision'
  }
  if (task.result.includes('prefer') || task.result.includes('偏好')) {
    return 'preference'
  }
  return 'context'
}
```

### FR-4: 路径遍历防护

**描述**: `profileId` 必须经过严格校验，防止路径遍历攻击。

**实现**:

```typescript
const VALID_PROFILE_ID = /^[a-zA-Z0-9_-]{1,64}$/

function validateProfileId(profileId: string): void {
  if (!VALID_PROFILE_ID.test(profileId)) {
    throw new Error(`Invalid profileId: ${profileId}`)
  }
}
```

### FR-5: 并发写入安全

**描述**: 多个 conversation 同时结束时，可能并发写入同一 Agent 的 MEMORY.md。

**实现**: Promise 队列化（已在 FR-1 中实现）

```typescript
private writeQueue = new Map<string, Promise<void>>()

async append(profileId: string, entry: MemoryEntry): Promise<void> {
  const prev = this.writeQueue.get(profileId) ?? Promise.resolve()
  const next = prev.then(() => this.doAppend(profileId, entry))
  this.writeQueue.set(profileId, next)
  return next
}
```

---

## 4. 非功能需求

### NFR-1: 向后兼容

- Agent 无 MEMORY.md 时自动初始化（空模板）
- 不修改现有 `onObservation` 接口签名
- Phase A 的 tool use 机制不受影响

### NFR-2: 性能

- MEMORY.md 读取：文件系统缓存（启动时一次）
- MEMORY.md 写入：异步追加（不阻塞主线程）
- 注入策略：全量注入（对齐 Slock，不做截断），LLM context window 自然限制

### NFR-3: 安全

- 路径遍历防护：`profileId` 正则校验
- 文件权限：`dir` 0o700, `MEMORY.md` 0o600
- 敏感信息：MEMORY.md 明文存储（MVP），ADR-014 标注为 Known Gap

### NFR-4: 可观测性

- memory load 日志：`[AgentMemory] loaded ${profileId}: ${chars} chars`
- memory update 日志：`[AgentMemory] updated ${profileId}: ${entry.category} - ${entry.summary}`

---

## 5. 测试需求

### 测试清单

| 测试文件 | 场景 | 说明 |
|----------|------|------|
| `agent-memory.test.ts` | load 首次初始化 | 无 MEMORY.md 时创建模板 |
| `agent-memory.test.ts` | load 已有文件 | 读取现有 MEMORY.md |
| `agent-memory.test.ts` | append 追加条目 | 验证内容追加正确 |
| `agent-memory.test.ts` | 并发写入 | 3 个同时 append，验证顺序 |
| `agent-memory.test.ts` | 路径遍历防护 | 非法 profileId 抛错 |
| `agent-runtime.test.ts` | start 加载 memory | 验证 systemPrompt 包含 memory |
| `daemon.test.ts` | 对话结束触发 update | 验证 memory 被更新 |

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| MEMORY.md 过大 | 中 | 高 | LLM context window 自然限制；如超限考虑摘要或分层策略（P2） |
| 并发写入丢数据 | 低 | 高 | Promise 队列化 |
| 敏感信息泄露 | 中 | 高 | 文件权限 0o600 + 路径遍历防护 |
| 规则驱动更新遗漏关键信息 | 中 | 中 | 后续可选 LLM reflect 补全 |
| 磁盘耗尽 | 低 | 高 | 单文件上限 1MB，超限截断 |

---

## 7. 验收标准

- [ ] `AgentMemory.load()` 首次初始化创建模板
- [ ] `AgentMemory.load()` 读取现有 MEMORY.md
- [ ] `AgentMemory.append()` 正确追加条目
- [ ] 并发写入不丢数据（3 个同时写入验证）
- [ ] 路径遍历防护生效（非法 profileId 抛错）
- [ ] `AgentRuntime.start()` 注入 memory 到 systemPrompt
- [ ] 对话结束时触发 memory 更新
- [ ] memory 更新日志记录正确
- [ ] 所有测试通过
- [ ] Typecheck 0 errors

---

## 8. 实现检查清单

- [ ] 新增 `src/main/daemon/agent-memory.ts`（AgentMemory 类）
- [ ] `agent-runtime.ts`: `start()` 加载 memory 并注入 systemPrompt
- [ ] `agent-runtime.ts`: `buildMemoryEntry()` + `summarizeReply()`
- [ ] `daemon.ts`: 对话结束触发 memory 更新
- [ ] `runtime-registry.ts`: 传递 agent workspace path
- [ ] 路径遍历防护：`profileId` 正则校验
- [ ] 并发安全：Promise 队列化写入
- [ ] 测试: `agent-memory.test.ts`（初始化/读取/追加/并发/防护）
- [ ] 测试: `agent-runtime.test.ts`（memory 注入）
- [ ] 测试: `daemon.test.ts`（对话结束触发）
