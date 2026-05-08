import { ChevronDown, Bot } from 'lucide-react'
import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useA2AStore, type A2ATask } from '../../stores/a2aStore'
import { useAgentProfileStore } from '../../stores/agentProfileStore'

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground',
  working: 'text-blue-400 animate-pulse',
  completed: 'text-green-400',
  failed: 'text-red-400'
}

const STATUS_DOTS: Record<string, string> = {
  pending: 'bg-accent',
  working: 'bg-blue-400',
  completed: 'bg-green-400',
  failed: 'bg-red-400'
}

const STATUS_LABELS: Record<string, string> = {
  pending: '排队中',
  working: '运行中',
  completed: '已完成',
  failed: '失败'
}

function TaskRow({ task }: { task: A2ATask }) {
  const profiles = useAgentProfileStore((s) => s.profiles)
  const targetProfile = profiles.find((p) => p.id === task.toProfileId)
  const sourceProfile = task.fromProfileId
    ? profiles.find((p) => p.id === task.fromProfileId)
    : null

  const cliLabel = targetProfile?.preferredProvider
    ? targetProfile.preferredProvider.replace('-cli', '').replace('opencode', 'oc')
    : null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-card/40 transition-colors group">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOTS[task.status] ?? 'bg-accent'}`} />
      <span className="flex-1 text-left text-[11px] text-muted-foreground truncate">
        {sourceProfile ? (
          <span className="text-muted-foreground">@{sourceProfile.name}</span>
        ) : (
          <span className="text-muted-foreground">User</span>
        )}
        <span className="text-muted-foreground"> → </span>
        <span className="text-foreground">@{targetProfile?.name ?? 'Unknown'}</span>
        {cliLabel && (
          <span className="ml-1 text-[10px] text-muted-foreground font-mono">({cliLabel})</span>
        )}
      </span>
      <span className={`text-[10px] shrink-0 ${STATUS_COLORS[task.status] ?? 'text-muted-foreground'}`}>
        {STATUS_LABELS[task.status] ?? task.status}
      </span>
    </div>
  )
}

export function AgentActivityPanel() {
  const [expanded, setExpanded] = useState(true)
  const currentConversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const tasks = useA2AStore((s) =>
    currentConversationId ? (s.tasksByConversation[currentConversationId] ?? []) : []
  )

  const recentTasks = [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)

  const activeCount = tasks.filter((t) => t.status === 'working' || t.status === 'pending').length

  if (tasks.length === 0) return null

  return (
    <div className="border-t border-border shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card/60 transition-colors"
      >
        <Bot size={12} className="text-emerald-500 shrink-0" />
        <span className="flex-1 text-left text-[11.5px] text-muted-foreground">Agent Activity</span>
        {activeCount > 0 && (
          <span className="text-[10px] text-emerald-500 mr-1">{activeCount}</span>
        )}
        <ChevronDown
          size={10}
          className={`text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="pb-1">
          {recentTasks.length === 0 ? (
            <p className="px-3 py-1 text-[11px] text-muted-foreground">No activity yet</p>
          ) : (
            recentTasks.map((task) => <TaskRow key={task.id} task={task} />)
          )}
        </div>
      )}
    </div>
  )
}
