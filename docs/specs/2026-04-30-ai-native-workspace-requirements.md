---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: product-requirements
source:
  - https://www.figma.com/make/HssD6defKUYQV9PbipaOTo/AI-Native-Development-Workspace
  - https://upper-tweak-68686408.figma.site
---

# AI Native Development Workspace Requirements

## Product Definition

Bytro should become an AI-native development workstation: a local desktop workspace where users create tasks, assign or observe multiple agents, inspect the shared conversation, review code changes, and keep terminal/test/build feedback in the same surface.

The published Figma site describes the product as a workstation for task-driven workflows and multi-agent interactions. The UI prototype confirms that the product is not a chat app with optional coding panels; it is an IDE-like workspace where task execution, agent reasoning, file changes, code, docs, preview, settings, and terminal output are first-screen concepts.

## Primary User

The primary user is an individual developer using AI agents to modify a local codebase. They need to see what agents are doing, understand the proposed plan, inspect files and diffs, run or observe validation, and intervene before risky work lands.

## Product Principles

- Task first: every conversation and agent event belongs to an active task.
- Shared execution: multiple agents can participate in one task through a shared conversation.
- Change visibility: file changes are visible as a first-class artifact, not hidden inside chat text.
- Workspace continuity: project, files, tabs, terminal output, docs, and settings remain in context while agents work.
- Local control: user can stop, redirect, follow suggestions, open changes, or adjust agents without leaving the main screen.
- Dense calm UI: dark, compact, IDE-like surfaces with resizable panes and stable rows.

## Core Screen Model

The Figma prototype is organized into three resizable columns plus a bottom output surface.

| Surface | Product Role | Required Capabilities |
|---|---|---|
| Task Rail | Work queue and task switching | New task, task filters, task status, agent count, changed-file count, collapse/expand |
| Shared Conversation | Task command center | Project selector, active agents, user prompts, agent messages, thinking, tool calls, plan blocks, change summaries, composer |
| Workspace Area | Developer inspection and control | Code editor/viewer, track changes, docs, preview, settings, file tabs, follow suggestions, explorer/outline side panel |
| Bottom Output | Execution feedback | Terminal, build, test, diagnostics tabs with session-scoped output |

## Functional Requirements

### 1. Project And Task Rail

- The app must support recent projects with name, path, and last-opened time.
- The user can open a folder and switch active project.
- The user can create a new task inside the active project.
- Tasks have at least these statuses: `Idle`, `Running`, `Waiting`, `Error`, `Done`.
- Task rows show title, status, timestamp, participant agent count, and changed-file count.
- Task filters include all, active, pending, and completed.
- The task rail can collapse, and the shared conversation header can expand it again.

### 2. Shared Conversation

- The shared conversation is scoped by project and active task.
- The header includes project selection, new task, and settings.
- The active agent strip shows agent name, role, and state.
- Agent states include idle, thinking, editing, reviewing, and waiting.
- Message types include user, agent, plan, and change.
- Agent messages can include:
  - thinking block
  - tool call list
  - markdown response
  - mini change summary
  - copy/retry actions
- Plan blocks render separately from generic agent markdown.
- Tool calls show tool name, compact input summary, running/done/error status, expandable input, and result.
- Tool names are normalized into human labels for Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Delete, and MCP tools.
- The composer supports target agent selection and modes: build, plan, review, ask.
- The composer placeholder should invite work intent, not generic chat.

### 3. Change Visibility

- The app must aggregate changed files for the active task.
- Change summaries appear both inside agent responses and pinned at the bottom of the shared conversation.
- File changes track path, status, additions, and deletions.
- Supported file statuses: modified, added, deleted.
- Users can open the Track Changes panel from a change summary.
- The changed-file surface should support Chinese labels used by the prototype, including `产物汇总` and `查看变更`, while keeping the UI ready for localization.

### 4. Workspace Area

- The workspace area supports top-level panels: Code Editor, Track Changes, Documentation, Preview, Settings.
- Panels are tabbed, closable, and can be opened from actions such as settings or view changes.
- Code panel supports file tabs, new tab, close tab, current file title, and follow suggestions.
- Follow suggestions are small file/action chips linked to the active agent output.
- Code view must show line numbers and syntax highlighting in the MVP.
- Track Changes panel must show changed files and diff hunks.
- Documentation panel must render project docs such as `CLAUDE.md`, README, API docs, or project memory.
- Preview panel must show local dev-server status and URL.
- Settings panel must include General, Appearance, Agents, API Keys, Network, Git, Data & Storage, and Notifications sections, even if some are initially placeholders.

### 5. Explorer And Outline

- Code panel shows an Explorer side panel by default.
- Explorer supports folders, files, expanded/collapsed state, active file, and compact row density.
- Non-code panels may show an Outline side panel.
- Outline can list functions, exports, or document sections depending on active panel type.

### 6. Bottom Output Surface

- Bottom output is toggled from the workspace toolbar.
- Output tabs include terminal, build, test, and diagnostics.
- Terminal shows command output and local dev-server URL.
- Test output shows passed/failed test summaries.
- Diagnostics output shows warnings/errors and no-error state.
- The output surface must be vertically resizable and preserve active tab.

### 7. Agent Roles And Settings

- Initial built-in roles:
  - Architect or Planner: decomposes and validates the plan.
  - Coder: edits files and runs tests.
  - Reviewer: reviews diffs and risks.
- Users can enable/disable agents and configure model per role.
- API key settings include Anthropic, OpenAI, and GitHub.
- General settings include auto-save, tab size, format on save, telemetry, and language.
- Appearance settings include theme, editor font, font size, and minimap.

### 8. Safety And Control

- User can stop or interrupt active execution.
- Risky operations must create approval requests before execution or before commit/apply.
- Deleting files, running destructive commands, dependency changes, and network actions must be distinguishable from ordinary edits.
- Tool calls and file changes must be persisted for audit and recovery.

## MVP Scope

The next implementation pass should target a realistic single-machine MVP that matches the designed screen hierarchy.

In:

- Resizable task rail, shared conversation, workspace area, and output surface.
- Real project selection and active workspace root.
- Real task CRUD and task-scoped conversation.
- Agent runtime abstraction that can support multiple role sessions, even if only Claude CLI is active at first.
- Structured tool call, thinking, plan, and change event rendering.
- Read-only code viewer, file tree, basic diff, docs viewer, preview placeholder, settings shell.
- Terminal/build/test/diagnostics output model with at least log playback.
- SQLite persistence for projects, tasks, messages, tool calls, changes, workspace tabs, and terminal logs.

Out for MVP:

- Full Monaco editing parity.
- Full xterm.js interactive terminal.
- Parallel multi-provider execution.
- Git worktree isolation.
- Remote/team collaboration.
- MCP/A2A external protocol surfaces.

## Success Criteria

- A user can open a local project, create a task, send a build/plan/review/ask prompt, observe agent/tool activity, inspect changed files, open a diff, and see terminal/test/diagnostic output without leaving the main screen.
- The UI visually reads as an AI-native IDE workspace at first glance, not as a chat page.
- Every visible event is scoped to the active project and task.
- The app can recover task state after reload from SQLite.
- Typecheck and build pass after implementation changes.

