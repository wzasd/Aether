---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/renderer/src/pages/Chat.tsx
  - src/renderer/src/components/chat/ChatInput.tsx
  - src/renderer/src/components/workspace/SharedConversation.tsx (new)
---

# Shared Conversation

## Goal

Refactor the existing Chat page into the Figma middle-column `SharedConversation` component. Preserve all existing streaming/message/thinking/tool-call functionality while adding the project selector, agent strip, mode switcher, and agent message restructuring.

## Strategy: Wrap, Don't Rewrite

Create a `SharedConversation` wrapper component that sits in the WorkspaceShell's middle panel slot. The wrapper adds the Figma UI chrome (project selector, agent strip, mode switcher, session changes bar) around the existing ChatPage content.

This keeps the existing chat pipeline intact while changing the visual shell.

## Component Tree

```
SharedConversation
├── TitleBar
│   ├── ExpandTaskRail button (when taskRail collapsed)
│   ├── ProjectSelector (dropdown)
│   ├── New Task button
│   └── Settings button
├── AgentStrip
│   └── Agent cards (name, role, status dot) + Add Agent placeholder
├── ConversationBody (scrollable)
│   ├── UserMessage (blue bubble, right-aligned)
│   ├── AgentMessage
│   │   ├── ThinkingBlock (reuse existing)
│   │   ├── ToolCallItem[] (enhanced existing)
│   │   ├── MarkdownContent (reuse existing)
│   │   ├── MiniChangesSummary (placeholder → M8)
│   │   └── Copy / Retry actions
│   └── PlanBlock (blue-bordered card)
├── SessionChangesSummary (pinned bottom, placeholder → M8)
└── Composer
    ├── Agent selector dropdown
    ├── Mode switcher (Build / Plan / Review / Ask)
    ├── Textarea
    └── Send button
```

## New Sub-Components

### ProjectSelector

Dropdown button showing current project name + `FolderOpen` icon. On click, shows dropdown with recent projects list + "Open folder..." action.

Uses `useWorkspaceStore` data. For MVP, selects the first workspace.

### AgentStrip

Horizontal row of agent cards. Each card shows:
- Colored status dot (idle=gray, thinking=blue, editing=yellow, reviewing=purple, waiting=orange)
- Agent name + role

For MVP: shows hardcoded Architect + Coder cards as in the Figma source.

### ModeSwitcher

Four-button group: Build / Plan / Review / Ask. Active mode has `bg-blue-600 text-white`. Replaces the current `PermissionModeSelector` position.

Maps modes to existing permission modes:
- Build → `autoEdit`
- Plan → `plan`  
- Review → `plan` (read-only)
- Ask → `plan` (read-only)

## Modified Components

### ChatInput → Composer

Add above the textarea:
- Agent selector `<select>` (All Agents / specific agent)
- Mode switcher button group

Keep existing: textarea, paperclip, send button, `/remember` handler, streaming abort.

### ChatPage → ChatPage (simplified)

Remove: title bar (moves to SharedConversation title bar), config bar (model/permission/dir selectors move to composer/settings).

Keep: scroll logic, message rendering, streaming display.

Route stays: `/chat/:id` renders `ChatPage` inside the SharedConversation panel.

## App.tsx Changes

```tsx
// Before
taskRail={<TaskRail />}
sharedConversation={null}

// After  
taskRail={<TaskRail />}
sharedConversation={<SharedConversation />}
```

`SharedConversation` renders `<Routes>` internally (or App.tsx keeps Routes in the sharedConversation slot).

## Message Types

| Type | Visual | Existing/New |
|------|--------|-------------|
| `user` | Blue bubble `bg-blue-600 rounded-2xl rounded-br-sm`, right-aligned | Existing |
| `agent` | Thinking → ToolCalls → Content → MiniChanges → Copy/Retry | Restructured |
| `plan` | Blue-bordered card `border-blue-900/30 bg-blue-950/20` | New |
| `change` | File diff card → M8 | New |

## States

| State | Behavior |
|-------|----------|
| No active conversation | Show centered placeholder "Select a task or start a new conversation" |
| Loading conversation | Skeleton or subtle spinner |
| Streaming | Composer shows Stop button, cursor blinks in agent content |
| Empty conversation | Show composer only |
| Error loading | Inline error with retry |

## Verification

- [ ] `pnpm run typecheck`
- [ ] `pnpm build`
- [ ] Existing chat flow works: create conversation → send message → stream → stop
- [ ] Project selector shows workspaces
- [ ] Mode switcher changes send mode
- [ ] Agent strip visible in middle panel header
- [ ] macOS traffic lights don't overlap middle panel header
