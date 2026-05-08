import { useEffect, useState, useCallback } from 'react'
import {
  ChevronRight, ChevronDown, Folder, File as FileIcon, Search,
  FileCode, FileText, FileJson, FileImage, FileType2, FileKey,
  Loader,
} from 'lucide-react'
import { useFileStore, type FileEntry } from '../../stores/fileStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { FileContextMenu } from './FileContextMenu'

const EXT_ICON_MAP: Record<string, React.ReactNode> = {
  ts: <FileCode size={11} className="text-blue-400 shrink-0" />,
  tsx: <FileCode size={11} className="text-cyan-400 shrink-0" />,
  js: <FileCode size={11} className="text-yellow-400 shrink-0" />,
  jsx: <FileCode size={11} className="text-cyan-400 shrink-0" />,
  mjs: <FileCode size={11} className="text-yellow-400 shrink-0" />,
  cjs: <FileCode size={11} className="text-yellow-400 shrink-0" />,
  json: <FileJson size={11} className="text-yellow-400 shrink-0" />,
  css: <FileType2 size={11} className="text-blue-300 shrink-0" />,
  scss: <FileType2 size={11} className="text-pink-400 shrink-0" />,
  less: <FileType2 size={11} className="text-blue-400 shrink-0" />,
  html: <FileCode size={11} className="text-orange-400 shrink-0" />,
  htm: <FileCode size={11} className="text-orange-400 shrink-0" />,
  md: <FileText size={11} className="text-foreground shrink-0" />,
  mdx: <FileText size={11} className="text-foreground shrink-0" />,
  py: <FileCode size={11} className="text-green-400 shrink-0" />,
  rs: <FileCode size={11} className="text-orange-400 shrink-0" />,
  go: <FileCode size={11} className="text-cyan-400 shrink-0" />,
  sql: <FileCode size={11} className="text-blue-400 shrink-0" />,
  yaml: <FileKey size={11} className="text-red-400 shrink-0" />,
  yml: <FileKey size={11} className="text-red-400 shrink-0" />,
  sh: <FileCode size={11} className="text-green-400 shrink-0" />,
  bash: <FileCode size={11} className="text-green-400 shrink-0" />,
  zsh: <FileCode size={11} className="text-green-400 shrink-0" />,
  svg: <FileImage size={11} className="text-purple-400 shrink-0" />,
  png: <FileImage size={11} className="text-purple-400 shrink-0" />,
  jpg: <FileImage size={11} className="text-purple-400 shrink-0" />,
  jpeg: <FileImage size={11} className="text-purple-400 shrink-0" />,
  gif: <FileImage size={11} className="text-purple-400 shrink-0" />,
  ico: <FileImage size={11} className="text-purple-400 shrink-0" />,
  gitignore: <FileKey size={11} className="text-muted-foreground shrink-0" />,
  env: <FileKey size={11} className="text-yellow-400 shrink-0" />,
  lock: <FileKey size={11} className="text-muted-foreground shrink-0" />,
}

function getFileIcon(name: string, isDirectory: boolean): React.ReactNode {
  if (isDirectory) {
    return <Folder size={11} className="text-muted-foreground shrink-0" />
  }
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : ''
  if (ext && EXT_ICON_MAP[ext]) return EXT_ICON_MAP[ext]
  return <FileIcon size={11} className="text-muted-foreground shrink-0" />
}

function getExt(name: string): string {
  if (!name.includes('.')) return ''
  return name.split('.').pop()?.toLowerCase() || ''
}

type CtxMenuState = {
  x: number; y: number; entry: FileEntry
} | null

interface ExplorerPanelProps {
  embedded?: boolean
  onOpenFile?: (filePath: string) => void
}

