---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/renderer/src/components/workspace/WorkspaceArea.tsx (new)
  - src/renderer/src/stores/uiStore.ts
---

# Workspace Area (Framework Shell)

## Goal

Build the right-side workspace panel framework: tabbed top-level panels, file tabs for the Code panel, Explorer/Outline side panel toggle, and Follow Suggestions. Content panels start as placeholders and are filled by subsequent modules.

## Component Tree

```
WorkspaceArea
├── PanelTabBar (top, border-b-2)
│   ├── Panel tabs (Code / Diff / Docs / Preview / Settings)
│   │   └── Each: icon + label + close badge (hover)
│   ├── Separator (vertical line)
│   ├── Add Panel button + dropdown picker
│   └── Right controls: Outline toggle + Terminal toggle
├── CodePanel-owned FileTabBar (conditional, only inside Code panel)
│   └── Real open files from fileStore
├── FollowSuggestions bar (conditional)
│   └── "Follow:" label + file chips
├── Main content row (flex-1, flex)
│   ├── Content area (flex-1)
│   │   └── Panel content (Code / Diff / Docs / Preview / Settings)
│   └── SidePanel (conditional)
│       ├── Explorer (for Code panel)
│       └── Outline (for non-Code panels)
```

## Panel Tab Bar

### Tabs

Each tab: `icon + label` with `px-3 py-1.5 rounded text-xs`.
- Active: `bg-zinc-800 text-zinc-100`
- Inactive: `text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900`
- Close badge: `absolute -top-1 -right-1`, hidden by default, `group-hover:flex`

### Add Dropdown

Button: `+` icon, `Add` label. Dropdown lists all 5 panel types. Already-open panels show "open" badge. Clicking an open panel switches to it.

### Right Controls

Two toggle buttons:
- Outline/Sidebar toggle (`PanelRight` icon)
- Terminal toggle (`Terminal` icon, controls bottom panel)
- Active state: `bg-zinc-800 text-zinc-200`

## Panel Types

| Panel | Icon | Content (MVP) | Filled By |
|-------|------|---------------|-----------|
| Code | `Code2` | Placeholder "Code Editor" | Module 5 |
| Diff | `GitCompare` | Placeholder "Track Changes" | Module 8 |
| Docs | `BookOpen` | Placeholder "Documentation" | Module 5 |
| Preview | `Monitor` | Placeholder "Preview" | Module 6 |
| Settings | `Settings` | Placeholder "Settings" | Module 9 |

## File Tab Bar (Code panel only)

Visible only when the active panel is Code. M5 moves the file tab truth source into `fileStore` and `CodePanel`; `WorkspaceArea` must not keep a second mock file tab state.

Each file tab: `FileCode` or `FileText` icon + title + `X` close button (hover).
- Active: `bg-zinc-900 text-zinc-200`
- Inactive: `text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40`

## Follow Suggestions

Conditional bar below file tabs. Shows `"Follow:"` label + clickable file chips.
- Chip: `px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded text-xs`

## Explorer / Outline

- **Explorer**: Shown when Code panel is active. Real lazy file tree from `fileStore`.
- **Outline**: Shown when non-Code panel is active and `showSidePanel` is true. Shows functions/exports.

Both are `w-52` or `w-56` side panels with `border-l border-zinc-800`.

## State

All state is local `useState` in WorkspaceArea:
- `panels`: array of open panels
- `activePanelId`: currently selected panel
- `showPanelPicker`: Add panel dropdown open

File tree, open files, and active file are owned by `fileStore` and rendered by `CodePanel` / `ExplorerPanel`.

## Props

```ts
interface WorkspaceAreaProps {
  showSidePanel: boolean
  showBottomPanel: boolean
  onToggleSidePanel: () => void
  onToggleBottomPanel: () => void
}
```

Toggle state connects to `uiStore` (bottomPanelOpen).

## Verification

- [ ] `pnpm run typecheck` + `pnpm build`
- [ ] Panel tabs switch between Code/Diff/Docs/Preview/Settings
- [ ] Add dropdown shows all panel types with open/closed state
- [ ] File tabs show/hide based on active panel
- [ ] Explorer/Outline toggle works
- [ ] Close button removes panel tab
