---
status: active
owner: bytro
last_verified: 2026-05-01
doc_kind: index
---

# Bytro Documentation Index

This directory is the record system for Bytro. Agents should start here, then read only the documents relevant to the task.

## Agent 入口（优先读这两个）

- `PROGRESS.md` — **当前项目状态**：Feature 进度、P1 问题、已完成列表。每次任务开始必读。
- `features/` — **Feature 文档**：每个 feature 一个文件，包含需求、设计决策、当前状态、代码位置。

## How To Use This Map

| Task | Read First | Then Read |
|------|------------|-----------|
| Runtime/build/Electron issue | `architecture/runtime.md` | related review docs |
| Claude CLI / streaming / tools | `architecture/ai-provider.md` | `modules/ai-provider.md`, active review |
| Agent collaboration / runtime discovery reference | `architecture/multica-agent-collaboration-reference.md` | `architecture/multi-agent-a2a-orchestration.md`, `architecture/acp-protocol-leverage.md` |
| Agent communication patterns reference | `architecture/slock-agent-communication-reference.md` | `architecture/multi-agent-a2a-orchestration.md`, `architecture/decisions/session-layer-adrs.md` |
| Session layer fixes / observability | `architecture/decisions/session-layer-adrs.md` | `architecture/session-bug-fixes.md`, `architecture/observability-logging.md`, `src/main/core/logging.ts`, `src/main/ai/orchestrator.ts` |
| Session-Context-Memory refactoring | `architecture/bytro-refactoring-plan.md` | `architecture/decisions/session-layer-adrs.md`, `architecture/memory-system.md`, `architecture/multi-agent-a2a-orchestration.md` |
| Open Floor / dual-mode collaboration | `features/open-floor-collaboration-mode.md` | `architecture/bytro-refactoring-plan.md` Phase 4, `architecture/decisions/session-layer-adrs.md` ADR-009/010 |
| Permission model / approval architecture | `architecture/decisions/session-layer-adrs.md` ADR-010 | `architecture/observability-logging.md`, `architecture/bytro-refactoring-plan.md` Phase 4 |
| Memory Palace / recall / agent sessions | `architecture/memory-palace-design.md` | `architecture/memory-system.md`, `architecture/a2a-memory-bridge.md`, `features/memory-palace.md` |
| Functional requirements (active) | `specs/2026-04-30-functional-requirements.md` | module design docs in `design/modules/` |
| Design spec reference | `design/mochi-design-reference.md` | `reviews/active/design-spec-gap-analysis.md` |
| Module A: Task = Conversation | `design/modules/A-task-execution-engine.md` | `specs/2026-04-30-functional-requirements.md` |
| Module B: File Change Tracking | `design/modules/B-file-change-tracking.md` | Module A design, existing `chatStore` |
| Module C: Memory Palace | `design/modules/C-memory-palace.md` | Module A design, `design/mochi-design-reference.md` §7.5/§14 |
| AI-native workspace requirements | `specs/2026-04-30-ai-native-workspace-requirements.md` | `architecture/ai-native-workspace.md`, `plans/2026-04-30-ui-first-priority-plan.md` |
| AI-native workspace architecture | `architecture/ai-native-workspace.md` | `specs/2026-04-30-ai-native-workspace-requirements.md`, `architecture/runtime.md`, `architecture/ai-provider.md` |
| Code/Terminal/Preview technology choices | `architecture/workspace-surfaces-technology.md` | `architecture/ai-native-workspace.md`, `architecture/runtime.md` |
| Renderer UI changes | `design/ui-guidelines.md` | `design/design-agent-workflow.md`, screen spec |
| Chat UI changes | `design/screens/chat.md` | `design/review-checklist.md` |
| UI-first priority planning | `plans/2026-04-30-ui-first-priority-plan.md` | Active but partially completed; read `reviews/active/p0-code-review.md` for remaining gaps |
| Plan completion review | `reviews/active/plan-completion-review.md` | Current source of truth for which plans are completed vs still active |
| Historical P0 implementation | `plans/2026-04-28-bytro-p0-implementation.md` | Completed historical plan; use architecture/module docs for current contracts |
| Historical memory implementation | `plans/2026-04-29-bytro-memory-system.md` | Completed historical plan; use `architecture/memory-system.md` for current contracts |
| Code review follow-up | `reviews/active/p0-code-review.md` | historical review if needed |
| Latest code review | `reviews/active/2026-05-01-latest-code-review.md` | Current review for latest Workspace / Module A convergence code |
| New architectural decision | `templates/adr-template.md` | existing `decisions/` docs |
| New implementation plan | `templates/plan-template.md` | `plans/` |

## Top-Level Maps

