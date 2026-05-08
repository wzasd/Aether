import { useState } from 'react'
import { getToolMeta, formatToolInput } from '../../utils/toolMeta'

interface ToolCallProps {
  toolName: string
  toolInput: string
  status: 'running' | 'completed' | 'error'
  result?: string
}

const MAX_RESULT_LINES = 12

export function ToolCall({ toolName, toolInput, status, result }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false)
  const [resultExpanded, setResultExpanded] = useState(false)
  const meta = getToolMeta(toolName)
  const formattedInput = formatToolInput(toolName, toolInput)

  const statusIcon =
    status === 'running' ? (
      <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
    ) : status === 'completed' ? (
      <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    )

  const statusText = status === 'running' ? '运行中' : status === 'completed' ? '成功' : '失败'

  const resultLines = result ? result.split('\n') : []
  const resultPreview = resultLines.slice(0, MAX_RESULT_LINES).join('\n')
  const hasMoreLines = resultLines.length > MAX_RESULT_LINES

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 transition-colors"
      >
        <span style={{ color: meta.color }} className="shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
          </svg>
        </span>
        <span className="text-foreground font-medium shrink-0">{meta.label}</span>
        <span className="text-muted-foreground truncate min-w-0">{formattedInput}</span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {statusIcon}
          <span className="text-muted-foreground">{statusText}</span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <div className="text-muted-foreground mb-1">输入</div>
            <pre className="text-foreground bg-muted rounded p-2 overflow-x-auto text-[11px] max-h-40">
              {toolInput}
            </pre>
          </div>
          {result && (
            <div>
              <div className="text-muted-foreground mb-1">结果</div>
              <pre className="text-foreground bg-muted rounded p-2 overflow-x-auto text-[11px] max-h-40">
                {resultExpanded ? result : resultPreview}
              </pre>
              {hasMoreLines && !resultExpanded && (
                <button
                  onClick={() => setResultExpanded(true)}
                  className="text-muted-foreground hover:text-foreground mt-1"
                >
                  显示全部 {resultLines.length} 行
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}