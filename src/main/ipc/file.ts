import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { extname, isAbsolute, normalize, relative, resolve } from 'path'
import { getDb } from '../core/db'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[] | null
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.bytro', 'out', '.next', '__pycache__', '.venv'])
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const WARN_FILE_SIZE = 500 * 1024 // 500KB

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'html',
  '.md': 'markdown', '.mdx': 'markdown',
  '.py': 'python',
  '.sql': 'sql',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.graphql': 'graphql', '.gql': 'graphql',
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return LANG_MAP[ext] || 'text'
}

async function getProjectRoot(workspaceId: string): Promise<string> {
  if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
    throw new Error('Invalid workspace id')
  }

  const db = getDb()
  const row = db.prepare('SELECT repo_path FROM workspaces WHERE id = ?').get(workspaceId) as { repo_path: string | null } | undefined
  if (!row) {
    throw new Error('Workspace not found')
  }
  return validateProjectPath(row.repo_path)
}

async function safePath(projectRoot: string, targetPath: string): Promise<string> {
  if (typeof targetPath !== 'string') {
    throw new Error('Invalid path')
  }
  if (isAbsolute(targetPath)) {
    throw new Error('Path traversal detected')
  }

  const resolvedProject = await fs.realpath(projectRoot)
  const target = targetPath === '' || targetPath === '.'
    ? resolvedProject
    : resolve(resolvedProject, normalize(targetPath))
  const realTarget = await fs.realpath(target)
  const rel = relative(resolvedProject, realTarget)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error('Path traversal detected')
  }
  return realTarget
}

async function safeParentPath(projectRoot: string, targetPath: string): Promise<{ absPath: string; parentDir: string }> {
  if (typeof targetPath !== 'string') {
    throw new Error('Invalid path')
  }
  if (isAbsolute(targetPath)) {
    throw new Error('Path traversal detected')
  }

  const resolvedProject = await fs.realpath(projectRoot)
  const absPath = resolve(resolvedProject, normalize(targetPath))
  const rel = relative(resolvedProject, absPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal detected')
  }

  // Validate parent directory exists
  const parentDir = resolve(absPath, '..')
  try {
    await fs.realpath(parentDir)
  } catch {
    throw new Error('Parent directory does not exist')
  }

  return { absPath, parentDir }
}

async function validateProjectPath(raw: unknown): Promise<string> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Invalid project path')
  }
  try {
    const abs = await fs.realpath(resolve(raw.trim()))
    const s = await fs.stat(abs)
    if (!s.isDirectory()) throw new Error('Project path is not a directory')
    return abs
  } catch (e: any) {
    if (e.code === 'ENOENT') throw new Error('Project path does not exist')
    throw e
  }
}

async function scanDir(dirPath: string, relativePath: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  const dirents = (await fs.readdir(dirPath, { withFileTypes: true })).sort((a, b) => {
    const aDir = a.isDirectory()
    const bDir = b.isDirectory()
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  for (const dirent of dirents) {
    const name = dirent.name
    if (name.startsWith('.') && name !== '.env' && name !== '.env.local' && name !== '.gitignore') continue
    const relPath = relativePath ? `${relativePath}/${name}` : name
    try {
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        if (IGNORED_DIRS.has(name)) continue
        entries.push({
          name,
          path: relPath,
          isDirectory: true,
          children: null,
        })
      } else {
        entries.push({
          name,
          path: relPath,
          isDirectory: false,
        })
      }
    } catch {
      // skip inaccessible files
    }
  }
  return entries
}

export function registerFileIpc(): void {
  ipcMain.handle('file:list', async (_event, workspaceId: string, dir?: string) => {
    const root = await getProjectRoot(workspaceId)
    const targetDir = dir ? await safePath(root, dir) : root
    return scanDir(targetDir, dir || '')
  })

  ipcMain.handle('file:write', async (_event, workspaceId: string, filePath: string, content: string) => {
    if (typeof content !== 'string') {
      throw new Error('Invalid content: must be a string')
    }
    const root = await getProjectRoot(workspaceId)
    const absPath = await safePath(root, filePath)
    const st = await fs.stat(absPath)
    if (st.isDirectory()) {
      throw new Error('Cannot write to a directory')
    }
    await fs.writeFile(absPath, content, 'utf-8')
    return { success: true, path: filePath, size: Buffer.byteLength(content, 'utf-8') }
  })

  ipcMain.handle('file:read', async (_event, workspaceId: string, filePath: string) => {
    const root = await getProjectRoot(workspaceId)
    const absPath = await safePath(root, filePath)
    const st = await fs.stat(absPath)

    if (st.isDirectory()) {
      throw new Error('Cannot read a directory as a file')
    }

    if (st.size > MAX_FILE_SIZE) {
      return {
        content: `File too large (${(st.size / 1024 / 1024).toFixed(1)} MB). Max: 2 MB.`,
        language: 'text',
        size: st.size,
        tooLarge: true,
      }
    }

    const buffer = await fs.readFile(absPath)
    // Binary check
    if (buffer.slice(0, 512).some((b) => b === 0)) {
      return {
        content: `Binary file (${(st.size / 1024).toFixed(1)} KB)`,
        language: 'text',
        size: st.size,
        binary: true,
      }
    }

    return {
      content: buffer.toString('utf-8'),
      language: detectLanguage(filePath),
      size: st.size,
      warnLarge: st.size > WARN_FILE_SIZE,
    }
  })

  // Phase D: CRUD operations
  ipcMain.handle('file:createFile', async (_event, workspaceId: string, filePath: string) => {
    const root = await getProjectRoot(workspaceId)
    const { absPath } = await safeParentPath(root, filePath)
    try {
      await fs.stat(absPath)
      throw new Error('File already exists')
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e
    }
    await fs.writeFile(absPath, '', 'utf-8')
    return { success: true, path: filePath }
  })

  ipcMain.handle('file:createDir', async (_event, workspaceId: string, dirPath: string) => {
    const root = await getProjectRoot(workspaceId)
    const { absPath } = await safeParentPath(root, dirPath)
    await fs.mkdir(absPath, { recursive: true })
    return { success: true, path: dirPath }
  })

  ipcMain.handle('file:rename', async (_event, workspaceId: string, oldPath: string, newPath: string) => {
    const root = await getProjectRoot(workspaceId)
    const absOld = await safePath(root, oldPath)
    const absNew = await safePath(root, newPath)
    await fs.rename(absOld, absNew)
    return { success: true, oldPath, newPath }
  })

  ipcMain.handle('file:delete', async (_event, workspaceId: string, filePath: string) => {
    const root = await getProjectRoot(workspaceId)
    const absPath = await safePath(root, filePath)
    const st = await fs.stat(absPath)
    if (st.isDirectory()) {
      await fs.rm(absPath, { recursive: true, force: true })
    } else {
      await fs.unlink(absPath)
    }
    return { success: true, path: filePath }
  })
}
