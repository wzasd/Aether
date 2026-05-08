import { useCallback, useEffect, useRef, useState } from 'react'
import { X, FileCode, FileText } from 'lucide-react'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useFileStore, type OpenFile } from '../../stores/fileStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUIStore } from '../../stores/uiStore'

loader.config({ monaco })

const LANG_MAP: Record<string, string> = {
  typescript: 'typescript', javascript: 'javascript',
  json: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'html', markdown: 'markdown',
  python: 'python', sql: 'sql',
  yaml: 'yaml', xml: 'xml',
  bash: 'shell', sh: 'shell', zsh: 'shell',
  graphql: 'graphql', gql: 'graphql',
}

function monacoLang(lang: string): string {
  return LANG_MAP[lang] || 'plaintext'
}

export function CodePanel() {
  const openFiles = useFileStore((s) => s.openFiles)
  const activeFilePath = useFileStore((s) => s.activeFilePath)
  const setActiveFile = useFileStore((s) => s.setActiveFile)
  const closeFile = useFileStore((s) => s.closeFile)

  const filePaths = Object.keys(openFiles)
  const activeFile: OpenFile | undefined = activeFilePath ? openFiles[activeFilePath] : undefined

  return (
    <div className="h-full bg-background flex flex-col min-h-0">
      {/* File tabs */}
      {filePaths.length > 0 && (
        <div className="border-b border-border flex items-center min-h-[36px] bg-background shrink-0">
          <div className="titlebar-no-drag tab-scrollbar flex items-center flex-1 overflow-x-auto min-w-0">
            {filePaths.map((path) => {
              const name = path.split('/').pop() || path
              const isDoc = name.endsWith('.md')
              return (
                <button
                  key={path}
                  onClick={() => setActiveFile(path)}
                  className={`group shrink-0 px-3 py-2 border-r border-border flex items-center gap-1.5 text-xs whitespace-nowrap transition-colors ${
                    activeFilePath === path
                      ? 'bg-card text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                  }`}
                >
                  {isDoc ? <FileText size={12} /> : <FileCode size={12} />}
                  <span className="max-w-[150px] truncate">{name}</span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); closeFile(path) }}
                    className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground rounded p-0.5 hover:bg-accent"
                  >
                    <X size={10} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {!activeFile && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <FileCode size={32} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-xs text-muted-foreground">Open a file from the Explorer</p>
            </div>
          </div>
        )}

        {activeFile && activeFile.loading && (
          <div className="p-4 text-xs text-muted-foreground font-mono">Loading...</div>
        )}

        {activeFile && activeFile.error && (
          <div className="p-4 text-xs text-red-400 font-mono">Error: {activeFile.error}</div>
        )}

        {activeFile && !activeFile.loading && !activeFile.error && (
          <CodeEditor file={activeFile} filePath={activeFilePath || ''} />
        )}
      </div>
    </div>
  )
}

/* ─── Monaco Editor ──────────────────────────────────── */
function CodeEditor({ file, filePath }: { file: OpenFile; filePath: string }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [dirty, setDirty] = useState(false)
  const originalContentRef = useRef(file.content)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const resolved = useUIStore((s) => s.resolved)

  // Sync Monaco theme
  useEffect(() => {
    if (editorRef.current) {
      monaco.editor.setTheme(resolved === 'dark' ? 'vs-dark' : 'vs')
    }
  }, [resolved])

  // Reset dirty state when switching files
  useEffect(() => {
    originalContentRef.current = file.content
    setDirty(false)
  }, [filePath, file.content])

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor
    editor.focus()

    // Cmd+S / Ctrl+S to save
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => saveFile(),
    })
  }, [])

  const saveFile = useCallback(async () => {
    if (!workspaceId || !editorRef.current) return
    const content = editorRef.current.getValue()

    try {
      await window.api.file.write(workspaceId, filePath, content)
      originalContentRef.current = content
      setDirty(false)
    } catch {
      // best-effort
    }
  }, [workspaceId, filePath])

  // Large file / binary → read-only fallback
  if (file.tooLarge || file.binary) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-yellow-400 mb-2">
            {file.binary ? 'Binary file' : 'Large file'}
          </p>
          <p className="text-xs text-muted-foreground">
            {file.binary
              ? `Cannot display binary content (${(file.size / 1024).toFixed(1)} KB)`
              : `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Opening in read-only mode.`}
          </p>
        </div>
      </div>
    )
  }

  const isReadOnly = (file.size ?? 0) > 500 * 1024 // >500KB → read-only

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border text-[10px] text-muted-foreground shrink-0">
        <span>{filePath}{dirty && <span className="text-amber-400 ml-1">●</span>}</span>
        <span>{file.language}</span>
      </div>

      {/* Editor */}
      <div className="flex-1">
        <Editor
          defaultLanguage={monacoLang(file.language)}
          defaultValue={file.content}
          theme={resolved === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            readOnly: isReadOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            tabSize: 2,
            automaticLayout: true,
            padding: { top: 8 },
            renderLineHighlight: 'line',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
          }}
          onChange={(value) => {
            if (value !== undefined) {
              setDirty(value !== originalContentRef.current)
            }
          }}
          onMount={handleMount}
          loading={<div className="p-4 text-xs text-muted-foreground font-mono">Loading editor...</div>}
        />
      </div>
    </div>
  )
}
