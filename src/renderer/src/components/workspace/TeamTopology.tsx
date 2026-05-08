import { useState, useRef, useEffect, useCallback, forwardRef } from 'react'
import {
  Network,
  Zap,
  ChevronDown,
  Bot,
  Route,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import type { AgentProfileConfig } from '../../stores/agentProfileStore'

interface TeamMemberInfo {
  profileId: string
  providerOverride?: string
  modelOverride?: string
}

interface TeamTopologyProps {
  name: string
  members: TeamMemberInfo[]
  profiles: AgentProfileConfig[]
  policies?: Record<string, unknown>
}

const ROLE_CONFIG: Record<string, { bg: string; ring: string; text: string; glow: string; label: string }> = {
  planning: {
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    text: 'text-amber-400',
    glow: 'shadow-amber-500/20',
    label: '规划'
  },
  implementation: {
    bg: 'bg-emerald-500/15',
    ring: 'ring-emerald-500/30',
    text: 'text-emerald-400',
    glow: 'shadow-emerald-500/20',
    label: '实现'
  },
  review: {
    bg: 'bg-purple-500/15',
    ring: 'ring-purple-500/30',
    text: 'text-purple-400',
    glow: 'shadow-purple-500/20',
    label: '审查'
  },
  ui: {
    bg: 'bg-pink-500/15',
    ring: 'ring-pink-500/30',
    text: 'text-pink-400',
    glow: 'shadow-pink-500/20',
    label: 'UI'
  },
  coder: {
    bg: 'bg-blue-500/15',
    ring: 'ring-blue-500/30',
    text: 'text-blue-400',
    glow: 'shadow-blue-500/20',
    label: '编码'
  },
  assistant: {
    bg: 'bg-slate-500/15',
    ring: 'ring-slate-500/30',
    text: 'text-slate-400',
    glow: 'shadow-slate-500/20',
    label: '助手'
  }
}

const ROLE_DOT: Record<string, string> = {
  planning: 'bg-amber-500',
  implementation: 'bg-emerald-500',
  review: 'bg-purple-500',
  ui: 'bg-pink-500',
  coder: 'bg-blue-500',
  assistant: 'bg-slate-500'
}

const POLICY_ICONS: Record<string, typeof ShieldCheck> = {
  allowAgentMention: Route,
  allowCapabilityRouting: Sparkles
}

function getRoleConfig(role: string) {
  return ROLE_CONFIG[role] ?? ROLE_CONFIG.assistant
}

/* ------------------------------------------------------------------ */
/*  Node — a single agent in the network                               */
/* ------------------------------------------------------------------ */

const AgentNode = forwardRef<HTMLButtonElement, {
  profile: AgentProfileConfig
  member: TeamMemberInfo
  isExpanded: boolean
  onToggle: () => void
  style?: React.CSSProperties
}>(function AgentNode({ profile, member, isExpanded, onToggle, style }, ref) {
  const cfg = getRoleConfig(profile.role)
  const hasOverride = !!(member.providerOverride || member.modelOverride)
  const dotColor = ROLE_DOT[profile.role] ?? 'bg-slate-500'

  return (
    <button
      ref={ref}
      onClick={onToggle}
      style={style}
      className={`
        group relative flex items-center gap-2 rounded-lg
        border px-2.5 py-2 transition-all duration-200 cursor-pointer
        ${isExpanded
          ? `${cfg.bg} border-foreground/20 shadow-sm ${cfg.glow} shadow-md`
          : 'bg-card/80 border-border/60 hover:border-foreground/15 hover:bg-secondary/40'
        }
      `}
    >
      {/* Avatar */}
      <div className={`
        relative w-7 h-7 rounded-full flex items-center justify-center shrink-0
        ring-1 ${cfg.ring} ${cfg.bg}
      `}>
        <span className={`text-[10px] font-semibold ${cfg.text} leading-none select-none`}>
          {profile.name.charAt(0).toUpperCase()}
        </span>
        {/* Online-style dot */}
        <span className={`
          absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full
          ${dotColor} ring-2 ring-card
        `} />
      </div>

      {/* Name + role */}
      <div className="text-left min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-foreground leading-tight truncate max-w-[80px]">
            {profile.name}
          </span>
          {hasOverride && (
            <Zap size={9} className="text-amber-400 shrink-0" />
          )}
        </div>
        <span className={`text-[9px] ${cfg.text} leading-tight opacity-80`}>
          {cfg.label}
        </span>
      </div>

      {/* Expand chevron */}
      <ChevronDown
        size={11}
        className={`
          text-muted-foreground/40 shrink-0 ml-auto transition-transform duration-200
          ${isExpanded ? 'rotate-180' : ''}
        `}
      />
    </button>
  )
})

/* ------------------------------------------------------------------ */
/*  Detail panel — expanded member info                                */
/* ------------------------------------------------------------------ */

function MemberDetail({
  profile,
  member
}: {
  profile: AgentProfileConfig
  member: TeamMemberInfo
}) {
  const cfg = getRoleConfig(profile.role)
  const rows: { label: string; value: string; accent?: boolean }[] = []

  if (profile.preferredProvider) {
    rows.push({ label: 'Provider', value: profile.preferredProvider })
  }
  if (profile.model) {
    rows.push({ label: 'Model', value: profile.model })
  }
  if (member.providerOverride) {
    rows.push({ label: 'Provider', value: member.providerOverride, accent: true })
  }
  if (member.modelOverride) {
    rows.push({ label: 'Model', value: member.modelOverride, accent: true })
  }

  return (
    <div className="rounded-lg border border-border/50 bg-popover/80 px-3 py-2 space-y-1.5 shadow-sm">
      {/* Override banner */}
      {(member.providerOverride || member.modelOverride) && (
        <div className="flex items-center gap-1 text-[9px] text-amber-400">
          <Zap size={9} />
          <span>Runtime override active</span>
        </div>
      )}

      {/* Key-value rows */}
      {rows.map((r) => (
        <div key={r.label + r.value} className="flex items-center justify-between gap-3">
          <span className="text-[9px] text-muted-foreground shrink-0">{r.label}</span>
          <span className={`text-[9px] font-mono truncate ${r.accent ? 'text-amber-400' : 'text-foreground'}`}>
            {r.value}
          </span>
        </div>
      ))}

      {/* Capabilities */}
      {profile.capabilities && profile.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {profile.capabilities.map((c) => (
            <span
              key={c}
              className={`text-[8px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text} ring-1 ${cfg.ring}`}
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Network canvas — SVG connection lines between nodes                 */
/* ------------------------------------------------------------------ */

function NetworkCanvas({
  containerRef,
  nodePositions,
  memberCount
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  nodePositions: Map<string, { x: number; y: number }>
  memberCount: number
}) {
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  if (memberCount < 2 || size.w === 0) return null

  const points = Array.from(nodePositions.values())
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []

  // Connect each node to its nearest neighbor and to the next node (mesh-like)
  for (let i = 0; i < points.length; i++) {
    // Linear chain
    if (i < points.length - 1) {
      lines.push({
        x1: points[i].x, y1: points[i].y,
        x2: points[i + 1].x, y2: points[i + 1].y
      })
    }
    // Cross-connections for network feel (connect to node 2 ahead if exists)
    if (i < points.length - 2) {
      lines.push({
        x1: points[i].x, y1: points[i].y,
        x2: points[i + 2].x, y2: points[i + 2].y
      })
    }
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={size.w}
      height={size.h}
      style={{ overflow: 'visible' }}
    >
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.x1} y1={l.y1}
          x2={l.x2} y2={l.y2}
          stroke="currentColor"
          className="text-border/40"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ))}
      {/* Small dots at each node center */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r={2}
          className="fill-border/30"
        />
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function TeamTopology({ name, members, profiles, policies }: TeamTopologyProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map())

  const resolvedProfiles = members
    .map((m) => {
      const profile = profiles.find((p) => p.id === m.profileId)
      return { member: m, profile }
    })
    .filter((r): r is { member: TeamMemberInfo; profile: AgentProfileConfig } => !!r.profile)

  const activePolicies = policies
    ? Object.entries(policies).filter(([, v]) => v).map(([k]) => k)
    : []

  // Recalculate node positions for SVG lines
  const recalcPositions = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const next = new Map<string, { x: number; y: number }>()
    nodeRefs.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect()
      next.set(id, {
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top + rect.height / 2
      })
    })
    setNodePositions(next)
  }, [])

  useEffect(() => {
    recalcPositions()
    window.addEventListener('resize', recalcPositions)
    return () => window.removeEventListener('resize', recalcPositions)
  }, [recalcPositions, resolvedProfiles.length, expandedId])

  const setNodeRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) {
      nodeRefs.current.set(id, el)
    } else {
      nodeRefs.current.delete(id)
    }
  }, [])

  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Network size={20} className="mb-1.5 opacity-25" />
        <span className="text-[11px]">暂无成员</span>
      </div>
    )
  }

  // Layout: for 1-3 members, single row. 4+, use 2-row grid.
  const useGrid = resolvedProfiles.length >= 4
  const topRowCount = useGrid ? Math.ceil(resolvedProfiles.length / 2) : resolvedProfiles.length
  const bottomRowCount = useGrid ? resolvedProfiles.length - topRowCount : 0

  return (
    <div className="space-y-2">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-secondary/80 flex items-center justify-center">
            <Bot size={10} className="text-muted-foreground" />
          </div>
          <span className="text-[11px] font-medium text-foreground tracking-tight">{name}</span>
          <span className="text-[10px] text-muted-foreground/70 tabular-nums">
            {resolvedProfiles.length}
          </span>
        </div>
        {activePolicies.length > 0 && (
          <div className="flex items-center gap-1">
            {activePolicies.map((p) => {
              const Icon = POLICY_ICONS[p] ?? ShieldCheck
              return (
                <span
                  key={p}
                  className="flex items-center gap-0.5 text-[8px] text-muted-foreground/70 bg-secondary/50 px-1.5 py-0.5 rounded-full"
                  title={p}
                >
                  <Icon size={8} />
                  {p.replace(/([A-Z])/g, ' $1').trim().split(' ').pop()}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Network area */}
      <div ref={containerRef} className="relative">
        {/* SVG connection lines */}
        <NetworkCanvas
          containerRef={containerRef}
          nodePositions={nodePositions}
          memberCount={resolvedProfiles.length}
        />

        {/* Nodes */}
        {useGrid ? (
          <div className="space-y-1.5">
            {/* Top row */}
            <div className="flex gap-1.5 justify-center flex-wrap">
              {resolvedProfiles.slice(0, topRowCount).map(({ profile, member }) => {
                const isExpanded = expandedId === profile.id
                return (
                  <div key={profile.id} className="space-y-1">
                    <AgentNode
                      ref={(el) => setNodeRef(profile.id, el)}
                      profile={profile}
                      member={member}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : profile.id)}
                    />
                    {isExpanded && (
                      <MemberDetail profile={profile} member={member} />
                    )}
                  </div>
                )
              })}
            </div>
            {/* Bottom row (offset for network feel) */}
            {bottomRowCount > 0 && (
              <div className="flex gap-1.5 justify-center flex-wrap" style={{ paddingLeft: 40 }}>
                {resolvedProfiles.slice(topRowCount).map(({ profile, member }) => {
                  const isExpanded = expandedId === profile.id
                  return (
                    <div key={profile.id} className="space-y-1">
                      <AgentNode
                        ref={(el) => setNodeRef(profile.id, el)}
                        profile={profile}
                        member={member}
                        isExpanded={isExpanded}
                        onToggle={() => setExpandedId(isExpanded ? null : profile.id)}
                      />
                      {isExpanded && (
                        <MemberDetail profile={profile} member={member} />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-1.5 justify-center flex-wrap">
            {resolvedProfiles.map(({ profile, member }) => {
              const isExpanded = expandedId === profile.id
              return (
                <div key={profile.id} className="space-y-1">
                  <AgentNode
                    ref={(el) => setNodeRef(profile.id, el)}
                    profile={profile}
                    member={member}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedId(isExpanded ? null : profile.id)}
                  />
                  {isExpanded && (
                    <MemberDetail profile={profile} member={member} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-center gap-1 pt-0.5">
        <Route size={8} className="text-muted-foreground/30" />
        <span className="text-[8px] text-muted-foreground/40 tracking-wide">
          {resolvedProfiles.length <= 1
            ? 'Single agent mode'
            : 'Agents route via @mention'
          }
        </span>
      </div>
    </div>
  )
}
