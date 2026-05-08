import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { MessageItem } from './MessageItem'
import { ToolCall } from './ToolCall'
import { AgentBadge } from './AgentBadge'

interface DBMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'plan'
  content: string | null
  thinking: string | null
  tool_calls?: string
  agent_profile_id?: string | null
  created_at: number
}

type VirtualRow =
  | { type: 'message'; key: string; msg: DBMessage }
  | { type: 'task-stream'; key: string; ts: ReturnType<typeof useChatStore.getState>['taskStreams'][string] }
  | { type: 'streaming-tool'; key: string; tc: { id: string; toolName: string; toolInput: string; status: 'running' | 'completed' | 'error'; result?: string } }
  | { type: 'streaming-thinking'; key: string }
  | { type: 'streaming-text'; key: string }
  | { type: 'optimistic'; key: string }
  | { type: 'permission'; key: string; perm: ReturnType<typeof useChatStore.getState>['pendingPermissions'][number] }
  | { type: 'question'; key: string; question: ReturnType<typeof useChatStore.getState>['pendingQuestions'][number] }
  | { type: 'empty'; key: string }

function PendingQuestionCard({
  confirmId,
  questions,
}: {
  confirmId: string
  questions: Array<{ question: string; header?: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> }>
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

  const allAnswered = questions.every((item, index) => {
    const a = answers[index]
    if (Array.isArray(a)) return a.length > 0
    return a && a.length > 0
  })

  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs space-y-4">
      <div className="text-foreground font-medium">需要你的回答</div>
      {questions.map((item, index) => {
        const currentAnswer = answers[index]
        const isMultiSelect = item.multiSelect ?? false
        const selectedLabels: string[] = Array.isArray(currentAnswer) ? currentAnswer : currentAnswer ? [currentAnswer] : []

        return (
          <div key={`${confirmId}-${index}`} className="space-y-2">
            {item.header && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">{item.header}</div>
            )}
            <div className="text-foreground">{item.question}</div>
            {item.options && item.options.length > 0 ? (
              <div className="space-y-1">
                {item.options.map((option) => {
                  const isSelected = selectedLabels.includes(option.label)
                  return (
                    <button
                      key={option.label}
                      onClick={() => {
                        setAnswers((prev) => {
                          if (isMultiSelect) {
                            const current = (Array.isArray(prev[index]) ? prev[index] : []) as string[]
                            const next = isSelected
                              ? current.filter((l) => l !== option.label)
                              : [...current, option.label]
                            return { ...prev, [index]: next }
                          }
                          return { ...prev, [index]: isSelected ? '' : option.label }
                        })
                      }}
                      className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${
                        isSelected
                          ? 'border-primary/50 bg-primary/10 text-foreground'
                          : 'border-border bg-background hover:border-primary/30 text-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex-shrink-0 w-3.5 h-3.5 rounded-${isMultiSelect ? 'sm' : 'full'} border flex items-center justify-center ${
                            isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                          }`}
                        >
                          {isSelected && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 4L3 5.5L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">{option.label}</div>
                          {option.description && (
                            <div className="text-muted-foreground text-[10px] mt-0.5">{option.description}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <input
                value={Array.isArray(currentAnswer) ? currentAnswer.join(', ') : currentAnswer || ''}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [index]: event.target.value,
                  }))
                }
                placeholder={isMultiSelect ? '多个答案可用逗号分隔' : '输入你的回答'}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground placeholder:text-muted-foreground"
              />
            )}
          </div>
        )
      })}
      <button
        onClick={() => {
          const flatAnswers: Record<string, string> = {}
          for (const [key, val] of Object.entries(answers)) {
            flatAnswers[key] = Array.isArray(val) ? val.join(',') : val
          }
          useChatStore.getState().answerQuestion(confirmId, flatAnswers)
        }}
        disabled={!allAnswered}
        className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        提交回答
      </button>
    </div>
  )
}

function parsePlanContent(toolInput: string): string | null {
  try {
    const parsed = JSON.parse(toolInput)
    if (parsed && typeof parsed === 'object' && parsed.plan) {
      const plan = parsed.plan
      const parts: string[] = []
      if (plan.Context) parts.push(`## Context\n${plan.Context}`)
      if (plan.方案) parts.push(`## 方案\n${plan.方案}`)
      if (plan.文件) parts.push(`## 文件\n${plan.文件}`)
      if (plan.验证) parts.push(`## 验证\n${plan.验证}`)
      if (plan.备注) parts.push(`## 备注\n${plan.备注}`)
      if (parts.length > 0) return parts.join('\n\n')
      return typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2)
    }
    if (typeof parsed === 'string') return parsed
  } catch {}
  return null
}

const ESTIMATED_HEIGHTS: Record<VirtualRow['type'], number> = {
  message: 180,
  'task-stream': 200,
  'streaming-tool': 80,
  'streaming-thinking': 48,
  'streaming-text': 120,
  optimistic: 32,
  permission: 120,
  question: 300,
  empty: 64,
}

export function MessageList({ messages }: { messages: DBMessage[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const isNearBottomRef = useRef(true)

  const streamingText = useChatStore((s) => s.streamingText)
  const thinkingText = useChatStore((s) => s.thinkingText)
  const tools = useChatStore((s) => s.tools)
  const currentTurnToolIds = useChatStore((s) => s.currentTurnToolIds)
  const isOptimisticStreaming = useChatStore((s) => s.isOptimisticStreaming)
  const streamingRequestId = useChatStore((s) => s.streamingRequestId)
  const pendingPermissions = useChatStore((s) => s.pendingPermissions)
  const pendingQuestions = useChatStore((s) => s.pendingQuestions)
  const taskStreams = useChatStore((s) => s.taskStreams)
  const profiles = useAgentProfileStore((s) => s.profiles)

  const isStreaming = isOptimisticStreaming || streamingRequestId !== null

  // Streaming tool calls
  const streamingToolCalls = currentTurnToolIds
    .map((tid) => {
      const t = tools[tid]
      return t ? { id: tid, toolName: t.name, toolInput: t.input, status: t.status as 'running' | 'completed' | 'error', result: t.result } : null
    })
    .filter(Boolean)

  // Build flat rows array
  const rows = useMemo<VirtualRow[]>(() => {
    const r: VirtualRow[] = []

    // History messages
    for (const msg of messages) {
      r.push({ type: 'message', key: `msg-${msg.id}`, msg })
    }

    // Task stream bubbles
    for (const ts of Object.values(taskStreams)) {
      if (ts.isActive) {
        r.push({ type: 'task-stream', key: `ts-${ts.taskId}`, ts })
      }
    }

    // Current streaming elements
    for (const tc of streamingToolCalls) {
      r.push({ type: 'streaming-tool', key: `stc-${tc.id}`, tc })
    }
    if (thinkingText) {
      r.push({ type: 'streaming-thinking', key: 'thinking' })
    }
    if (streamingText) {
      r.push({ type: 'streaming-text', key: 'streaming' })
    }
    if (isOptimisticStreaming && !streamingText && !thinkingText && streamingToolCalls.length === 0) {
      r.push({ type: 'optimistic', key: 'optimistic' })
    }

    // Pending permissions and questions
    for (const perm of pendingPermissions) {
      r.push({ type: 'permission', key: `perm-${perm.confirmId}`, perm })
    }
    for (const q of pendingQuestions) {
      r.push({ type: 'question', key: `q-${q.confirmId}`, question: q })
    }

    if (r.length === 0) {
      r.push({ type: 'empty', key: 'empty' })
    }

    return r
  }, [messages, taskStreams, streamingToolCalls, thinkingText, streamingText, isOptimisticStreaming, pendingPermissions, pendingQuestions])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => ESTIMATED_HEIGHTS[rows[index]?.type ?? 'message'],
    overscan: 5,
    getItemKey: (index) => rows[index]?.key ?? `row-${index}`,
  })

  // Auto-scroll to bottom when new content arrives and user is near bottom
  useEffect(() => {
    if (isNearBottomRef.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    }
  }, [rows.length])

  // Re-measure streaming items periodically
  useEffect(() => {
    if (!isStreaming) return
    const interval = setInterval(() => {
      const scrollEl = parentRef.current
      if (!scrollEl) return
      // Find streaming-type elements and re-measure them
      const streamingSelectors = rows
        .map((row, i) => (row.type === 'streaming-text' || row.type === 'task-stream') ? i : -1)
        .filter((i) => i >= 0)
      for (const idx of streamingSelectors) {
        const el = scrollEl.querySelector(`[data-index="${idx}"]`)
        if (el instanceof HTMLElement) {
          virtualizer.measureElement(el)
        }
      }
    }, 100)
    return () => clearInterval(interval)
  }, [isStreaming, rows])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isNearBottomRef.current = atBottom
    setUserScrolledUp(!atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    setUserScrolledUp(false)
  }, [virtualizer, rows.length])

  // Parse tool_calls from DB message
  const parseToolCalls = (toolCallsStr?: string): Array<{ id: string; toolName: string; toolInput: string; status: 'running' | 'completed' | 'error'; result?: string }> | undefined => {
    if (!toolCallsStr) return undefined
    try {
      const parsed = JSON.parse(toolCallsStr)
      if (Array.isArray(parsed)) {
        return parsed.map((tc: any) => {
          const rawStatus: unknown = tc.status
          const status: 'running' | 'completed' | 'error' =
            rawStatus === 'error' ? 'error' : rawStatus === 'running' ? 'running' : 'completed'
          return {
            id: tc.id || tc.toolCallId || '',
            toolName: tc.toolName || tc.name || 'tool',
            toolInput: typeof tc.toolInput === 'string' ? tc.toolInput : JSON.stringify(tc.toolInput || {}),
            status,
            result: tc.result,
          }
        })
      }
    } catch { /* invalid JSON */ }
    return undefined
  }

  const renderRow = (row: VirtualRow) => {
    switch (row.type) {
      case 'empty':
        return (
          <div className="flex items-center justify-center text-muted-foreground text-sm py-8">
            发送消息开始对话
          </div>
        )

      case 'message': {
        const agentProfile = row.msg.agent_profile_id
          ? profiles.find((p) => p.id === row.msg.agent_profile_id)
          : null
        return (
          <MessageItem
            role={row.msg.role}
            content={row.msg.content}
            thinking={row.msg.thinking}
            toolCalls={parseToolCalls(row.msg.tool_calls)}
            agentProfileId={row.msg.agent_profile_id}
            agentName={agentProfile?.name}
            agentRole={agentProfile?.role}
          />
        )
      }

      case 'task-stream': {
        const agentProfile = row.ts.agentProfileId
          ? profiles.find((p) => p.id === row.ts.agentProfileId)
          : null
        return (
          <div className="space-y-2">
            {agentProfile && (
              <div className="flex items-center gap-2 px-1">
                <AgentBadge agentName={agentProfile.name} role={agentProfile.role} />
                <span className="text-xs text-muted-foreground">流式输出中...</span>
              </div>
            )}
            {row.ts.thinkingText && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground min-w-0">
                  <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                  <span className="font-medium shrink-0">思考中...</span>
                  <span className="text-muted-foreground/60 truncate min-w-0">
                    {row.ts.thinkingText.replace(/\n+/g, ' ').substring(0, 100)}...
                  </span>
                </div>
              </div>
            )}
            {row.ts.currentTurnToolIds.length > 0 && (
              <div className="space-y-1.5">
                {row.ts.currentTurnToolIds.map((tid) => {
                  const t = row.ts.tools[tid]
                  return t ? (
                    <ToolCall key={tid} toolName={t.name} toolInput={t.input} status={t.status} result={t.result} />
                  ) : null
                })}
              </div>
            )}
            {row.ts.streamingText && (
              <MessageItem role="assistant" content={row.ts.streamingText} isStreaming />
            )}
          </div>
        )
      }

      case 'streaming-tool':
        return (
          <div className="space-y-1.5">
            <ToolCall
              toolName={row.tc.toolName}
              toolInput={row.tc.toolInput}
              status={row.tc.status}
              result={row.tc.result}
            />
          </div>
        )

      case 'streaming-thinking':
        return (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground min-w-0">
              <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="font-medium shrink-0">思考中...</span>
              <span className="text-muted-foreground/60 truncate min-w-0">
                {thinkingText.replace(/\n+/g, ' ').substring(0, 100)}...
              </span>
            </div>
          </div>
        )

      case 'streaming-text':
        return <MessageItem role="assistant" content={streamingText} isStreaming />

      case 'optimistic':
        return (
          <div className="flex items-center gap-2 text-muted-foreground text-sm px-2">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>运行中...</span>
          </div>
        )

      case 'permission': {
        const isPlanMode = row.perm.toolName === 'EnterPlanMode' || row.perm.toolName === 'ExitPlanMode'
        const isExitPlan = row.perm.toolName === 'ExitPlanMode'
        const planContent = isPlanMode ? parsePlanContent(row.perm.toolInput) : null
        return (
          <div className="bg-card border border-border rounded-lg p-3 text-xs">
            {isPlanMode ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-foreground font-medium">{isExitPlan ? '计划已就绪' : '进入计划模式'}</span>
                </div>
                {planContent ? (
                  <div className="text-muted-foreground mb-3 max-h-40 overflow-auto whitespace-pre-wrap">{planContent}</div>
                ) : (
                  <div className="text-muted-foreground mb-3 max-h-20 overflow-auto">{row.perm.toolInput}</div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => useChatStore.getState().confirmPermission(row.perm.confirmId, true)}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    {isExitPlan ? '接受计划' : '开始计划'}
                  </button>
                  <button
                    onClick={() => useChatStore.getState().confirmPermission(row.perm.confirmId, false)}
                    className="px-3 py-1.5 border border-border text-muted-foreground rounded hover:bg-muted/50"
                  >
                    {isExitPlan ? '拒绝' : '取消'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-foreground font-medium">权限确认</span>
                  <span className="text-muted-foreground">{row.perm.toolName}</span>
                </div>
                <div className="text-muted-foreground mb-3 max-h-20 overflow-auto">{row.perm.toolInput}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => useChatStore.getState().confirmPermission(row.perm.confirmId, true)}
                    className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-500"
                  >
                    允许
                  </button>
                  <button
                    onClick={() => useChatStore.getState().confirmPermission(row.perm.confirmId, false)}
                    className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500"
                  >
                    拒绝
                  </button>
                </div>
              </>
            )}
          </div>
        )
      }

      case 'question':
        return <PendingQuestionCard confirmId={row.question.confirmId} questions={row.question.questions} />
    }
  }

  return (
    <div className="flex-1 relative min-h-0">
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="h-full overflow-auto"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const row = rows[vItem.index]
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                }}
                className="px-4 py-1.5"
              >
                {renderRow(row)}
              </div>
            )
          })}
        </div>
      </div>

      {userScrolledUp && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 z-20 bg-primary text-primary-foreground shadow-lg rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-primary/90 transition-colors"
        >
          <ArrowDown size={12} />
          新消息
        </button>
      )}
    </div>
  )
}
