---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: checklist
---

# UI Review Checklist

Use this when reviewing or finishing UI work.

## Structure

- [ ] The screen has a clear primary task.
- [ ] Secondary panels do not compete with the main work area.
- [ ] No card-in-card layout.
- [ ] Lists have stable row height and clear selected/hover states.

## States

- [ ] Loading state is visible.
- [ ] Empty state is useful and compact.
- [ ] Error state says what failed and what the user can do.
- [ ] Disabled state is clear.
- [ ] Streaming/stopped states preserve user context.

## Visual

- [ ] Uses semantic tokens, not one-off colors.
- [ ] Text does not overflow buttons, cards, or sidebars.
- [ ] No overlapping UI at desktop or narrow widths.
- [ ] Icons have clear meaning or tooltip/title.
- [ ] Type scale matches container density.

## Agent Surfaces

- [ ] Tool calls show name, input, status, and result/error.
- [ ] Permission prompts are tied to the active session.
- [ ] Todo/subagent/usage panels do not show another conversation's state.
- [ ] Stopped generation preserves partial output and shows a stop notice.

## Verification

- [ ] `pnpm run typecheck`
- [ ] `pnpm build`
- [ ] Browser/app inspection for the affected screen
