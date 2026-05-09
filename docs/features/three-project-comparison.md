# 三项目架构对比：bytro 2.0 vs Multica vs Slock

**日期**: 2026-05-09  
**对比维度**: 架构、Agent 模型、消息机制、任务管理、生命周期

---

## 1. 整体定位

| 维度 | bytro 2.0 | Multica | Slock |
|------|-----------|---------|-------|
| **定位** | 本地 AI IDE | 托管 Agent 平台 | 人-AI 协作聊天平台 |
| **形态** | Electron 桌面应用 | SaaS + 本地 Daemon | 类 Slack 聊天应用 |
| **核心场景** | 编码 + Agent 辅助 | Issue 管理 + Agent 执行 | 团队讨论 + Agent 参与 |
| **部署** | 本地 | 云端 + 本地 Daemon | 云端 |
| **开源** | 是 | 是 | 否（内部） |

---

## 2. 架构对比

### 2.1 技术栈

| | bytro 2.0 | Multica | Slock |
|---|---|---|---|
| **后端语言** | TypeScript (Node.js) | Go | TypeScript (Node.js) |
| **前端** | React + Electron | Next.js + Electron | React |
| **数据库** | SQLite | PostgreSQL | PostgreSQL |
| **状态管理** | Zustand | Zustand + React Query | 自定义 |
| **通信** | IPC (Electron) | WebSocket + HTTP | WebSocket |
| **Agent 协议** | ACP (JSON-RPC) | Stream JSON | 自定义 |

### 2.2 进程模型

| | bytro 2.0 | Multica | Slock |
|---|---|---|---|
| **Agent 进程** | 常驻 Runtime (Daemon 内) | 常驻 Daemon + CLI 子进程 | 常驻进程 |
| **启动方式** | Electron main 启动 | CLI `daemon start` | 云端部署 |
| **心跳** | 内部 EventBus | 15s HTTP 心跳 | 内置 |
| **崩溃恢复** | 重启 Electron | Daemon 自动重启 | 云端自动重启 |

### 2.3 调度模型

```
bytro 2.0 (EventBus + TaskQueue)
─────────────────────────────────
用户消息 → EventBus.Publish('message:new')
  → 常驻 Agent Runtime 订阅
    → TaskQueue.Enqueue()
      → Daemon 分配执行槽
        → AgentRuntime.onObservation()
          → 生成回复 → EventBus.Publish('message:reply')

Multica (Server Queue + Daemon Claim)
─────────────────────────────────────
用户评论 → Server 创建 Task → DB 队列表
  → Daemon 轮询/WS 唤醒
    → ClaimTask()
      → spawn CLI 子进程
        → 流式输出 → Server 更新

Slock (Shared Message Bus)
──────────────────────────
用户消息 → Channel 消息流
  → 所有 Agent 实时收到
    → Agent 自主判断回应
      → 直接回复到 Channel
```

---

## 3. Agent 模型对比

| 维度 | bytro 2.0 | Multica | Slock |
|------|-----------|---------|-------|
| **Agent 数量** | 6 个（可配置） | 10+ 种 CLI | N 个（动态） |
| **Agent 类型** | Claude / Codex / OpenCode | Claude / Codex / Copilot / Cursor / Kimi... | 自定义角色 |
| **常驻/临时** | 常驻 Runtime | 常驻 Daemon | 常驻进程 |
| **触发方式** | 事件订阅 + TaskQueue | Task 队列 + Claim | 消息流订阅 |
| **自主决策** | 可配置（relevance 过滤） | 完全自主（Agent 自行 claim） | 完全自主 |
| **工具调用** | ACP 工具 | CLI 工具 + MCP | 自定义工具 |
| **记忆** | Session resume（L3） | Session resume + Skill | MEMORY.md |

---

## 4. 消息机制对比

