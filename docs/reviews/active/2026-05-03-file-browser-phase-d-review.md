---
status: active
owner: mochi
last_updated: 2026-05-03
doc_kind: code-review
---

# File Browser Phase D Code Review

Review scope:

- File CRUD IPC handlers in `src/main/ipc/file.ts`.
- Preload and renderer ElectronAPI file signatures.
- `fileStore` CRUD, refresh, and open-file reference updates.
- `FileContextMenu` and `ExplorerPanel` interaction wiring.
- `WorkspaceArea` ExplorerPanel integration with CodePanel open requests.

Verification:

- `pnpm run typecheck` passed on 2026-05-03.
- Browser/manual context menu verification was not run in this review pass.

## Findings

### [P1] Rename cannot create the new target path

File:

- `src/main/ipc/file.ts`

`file:rename` validates `newPath` with `safePath`, but `safePath` calls `fs.realpath(target)` and therefore requires the destination to already exist.

A normal rename from `foo.ts` to `bar.ts` fails with `ENOENT` before `fs.rename` runs.

Recommended fix:

Use `safeParentPath` for the destination path, then apply an explicit existence/overwrite policy check before `fs.rename`.

Status: Open.

### [P1] New file/dir creation can escape through symlink parents

File:

- `src/main/ipc/file.ts`

`safeParentPath` checks that the textual resolved target is under the project root, then realpaths the parent only to confirm it exists.

If the workspace contains a symlink directory such as `link -> /tmp`, creating `link/outside.txt` passes the textual check and writes outside the workspace because `fs.writeFile` follows the symlink.

Recommended fix:

After `realpath(parentDir)`, compare the real parent path against the real project root. Build the final path from the verified real parent plus basename, or reject symlink parents for write operations.

Status: Open.

### [P2] Root-level CRUD refresh is a no-op

File:

- `src/renderer/src/stores/fileStore.ts`

`createFile`, `createDir`, `renameEntry`, and `deleteEntry` call `refreshDir(parentDir(...))`. For root-level entries, that parent is `''`.

`refreshDir('')` fetches the root children, but then only updates an entry whose `entry.path === ''`. No such entry exists in `fileTree`, so the root tree does not change until a full reload.

Recommended fix:

Special-case `dirPath === ''` to replace `fileTree`, or call `loadTree()` for root refreshes.

Status: Open.

### [P2] Directory rename/delete leaves nested open files stale

File:

- `src/renderer/src/stores/fileStore.ts`

`renameEntry` only remaps `openFiles[oldPath]`, and `deleteEntry` only closes the exact `filePath`.

When a directory is renamed or deleted, any open tab under that directory remains keyed to the old or deleted path, with stale content and broken future saves or activation.

Recommended fix:

For directory operations, update or close all open-file keys equal to the path or starting with `${path}/`.

Status: Open.
