---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: design
---

# Bytro UI Guidelines

Bytro is a developer workspace for agent-assisted coding. It should feel quiet, precise, and durable.

## Product Feel

- Work-focused, not marketing-like.
- Dense enough for repeated daily use.
- Clear hierarchy over decoration.
- Calm surfaces, restrained color, predictable interaction.
- Strong state visibility for agents, tools, memory, and generation.

## Reference Products

- Cursor: AI chat + coding workspace.
- Linear: list density, status clarity, keyboardable workflows.
- Raycast: compact commands, selectors, crisp empty/error states.

## Layout Rules

- Prefer stable panes: sidebar, main conversation/work area, inspector/status surface.
- Do not add hero sections, decorative gradients, or marketing composition.
- Do not nest cards inside cards.
- Cards are for repeated entities, modals, or framed tools.
- Headers and toolbars should use fixed dimensions to prevent layout shift.

## Visual Rules

- Use existing semantic tokens first: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`.
- Avoid one-off hardcoded color palettes.
- Border radius should usually be 6-8px.
- Keep typography compact inside panels and lists.
- Use icons for tool buttons when the command is familiar.

## Required States

Every new UI feature should account for relevant states:

- idle
- loading
- empty
- error
- active
- disabled
- streaming
- stopped
- permission waiting
- tool running
- tool completed

## Message UI Rules

- User messages: visually distinct but not oversized.
- Assistant messages: readable markdown, stable line width.
- System notices: subtle centered notice or low-emphasis block.
- Thinking: muted, expandable, clearly secondary.
- Tool calls: compact, collapsible, status visible.
- Permission prompts: actionable, scoped to the active session.

## Agent Settings Rules

- Agent settings should separate `AgentProfile` metadata, prompt template preview, and routing capabilities.
- Basic profile metadata (`name`, `role`, `provider`, `model`, `description`) is the high-frequency editable area.
- Role templates should be read-only in Settings and clearly marked as `preset` or `custom`.
- Capability routing fields (`capabilities`, `whenToUse`, `outputContract`) should be advanced and collapsed by default.
- Preset/custom source detection should reuse the same preset profile ids as seed data; do not create a second Agent registry in the renderer.

## Verification

For substantial UI changes:

- Run `pnpm run typecheck`.
- Run `pnpm build`.
- Open the app and inspect desktop and narrow widths.
- Check for text overflow, overlapping UI, broken scroll, missing empty/error states.
