---
status: active
owner: bytro
last_verified: 2026-05-01
doc_kind: plan
progress: partially-completed
---

# Plan: UI-First Priority Reset

> Status: Active strategy, partially completed. Workspace shell, shared conversation, workspace area, file/code MVP, preview MVP, and bottom output MVP have landed. Change visibility, memory/context surface polish, and Module A `Task = Conversation` convergence remain active.

## Goal

Re-prioritize Bytro around the Figma preset direction: an AI-native development workspace, not a generic chat app. The next build should make the first screen feel like a usable daily coding workspace: active task, conversation, agent state, project context, and file changes are all visible without overwhelming the user.

## Source Context

- The shared Figma Make link is public. The Figma plugin exposes the prototype's source structure, including `TaskRail`, `SharedConversation`, and `WorkspaceArea`.
- The published Figma site describes the product as a workstation for task-driven workflows and multi-agent interactions.
- The visible and source-derived design is a dark, dense development workspace: left project/task rail, center shared agent conversation, right code/diff/docs/preview/settings workspace, explorer/outline side panel, and bottom terminal/build/test/diagnostics output surface.
- Current Bytro P0 already includes core chat, Claude CLI provider, session config, conversation management, status surfaces, and memory system foundations.
- The priority reset should not chase all roadmap items evenly. It should first make the main screen match the design's working shape, then deepen each pane.

Canonical follow-up docs:

- `docs/specs/2026-04-30-ai-native-workspace-requirements.md`
- `docs/architecture/ai-native-workspace.md`

## Priority Principle

Order work by whether it helps the user answer five questions on the main screen:

1. What project and task am I working on?
2. What is the agent doing right now?
3. What did the agent change?
4. What needs my decision or permission?
5. What context will carry forward?

If a feature does not improve one of these answers, it should wait.

## P0: Design-Faithful Single-Agent Workspace

P0 is no longer "chat plus several side features." P0 is a stable single-agent development workspace with the same first-screen hierarchy as the Figma preset.

| Priority | Workstream | Why First | Acceptance |
|---|---|---|---|
| P0.1 | Workspace shell parity | The design's first impression is an IDE-like workspace, so the app must stop reading as a chat-only screen. | Four stable surfaces: project/task rail, agent column, code/editor area, terminal/output area; dark dense styling; no overlap at desktop/narrow widths. |
| P0.2 | Active agent execution loop | This is the core user workflow: choose project, set model/permission, ask agent, stream response, stop safely. | Composer, selectors, streaming, thinking, tool calls, stop, provider error, empty state, and partial-output preservation all work together. |
| P0.3 | Agent activity stack | The Figma center column shows agent work as structured steps, not only markdown messages. | Current task, plan/todo rows, tool events, permission waiting, usage, and stopped/error states are scoped to the active conversation and visually grouped. |
| P0.4 | Code surface MVP | The design includes code as a first-screen object, so a blank chat-only right pane would miss the product premise. | File selector/tree, current file header, read-only code view with syntax highlighting, and empty/error/loading states. Monaco editing can deepen later. |
| P0.5 | Terminal/output MVP | The design includes a lower execution surface; this makes agent work feel inspectable. | Bottom panel with command/output log, running/stopped/error states, clear active session label, and scroll behavior. xterm.js can deepen later. |
| P0.6 | Change visibility MVP | A development workspace must show what changed before adding multi-agent complexity. | Changed-file list, changed-file count, basic diff summary, and selected change detail tied to the active workspace. |
| P0.7 | Project memory and context surface | Memory is a product differentiator, but it should be visible as context, not another database feature. | Recall result, candidate review, conversation summary, and current project memory are reachable from the active workspace. |
| P0.8 | Conversation management polish | Needed for daily use, but secondary to the active work loop. | Search, titles, delete confirmation, selected states, empty/error states, and keyboard-friendly interactions are clean. Task card hover actions (delete/archive/rename) per PRD 4.1.3–4.1.4. |

## Progress Snapshot

Verified against code on 2026-05-01:

| Workstream | Status | Evidence |
|---|---|---|
| P0.1 Workspace shell parity | Done | `WorkspaceShell`, `TaskRail`, `SharedConversation`, `WorkspaceArea`, and `BottomOutput` are wired into `App.tsx`. |
| P0.2 Active agent execution loop | Done | Claude CLI provider, session config, streaming, abort, tool events, and provider errors are implemented. |
| P0.3 Agent activity stack | Done | `ThinkingBlock`, `ToolCall`, `TodoList`, `SubagentStatus`, and `UsageBar` are present and event-driven. |
| P0.4 Code surface MVP | Done | `FileService`, `fileStore`, `ExplorerPanel`, and `CodePanel` provide safe read-only file browsing and syntax-highlighted code. |
| P0.5 Terminal/output MVP | Partial | `BottomOutput` exists with Build/Test/Diagnostics/Terminal tabs, but it still uses simulated output and is not yet a real PTY/log service. |
| P0.6 Change visibility MVP | Not done | Diff/change tracking remains pending; current `DiffPanel` is still example-driven per active review. |
| P0.7 Project memory/context surface | Partial | Memory IPC/store/context injection/candidates exist, but the Figma-style compact Memory Palace surface is not complete. |
| P0.8 Conversation management polish | Partial | Search, title protection, delete confirmation, and state stores exist in the legacy sidebar/chat flow; TaskRail still needs Module A before this is complete in the workspace shell. Task card hover actions (delete/archive/rename) not yet implemented — PRD 4.1.3–4.1.4 updated, backend `task:delete`/`conversation:delete` IPC exists, UI pending. |

This plan remains open until P0.5 is connected to real output, P0.6 lands, P0.7 is represented in the workspace UI, and P0.8 is reconciled with Module A.

## P1: Developer Control Loop

After the first-screen workspace is coherent, deepen the developer controls behind the panes that already exist.

| Priority | Workstream | Acceptance |
|---|---|---|
| P1.1 | Full file explorer | Lazy file tree, current workspace root, ignored directories, selected file preview. |
| P1.2 | Monaco editor | Open file, syntax highlight, edit/save, dirty state, read-only fallback. |
| P1.3 | Diff view | Side-by-side or inline diff for agent changes, readable large-file behavior. |
| P1.4 | xterm terminal | PTY output in xterm.js with resize, input, status, and stop handling. |
| P1.5 | Approval gate MVP | Permission prompts, risky file changes, and destructive actions are reviewed in one consistent surface. |
| P1.6 | Git panel MVP | Stage, commit, branch status, and changed file history. |

## P2: Multi-Agent Collaboration

Only start multi-agent work after the single-agent workspace and change-control loop are usable.

| Priority | Workstream | Acceptance |
|---|---|---|
| P2.1 | Multi-provider adapter registry | Codex/Gemini/Kimi can be detected, configured, enabled, and disabled. |
| P2.2 | Task decomposition | User can edit generated subtasks before execution. |
| P2.3 | Parallel execution | Multiple agent sessions run with clear ownership and resource limits. |
| P2.4 | Shared blackboard | Agents can publish intermediate results and consume relevant context. |
| P2.5 | Conflict detection | Multi-agent edits to the same file are detected and routed to user review. |

## P3: Governance And Scale

Governance should come after the workspace proves useful.

| Priority | Workstream | Acceptance |
|---|---|---|
| P3.1 | Trust scoring | Agent behavior history affects default approval levels. |
| P3.2 | Audit report | User can export a clear operation/change report. |
| P3.3 | MCP/A2A integration | External tools can call Bytro capabilities through explicit protocol surfaces. |
| P3.4 | Remote approval | Mobile or team approval flow exists without weakening local safety. |

## Immediate Next Build Order

1. Audit current Chat screen against the Figma thumbnail and UI review checklist.
2. Refactor the screen into stable workspace panes: left project rail, center agent column, right code surface, bottom output surface.
3. Move agent activity into a structured stack in the agent column.
4. Add read-only code/file and terminal/output MVPs before full Monaco or xterm.js.
5. Add the Change Visibility MVP before Git or multi-agent features.
6. Expose memory/context as a compact active-workspace surface.
7. Run typecheck, build, and desktop/narrow visual inspection.

## Out Of Scope For The Next Pass

- Multi-model execution beyond the existing Claude provider abstraction.
- DAG orchestration.
- Full Git worktree isolation.
- Team workflows.
- Remote access.
- MCP/A2A.
- Marketing or landing-page UI.

## Verification

- [ ] `pnpm run typecheck`
- [ ] `pnpm build`
- [ ] Inspect the main workspace at desktop width.
- [ ] Inspect the main workspace at narrow width.
- [ ] Verify empty, streaming, tool running, permission waiting, stopped, and provider error states.

## Risks

- The public thumbnail is readable, but fine-grained layer measurements still require Figma canvas/dev-mode access or exported frames.
- Change visibility may require main-process file watching and diff computation; keep the first version intentionally small.
- Memory UI can become noisy. Keep it compact and tied to the active conversation/project.

## Decisions

- Prioritize a coherent single-agent workspace before multi-agent features.
- Bring lightweight code, output, and change visibility surfaces into P0 because the Figma preset already shows them in the first screen.
- Keep full Monaco editing, xterm.js, full Git, and full approvals in P1; P0 should establish the panes and basic working states first.
