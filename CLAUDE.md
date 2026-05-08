# CLAUDE.md

ehavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

This file is the short map for Claude Code and other coding agents working in Bytro. Keep it short. Put durable details in `docs/`, not here.

## Project

Bytro is an Electron + React + Zustand AI Chat IDE.

- Main process: Node/Electron, SQLite, AI provider runtime, IPC.
- Preload: narrow `window.api` bridge only.
- Renderer: React 18, Zustand, Tailwind v4.
- AI runtime: Claude CLI provider with `child_process` stream-json for non-manual modes and `node-pty` for manual interactive mode.
- Memory runtime: `.bytro/*` files are durable truth sources; SQLite tables are read models / indexes unless explicitly documented otherwise.

## Start Here

Before changing code:

1. `docs/PROGRESS.md` — 当前项目状态，正在做什么，P1 问题列表。**每次必读。**
2. `docs/features/<feature>.md` — 任务对应 feature 的需求、设计、当前状态。
3. 按需读架构文档：
   - `docs/architecture/runtime.md` — Electron/runtime/build boundaries.
   - `docs/architecture/ai-provider.md` — AI provider, Claude CLI, event stream.
   - `docs/architecture/memory-system.md` — project/agent/conversation memory truth sources.
4. UI 改动时：`docs/design/mochi-design-reference.md` — **设计规范单一真相来源**。

### react-resizable-panels 版本说明

项目安装了 **v4** (`react-resizable-panels@4.x`)，API 与设计文档中的 v3 示例不同：

| 设计文档 (v3) | 实际代码 (v4) |
|--------------|-------------|
| `PanelGroup` | `Group` |
| `PanelResizeHandle` | `Separator` |
| `ImperativePanelHandle` | `PanelImperativeHandle` |
| `ref` on Panel | `panelRef` on Panel |
| `autoSaveId` | 使用 `useDefaultLayout()` hook |
| `onCollapse` / `onExpand` | 使用 `onResize` 检测 `size.asPercentage === 0` |
| Panel `direction` | Group `orientation` |

## Required Workflow

1. Read `docs/PROGRESS.md`, then the relevant `docs/features/<feature>.md`.
2. Inspect the current code before editing.
3. Keep changes scoped to the request.
4. Update docs when behavior, architecture, IPC, DB schema, or UI contracts change.
5. Run verification:
   - `pnpm run typecheck`
   - `pnpm build`
   - `pnpm test` when tests are touched or relevant

## Hard Rules

- Do not use `BrowserRouter`; Electron file loading requires `HashRouter` unless a custom protocol fallback exists.
- Do not expose generic Electron IPC to renderer. Preload must expose only narrow namespaced APIs.
- Validate IPC payloads at runtime in main process.
- Do not construct SQL with renderer-controlled column names.
- Open external URLs only through protocol allowlists.
- Main/preload output is CJS. Do not add `"type": "module"` to `package.json`.
- `better-sqlite3` is a native CJS dependency; load it through the existing DB boundary.
- Do not treat Claude/Codex runtime session ids as durable memory.
- Do not write project memory read models directly from renderer. Durable memory goes through `.bytro/project-memory.md` or markers, then gets indexed.

## UI Rules

- Bytro is a quiet developer workspace, not a marketing site.
- Use existing semantic tokens and components first.
- Avoid card-in-card layouts, decorative gradients, and one-off color systems.
- Every UI change must cover relevant states: idle, loading, empty, error, active, disabled, streaming, stopped.
- For substantial UI work, verify in the app with screenshots or browser inspection.

## Commands

```bash
pnpm dev
pnpm run typecheck
pnpm build
pnpm test
pnpm dist
```

## Documentation Rule

`CLAUDE.md` is a map, not a manual. Feature specs live in `docs/features/`. Current project state lives in `docs/PROGRESS.md`. If a detail grows beyond a few bullets, move it into `docs/` and link it.
