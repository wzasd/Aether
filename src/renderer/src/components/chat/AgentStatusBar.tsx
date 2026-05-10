import { useState, useRef, useEffect, useMemo } from 'react'
import { Brain, Users, Zap, ChevronDown } from 'lucide-react'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useSessionConfigStore, type CanonicalPermissionMode } from '../../stores/sessionConfigStore'
import { useChatStore } from '../../stores/chatStore'

interface AgentStatusBarProps {
  conversationId: string
}

const PERMISSION_OPTIONS: { value: CanonicalPermissionMode; label: string; color: string }[] = [
  { value: 'plan', label: 'Ask first', color: 'text-muted-foreground' },
  { value: 'autoEdit', label: 'Auto', color: 'text-yellow-400' },
  { value: 'trusted', label: 'YOLO', color: 'text-red-400' },
]

type AgentOpenFloorStatus = 'thinking' | 'replied' | 'pending' | 'skipped'

interface AgentStatusPill {
  profileId: string
  name: string
  role: string
  status: AgentOpenFloorStatus
}

export function AgentStatusBar({ conversationId }: AgentStatusBarProps) {
  const { profiles } = useAgentProfileStore()
  const enabledProfiles = profiles.filter((p) => p.isEnabled)

  const executionMode = useSessionConfigStore((s) => s.executionMode)
  const permissionMode = useSessionConfigStore((s) => s.permissionMode)
  const setPermissionMode = useSessionConfigStore((s) => s.setPermissionMode)

  const collaborationMode = useChatStore((s) => s.pendingCollaborationMode[conversationId])
  const setPendingCollaborationMode = useChatStore((s) => s.setPendingCollaborationMode)
  const openFloorState = useChatStore((s) => s.openFloorStates[conversationId])
  const isOpenFloor = openFloorState?.status === 'active'
  const hasOpenFloorActivity = isOpenFloor || (openFloorState?.responses.length ?? 0) > 0

  const [permOpen, setPermOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [agentDetailOpen, setAgentDetailOpen] = useState(false)
  const permRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const agentDetailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (permRef.current && !permRef.current.contains(e.target as Node)) {
        setPermOpen(false)
      }
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeOpen(false)
      }
      if (agentDetailRef.current && !agentDetailRef.current.contains(e.target as Node)) {
        setAgentDetailOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Build per-agent Open Floor status pills
  const agentStatusPills = useMemo<AgentStatusPill[]>(() => {
    if (!hasOpenFloorActivity) return []

    const thinkingSet = new Set(openFloorState?.thinkingAgents.map((a) => a.agentId) ?? [])
    const repliedSet = new Set(openFloorState?.responses.map((r) => r.agentId) ?? [])
    const isClosed = !isOpenFloor && (openFloorState?.responses.length ?? 0) > 0

    return enabledProfiles.map((profile) => {
      let status: AgentOpenFloorStatus
      if (thinkingSet.has(profile.id)) {
        status = 'thinking'
      } else if (repliedSet.has(profile.id)) {
        status = 'replied'
      } else if (isClosed) {
        status = 'skipped'
      } else {
        status = 'pending'
      }
      return {
        profileId: profile.id,
        name: profile.name,
        role: profile.role,
        status,
      }
    })
  }, [enabledProfiles, openFloorState, hasOpenFloorActivity, isOpenFloor])

  const statusDotClass = (status: AgentOpenFloorStatus): string => {
    switch (status) {
      case 'thinking':
        return 'bg-amber-400 animate-pulse'
      case 'replied':
        return 'bg-emerald-400'
      case 'skipped':
        return 'bg-slate-400'
      case 'pending':
        return 'bg-slate-600'
    }
  }

  const statusLabel = (status: AgentOpenFloorStatus): string => {
    switch (status) {
      case 'thinking':
        return '思考中'
      case 'replied':
        return '已回复'
      case 'skipped':
        return '静默'
      case 'pending':
        return '等待中'
    }
  }

  const currentPerm = PERMISSION_OPTIONS.find((p) => p.value === permissionMode) ?? PERMISSION_OPTIONS[0]
  const isYolo = permissionMode === 'trusted'

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 mb-2 rounded-lg border border-border bg-secondary/30 text-xs">
      {/* Top row — existing controls */}
      <div className="flex items-center gap-2">
        {/* All agents present */}
        <div className="flex items-center gap-1.5">
          <Users size={13} className="text-emerald-400" />
          <span className="text-foreground font-medium">
            {enabledProfiles.length} Agent{enabledProfiles.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="w-px h-3 bg-border mx-1" />

        {/* Mode indicators — toggleable dropdown */}
        <div ref={modeRef} className="relative">
          <button
            onClick={() => setModeOpen((v) => !v)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
              isOpenFloor || collaborationMode === 'open_floor'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            {isOpenFloor || collaborationMode === 'open_floor' ? (
              <>
                <Brain size={12} />
                <span>Open Floor</span>
                {openFloorState?.responses.length ? (
                  <span className="text-blue-400/70">({openFloorState.responses.length})</span>
                ) : null}
              </>
            ) : (
              <>
                <Zap size={12} />
                <span>Orchestrated</span>
              </>
            )}
            <ChevronDown size={10} className={`transition-transform ${modeOpen ? 'rotate-180' : ''}`} />
          </button>
          {modeOpen && (
            <div className="absolute bottom-full right-0 mb-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-36 overflow-hidden">
              <button
                onClick={() => {
                  setPendingCollaborationMode(conversationId, 'open_floor')
                  setModeOpen(false)
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2 ${
                  (isOpenFloor || collaborationMode === 'open_floor') ? 'bg-secondary' : ''
                }`}
              >
                <Brain size={12} className="text-blue-400" />
                <span className="text-blue-400">Open Floor</span>
              </button>
              <button
                onClick={() => {
                  setPendingCollaborationMode(conversationId, 'orchestrated')
                  setModeOpen(false)
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2 ${
                  (!isOpenFloor && collaborationMode !== 'open_floor') ? 'bg-secondary' : ''
                }`}
              >
                <Zap size={12} className="text-muted-foreground" />
                <span>Orchestrated</span>
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-3 bg-border mx-1" />

        {/* Execution mode */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          executionMode === 'parallel'
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-muted text-muted-foreground'
        }`}>
          {executionMode === 'parallel' ? 'parallel' : 'serial'}
        </span>

        <div className="flex-1" />

        {/* Permission dropdown */}
        <div ref={permRef} className="relative">
          <button
            onClick={() => setPermOpen((v) => !v)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
              isYolo
                ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/40'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <span className={isYolo ? '' : currentPerm.color}>{currentPerm.label}</span>
            <ChevronDown size={10} className={`transition-transform ${permOpen ? 'rotate-180' : ''}`} />
          </button>
          {permOpen && (
            <div className="absolute bottom-full right-0 mb-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-28 overflow-hidden">
              {PERMISSION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    if (opt.value === 'trusted' && permissionMode !== 'trusted') {
                      if (!window.confirm(
                        '切换到 YOLO 模式？\n\nAgent 将自动执行任务，不再逐条确认。'
                      )) return
                    }
                    setPermissionMode(opt.value)
                    setPermOpen(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-secondary transition-colors flex items-center gap-2 ${
                    permissionMode === opt.value ? 'bg-secondary' : ''
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    opt.value === 'trusted' ? 'bg-red-400' :
                    opt.value === 'autoEdit' ? 'bg-yellow-400' :
                    'bg-muted-foreground'
                  }`} />
                  <span className={opt.color}>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings link */}
        <button
          onClick={() => {
            const event = new CustomEvent('open-agent-settings')
            window.dispatchEvent(event)
          }}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline shrink-0"
        >
          配置
        </button>
      </div>

      {/* Per-agent Open Floor status row */}
      {hasOpenFloorActivity && agentStatusPills.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground shrink-0">状态:</span>
          <div ref={agentDetailRef} className="relative flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setAgentDetailOpen((v) => !v)}
              className="flex items-center gap-1 flex-wrap"
            >
              {agentStatusPills.map((pill) => (
                <span
                  key={pill.profileId}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/60 border border-border/50 text-[10px]"
                  title={`${pill.name}（${pill.role}）— ${statusLabel(pill.status)}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(pill.status)}`} />
                  <span className="text-foreground">{pill.name}</span>
                </span>
              ))}
            </button>

            {/* Agent detail dropdown */}
            {agentDetailOpen && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-44 overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border">
                  <span className="text-[10px] text-muted-foreground">Agent 状态详情</span>
                </div>
                {agentStatusPills.map((pill) => (
                  <div
                    key={pill.profileId}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(pill.status)}`} />
                    <span className="text-foreground font-medium">{pill.name}</span>
                    <span className="text-[10px] text-muted-foreground">{pill.role}</span>
                    <span className={`text-[10px] ml-auto ${
                      pill.status === 'thinking' ? 'text-amber-400' :
                      pill.status === 'replied' ? 'text-emerald-400' :
                      pill.status === 'skipped' ? 'text-slate-400' :
                      'text-muted-foreground'
                    }`}>
                      {statusLabel(pill.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
