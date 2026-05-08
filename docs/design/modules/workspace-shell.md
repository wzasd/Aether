---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/renderer/src/App.tsx
  - src/renderer/src/stores/uiStore.ts
---

# Workspace Shell

## Goal

Replace the current `sidebar + main` layout with the Figma-defined three-column resizable workspace, plus an optional bottom output panel. The shell provides the layout container for all subsequent modules.

## Layout Specification

```
┌──────────────────────────────────────────────────────────────┐
│  system macOS traffic lights (titleBarStyle: hiddenInset)     │
├───────────┬─────────────────┬────────────────────────────────┤
│ TaskRail  │ Shared          │ WorkspaceArea                   │
│ (17%)     │ Conversation    │ (57%)                           │
│           │ (26%)           │ ┌─ Panel tabs ──────────────┐   │
│ collapse  │                 │ │ Code │ Diff │ ... │ Add   │   │
│ → 0%      │ collapse → 10%  │ ├───────────────────────────┤   │
│           │                 │ │ Content area              │   │
│           │                 │ │                           │   │
│           │                 │ ├───────────────────────────┤   │
│           │                 │ │ Bottom Output (resizable) │   │
│           │                 │ └───────────────────────────┘   │
└───────────┴─────────────────┴────────────────────────────────┘
```

### Panel Sizes

| Panel | defaultSize | minSize | maxSize | collapsible |
|-------|------------|---------|---------|-------------|
| TaskRail | 17 | 10 | 28 | yes (collapsedSize=0) |
| SharedConversation | 26 | 16 | 45 | yes (collapsedSize=10 for header) |
| WorkspaceArea | 57 | 30 | — | no |

### Resize Handles

- Width: `w-[3px]`
- Default: `bg-zinc-900`
- Hover: `bg-blue-600/40`
- Inner indicator: `h-8 w-px bg-zinc-700 group-hover:bg-blue-500 rounded-full`

### Bottom Panel (vertical split inside WorkspaceArea)

- Toggle via toolbar button, state in `uiStore.bottomPanelOpen`
- Vertical resize handle: `h-1` with `cursor-row-resize`
- Default split: 70% editor / 30% bottom when open; 100% editor when closed

## macOS Traffic Lights

The native Electron window uses `titleBarStyle: 'hiddenInset'` and `trafficLightPosition`, so macOS renders the traffic lights. The renderer must not draw duplicate red/yellow/green dots.

Leftmost panel header (TaskRail) must use `pl-16` to clear the native traffic-light area. When TaskRail is collapsed, the shell shows a small expand affordance below the native controls.

## Component Tree

```
App (HashRouter)
└── WorkspaceShell
    ├── TaskRailExpandButton (only when TaskRail is collapsed)
    ├── PanelGroup (horizontal, id="bytro-main", defaultLayout from localStorage)
    │   ├── Panel (id="task-rail")
    │   │   └── TaskRail (placeholder initially)
    │   ├── PanelResizeHandle
    │   ├── Panel (id="shared-conversation")
    │   │   └── SharedConversation (placeholder initially)
    │   ├── PanelResizeHandle
    │   └── Panel (id="workspace")
    │       └── WorkspaceArea
    │           └── PanelGroup (vertical, layout persisted per project)
    │               ├── Panel (id="editor-main")
    │               │   └── <Routes> (HomePage | ChatPage initially)
    │               ├── PanelResizeHandle (conditional)
    │               └── Panel (id="editor-bottom", conditional)
    │                   └── BottomOutput (placeholder initially)
```

## State Management

Extend `uiStore`:

```ts
interface UIState {
  // existing
  sidebarOpen: boolean
  theme: 'light' | 'dark'
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void

  // new — workspace shell
  taskRailCollapsed: boolean
  setTaskRailCollapsed: (v: boolean) => void
  bottomPanelOpen: boolean
  toggleBottomPanel: () => void
  setBottomPanelOpen: (v: boolean) => void
}
```

## Route Strategy

Two routes during transition, both rendered inside the WorkspaceArea content zone:

| Path | Component | Behavior |
|------|-----------|----------|
| `/` | `HomePage` | Existing home, shown in workspace content area |
| `/chat/:id` | `ChatPage` | Existing chat, will later become SharedConversation slot |

When Module 3 lands, routes will change — the workspace becomes a persistent shell and the chat moves into the SharedConversation panel.

## Phased Implementation

### Step 1: Install dependency

```bash
pnpm add react-resizable-panels
```

### Step 2: Create `WorkspaceShell.tsx`

New file: `src/renderer/src/components/workspace/WorkspaceShell.tsx`

- Wraps children in the three-column `PanelGroup`
- Leaves space for native macOS traffic lights
- Renders placeholder panels for TaskRail and SharedConversation (empty divs with correct styling)
- Routes render in the workspace panel content area

### Step 3: Refactor `App.tsx`

- Remove `flex h-screen` + `Sidebar` layout
- Replace with `<WorkspaceShell>` wrapping `<Routes>`
- Move global keyboard shortcuts into WorkspaceShell or keep in AppContent

### Step 4: Update `uiStore.ts`

- Add `taskRailCollapsed`, `bottomPanelOpen` and their setters

## Edge Cases

| State | Behavior |
|-------|----------|
| TaskRail collapsed | Panel collapses to 0, SharedConversation header shows expand button + pl-16 |
| SharedConversation collapsed | Panel collapses to minimal header width |
| Bottom panel closed | Vertical Panel is skipped, editor takes 100% |
| Narrow window | WorkspaceArea has `minSize={30}`, prevents complete collapse |
| No active task | TaskRail shows empty state (handled in Module 2) |
| First launch | Panel sizes use defaults from `defaultSize` props |

## Verification

- [ ] `pnpm add react-resizable-panels` succeeds
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] App opens with three visible columns
- [ ] Each column is independently resizable by dragging handles
- [ ] Native macOS traffic lights visible top-left, don't overlap content
- [ ] TaskRail can collapse/expand
- [ ] Bottom panel can toggle via button
- [ ] Existing routes (`/` and `/chat/:id`) still work