| 维度 | bytro 2.0 | Multica | Slock |
|------|-----------|---------|-------|
| **消息存储** | SQLite messages 表 | PostgreSQL comments 表 | PostgreSQL messages |
| **实时性** | EventBus（同进程） | WebSocket | WebSocket |
| **消息可见性** | 全量（Agent 可订阅） | Issue 内全量 | Channel 内全量 |
| **Agent 互相可见** | ✅（EventBus 订阅） | ✅（Comment 共享） | ✅（共享消息流） |
| **@mention** | 支持 | 支持 | 支持 |
| **线程化** | 待实现 | Issue Comment 线程 | Thread 支持 |

---

## 5. 任务管理对比

| 维度 | bytro 2.0 | Multica | Slock |
|------|-----------|---------|-------|
| **工作单元** | Conversation / Issue（P4） | Issue | Task |
| **状态流转** | 待实现（P4） | todo→in_progress→done | todo→in_progress→in_review→done |
| **任务分配** | 自动（所有 Agent）或 @mention | Assign to Agent | Agent 自主 claim |
| **看板** | 待实现 | ✅ | ✅ |
| **执行追踪** | TaskQueue 状态 | Task 状态 + 日志 | Task 消息流 |

---

## 6. 关键差距分析

### bytro 2.0 的优势

1. **本地优先** — 所有数据在本地，隐私可控
2. **IDE 集成** — 编码场景深度集成
3. **轻量** — SQLite + Electron，启动快
4. **灵活** — 两种模式并存（Open Floor + Orchestrated）

### bytro 2.0 的劣势

1. **无云端协作** — 无法多设备同步
2. **无看板** — 任务管理弱于 Multica
3. **Agent 种类少** — 只有 3 种，Multica 有 10+
4. **事件总线同进程** — 无法跨设备

### Multica 的优势

1. **完整任务生命周期** — Issue + 看板 + 状态流转
2. **多 Agent 支持** — 10+ 种 CLI 后端
3. **云端协作** — 多设备、多用户
4. **Skill 系统** — 跨会话经验积累

### Multica 的劣势

1. **依赖云端** — 自托管也需要服务器
2. **复杂度高** — Go + TS monorepo，部署重
3. **本地感知弱** — 不如 bytro 贴近 IDE

### Slock 的优势

1. **实时协作** — 真正的群聊体验
2. **Agent 自主性高** — 自主判断、自主 claim
3. **MEMORY 机制** — 跨会话记忆

### Slock 的劣势

1. **封闭** — 不开源
2. **无任务管理** — 纯讨论，无看板
3. **编码场景弱** — 不是 IDE

---

## 7. 演进建议

### bytro 2.0 → 补齐差距

| 差距 | 优先级 | 方案 |
|------|--------|------|
| 无看板 | P1 | 加 IssueBoard 组件 |
| 无云端 | P2 | 可选云端同步模块 |
| Agent 种类少 | P2 | 扩展 Backend 接口 |
| 事件总线同进程 | P3 | 可选 WebSocket 适配 |
| Skill 系统 | P3 | 跨会话记忆沉淀 |

### bytro 2.0 的独特价值

bytro 不需要变成 Multica 或 Slock，而是**取两者之长**：
- **Multica 的任务管理** → 加 Issue + 看板
- **Slock 的实时协作** → EventBus 已具备
- **bytro 的本地 IDE** → 保持核心优势

**目标定位**："本地优先的 AI 团队协作 IDE" —— 既有 Multica 的任务管理能力，又有 Slock 的实时协作感，同时保持本地部署的轻量和隐私。

---

## 8. 附录：当前 bytro 2.0 状态（合并后）

| 能力 | 状态 |
|------|------|
| Daemon 常驻 | ✅ |
| EventBus 消息总线 | ✅ |
| TaskQueue 任务队列 | ✅ |
| Agent 常驻 Runtime | ✅ |
| Session resume | ✅ |
| Open Floor 事件驱动 | ✅ |
| Orchestrated 模式 | 保留原样 |
| Issue 模型 | 待实现（P4） |
| 看板视图 | 待实现（P4） |
| 云端同步 | 未规划 |
