import { useTodoStore } from '../stores/todoStore'
import { Circle, Loader2, CheckCircle2 } from 'lucide-react'

export function TodoList() {
  const items = useTodoStore((s) => s.items)

  if (items.length === 0) return null

  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircle2 size={12} className="text-green-500" />
    if (status === 'in_progress') return <Loader2 size={12} className="animate-spin text-blue-500" />
    return <Circle size={12} className="text-muted-foreground" />
  }

  return (
    <div className="px-3 py-2 space-y-1">
      <div className="text-xs font-medium text-muted-foreground">任务列表</div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {statusIcon(item.status)}
          <span className={item.status === 'completed' ? 'text-muted-foreground/60' : ''}>
            {item.activeForm || item.content}
          </span>
        </div>
      ))}
    </div>
  )
}
