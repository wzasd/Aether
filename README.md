<p align="center">
  <!-- <img src="./resources/bytro-banner.png" alt="Bytro - Multi-Agent AI Chat IDE" width="100%"> -->
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
  <strong>A free, open-source, Multi-Agent AI Chat IDE</strong><br>
  <em>Built-in Agents | Auto-Detect CLI | Any API Key | Multi-Agents | Open Floor | 7 Providers | macOS First</em>
</p>

<p align="center">
  <a href="https://github.com/wzasd/Aether/releases">
    <img src="https://img.shields.io/badge/⬇️%20Download%20Now-Latest%20Release-32CD32?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release" height="50">
  </a>
</p>

<p align="center">
  <strong>English</strong> | <a href="./docs/readme/readme_zh.md">简体中文</a>
</p>

---

## 📋 Quick Navigation

<p align="center">

[Open Floor](#-open-floor--multi-agent-roundtable) ·
[Why Bytro?](#-why-bytro) ·
[Quick Start](#-quick-start) ·
[FAQ](#-quick-qa)

</p>

---

## Multi-Agent — AI Agents That Work Together

**Bytro is more than a chat client.** It's a Multi-Agent IDE where AI agents collaborate in real-time within a single conversation — reading files, writing code, reviewing changes, and solving problems together. You see everything the agents do, and you're always in control.

|                                 | Traditional AI Chat Clients | **Bytro (Multi-Agent)**                                                                 |
| :------------------------------ | :-------------------------- | :-------------------------------------------------------------------------------------- |
| Multiple AI Agents at once      | No                          | **7 providers — Claude, OpenCode, Gemini, Codex, Copilot, Cursor, Kimi — auto-detected** |
| Agents can collaborate          | No                          | **@mention delegation, Open Floor discussion, serial/parallel orchestration**            |
| Agent can operate on your files | Limited or No               | **Yes — each agent has full file access via CLI provider**                              |
| AI can execute multi-step tasks | Limited                     | **Yes — autonomous with your approval**                                                 |
| Real-time streaming             | Partial                     | **Token-by-token streaming, tool calls stay behind the scenes**                         |
| Price                           | Free / Paid                 | **Free & Open Source**                                                                  |

<!-- <p align="center">
  <img src="./resources/bytro-open-floor.png" alt="Bytro Open Floor" width="800">
</p> -->

---

## 🗣️ Open Floor — Multi-Agent Roundtable Discussion

Send one message, and all enabled agents respond simultaneously. They can see each other's replies, agree, refute, or supplement — just like a team standup.

- **All agents receive the message simultaneously** — event-driven, not round-robin
- **Multi-round convergence** — agents can follow up in Round 2 after seeing peer replies
- **Each active agent responds** — within response limits, no hard gate
- **Per-agent status indicators** — streaming → replied → silent

<!-- <p align="center">
  <img src="./resources/bytro-open-floor-demo.gif" alt="Open Floor Demo" width="800">
</p> -->

<details>
<summary><strong>🔍 View Open Floor Details ▶️</strong></summary>

<br>

**How it works:**

1. User sends a message → Orchestrator broadcasts to all enabled agents
2. Each active agent (within response limits) independently generates a reply (streaming)
3. All replies are visible to other agents → they can follow up in the next round
4. Discussion naturally converges after 2-3 rounds

**Configuration:**

- Switch between Open Floor and Orchestrated mode via AgentStatusBar dropdown
- Mode persists across messages — no need to re-select each time
- Agents use an **Invitation Framework** ("share your view") rather than a judgment framework ("evaluate then decide")

</details>

---

## 🎯 @Mention — Direct Delegation

Route a task to a specific agent with `@AgentName: task description`.

- **Orchestrated mode** — only the mentioned agent executes, others stay silent
- **Chain delegation** *(planned)* — agents can @mention other agents in their output
- **Loop detection** *(planned)* — prevents infinite agent-to-agent ping-pong

<details>
<summary><strong>🔍 View @Mention Details ▶️</strong></summary>

<br>

**Example:**

```
You: @Coder fix the Gemini message display bug

@Coder: Root cause found — Electron PATH doesn't include /opt/homebrew/bin...
```

**Chain delegation:**

```
You: Refactor the auth module

@架构设计: I'll design the new auth architecture...
  → @Coder: Implementing the architecture plan...
    → @Reveiw工程师: Reviewing the implementation...

Final output: Architecture + Code + Review, all in one chain
```

**Loop detection:** If Agent A → B → A would create a cycle, the system stops and reports the loop.

</details>

---

## 📊 Real-Time Streaming — Clean Text, No Tool Call XML

Agent replies stream token-by-token. Tool call output stays behind the scenes — you only see the final result.

- **`text_delta` accumulation** — only pure text is streamed to the UI
- **`insideToolCall` guard** — tool call XML is suppressed during streaming
- **Fallback summary** — agents that only do tool calls still produce a readable summary

<!-- <p align="center">
  <img src="./resources/bytro-streaming-demo.gif" alt="Streaming Demo" width="800">
</p> -->

---

## 🧠 Agent Memory — Persistent Knowledge Across Sessions

Each agent maintains a `MEMORY.md` that persists across context compressions. When the context window fills up and gets compacted, MEMORY.md is the **recovery anchor** — the agent can resume without losing key decisions.

- **Compaction Safety** — system prompt includes recovery instructions
- **Cross-session knowledge** — agents remember past decisions and conventions
- **Project-level memory** — `MEMORY.md` in agent workspace is the durable truth source

---

## 📸 Real Conversation — 4 Agents Fix a Bug in 30 Minutes

> This is a **real session** from our team. The user reported that OpenCode agent completes work but the reply never appears.

### Round 1: Root Cause Analysis

👤 **User**: "6 agents only 4 reply, and Planner's output shows raw `<invoke name="readMessages">` XML"

🟡 **@架构设计**: Root cause — 3 hypotheses: (1) CLI binary not installed (2) maxConcurrentTasks limit (3) MAX_RESPONSES_PER_AGENT limit. Most likely: CLI binary missing → `runtime.start()` fails → `isActive = false`

🟢 **@Reveiw工程师**: Supplementary finding — Planner/Codex `result.reply` is empty → `[NO_REPLY]` branch → UI doesn't display. Also discovered tool call XML leaking into chat.

### Round 2: Fix Implementation

🟣 **@Cindy**: FR-5.1 implemented — `waitForReplyWithStreaming` now uses `accumulatedText` instead of `fullText`. Tool call XML no longer leaks. 307 tests pass.

### Round 3: Review & Close

🟢 **@Reveiw工程师**: FR-5.1-5.4 Review APPROVED ✅

> **What you just saw**: Bug report → 4 agents analyze simultaneously → Architect finds root cause → Reviewer supplements details → Developer implements fix → Reviewer approves → Done in one session.

---

## 🤔 Why Bytro?

<details>
<summary><strong>Click to see detailed comparison</strong></summary>

<br>

Bytro is a **free and open-source Multi-Agent AI Chat IDE**. Unlike single-agent chat clients, Bytro lets multiple specialized agents collaborate in one conversation.

| Dimension     | Single-Agent Chat | Bytro                                                    |
| :------------ | :---------------- | :------------------------------------------------------- |
| Agent Count   | 1                 | Multiple (up to 6+ simultaneously)                      |
| Collaboration | None              | @mention delegation, Open Floor discussion               |
| Model Support | 1 provider        | 7 providers — Claude, OpenCode, Gemini, Codex, and more |
| Streaming     | Full text (mixed) | Clean text only (tool calls filtered)                    |
| Memory        | Per-session       | Cross-session MEMORY.md in agent workspace              |
| Cost          | Free / Paid       | Free & Open Source                                       |

</details>

---

## 🚀 Quick Start

### System Requirements

- **macOS**: 12.0 or higher (Apple Silicon / Intel)
- **Node.js**: 18+
- **pnpm**: 8+

### Install

<p>
  <a href="https://github.com/wzasd/Aether/releases">
    <img src="https://img.shields.io/badge/Download-Latest%20Release-32CD32?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release" height="50">
  </a>
</p>

```bash
git clone https://github.com/wzasd/Aether.git
cd Aether
pnpm install

# Verify CLI is available (at least one)
claude --version    # or: gemini --version / opencode --version

pnpm dev
```

### Get Started in 3 Steps

1. **Install** Bytro and at least one AI CLI provider
2. **Configure** your API key in Settings → Credentials
3. **Start chatting** — create a conversation, choose Open Floor mode, send a message

### Permission Modes

| Mode | Behavior | When to Use |
| :--- | :------- | :---------- |
| **Ask First** | Ask before every tool call | New users, exploratory work |
| **Auto** | Auto-approve file edits, ask for commands | Balanced safety and speed |
| **YOLO** | Auto-approve everything | Trusted agents, production work |

> 💡 **Recommendation**: Start with **Ask First**, switch to **YOLO** once you trust the agent.

<details>
<summary><strong>🔍 View CLI Provider Installation ▶️</strong></summary>

<br>

| CLI | Install Command | Notes |
| :-- | :------------- | :---- |
| Claude | `npm install -g @anthropic-ai/claude-code` | Most complete feature support |
| OpenCode | Download from <https://opencode.ai> | Open-source, versatile |
| Gemini | `npm install -g @anthropic-ai/gemini-cli` | Google Gemini |
| Codex | `npm install -g @openai/codex` | OpenAI Codex |
| Copilot | `npm install -g @github/copilot-cli` | GitHub Copilot |
| Cursor | Download from <https://cursor.sh> | Cursor Agent |
| Kimi | `npm install -g @moonshot-ai/kimi-cli` | Moonshot AI |

</details>

---

## Quick Q&A

<details>
<summary><strong>Q: Do I need to install Claude CLI or Gemini CLI first?</strong></summary>
A: **Yes.** Bytro uses CLI providers as the AI runtime. Install at least one CLI (Claude recommended), then Bytro auto-detects it. Each agent can use a different provider and model.
</details>

<details>
<summary><strong>Q: What's Open Floor vs Orchestrated?</strong></summary>
A: **Open Floor** = all agents see your message and respond simultaneously (like a team standup). **Orchestrated** = you @mention a specific agent, only that agent responds (like delegating a task). Switch anytime via the status bar dropdown.
</details>

<details>
<summary><strong>Q: Is it free?</strong></summary>
A: Bytro is completely free and open source (MIT license). You pay for API usage from your chosen provider (Claude, Gemini, etc.).
</details>

<details>
<summary><strong>Q: Is my data secure?</strong></summary>
A: All data is stored locally in SQLite. Nothing is uploaded to any server. Agent memory files are local only.
</details>

---

## 🏗️ Architecture

<details>
<summary><strong>🔍 View Architecture & Data Flow ▶️</strong></summary>

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
│  │  → parseOutput → emitSessionEvent         │    │
│  └──────────────────────────────────────────┘    │
│         ↕                                        │
│  Claude │ OpenCode │ Gemini │ Codex │ Copilot │ Cursor │ Kimi
└─────────────────────────────────────────────────┘
```

**Key data flow:**

```
User Message → Orchestrator
  → Open Floor: all agents enqueue → parallel claimAndExecute → each replies → converge
  → Orchestrated: Orchestrator analyzes → delegates to specific agent → agent executes → result

Single Agent execution:
  TaskQueue.enqueue() → RuntimeRegistry.claimAndExecute()
    → AgentRuntime.onObservation() → CLI Provider starts
    → streaming events (text_delta / tool_start / tool_result / complete)
    → waitForReplyWithStreaming() accumulates reply content (filters tool call XML)
    → Bus.publish('message:reply') → IPC(ai:event) → frontend renders
```

**Core modules:**

| Module | Responsibility |
| :------ | :------------- |
| EventBus | Event dispatch center, `subscribeWithKey()` prevents duplicate registration |
| TaskQueue | Message enqueue + claim + concurrency control |
| RuntimeRegistry | Agent lifecycle management (start/stop/isActive) |
| Daemon | Orchestration core — `claimAndExecute` → `onObservation` → emit |
| BaseCLIProvider | Unified CLI interaction layer (PATH detection + stream-json parsing) |

</details>

---

## ⚙️ Configuration

<details>
<summary><strong>🔍 View Agent Configuration ▶️</strong></summary>

<br>

Each agent has an independent profile defining role, provider, and permissions:

```json
{
  "id": "planner",
  "name": "架构设计",
  "description": "Senior architect, expert in system design and architecture decisions",
  "preferredProvider": "opencode",
  "model": "default",
  "permissionFlags": {
    "trusted": ["--agent", "plan", "--model", "default"]
  }
}
```

**Collaboration modes:**

| Mode | Description | Use Case |
| :--- | :---------- | :------- |
| **Open Floor** | All agents participate freely, visible to each other | Discussion, brainstorming |
| **Orchestrated** | @mention triggers specific agent, others silent | Specific tasks, code fixes |
| **Ask First** | Agent asks before executing | Safety-sensitive operations |

</details>

---

## 🤖 Provider Support

<details>
<summary><strong>🔍 View All 7 Providers ▶️</strong></summary>

<br>

| Provider | Transport | Model Selection | Custom Path | Status |
| :------- | :-------- | :------------- | :---------- | :----- |
| Claude | stream-json (persistent) | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | ✅ Stable |
| OpenCode | per-turn spawn | `--agent build/plan` | `~/.opencode/bin/opencode` | ✅ Stable |
| Gemini | per-turn spawn (stdin) | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | ✅ Stable |
| Codex | per-turn spawn | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | ✅ Stable |
| Copilot | per-turn spawn | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | 🔄 Beta |
| Cursor | per-turn spawn | `--model` flag | `/opt/homebrew/bin` + `/usr/local/bin` | 🔄 Beta |
| Kimi | per-turn spawn | auto (CLI managed) | `~/.local/bin/kimi` | ✅ Stable |

</details>

---

## 🧪 Development Setup

Tech stack: Electron · Vite · React · Zustand · SQLite · TypeScript

```bash
pnpm dev          # dev mode (hot reload)
pnpm build        # build
pnpm start        # run built app
pnpm test         # run tests (vitest)
pnpm typecheck    # TypeScript type check
pnpm dist         # package macOS DMG
```

---

## 🤝 Contributing

Please read [AGENTS.md](AGENTS.md) before opening a PR.

1. Fork this project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

All changes require Review APPROVED. Test coverage ≥ 80%.

---

## License

This project is licensed under [MIT](LICENSE).

---

## Star History

<p align="center">
  <a href="https://www.star-history.com/#wzasd/Aether&Date" target="_blank">
    <img src="https://api.star-history.com/svg?repos=wzasd/Aether&type=Date" alt="Star History" width="600">
  </a>
</p>

<div align="center">

**If you like it, give us a star ⭐**

[Report Bug](https://github.com/wzasd/Aether/issues) · [Request Feature](https://github.com/wzasd/Aether/issues)

</div>