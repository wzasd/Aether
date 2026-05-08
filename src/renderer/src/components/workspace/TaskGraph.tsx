import { useState, useEffect, useCallback, useRef } from 'react'
import { GitBranch, Loader, CheckCircle, XCircle, Clock, User, MessageSquare, ChevronDown, Filter } from 'lucide-react'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useA2AStore } from '../../stores/a2aStore'

interface GraphNode {
  id: string
  toProfileId: string
  fromProfileId: string | null
  message: string
  status: string
  depth: number
  executionMode: string
}

interface GraphEdge {
  id: string
  fromNodeId: string | null
  toNodeId: string
  edgeType: string
  label?: string
}

type FilterMode = 'all' | 'active' | 'completed'

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending:   { icon: Clock,        color: 'text-muted-foreground', label: 'Pending' },
  working:   { icon: Loader,       color: 'text-blue-400',         label: 'Running' },
  completed: { icon: CheckCircle,  color: 'text-emerald-400',      label: 'Done' },
  failed:    { icon: XCircle,      color: 'text-red-400',          label: 'Failed' }
}

const EDGE_LABELS: Record<string, string> = {
  'user-mention': 'User',
  'agent-mention': '@',
  'capability-route': '@capability',
  'feedback': 'Feedback'
}

const EDGE_COLORS: Record<string, string> = {
  'user-mention': 'bg-slate-400',
  'agent-mention': 'bg-blue-400',
  'capability-route': 'bg-purple-400',
  'feedback': 'bg-emerald-400'
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

export function TaskGraph({ conversationId }: { conversationId: string | null }) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [filter, setFilter] = useState<FilterMode>('active')
  const [expanded, setExpanded] = useState(true)
  const [prevStatuses, setPrevStatuses] = useState<Record<string, string>>({})
  const profiles = useAgentProfileStore((s) => s.profiles)
  const getQueuePosition = useA2AStore((s) => s.getQueuePosition)

  const loadGraph = useCallback(async () => {
    if (!conversationId) return
    try {
      const graph = await window.api.orchestrator.getActiveGraph(conversationId)
      const newNodes = graph.nodes as GraphNode[]
      // Track status transitions for animation
      setPrevStatuses((prev) => {
        const updated = { ...prev }
        newNodes.forEach((n) => { updated[n.id] = n.status })
        return updated
      })
      setNodes(newNodes)
      setEdges(graph.edges as GraphEdge[])
    } catch { /* ignore */ }
  }, [conversationId])

  useEffect(() => { loadGraph() }, [loadGraph])

  useEffect(() => {
    if (!conversationId) return
    const unsub1 = window.api.orchestrator.onA2ATaskCreated(() => { loadGraph() })
    const unsub2 = window.api.orchestrator.onA2ATaskCompleted(() => { loadGraph() })
    const unsub3 = window.api.orchestrator.onA2ATaskQueued(() => { loadGraph() })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [conversationId, loadGraph])

  useEffect(() => {
    if (!conversationId) return
    const interval = setInterval(() => loadGraph(), 2000)
    return () => clearInterval(interval)
  }, [conversationId, loadGraph])

  if (!conversationId || nodes.length === 0) return null

  const profileName = (profileId: string): string =>
    profiles.find((p) => p.id === profileId)?.name ?? profileId.slice(0, 8)

  // Filter nodes
  const filteredNodes = (() => {
    switch (filter) {
      case 'active': return nodes.filter((n) => n.status === 'pending' || n.status === 'working')
      case 'completed': return nodes.filter((n) => n.status === 'completed' || n.status === 'failed')
      default: return nodes
    }
  })()

  const activeCount = nodes.filter((n) => n.status === 'pending' || n.status === 'working').length
  const doneCount = nodes.filter((n) => n.status === 'completed').length
  const failedCount = nodes.filter((n) => n.status === 'failed').length

  // Unique edge types for legend
  const edgeTypeSet = new Set(edges.map((e) => e.edgeType))
  const edgeTypes = Array.from(edgeTypeSet)

  return (
    <div className="shrink-0 border-t border-border bg-card/30">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card/50 transition-colors"
      >
        <ChevronDown size={12} className={`text-muted-foreground transition-transform ${expanded ? '' : '-rotate-90'}`} />
        <GitBranch size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Task Graph</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {nodes.length} nodes · {edges.length} edges
        </span>
        {activeCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-400/10 text-blue-400 tabular-nums">
            {activeCount} active
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {/* Filters + Legend */}
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            <Filter size={10} className="text-muted-foreground mr-1" />
            {(['all', 'active', 'completed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  filter === f
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {f === 'all' ? `All (${nodes.length})` : f === 'active' ? `Active (${activeCount})` : `Done (${doneCount + failedCount})`}
              </button>
            ))}

            <span className="text-[10px] text-muted-foreground/40 mx-1">|</span>

            {/* Edge type legend */}
            {edgeTypes.map((t) => (
              <span key={t} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className={`w-1.5 h-1.5 rounded-full ${EDGE_COLORS[t] ?? 'bg-muted-foreground'}`} />
                {EDGE_LABELS[t] ?? t}
              </span>
            ))}
          </div>

          {/* Nodes */}
          <div className="relative">
            <div className="max-h-[180px] overflow-y-auto scrollbar-thin" style={{ maskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent)' }}>
              <div className="space-y-1.5">
                {filteredNodes.map((node) => {
                  const status = STATUS_CONFIG[node.status] ?? STATUS_CONFIG.pending
                  const Icon = status.icon
                  const agentName = profileName(node.toProfileId)
                  const fromName = node.fromProfileId ? profileName(node.fromProfileId) : null
                  const statusChanged = prevStatuses[node.id] && prevStatuses[node.id] !== node.status

                  return (
                    <div
                      key={node.id}
                      className={`flex items-start gap-2.5 p-2 rounded-lg border transition-all duration-300 ${
                        statusChanged ? 'animate-pulse' : ''
                      } ${
                        node.status === 'working'
                          ? 'border-blue-400/40 bg-blue-400/5'
                          : node.status === 'completed'
                          ? 'border-emerald-400/20 bg-emerald-400/5'
                          : node.status === 'failed'
                          ? 'border-red-400/20 bg-red-400/5'
                          : 'border-border bg-card'
                      }`}
                      style={{ marginLeft: `${node.depth * 14}px` }}
                    >
                      <div className={`mt-0.5 shrink-0 ${status.color} ${node.status === 'working' ? 'animate-spin' : ''}`}>
                        <Icon size={13} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <User size={9} className="text-muted-foreground shrink-0" />
                          <span className="text-[11px] font-medium text-foreground">{agentName}</span>
                          <span className={`text-[9px] ${status.color}`}>{status.label}</span>
                          {node.status === 'pending' && (
                            <span className="text-[9px] px-1 py-px rounded bg-amber-400/10 text-amber-400 tabular-nums">
                              #{getQueuePosition(conversationId, node.id) ?? '—'}
                            </span>
                          )}
                          {fromName && (
                            <span className="text-[9px] text-muted-foreground">← {fromName}</span>
                          )}
                          {node.executionMode === 'parallel' && (
                            <span className="text-[9px] px-1 py-px rounded bg-purple-400/10 text-purple-400">∥</span>
                          )}
                        </div>

                        <div className="text-[10px] text-muted-foreground leading-relaxed">
                          <MessageSquare size={9} className="inline mr-1 text-muted-foreground/50" />
                          {truncate(node.message, 100)}
                        </div>

                        {/* Edge badge */}
                        {edges
                          .filter((e) => e.toNodeId === node.id)
                          .map((e) => (
                            <div key={e.id} className="mt-1 inline-flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${EDGE_COLORS[e.edgeType] ?? 'bg-muted-foreground'}`} />
                              <span className="text-[9px] text-muted-foreground/60">
                                {e.label ?? EDGE_LABELS[e.edgeType] ?? e.edgeType}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )
                })}

                {filteredNodes.length === 0 && (
                  <div className="text-[10px] text-muted-foreground py-2 text-center">
                    No {filter === 'active' ? 'active' : filter === 'completed' ? 'completed' : ''} nodes
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
