---
status: active
owner: bytro
last_verified: 2026-04-30
doc_kind: design
applies_to:
  - src/main/ipc/file.ts (new)
  - src/preload/index.ts
  - src/renderer/src/stores/fileStore.ts (new)
  - src/renderer/src/components/workspace/CodePanel.tsx (new)
  - src/renderer/src/components/workspace/ExplorerPanel.tsx (new)
---

# Code Editor & File Tree

## Goal

Implement P0 read-only code viewer and real file explorer. Use existing `react-syntax-highlighter` for syntax highlighting. File reads go through main process IPC — renderer never touches the filesystem directly.

## Architecture

```
Main Process
  FileService (implicit in IPC handler)
    ├── listFiles(workspaceId, dir) → FileEntry[]
    └── readFile(workspaceId, path) → { content, language, size }
    └── resolve workspaceId → workspaces.repo_path in main process

IPC: file:list, file:read

Renderer
  fileStore
    ├── fileTree: FileEntry[]
    ├── fileContents: Map<path, { content, language, loading, error? }>
    ├── loadTree(workspaceId)
    └── loadFile(workspaceId, path)

  CodePanel (replaces CodePlaceholder)
    ├── File tabs (reuse from WorkspaceArea)
    ├── Line numbers + syntax-highlighted content
    └── States: loading, empty, error, binary/large-file

  ExplorerPanel (replaces hardcoded FileTree in WorkspaceArea)
    ├── Lazy tree with expand/collapse
    ├── Ignores: node_modules, .git, dist, .bytro, out
    └── Click file → load into CodePanel
```

## Data Types

```ts
interface FileEntry {
  name: string
  path: string       // relative to project root
  isDirectory: boolean
  children?: FileEntry[] | null
}

interface FileContent {
  content: string
  language: string   // for syntax highlighter
  size: number
}
```

## IPC: file:*

| Channel | Signature | Return |
|---------|-----------|--------|
| `file:list` | `(workspaceId: string, dir?: string)` | `FileEntry[]` |
| `file:read` | `(workspaceId: string, filePath: string)` | `{ content, language, size }` |

Main process resolves `workspaceId` to `workspaces.repo_path`, validates it is an existing directory, rejects absolute paths and `..` traversal, and checks real paths so symlinks cannot escape the project root.

## Language Detection

Simple extension-based mapping:
- `.ts`/`.tsx` → `typescript`
- `.js`/`.jsx` → `javascript`
- `.json` → `json`
- `.css` → `css`
- `.html` → `html`
- `.md` → `markdown`
- `.py` → `python`
- `.sql` → `sql`
- default → plain text

## Preload API

```ts
api.file = {
  list: (workspaceId: string, dir?: string) => ipcRenderer.invoke('file:list', workspaceId, dir),
  read: (workspaceId: string, filePath: string) => ipcRenderer.invoke('file:read', workspaceId, filePath),
}
```

## fileStore

```ts
interface FileState {
  fileTree: FileEntry[]
  openFiles: Map<string, { content: string; language: string; size: number; loading: boolean; error?: string }>
  activeFilePath: string | null

  loadTree: (workspaceId: string) => Promise<void>
  openFile: (workspaceId: string, filePath: string) => Promise<void>
  closeFile: (filePath: string) => void
  setActiveFile: (filePath: string) => void
}
```

## Safety Rules

- Renderer never accesses `fs` directly
- Renderer never chooses a raw project root; it passes `workspaceId` only
- Main process validates paths: no absolute paths, no `..` traversal, realpath must stay within `workspaces.repo_path`
- Symlinks are not followed by the Explorer scan and cannot be used to read outside the project root
- Files > 500KB show warning, > 2MB are rejected
- Binary files detected by null bytes → show metadata only

## Verification

- [ ] `pnpm run typecheck` + `pnpm build`
- [ ] File explorer shows real project tree
- [ ] Click file → loads content with syntax highlighting
- [ ] Large file shows warning
- [ ] Binary file shows metadata
- [ ] node_modules/.git/dist are excluded
