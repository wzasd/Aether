import { useSubagentStore } from '../stores/subagentStore'
import { Loader2, CheckCircle2 } from 'lucide-react'

export function SubagentStatus() {
  const agents = useSubagentStore((s) => s.agents)
  const agentList = Object.values(agents)

  if (agentList.length === 0) return null

  const activeCount = agentList.filter(a => a.status === 'active').length

  return (
    <div className="px-4 py-2 text-xs border-t border-border bg-muted/20">
      <div className="flex items-center gap-1 font-medium text-muted-foreground mb-1">
        {activeCount > 0 && <Loader2 size={12} className="animate-spin" />}
        <span>Subagent {activeCount > 0 ? `运行中 (${activeCount})` : '已完成'}</span>
      </div>
      <div className="space-y-0.5">
        {agentList.map((agent) => (
          <div key={agent.id} className="flex items-center gap-1 text-muted-foreground">
            {agent.status === 'active' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
            <span className="truncate">{agent.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
