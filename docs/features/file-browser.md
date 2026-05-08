---
status: design
priority: P1
last_verified: 2026-05-02
doc_kind: feature
---

# Feature: File Browser

## Why

当前 ExplorerPanel 功能有限：没有完整的文件树、不能展开目录、不能右键操作。用户需要在 IDE 里浏览项目文件结构、打开文件编辑、对文件做基本操作（重命名、删除、新建）。

**用户故事**：在 WorkspaceArea 的 Code 面板左侧看到项目文件树，点击文件在 Monaco 中打开，右键可以新建/重命名/删除文件，文件变更后自动刷新。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| F1 | 文件树渲染 | 懒加载树形结构，展开/折叠目录 | P0 |
| F2 | 文件图标 | 按扩展名显示文件图标，目录与文件区分 | P0 |
| F3 | 点击打开文件 | 单击文件在 Monaco Editor 中打开 | P0 |
| F4 | 右键菜单 | 新建文件/文件夹、重命名、删除、复制路径 | P1 |
| F5 | 自动刷新 | 文件系统变更时自动更新树 | P1 |
| F6 | 键盘导航 | 方向键展开/折叠/选择，Enter 打开 | P1 |
| F7 | 排除规则 | 默认隐藏 node_modules/.git/dist，可配置 | P1 |
| F8 | 拖拽文件 | 拖拽文件到 ChatInput 作为上下文附件 | P2 |

## How

### 架构

```
Renderer (React)                    Main Process
─────────────────                    ────────────
FileTree component
    │
    ├── readDir(path) ────IPC────→  fs.readdir (Node.js)
    │
    ├── watch(path)  ────IPC────→  chokidar.watch (已有 file:watch IPC)
    │
    └── lazy load: 只加载展开的目录，根目录首次渲染时加载
```

### 数据流

```
1. WorkspaceShell mount → api.file.listDir(workspace.repoPath)
2. 返回 [dirEntry, ...] → 渲染根级树节点
3. 用户点击展开 → api.file.listDir(node.path) → 追加子节点
4. chokidar 检测变更 → file:changed IPC → store 更新 → UI 刷新
5. 用户点击文件 → WorkspaceArea.openFile(path)
```

### IPC 通道

已有的 `file:*` IPC 为基础，只需补充：

| Handler | 参数 | 返回 |
|---------|------|------|
| `file:listDir` | `dirPath: string` | `DirEntry[]` |
| `file:createFile` | `filePath: string` | `void` |
| `file:createDir` | `dirPath: string` | `void` |
| `file:rename` | `oldPath, newPath: string` | `void` |
| `file:delete` | `path: string` | `void` |

### DirEntry 类型

```typescript
interface DirEntry {
  name: string
  path: string           // 绝对路径
  type: 'file' | 'directory' | 'symlink'
  extension?: string     // ".ts", ".tsx", ".json" 等
  size?: number          // 文件大小 (bytes)
  modifiedAt?: number    // 最后修改时间
}
```

### 组件树

```
ExplorerPanel (已有，需增强)
  ├── FileTree
  │   ├── FileTreeNode (递归)
  │   │   ├── 展开/折叠箭头 (目录)
  │   │   ├── 文件图标 (按扩展名)
  │   │   ├── 文件名
  │   │   └── 子节点列表 (懒加载)
  │   └── 空状态："无文件"
  └── FileContextMenu (右键菜单)
      ├── 新建文件
      ├── 新建文件夹
      ├── 重命名
      ├── 删除
      └── 复制路径
```

### 性能考虑

- **懒加载**：默认只加载 2 层深度，展开时再加载子节点
- **目录大时**：超过 200 个条目的目录加虚拟滚动
- **去抖刷新**：chokidar 事件去抖 300ms 后统一刷新
- **忽略规则**：`.gitignore` 中的路径自动跳过，额外支持 `.bytroignore` 配置

### 文件图标映射

不引入额外图标库，使用简单的扩展名 → 图标映射：

```typescript
const EXT_ICONS: Record<string, string> = {
  ts: 'file-code', tsx: 'file-code', js: 'file-code', jsx: 'file-code',
  json: 'file-json', md: 'file-text', css: 'file-css',
  html: 'file-code', py: 'file-code', rs: 'file-code', go: 'file-code',
  gitignore: 'git-branch', env: 'shield', lock: 'lock',
  png: 'image', jpg: 'image', svg: 'image',
  // 默认: 'file'
}
```

## Status

📋 **设计阶段。** ExplorerPanel 有基础骨架，需要重构为完整的文件浏览器。

## Code

| 层 | 文件 | 变更 |
|----|------|------|
| 主进程 | `src/main/ipc/file.ts` | **增强** — 增加 listDir/createFile/createDir/rename/delete |
| 预加载 | `src/preload/index.ts` | **增强** — `api.file.*` 补充新方法 |
| 渲染 | `src/renderer/src/components/workspace/FileTree.tsx` | **新建** |
| 渲染 | `src/renderer/src/components/workspace/FileTreeNode.tsx` | **新建** |
| 渲染 | `src/renderer/src/components/workspace/FileContextMenu.tsx` | **新建** |
| 渲染 | `src/renderer/src/components/workspace/ExplorerPanel.tsx` | **重构** |
| 渲染 | `src/renderer/src/stores/fileStore.ts` | **增强** |
