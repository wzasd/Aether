# Open Floor 用户指南

> 面向 bytro-app 用户的 Open Floor（自由讨论）模式操作手册。

---

## 什么是 Open Floor？

**Open Floor = 自由讨论模式**

在这个模式下：
- 所有启用的 Agent 都会看到你的消息
- 每个 Agent 会从自己的专业角度参与讨论
- 像微信群聊一样，大家可以七嘴八舌
- 你也可以随时 @某个 Agent 点名让它发言

**对比 Orchestrated（编排模式）**：
| | Open Floor | Orchestrated |
|---|---|---|
| 场景 | 头脑风暴、讨论、闲聊 | 明确的任务执行 |
| Agent 行为 | 自由参与，各自发表观点 | 按 Pipeline 顺序执行 |
| 输出 | 多条独立观点 | 一份完整任务报告 |
| 适合 | 探索、讨论、收集多视角 | 开发、审查、执行 |

---

## 如何开始

### 1. 新建对话时选择模式

新建对话 → 默认是 Orchestrated → 点击 AgentStatusBar 的「Orchestrated ▾」→ 选「Open Floor」

```
Dev Team                    ⏹  Orchestrated ▾  👥 6  ⚙
                                    ↓
                              Open Floor
                              Orchestrated
```

### 2. 现有对话切换模式

在已有对话中 → 点击「Orchestrated ▾」→ 选「Open Floor」→ **下次发消息时生效**

> ⚠️ 切换模式不会立即生效，需要等下一条消息发送时才切换。

### 3. 发消息

输入框打字 → 回车发送 → 所有 Agent 会同时收到并思考

---

## 预期行为

### 正常情况

```
你: 我想讨论一下多 agent 协同的问题，你们有什么想法

🧠 @Planner 参与了讨论
Planner: 我觉得多 agent 协同最大的挑战是信息同步。每个 agent 都有自己的上下文，如果不共享，很容易重复劳动...

🧠 @Coder 参与了讨论
Coder: 从实现角度，我关心的是并发控制。6 个 agent 同时跑，怎么避免资源冲突？...

🧠 @Reveiw工程师 参与了讨论
Reveiw工程师: 审查角度，我担心的是输出一致性。如果多个 agent 同时改同一份代码...
```

### 如果 Agent 不相关

如果某个 Agent 判断话题和它无关：
- 它可能会简短说明 "这个话题偏前端，我不是最合适的人选"
- 或者完全不回（如果确实不相关）

### 停止讨论

点击 ⏹ 按钮 → 确认 → 所有 Agent 立即停止思考

---

## 常见问题

### Q1: 为什么只有 1 个 Agent 回复？

**可能原因**：
1. **话题太简单** — "你好"这种问候语只有最通用的 Agent 会回
2. **话题太偏** — 纯前端话题，后端 Agent 判断不相关
3. **Agent 没启用** — 去 Settings > Agents 检查是否启用了多个 Agent

**排查方法**：
- 用更有讨论价值的话题测试（如"讨论多 agent 协同"）
- 检查 👥 按钮 → 确认启用了多个 Agent

### Q2: 消息发了但 Agent 没回？

**可能原因**：
1. **API Key 问题** — Settings > AI Provider 检查 API Key 是否有效
2. **网络问题** — 检查是否能访问 LLM API
3. **Agent 正在思考** — 等 10-30 秒

### Q3: 第二条消息发出去消失了？

**已修复** — 这是之前的 bug，当前版本已修复。如果还遇到：
1. 确认 rebuild 到了最新版本
2. 检查 DevTools Console 是否有 `[chatStore]` 开头的报错日志

### Q4: 回复像机器人，不够自然？

**已优化** — 当前版本已把 Agent 的回复风格从"任务报告"改成"群聊风格"。如果还是觉得不自然：
- 这是持续优化项，我们会继续调 prompt
- 可以截图发给我们看具体哪里不自然

### Q5: 可以只让某些 Agent 参与吗？

**可以** — 两种方式：
1. **全局禁用**：Settings > Agents → 关闭不想参与的 Agent
2. **临时点名**：输入框里 @某个 Agent → 只有被 @ 的 Agent 会回

### Q6: Open Floor 和 @mention 有什么区别？

| | Open Floor | @mention |
|---|---|---|
| 触发方式 | 发消息（不设 @） | 输入框 @AgentName |
| 参与 Agent | 所有启用的 Agent | 只有被 @ 的 Agent |
| 适合场景 | 收集多视角 | 指定专人回答 |

---

## 使用技巧

### 1. 话题要有讨论价值

❌ "你好" → 太简单，只有 1 个 Agent 会回
✅ "讨论一下多 agent 协同的优缺点" → 多个 Agent 会从不同角度参与

### 2. 用 @mention 做补充

如果 Open Floor 后某个 Agent 没说到你想听的：
```
你: @Coder 你刚才没提到并发控制，具体怎么实现？
```

### 3. 及时停止

如果讨论偏了或不需要继续了，点击 ⏹ 停止，节省 Token。

### 4. 切换模式

如果讨论中发现需要执行具体任务（如"那就按 Planner 说的做"）：
1. 切回 Orchestrated 模式
2. 发消息让 Agent 执行

---

## 日志自助排查

如果遇到问题，可以按 `Cmd/Ctrl + Shift + I` 打开 DevTools → Console：

| 日志前缀 | 含义 |
|---------|------|
| `[chatStore] sendMessage` | 消息发送参数 |
| `[chatStore] observation dropped` | Agent 回复被拦截（状态不对） |
| `[chatStore] closeOpenFloor` | Open Floor 结束 |
| `[chatStore] error` | 出错信息 |

把报错截图发给我们，能快速定位问题。

---

## 已知限制

1. **不是流式输出** — Agent 思考完一次性显示，不是逐字打字机效果
2. **并发有限制** — 6 个 Agent 同时跑可能触发 API rate limit
3. **上下文共享** — 所有 Agent 看到同样的对话历史，没有隔离

---

*文档版本: 2026-05-08*
*作者: @需求文档师*
*相关: open-floor-fixes.md (修复记录), open-floor-collaboration-mode.md (技术 PRD)*