export function ExplorerPanel({ embedded = false, onOpenFile }: ExplorerPanelProps) {
  const fileTree = useFileStore((s) => s.fileTree)
  const treeLoading = useFileStore((s) => s.treeLoading)
  const projectPath = useFileStore((s) => s.projectPath)
  const setProjectPath = useFileStore((s) => s.setProjectPath)
  const loadTree = useFileStore((s) => s.loadTree)
  const loadChildDir = useFileStore((s) => s.loadChildDir)
  const collapseDir = useFileStore((s) => s.collapseDir)
  const activeFilePath = useFileStore((s) => s.activeFilePath)
  const openFile = useFileStore((s) => s.openFile)
  const createFile = useFileStore((s) => s.createFile)
  const createDir = useFileStore((s) => s.createDir)
  const renameEntry = useFileStore((s) => s.renameEntry)
  const deleteEntry = useFileStore((s) => s.deleteEntry)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    const wsPath = activeWorkspace?.repo_path
    if (wsPath && currentWorkspaceId) {
      setProjectPath(wsPath, currentWorkspaceId)
      loadTree()
    } else {
      setProjectPath(null, null)
    }
  }, [activeWorkspace?.repo_path, currentWorkspaceId, setProjectPath, loadTree])

  const handleToggleDir = useCallback((entry: FileEntry) => {
    if (entry.children === null) {
      loadChildDir(entry.path)
    } else {
      collapseDir(entry.path)
    }
  }, [loadChildDir, collapseDir])

  const handleFileClick = useCallback((entry: FileEntry) => {
    if (!entry.isDirectory) {
      if (onOpenFile) {
        onOpenFile(entry.path)
      } else {
        openFile(entry.path)
      }
    } else {
      handleToggleDir(entry)
    }
  }, [onOpenFile, openFile, handleToggleDir])

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const handleRenameSubmit = useCallback((oldPath: string) => {
    const name = renameValue.trim()
    if (name && name !== oldPath.split('/').pop()) {
      renameEntry(oldPath, name)
    }
    setRenaming(null)
    setRenameValue('')
  }, [renameValue, renameEntry])

  const handleDelete = useCallback((filePath: string) => {
    const name = filePath.split('/').pop() || filePath
    if (window.confirm(`Delete "${name}"?`)) {
      deleteEntry(filePath)
    }
  }, [deleteEntry])

  const handleCopyPath = useCallback((filePath: string) => {
    navigator.clipboard.writeText(filePath).catch(() => {})
  }, [])

  const parentDir = (p: string) => {
    const i = p.lastIndexOf('/')
    return i > 0 ? p.slice(0, i) : ''
  }

  return (
    <div className={`${embedded ? '' : 'w-52 border-l border-border '}bg-background flex flex-col h-full min-h-0`}>
      {!embedded && (
        <div className="shrink-0 px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Explorer</span>
          <Search size={12} className="text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-1.5 pb-1.5 pt-0 min-h-0">
        {treeLoading && (
          <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div>
        )}
        {!treeLoading && fileTree.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {projectPath ? 'Empty directory' : 'No project open'}
          </div>
        )}
        {!treeLoading && fileTree.map((entry) => (
          <TreeEntry
            key={entry.path}
            entry={entry}
            depth={0}
            activeFilePath={activeFilePath}
            renaming={renaming}
            renameValue={renameValue}
            onToggle={handleToggleDir}
            onFileClick={handleFileClick}
            onContextMenu={handleContextMenu}
            onRenameStart={(path, name) => { setRenaming(path); setRenameValue(name) }}
            onRenameChange={setRenameValue}
            onRenameSubmit={handleRenameSubmit}
          />
        ))}
      </div>

      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          isDirectory={ctxMenu.entry.isDirectory}
          filePath={ctxMenu.entry.path}
          fileName={ctxMenu.entry.name}
          onClose={() => setCtxMenu(null)}
          onNewFile={() => {
            const dir = ctxMenu.entry.isDirectory ? ctxMenu.entry.path : parentDir(ctxMenu.entry.path)
            const name = prompt('File name:')
            if (name?.trim()) createFile(dir, name.trim())
          }}
          onNewFolder={() => {
            const dir = ctxMenu.entry.isDirectory ? ctxMenu.entry.path : parentDir(ctxMenu.entry.path)
            const name = prompt('Folder name:')
            if (name?.trim()) createDir(dir, name.trim())
          }}
          onRename={() => {
            setRenaming(ctxMenu.entry.path)
            setRenameValue(ctxMenu.entry.name)
          }}
          onDelete={() => handleDelete(ctxMenu.entry.path)}
          onCopyPath={() => handleCopyPath(ctxMenu.entry.path)}
        />
      )}
    </div>
  )
}

function TreeEntry({
  entry,
  depth,
  activeFilePath,
  renaming,
  renameValue,
  onToggle,
  onFileClick,
  onContextMenu,
  onRenameStart,
  onRenameChange,
  onRenameSubmit,
}: {
  entry: FileEntry
  depth: number
  activeFilePath: string | null
  renaming: string | null
  renameValue: string
  onToggle: (entry: FileEntry) => void
  onFileClick: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
  onRenameStart: (path: string, name: string) => void
  onRenameChange: (v: string) => void
  onRenameSubmit: (path: string) => void
}) {
  const hasChildren = entry.isDirectory
  const isExpanded = entry.children !== null && entry.children !== undefined
  const childrenLoaded = entry.children !== null
  const isActive = entry.path === activeFilePath
  const isRenaming = renaming === entry.path
  const ext = getExt(entry.name)

  return (
    <>
      <button
        onClick={() => isRenaming ? undefined : onFileClick(entry)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        onDoubleClick={() => {
          if (!entry.isDirectory) return
          if (!isRenaming) onRenameStart(entry.path, entry.name)
        }}
        className={`w-full flex items-center gap-1 py-0.5 rounded text-xs transition-colors ${
          hasChildren
            ? 'sticky shadow-[0_1px_3px_-1px_rgba(0,0,0,0.15)] dark:shadow-[0_1px_3px_-1px_rgba(0,0,0,0.4)]'
            : ''
        } ${
          isActive
            ? 'bg-secondary text-foreground'
            : isRenaming
              ? 'bg-secondary text-foreground'
              : `text-muted-foreground hover:bg-card ${hasChildren ? 'bg-background' : ''}`
        }`}
        style={{
          paddingLeft: `${depth * 10 + 6}px`,
          ...(hasChildren ? { top: `${depth * 20}px`, zIndex: 10 - depth } : {}),
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            childrenLoaded ? (
              <ChevronDown size={11} className="shrink-0" />
            ) : (
              <Loader size={11} className="shrink-0 animate-spin" />
            )
          ) : (
            <ChevronRight size={11} className="shrink-0" />
          )
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        {getFileIcon(entry.name, entry.isDirectory)}
        {isRenaming ? (
          <input
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(entry.path)
              if (e.key === 'Escape') onRenameSubmit(entry.path)
            }}
            onBlur={() => onRenameSubmit(entry.path)}
            className="flex-1 min-w-0 bg-card border border-border rounded px-1 text-xs text-foreground outline-none"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{entry.name}{ext ? '' : ''}</span>
        )}
      </button>

      {hasChildren && isExpanded && entry.children && entry.children.length > 0 && (
        entry.children.map((child) => (
          <TreeEntry
            key={child.path}
            entry={child}
            depth={depth + 1}
            activeFilePath={activeFilePath}
            renaming={renaming}
            renameValue={renameValue}
            onToggle={onToggle}
            onFileClick={onFileClick}
            onContextMenu={onContextMenu}
            onRenameStart={onRenameStart}
            onRenameChange={onRenameChange}
            onRenameSubmit={onRenameSubmit}
          />
        ))
      )}
    </>
  )
}
