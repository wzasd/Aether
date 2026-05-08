import { create } from 'zustand'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[] | null
}

interface OpenFile {
  content: string
  language: string
  size: number
  loading: boolean
  error?: string
  tooLarge?: boolean
  binary?: boolean
}

interface FileState {
  workspaceId: string | null
  projectPath: string | null
  fileTree: FileEntry[]
  openFiles: Record<string, OpenFile>
  activeFilePath: string | null
  treeLoading: boolean
  _openInCodePanelSeq: number
  _openInCodePanelPath: string | null

  setProjectPath: (projectPath: string | null, workspaceId?: string | null) => void
  loadTree: () => Promise<void>
  openFile: (filePath: string) => Promise<void>
  closeFile: (filePath: string) => void
  setActiveFile: (filePath: string) => void
  loadChildDir: (dirPath: string) => Promise<void>
  collapseDir: (dirPath: string) => void
  requestOpenInCodePanel: (filePath: string) => void

  // Phase D: CRUD
  createFile: (parentDir: string, name: string) => Promise<void>
  createDir: (parentDir: string, name: string) => Promise<void>
  renameEntry: (oldPath: string, newName: string) => Promise<void>
  deleteEntry: (filePath: string) => Promise<void>
  refreshDir: (dirPath: string) => Promise<void>
}

export type { FileEntry, OpenFile }

function joinRelPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function parentDir(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i > 0 ? relPath.slice(0, i) : ''
}

