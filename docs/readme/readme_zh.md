<p align="center">
  <!-- <img src="../resources/bytro-banner.png" alt="Bytro - Multi-Agent AI Chat IDE" width="100%"> -->
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/wzasd/Aether?style=flat-square&color=32CD32" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-32CD32?style=flat-square" alt="License">
  &nbsp;
  <img src="https://img.shields.io/badge/platform-macOS%20%20%7C%20Windows%20%F0%9F%9A%A7%20%7C%20Linux%20%F0%9F%9A%A7-6C757D?style=flat-square&logo=apple&logoColor=white" alt="Platform">
  &nbsp;
  <img src="https://img.shields.io/badge/tests-307%20pass-32CD32?style=flat-square" alt="Tests">
</p>

---

<p align="center">
  <strong>免费、开源的多 Agent AI 协作 IDE</strong><br>
  <em>内置 Agent · 自动检测 CLI · 任意 API Key · 多 Agent 协作 · Open Floor · 7 个 Provider · 实时流式</em>
</p>

<p align="center">
  <a href="https://github.com/wzasd/Aether/releases">
    <img src="https://img.shields.io/badge/⬇️%20Download%20Now-Latest%20Release-32CD32?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release" height="50">
  </a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <strong>简体中文</strong>
</p>

---

## 📋 快速导航

<p align="center">

