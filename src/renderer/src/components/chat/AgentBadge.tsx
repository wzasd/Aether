const ROLE_COLORS: Record<string, string> = {
  planning: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  implementation: 'bg-green-600/20 text-green-400 border-green-600/30',
  review: 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  assistant: 'bg-accent/20 text-muted-foreground border-border/30'
}

interface AgentBadgeProps {
  agentName: string
  role?: string
}

export function AgentBadge({ agentName, role = 'assistant' }: AgentBadgeProps) {
  const colorClass = ROLE_COLORS[role.toLowerCase()] ?? ROLE_COLORS.assistant
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {agentName}
    </span>
  )
}
