---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: workflow
---

# Design Agent Workflow

Use this workflow when an agent changes Bytro UI.

## 1. Read

- `docs/design/ui-guidelines.md`
- The relevant screen spec under `docs/design/screens/`
- Current implementation files

## 2. Define States

Before editing, list the UI states affected by the task:

- idle
- loading
- empty
- error
- active
- disabled
- streaming
- stopped
- permission waiting
- tool running/completed/error

## 3. Implement

- Reuse existing components and tokens first.
- Keep layout stable with fixed dimensions where appropriate.
- Avoid introducing a new visual system.
- Do not change business logic unless the UI state requires it.

## 4. Verify

Minimum:

```bash
pnpm run typecheck
pnpm build
```

For interactive surfaces:

- Open local app.
- Verify normal, empty, loading, error, and narrow viewport states.
- Capture screenshots when the change is visual or layout-heavy.

## 5. Report

Final response should include:

- What changed.
- Which states were verified.
- Which commands passed.
- Any remaining visual risk.