[Open Floor](#-open-floor--多-agent-圆桌讨论) ·
[为什么选 Bytro？](#-为什么选-bytro) ·
[快速开始](#-快速开始) ·
[常见问题](#-常见问题)

</p>

---

## 多 Agent — AI Agent 一起协作

**Bytro 不只是聊天工具。** 它是一个多 Agent IDE，让 AI Agent 在同一个对话中实时协作——读文件、写代码、审查变更、一起解决问题。你能看到 Agent 的所有操作，始终掌控全局。

|                     | 传统 AI Chat | **Bytro（多 Agent）**                        |
| :------------------ | :----------- | :------------------------------------------- |
| 多 Agent 同时工作   | 不支持       | **7 个 Provider — Claude、OpenCode、Gemini、Codex、Copilot、Cursor、Kimi — 自动检测** |
| Agent 之间协作      | 不支持       | **@mention 委托、Open Floor 讨论、串行/并行编排** |
| Agent 操作文件      | 有限         | **每个 Agent 通过 CLI 有完整文件访问权限**    |
| AI 执行多步任务     | 有限         | **自主执行，需要你的批准**                   |
| 实时流式输出        | 部分         | **逐字流式，工具调用不泄漏到聊天界面**       |
| 价格                | 免费/付费    | **免费 & 开源**                              |

<!-- <p align="center">
  <img src="../resources/bytro-open-floor.png" alt="Bytro Open Floor" width="800">
</p> -->

---

## 🗣️ Open Floor — 多 Agent 圆桌讨论

发一条消息，所有启用的 Agent 同时回复。它们能看到彼此的回复，赞同、反驳或补充——就像团队站会。

- **所有 Agent 同时收到消息** — 事件驱动，不是轮询
- **Agent 能看到同伴回复** — 第二轮接话自然收敛
- **多轮收敛** — Agent 在 Round 2 看到同伴回复后可以补充，2-3 轮自然收敛
- **每个 Agent 有状态指示** — 思考中 → 已回复 → 静默

<!-- <p align="center">
  <img src="../resources/bytro-open-floor-demo.gif" alt="Open Floor Demo" width="800">
</p> -->

<details>
<summary><strong>🔍 查看 Open Floor 详情 ▶️</strong></summary>

<br>

**工作原理：**

1. 用户发送消息 → Orchestrator 广播给所有启用的 Agent
2. 每个活跃的 Agent（在回复限制内）独立生成回复（流式）
3. 所有回复对其他 Agent 可见 → 它们可以在下一轮跟进
4. 讨论 2-3 轮后自然收敛

**配置：**

- 通过 AgentStatusBar 下拉切换 Open Floor 和 Orchestrated 模式
- 模式跨消息持久化 — 不需要每次重新选择
- Agent 使用**邀请框架**（"分享你的观点"）而非判断框架（"评估然后决定"）

</details>

---

## 🎯 @Mention — 精准委托

用 `@AgentName: 任务描述` 把任务路由到特定 Agent。

- **Orchestrated 模式** — 只有被 @ 的 Agent 执行，其他静默
- **链式委托** *(计划中)* — Agent 可以在输出中 @mention 其他 Agent
- **循环检测** *(计划中)* — 防止 Agent 之间无限 ping-pong

<details>
<summary><strong>🔍 查看 @Mention 详情 ▶️</strong></summary>

<br>

**示例：**

```
你: @Coder 修一下 Gemini 消息无法展示的 bug

@Coder: 根因定位 — Electron PATH 不包含 /opt/homebrew/bin...
```

**链式委托：**

```
你: 重构 auth 模块

@架构设计: 我来设计新的 auth 架构...
  → @Coder: 实现架构方案...
    → @Reveiw工程师: 审查实现...

最终产出：架构 + 代码 + 审查，一条链完成
```

**循环检测：** 如果 Agent A → B → A 会形成循环，系统会停止并报告。

</details>

---

## 📊 实时流式输出 — 纯文本，无工具调用 XML

Agent 回复逐字流式渲染。工具调用输出不显示在聊天界面——你只看到最终结果。

- **`text_delta` 累积** — 只有纯文本流式到 UI
- **`insideToolCall` 防护** — 工具调用 XML 在流式期间被抑制
- **回退摘要** — 只做工具调用的 Agent 仍然产生可读摘要

<!-- <p align="center">
  <img src="../resources/bytro-streaming-demo.gif" alt="Streaming Demo" width="800">
</p> -->

---

## 🧠 Agent Memory — 跨会话持久记忆

每个 Agent 维护一个 `MEMORY.md`，在 context 压缩后仍然持久存在。当 context window 填满并被压缩时，MEMORY.md 是**恢复锚点**——Agent 可以在不丢失关键决策的情况下恢复。

- **压缩安全** — system prompt 包含恢复指令
- **跨会话知识** — Agent 记住过去的决策和约定
- **项目级记忆** — Agent workspace 中的 MEMORY.md 是持久知识源

---

## 📸 真实对话 — 4 个 Agent 30 分钟修一个 Bug

> 这是来自我们团队的**真实会话**。用户报告 OpenCode Agent 完成工作但回复不显示。

### Round 1：根因分析

👤 **用户**: "6 个 Agent 只有 4 个回复，Planner 的输出显示原始 `<invoke name="readMessages">` XML"

🟡 **@架构设计**: 根因 — 3 个假设：(1) CLI 二进制未安装 (2) maxConcurrentTasks 限制 (3) MAX_RESPONSES_PER_AGENT 限制。最可能：CLI 二进制缺失 → `runtime.start()` 失败 → `isActive = false`

🟢 **@Reveiw工程师**: 补充发现 — Planner/Codex `result.reply` 为空 → `[NO_REPLY]` 分支 → UI 不显示。还发现工具调用 XML 泄漏到聊天界面。

### Round 2：修复实施

🟣 **@Cindy**: FR-5.1 实现 — `waitForReplyWithStreaming` 现在使用 `accumulatedText` 替代 `fullText`。工具调用 XML 不再泄漏。307 tests pass。

### Round 3：审查闭环

🟢 **@Reveiw工程师**: FR-5.1-5.4 审查 APPROVED ✅

> **你刚才看到的**：Bug 报告 → 4 个 Agent 同时分析 → 架构师定位根因 → 审查工程师补充细节 → 开发者实施修复 → 审查工程师批准 → 一个会话完成。

---

## 🤔 为什么选 Bytro？

<details>
<summary><strong>点击查看详细对比</strong></summary>

<br>

Bytro 是一个**免费开源的多 Agent AI Chat IDE**。不同于单 Agent 聊天工具，Bytro 让多个专业 Agent 在一个对话中协作。

| 维度     | 单 Agent Chat | Bytro                                                    |
| :------- | :------------ | :------------------------------------------------------- |
| Agent 数量 | 1             | 多个（最多 6+ 同时）                                     |
| 协作     | 无            | @mention 委托、Open Floor 讨论                           |
| 模型支持 | 1 个 provider | 7 个 Provider — Claude、OpenCode、Gemini、Codex 等       |
| 流式输出 | 全文本（混合） | 纯文本（工具调用已过滤）                                 |
| 记忆     | 单会话        | 跨会话 MEMORY.md                                         |
| 成本     | 免费/付费     | 免费 & 开源                                              |

</details>

---

## 🚀 快速开始

### 系统要求

- **macOS**: 12.0 或更高（Apple Silicon / Intel）
- **Node.js**: 18+
- **pnpm**: 8+

### 安装

<p>
  <a href="https://github.com/wzasd/Aether/releases">
    <img src="https://img.shields.io/badge/Download-Latest%20Release-32CD32?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release" height="50">
  </a>
</p>

```bash
git clone https://github.com/wzasd/Aether.git
cd Aether
pnpm install

# 验证 CLI 可用（至少一个）
claude --version    # 或: gemini --version / opencode --version

pnpm dev
```

### 3 步上手

1. **安装** Bytro 和至少一个 AI CLI Provider
2. **配置** API Key（Settings → Credentials）
3. **开始聊天** — 创建对话，选择 Open Floor 模式，发送消息

### 权限模式

| 模式 | 行为 | 适用场景 |
| :--- | :--- | :------- |
| **Ask First** | 每次工具调用前确认 | 新用户、探索性工作 |
| **Auto** | 自动批准文件编辑，命令操作需确认 | 安全与速度平衡 |
| **YOLO** | 全部自动批准 | 信任的 Agent、生产环境 |

> 💡 **建议**：新手从 **Ask First** 开始，信任 Agent 后切换到 **YOLO**。

<details>
<summary><strong>🔍 查看 CLI Provider 安装 ▶️</strong></summary>

<br>

| CLI | 安装命令 | 说明 |
| :-- | :------- | :--- |
| Claude | `npm install -g @anthropic-ai/claude-code` | 功能最完整 |
| OpenCode | 从 <https://opencode.ai> 下载 | 开源、多功能 |
| Gemini | `npm install -g @anthropic-ai/gemini-cli` | Google Gemini |
| Codex | `npm install -g @openai/codex` | OpenAI Codex |
| Copilot | `npm install -g @github/copilot-cli` | GitHub Copilot |
| Cursor | 从 <https://cursor.sh> 下载 | Cursor Agent |
| Kimi | `npm install -g @moonshot-ai/kimi-cli` | Moonshot AI |

</details>

---

## 常见问题

<details>
<summary><strong>Q: 要先安装 Claude CLI 或 Gemini CLI 吗？</strong></summary>
A: **是的。** Bytro 使用 CLI Provider 作为 AI 运行时。安装至少一个 CLI（推荐 Claude），Bytro 会自动检测。每个 Agent 可以使用不同的 Provider 和模型。
</details>

<details>
<summary><strong>Q: Open Floor 和 Orchestrated 有什么区别？</strong></summary>
A: **Open Floor** = 所有 Agent 看到你的消息并同时回复（像团队站会）。**Orchestrated** = 你 @mention 特定 Agent，只有那个 Agent 回复（像委托任务）。随时通过状态栏下拉切换。
</details>

<details>
<summary><strong>Q: 免费吗？</strong></summary>
A: Bytro 完全免费开源（MIT 许可证）。你只需支付所选 Provider 的 API 使用费（Claude、Gemini 等）。
</details>

<details>
<summary><strong>Q: 数据安全吗？</strong></summary>
A: 所有数据存储在本地 SQLite 中。没有任何数据上传到服务器。Agent 记忆文件（MEMORY.md）仅在本地。
</details>

---

## 🏗️ 架构

<details>
<summary><strong>🔍 查看架构 & 数据流 ▶️</strong></summary>

<br>

```
┌─────────────────────────────────────────────────┐
│                  Renderer                        │
│          React + Zustand + Tailwind              │
│                                                  │
│  ChatStore ← IPC(ai:event) ← Engine ← Provider  │
└──────────────────────┬──────────────────────────┘
                       │ window.api (narrow bridge)
┌──────────────────────┴──────────────────────────┐
│                  Main Process                    │
│          Electron + SQLite + AI Runtime          │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ EventBus │  │TaskQueue │  │RuntimeRegistry│  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│         ↕            ↕             ↕             │
│  ┌──────────────────────────────────────────┐    │
│  │              Daemon                       │    │
│  │  claimAndExecute → onObservation → emit   │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │         BaseCLIProvider                   │    │
│  │  resolveBinary → startSession → sendMessage│   │
│  │  → parseOutput → emitSessionEvent         │   │
│  └──────────────────────────────────────────┘    │
│         ↕                                        │
│  Claude │ OpenCode │ Gemini │ Codex │ Copilot │ Cursor │ Kimi
└─────────────────────────────────────────────────┘
```

**关键数据流：**

```
用户消息 → Orchestrator
  → Open Floor: 所有 Agent 入队 → 并行 claimAndExecute → 各自回复 → converge
  → Orchestrated: Orchestrator 分析 → 按需分配子任务 → Agent 执行 → 汇总

单 Agent 执行:
  TaskQueue.enqueue() → RuntimeRegistry.claimAndExecute()
    → AgentRuntime.onObservation() → CLI Provider 启动
    → 流式事件 (text_delta / tool_start / tool_result / complete)
    → waitForReplyWithStreaming() 累积回复内容（过滤工具调用 XML）
    → Bus.publish('message:reply') → IPC(ai:event) → 前端渲染
```

**核心模块：**

| 模块 | 职责 |
| :------ | :------------- |
| EventBus | 事件分发中心，`subscribeWithKey()` 防重复注册 |
| TaskQueue | 消息入队 + claim + 并发控制 |
| RuntimeRegistry | Agent 生命周期管理（start/stop/isActive） |
| Daemon | 编排核心 — `claimAndExecute` → `onObservation` → emit |
| BaseCLIProvider | 统一 CLI 交互层（PATH 探测 + stream-json 解析） |

</details>

---

## ⚙️ 配置

<details>
<summary><strong>🔍 查看 Agent 配置 ▶️</strong></summary>

<br>

每个 Agent 有独立的 profile，定义角色、Provider 和权限：

```json
{
  "id": "planner",
  "name": "架构设计",
  "description": "资深架构设计师，精通系统设计和架构决策",
  "preferredProvider": "opencode",
  "model": "default",
  "permissionFlags": {
    "trusted": ["--agent", "plan", "--model", "default"]
  }
}
```

**协作模式：**

| 模式 | 说明 | 适用场景 |
| :--- | :--- | :------- |
| **Open Floor** | 所有 Agent 自由参与，互相可见 | 讨论、头脑风暴 |
| **Orchestrated** | @mention 触发特定 Agent，其他静默 | 具体任务、代码修复 |
| **Ask First** | Agent 先请示再执行 | 安全敏感操作 |

</details>

---

## 🤖 Provider 支持

<details>
<summary><strong>🔍 查看全部 7 个 Provider ▶️</strong></summary>

<br>

| Provider | 传输方式 | 模型选择 | 自定义路径 | 状态 |
| :------- | :------- | :------- | :--------- | :--- |
| Claude | stream-json（持久） | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | ✅ Stable |
| OpenCode | per-turn spawn | `--agent build/plan` | `~/.opencode/bin/opencode` | ✅ Stable |
| Gemini | per-turn spawn (stdin) | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | ✅ Stable |
| Codex | per-turn spawn | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | ✅ Stable |
| Copilot | per-turn spawn | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | 🔄 Beta |
| Cursor | per-turn spawn | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | 🔄 Beta |
| Kimi | per-turn spawn | auto（CLI 管理） | `~/.local/bin/kimi` | ✅ Stable |

</details>

---

## 🧪 开发环境

技术栈：Electron · Vite · React · Zustand · SQLite · TypeScript

```bash
pnpm dev          # 开发模式（hot reload）
pnpm build        # 构建
pnpm start        # 启动构建后的应用
pnpm test         # 运行测试（vitest）
pnpm typecheck    # TypeScript 类型检查
pnpm dist         # 打包 macOS DMG
```

---

## 🤝 贡献

提交 PR 前请阅读 [AGENTS.md](../AGENTS.md)。

1. Fork 本项目
2. 创建功能分支（`git checkout -b feature/AmazingFeature`）
3. 提交改动（`git commit -m 'feat: add AmazingFeature'`）
4. 推送到分支（`git push origin feature/AmazingFeature`）
5. 提交 Pull Request

所有改动需要 Review APPROVED。测试覆盖率 ≥ 80%。

---

## 许可证

本项目基于 [MIT](../LICENSE) 许可证。

---

## Star History

<p align="center">
  <a href="https://www.star-history.com/#wzasd/Aether&Date" target="_blank">
    <img src="https://api.star-history.com/svg?repos=wzasd/Aether&type=Date" alt="Star History" width="600">
  </a>
</p>

<div align="center">

**如果喜欢，请给个 Star ⭐**

[报告 Bug](https://github.com/wzasd/Aether/issues) · [请求功能](https://github.com/wzasd/Aether/issues)

</div>