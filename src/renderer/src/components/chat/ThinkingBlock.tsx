import { useState } from 'react'

interface ThinkingBlockProps {
  thinking: string
}

export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)

  const preview = thinking.replace(/\n+/g, ' ').substring(0, 100)

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
      >
        <svg
          className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="font-medium shrink-0">思考过程</span>
        {!expanded && preview && (
          <span className="text-muted-foreground/60 truncate ml-1 min-w-0">{preview}...</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap italic">
          {thinking}
        </div>
      )}
    </div>
  )
}