- `../CLAUDE.md` — short agent entrypoint.
- `../AGENTS.md` — generic agent entrypoint.
- `../ARCHITECTURE.md` — top-level architecture map.
- `architecture/runtime.md` — Electron processes, CJS build constraints, IPC boundaries.
- `architecture/ai-provider.md` — AI provider architecture and Claude CLI event flow.
- `architecture/multica-agent-collaboration-reference.md` — Multica agent collaboration and dynamic model discovery reference, compared with Bytro Agent Space.
- `architecture/slock-agent-communication-reference.md` — Slock agent communication model analysis as reference for bytro-app multi-agent architecture.
- `architecture/decisions/session-layer-adrs.md` — ADR-005~010: session layer fixes (runtime key, permission routing, lifecycle cleanup, feedback context, mention parser) + observability integration + dual-mode collaboration (ADR-009) + layered permission model (ADR-010).
- `architecture/session-bug-fixes.md` — 2026-05-08 session bug fixes summary: 6 bugs fixed (zombie defense, permission routing, runtime key collision, stale session resume, feedback context, mention parser), ADR decisions, verification results, lessons learned.
- `architecture/observability-logging.md` — JSONL structured logging for agent runtime lifecycle covering 11 event types (task/runtime/permission/feedback/intent), IPC API (`logs:list`/`logs:read`), troubleshooting guide for "agent doesn't reply" and "permission stuck" scenarios.
- `architecture/bytro-refactoring-plan.md` — **会话-上下文-记忆三模块联动重构计划**：现状评估、目标架构、模块映射、P0-P4 实施路线图（含 Phase 4 混合协作拓扑）。
- `architecture/memory-palace-design.md` — **Memory Palace 完整架构设计**：分类、不记忆清单、三层知识架构、自动蒸馏、JSONL/git 同步、新项目冷启动。
- `architecture/memory-system.md` — durable memory layers and read-model boundaries.
- `architecture/ai-native-workspace.md` — task-first workspace architecture derived from the Figma Make prototype.
- `architecture/workspace-surfaces-technology.md` — technology choices for Code Editor, Terminal/Output, and Preview.
- `features/open-floor-collaboration-mode.md` — **Open Floor 协作模式 PRD**（Task #6）：双模协作流程、Agent 自主介入、分层权限、UI 调整、场景矩阵、实施计划。
- `design/mochi-design-reference.md` — **设计规范单一真相来源**（字体/颜色/布局/组件/交互/Tailwind 规范）。
- `design/ui-guidelines.md` — product feel, layout, components, visual rules.
- `design/design-agent-workflow.md` — how agents should design, implement, and verify UI.
- `design/review-checklist.md` — UI review checklist.
- `reviews/active/p0-code-review.md` — current unresolved review findings.

## Existing Specs And Modules

> Feature 文档（需求+设计+状态）已迁移至 `features/`。以下为历史参考文档。

- `specs/2026-04-28-bytro-p0-design.md` — P0 implementation scope.
- `specs/2026-04-29-bytro-memory-system-design.md` — memory system design.
- `specs/2026-04-30-ai-native-workspace-requirements.md` — active requirements for the Figma Make AI-native development workspace.
- `specs/2026-04-30-functional-requirements.md` — **active functional requirements** (Module A/B/C/D).
- `design/modules/A-task-execution-engine.md` — Module A design: Task = Conversation model.
- `design/modules/B-file-change-tracking.md` — Module B design: file change tracking from tool calls.
- `design/modules/C-memory-palace.md` — Module C design: Memory Palace.
- `reviews/active/design-spec-gap-analysis.md` — code vs. design spec gap audit.
- `modules/ai-provider.md` — ClaudeCLIProvider module.
- `modules/conversation-management.md` — conversation search/title/delete.
- `modules/selectors.md` — model/permission/directory selectors.
- `modules/ai-status-visualization.md` — usage/todo/subagent visualization.
- `modules/manual-tui-parser.md` — manual-mode PTY parser notes.
- `plans/2026-04-30-ui-first-priority-plan.md` — active, partially completed UI-first priority reset based on the AI-native workspace direction.
- `plans/2026-04-30-module-A-implementation.md` — active Module A implementation plan; not yet completed in code.

## Historical Records

- `specs/2026-04-28-bytro-p0-review.md` — historical P0 review log. Do not treat this as current active findings.
- `plans/2026-04-28-bytro-p0-implementation.md` — completed historical P0 implementation plan.
- `plans/2026-04-29-bytro-memory-system.md` — completed historical memory implementation plan.

## Documentation Rules

- Docs must say whether they are active, historical, or resolved.
- Long-lived architecture belongs in `architecture/`.
- Product/UI taste belongs in `design/`.
- Current unresolved findings belong in `reviews/active/`.
- Historical findings belong in `reviews/resolved/`.
- Plans belong in `plans/`.
- Specs and ADR-like decisions belong in `specs/` or `architecture/decisions/` when that directory is added.
- Module-level design specs (pre-P0) are in `modules/` with `status: reference`. For overlapping topics, `architecture/` docs take precedence.

## Freshness Contract

When code changes these surfaces, update docs in the same change:

- IPC channels or preload API.
- DB schema or read-model/truth-source boundaries.
- AIEvent types or provider lifecycle.
- Memory materialization, recall, or indexing.
- Build format, Electron window security, preload path.
- Shared UI patterns or screen-level behavior.
