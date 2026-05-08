import { useState } from 'react'
import { Copy, RotateCcw } from 'lucide-react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCall } from './ToolCall'
import { MarkdownContent } from './MarkdownContent'
import { PlanBlock } from './PlanBlock'

const AGENT_PALETTE: Record<string, { border: string; name: string }> = {
  Architect: { border: 'border-blue-500/50',    name: 'text-blue-400'    },
  Coder:     { border: 'border-amber-500/50',   name: 'text-amber-400'   },
  Reviewer:  { border: 'border-emerald-500/50', name: 'text-emerald-400' },
  Planner:   { border: 'border-violet-500/50',  name: 'text-violet-400'  },
}

function agentColors(sender?: string | null) {
  return AGENT_PALETTE[sender ?? ''] ?? { border: 'border-border/50', name: 'text-muted-foreground' }
}

interface MessageItemProps {
  role: 'user' | 'assistant' | 'system' | 'plan'
  content: string | null
  thinking?: string | null
  toolCalls?: Array<{
    id: string
    toolName: string
    toolInput: string
    status: 'running' | 'completed' | 'error'
    result?: string
  }>
  isStreaming?: boolean
  agentProfileId?: string | null
  agentName?: string | null
  agentRole?: string | null
  timestamp?: string | null
}

export function MessageItem({
  role,
  content,
  thinking,
  toolCalls,
  isStreaming,
  agentName,
  timestamp,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  if (role === 'system') {
    return (
      <div className="flex justify-center my-3">
        <div className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          {content}
        </div>
      </div>
    )
  }

  if (role === 'plan') {
    return <PlanBlock content={content ?? ''} />
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] flex flex-col items-end gap-1">
          {timestamp && (
            <div className="text-xs text-muted-foreground">{timestamp}</div>
          )}
          <div className="bg-blue-600 text-white px-3 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        </div>
      </div>
    )
  }

  const colors = agentColors(agentName)

  return (
    <div className={`group flex flex-col gap-1.5 max-w-[92%] pl-2.5 border-l-2 ${colors.border}`}>
      <div className={`text-[11px] tracking-wide ${colors.name}`}>
        {agentName ?? 'Assistant'}
        {timestamp && (
          <>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">{timestamp}</span>
          </>
        )}
      </div>

      {thinking && <ThinkingBlock thinking={thinking} />}

      {toolCalls && toolCalls.length > 0 && (
        <div className="space-y-1">
          {toolCalls.map((tc) => (
            <ToolCall
              key={tc.id}
              toolName={tc.toolName}
              toolInput={tc.toolInput}
              status={tc.status}
              result={tc.result}
            />
          ))}
        </div>
      )}

      {content && (
        <div className="bg-card border border-border text-foreground px-3 py-2.5 rounded-lg leading-relaxed">
          <MarkdownContent content={content} />
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-muted-foreground ml-0.5 animate-pulse align-text-bottom rounded-sm" />
          )}
        </div>
      )}

      {(content || (toolCalls && toolCalls.length > 0)) && (
        <div className="flex items-center gap-0.5 h-5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
          <button
            onClick={handleCopy}
            title="Copy"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Copy size={11} />
            <span className="text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            title="Retry"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RotateCcw size={11} />
            <span className="text-[11px]">Retry</span>
          </button>
        </div>
      )}

      {isStreaming && !content && !thinking && (!toolCalls || toolCalls.length === 0) && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm px-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>思考中...</span>
        </div>
      )}
    </div>
  )
}
