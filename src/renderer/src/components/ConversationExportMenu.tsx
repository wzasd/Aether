import { useState, useRef, useEffect } from 'react'
import { Download, FileText, FileJson, ChevronDown, Check, Trash2 } from 'lucide-react'

interface ExportMenuProps {
  conversationId: string
  title: string
  onClose: () => void
  onDelete?: (id: string) => void
  position: { x: number; y: number }
}

interface ExportOptions {
  includeThinking: boolean
  includeToolCalls: boolean
  includeSystemMessages: boolean
  includeUsage: boolean
}

export function ConversationExportMenu({ conversationId, title, onClose, onDelete, position }: ExportMenuProps) {
  const [showOptions, setShowOptions] = useState(false)
  const [options, setOptions] = useState<ExportOptions>({
    includeThinking: false,
    includeToolCalls: true,
    includeSystemMessages: false,
    includeUsage: true,
  })
  const [exporting, setExporting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleExport = async (format: 'markdown' | 'json') => {
    setExporting(true)
    try {
      await window.api.conversation.export(conversationId, format, options)
    } finally {
      setExporting(false)
      onClose()
    }
  }

  const toggleOption = (key: keyof ExportOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Adjust position so menu doesn't overflow viewport
  const adjustedX = Math.min(position.x, window.innerWidth - 220)
  const adjustedY = Math.min(position.y, window.innerHeight - 300)

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] w-[200px] bg-card border border-border rounded-lg shadow-lg py-1 text-sm"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="px-3 py-1.5 text-xs text-muted-foreground truncate" title={title}>
        {title || 'Untitled'}
      </div>
      <div className="border-t border-border" />

      <button
        onClick={() => handleExport('markdown')}
        disabled={exporting}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left disabled:opacity-50"
      >
        <FileText size={14} className="text-blue-400 shrink-0" />
        <span>Export Markdown</span>
      </button>

      <button
        onClick={() => handleExport('json')}
        disabled={exporting}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent transition-colors text-left disabled:opacity-50"
      >
        <FileJson size={14} className="text-yellow-400 shrink-0" />
        <span>Export JSON</span>
      </button>

      <div className="border-t border-border" />

      <button
        onClick={() => setShowOptions((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent transition-colors text-left text-xs text-muted-foreground"
      >
        <span>Options</span>
        <ChevronDown size={12} className={`transition-transform ${showOptions ? 'rotate-180' : ''}`} />
      </button>

      {showOptions && (
        <div className="border-t border-border px-2 py-1 space-y-0.5">
          {([
            ['includeThinking', 'Thinking blocks'],
            ['includeToolCalls', 'Tool calls'],
            ['includeSystemMessages', 'System messages'],
            ['includeUsage', 'Usage stats'],
          ] as [keyof ExportOptions, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggleOption(key)}
              className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-accent transition-colors text-xs"
            >
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                options[key] ? 'bg-blue-500 border-blue-500 text-white' : 'border-border'
              }`}>
                {options[key] && <Check size={10} />}
              </span>
              <span className={options[key] ? 'text-foreground' : 'text-muted-foreground'}>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}

      {exporting && (
        <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
          <Download size={12} className="animate-pulse" />
          Exporting...
        </div>
      )}

      {onDelete && (
        <>
          <div className="border-t border-border" />
          <button
            onClick={() => {
              onClose()
              onDelete(conversationId)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-500/10 transition-colors text-left text-red-400"
          >
            <Trash2 size={14} className="shrink-0" />
            <span>删除</span>
          </button>
        </>
      )}
    </div>
  )
}
