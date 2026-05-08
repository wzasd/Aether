import { useSessionConfigStore } from '../stores/sessionConfigStore'
import { FolderOpen } from 'lucide-react'

export function WorkingDirSelector() {
  const workingDir = useSessionConfigStore((s) => s.workingDir)
  const selectWorkingDir = useSessionConfigStore((s) => s.selectWorkingDir)

  const displayPath = workingDir
    ? workingDir.length > 30
      ? '...' + workingDir.slice(-27)
      : workingDir
    : 'Select directory'

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="truncate max-w-[160px]">{displayPath}</span>
      <button
        onClick={selectWorkingDir}
        className="p-1 rounded hover:bg-accent transition-colors"
      >
        <FolderOpen size={12} />
      </button>
    </div>
  )
}
