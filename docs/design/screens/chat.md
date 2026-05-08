---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: screen-spec
screen: chat
---

# Chat Screen Spec

## Goal

The chat screen should make the active conversation, generation state, tool activity, memory context, and agent progress readable without overwhelming the user.

## Primary Regions

- Conversation sidebar.
- Message timeline.
- Composer.
- Agent status surfaces: Todo, tools, subagents, usage, memory recall.

## Message Types

| Type | Display |
|------|---------|
| user | compact distinct bubble/block |
| assistant | markdown content with readable spacing |
| system | subtle centered notice |
| thinking | muted expandable block |
| tool | compact collapsible status card |
| permission | actionable prompt tied to current session |

## Required States

- idle
- optimistic streaming
- streaming with text
- thinking only
- tool running
- permission waiting
- manually stopped
- timeout stopped
- provider error
- empty conversation

## Interaction Rules

- Stop generation must preserve partial assistant output.
- Background conversation events must not overwrite the visible conversation UI.
- Tool cards must not duplicate when partial and final events both arrive.
- Todo updates must persist to the originating conversation.