export const useFileStore = create<FileState>((set, get) => ({
  workspaceId: null,
  projectPath: null,
  fileTree: [],
  openFiles: {},
  activeFilePath: null,
  treeLoading: false,
  _openInCodePanelSeq: 0,
  _openInCodePanelPath: null,

  setProjectPath: (projectPath, workspaceId = null) => {
    const state = get()
    if (state.projectPath === projectPath && state.workspaceId === workspaceId) return
    set({
      workspaceId,
      projectPath,
      fileTree: [],
      openFiles: {},
      activeFilePath: null,
      treeLoading: false,
    })
  },

  loadTree: async () => {
    const { projectPath, workspaceId } = get()
    if (!projectPath || !workspaceId) return
    set({ treeLoading: true })
    try {
      const tree = await window.api.file.list(workspaceId)
      set((state) => {
        if (state.projectPath !== projectPath || state.workspaceId !== workspaceId) return {}
        return { fileTree: tree, treeLoading: false }
      })
    } catch {
      set((state) => {
        if (state.projectPath !== projectPath || state.workspaceId !== workspaceId) return {}
        return { treeLoading: false }
      })
    }
  },

  openFile: async (filePath) => {
    const { projectPath, workspaceId, openFiles } = get()
    if (!projectPath || !workspaceId) return

    set({
      openFiles: {
        ...openFiles,
        [filePath]: { content: '', language: 'text', size: 0, loading: true },
      },
      activeFilePath: filePath,
    })

    try {
      const result = await window.api.file.read(workspaceId, filePath)
      set((state) => {
        if (state.projectPath !== projectPath || state.workspaceId !== workspaceId) return {}
        return {
          openFiles: {
            ...state.openFiles,
            [filePath]: { ...result, loading: false },
          },
        }
      })
    } catch (e: any) {
      set((state) => {
        if (state.projectPath !== projectPath || state.workspaceId !== workspaceId) return {}
        return {
          openFiles: {
            ...state.openFiles,
            [filePath]: {
              content: '',
              language: 'text',
              size: 0,
              loading: false,
              error: e?.message ?? 'Failed to read file',
            },
          },
        }
      })
    }
  },

  closeFile: (filePath) => {
    set((state) => {
      const next = { ...state.openFiles }
      delete next[filePath]
      const paths = Object.keys(next)
      return {
        openFiles: next,
        activeFilePath: state.activeFilePath === filePath
          ? (paths.length > 0 ? paths[paths.length - 1] : null)
          : state.activeFilePath,
      }
    })
  },

  setActiveFile: (filePath) => set({ activeFilePath: filePath }),

  loadChildDir: async (dirPath) => {
    const { projectPath, workspaceId } = get()
    if (!projectPath || !workspaceId) return
    try {
      const children = await window.api.file.list(workspaceId, dirPath)
      set((state) => {
        if (state.projectPath !== projectPath || state.workspaceId !== workspaceId) return {}
        const updateTree = (entries: FileEntry[]): FileEntry[] =>
          entries.map((entry) => {
            if (entry.path === dirPath && entry.isDirectory) {
              return { ...entry, children }
            }
            if (entry.children) {
              return { ...entry, children: updateTree(entry.children) }
            }
            return entry
          })
        return { fileTree: updateTree(state.fileTree) }
      })
    } catch {
      // ignore
    }
  },

  collapseDir: (dirPath) => {
    set((state) => {
      const updateTree = (entries: FileEntry[]): FileEntry[] =>
        entries.map((entry) => {
          if (entry.path === dirPath && entry.isDirectory) {
            return { ...entry, children: null }
          }
          if (entry.children) {
            return { ...entry, children: updateTree(entry.children) }
          }
          return entry
        })
      return { fileTree: updateTree(state.fileTree) }
    })
  },

  requestOpenInCodePanel: (filePath) => set((state) => ({
    _openInCodePanelPath: filePath,
    _openInCodePanelSeq: state._openInCodePanelSeq + 1,
  })),

  // ── Phase D: CRUD ────────────────────────────────────

  createFile: async (parentDir, name) => {
    const { projectPath, workspaceId } = get()
    if (!projectPath || !workspaceId) return
    const filePath = joinRelPath(parentDir, name)
    await window.api.file.createFile(workspaceId, filePath)
    // Refresh parent to show new file
    await get().refreshDir(parentDir)
  },

  createDir: async (parentDir, name) => {
    const { projectPath, workspaceId } = get()
    if (!projectPath || !workspaceId) return
    const dirPath = joinRelPath(parentDir, name)
    await window.api.file.createDir(workspaceId, dirPath)
    await get().refreshDir(parentDir)
  },

  renameEntry: async (oldPath, newName) => {
    const { projectPath, workspaceId } = get()
    if (!projectPath || !workspaceId) return
    const newPath = joinRelPath(parentDir(oldPath), newName)
    await window.api.file.rename(workspaceId, oldPath, newPath)
    // Refresh the parent dir and update openFiles if needed
    await get().refreshDir(parentDir(oldPath))
    // If the renamed file was open, update the key
    const { openFiles, activeFilePath } = get()
    if (openFiles[oldPath]) {
      const next: Record<string, OpenFile> = {}
      for (const [k, v] of Object.entries(openFiles)) {
        next[k === oldPath ? newPath : k] = v
      }
      set({
        openFiles: next,
        activeFilePath: activeFilePath === oldPath ? newPath : activeFilePath,
      })
    }
  },

  deleteEntry: async (filePath) => {
    const { projectPath, workspaceId } = get()
    if (!projectPath || !workspaceId) return
    await window.api.file.delete(workspaceId, filePath)
    // Close file if open
    get().closeFile(filePath)
    // Refresh parent
    await get().refreshDir(parentDir(filePath))
  },

  refreshDir: async (dirPath) => {
    const { projectPath, workspaceId, fileTree } = get()
    if (!projectPath || !workspaceId) return
    try {
      const children = await window.api.file.list(workspaceId, dirPath)
      set((state) => {
        if (state.projectPath !== projectPath || state.workspaceId !== workspaceId) return {}
        const updateTree = (entries: FileEntry[]): FileEntry[] =>
          entries.map((entry) => {
            if (entry.path === dirPath && entry.isDirectory) {
              return { ...entry, children }
            }
            if (entry.children) {
              return { ...entry, children: updateTree(entry.children) }
            }
            return entry
          })
        return { fileTree: updateTree(state.fileTree) }
      })
    } catch {
      // ignore
    }
  },
}))
