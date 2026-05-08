import { useEffect } from 'react'
import { FileCode, GitBranch } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useChangeStore, type FileChange } from '../../stores/changeStore'
import { useFileStore } from '../../stores/fileStore'

const STATUS_COLORS: Record<string, string> = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
}

const STATUS_BG: Record<string, string> = {
  modified: 'bg-yellow-400/10',
  added: 'bg-green-400/10',
  deleted: 'bg-red-400/10',
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export function DiffPanel() {
  const currentConversation = useChatStore((s) => s.currentConversation)
  const changes = useChangeStore((s) =>
    currentConversation ? (s.changes[currentConversation.id] ?? []) : []
  )
  const loadChangesForConversation = useChangeStore((s) => s.loadChangesForConversation)

  useEffect(() => {
    if (currentConversation) {
      loadChangesForConversation(currentConversation.id)
    }
  }, [currentConversation?.id])

  return (
    <div className="h-full p-4 bg-card overflow-auto">
      <div className="space-y-3">
        {changes.map((change) => (
          <FileChangeCard key={change.id} change={change} />
        ))}

        {changes.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-6 text-center">
            <GitBranch size={20} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-[12px] text-muted-foreground">Changes from active tasks will appear here</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Agent file operations (Write/Edit/Delete) are captured automatically
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function FileChangeCard({ change }: { change: FileChange }) {
  const statusColor = STATUS_COLORS[change.status] || 'text-muted-foreground'
  const statusBg = STATUS_BG[change.status] || 'bg-zinc-400/10'
  const requestOpenInCodePanel = useFileStore((s) => s.requestOpenInCodePanel)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* File header */}
      <button
        onClick={() => requestOpenInCodePanel(change.path)}
        className="w-full px-3 py-2 bg-background border-b border-border flex items-center justify-between hover:bg-card transition-colors text-left"
        title="Open in Code Editor"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileCode size={13} className="text-muted-foreground shrink-0" />
          <span className="text-[12px] text-foreground font-mono truncate">
            {basename(change.path)}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBg} ${statusColor} shrink-0`}>
            {change.status}
          </span>
        </div>
        <div className="flex gap-2 text-[12px] shrink-0 ml-2">
          {change.additions > 0 && (
            <span className="text-green-400">+{change.additions}</span>
          )}
          {change.deletions > 0 && (
            <span className="text-red-400">-{change.deletions}</span>
          )}
        </div>
      </button>

      {/* File path detail */}
      <div className="px-3 py-2 bg-card/50 border-b border-border/50">
        <span className="text-[11px] text-muted-foreground font-mono">{change.path}</span>
      </div>

      {/* Diff content */}
      {change.diff_text && (
        <div className="px-3 py-2 bg-background overflow-x-auto max-h-48 overflow-y-auto">
          <pre className="text-[11px] font-mono leading-relaxed">
            {change.diff_text.split('\n').map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('+')
                    ? 'text-green-400 bg-green-400/5'
                    : line.startsWith('-')
                    ? 'text-red-400 bg-red-400/5'
                    : 'text-muted-foreground'
                }
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}
