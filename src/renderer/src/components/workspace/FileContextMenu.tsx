import { useEffect, useRef } from 'react'
import { FilePlus, FolderPlus, Pencil, Trash2, Copy, FileText } from 'lucide-react'

interface FileContextMenuProps {
  x: number
  y: number
  isDirectory: boolean
  filePath: string
  fileName: string
  onClose: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
  onCopyPath: () => void
}

export function FileContextMenu({
  x, y, isDirectory, filePath, fileName, onClose,
  onNewFile, onNewFolder, onRename, onDelete, onCopyPath,
}: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 180)
  const adjustedY = Math.min(y, window.innerHeight - 200)

  return (
    <div
      ref={ref}
      className="fixed z-50 w-44 bg-card border border-border rounded-md shadow-xl py-1 text-xs"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {isDirectory && (
        <>
          <MenuItem icon={<FilePlus size={12} />} label="New File" onClick={() => { onNewFile(); onClose() }} />
          <MenuItem icon={<FolderPlus size={12} />} label="New Folder" onClick={() => { onNewFolder(); onClose() }} />
          <div className="border-t border-border my-1" />
        </>
      )}
      <MenuItem icon={<Pencil size={12} />} label="Rename" onClick={() => { onRename(); onClose() }} />
      <MenuItem icon={<Copy size={12} />} label="Copy Path" onClick={() => { onCopyPath(); onClose() }} />
      <div className="border-t border-border my-1" />
      <MenuItem icon={<Trash2 size={12} />} label="Delete" danger onClick={() => { onDelete(); onClose() }} />
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-accent'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
