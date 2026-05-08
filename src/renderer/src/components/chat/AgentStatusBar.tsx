import { useState, useRef, useEffect } from 'react'
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

export function AgentStatusBar({ conversationId }: AgentStatusBarProps) {
  const { profiles } = useAgentProfileStore()
  const enabledProfiles = profiles.filter((p) => p.isEnabled)

  const executionMode = useSessionConfigStore((s) => s.executionMode)
  const permissionMode = useSessionConfigStore((s) => s.permissionMode)
  const setPermissionMode = useSessionConfigStore((s) => s.setPermissionMode)

  const collaborationMode = useChatStore((s) => s.pendingCollaborationMode[conversationId])
  const openFloorState = useChatStore((s) => s.openFloorStates[conversationId])
  const isOpenFloor = openFloorState?.status === 'active'

  const [permOpen, setPermOpen] = useState(false)
  const permRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (permRef.current && !permRef.current.contains(e.target as Node)) {
        setPermOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentPerm = PERMISSION_OPTIONS.find((p) => p.value === permissionMode) ?? PERMISSION_OPTIONS[0]
  const isYolo = permissionMode === 'trusted'

  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-border bg-secondary/30 text-xs">
      {/* All agents present */}
      <div className="flex items-center gap-1.5">
        <Users size={13} className="text-emerald-400" />
        <span className="text-foreground font-medium">
          {enabledProfiles.length} Agent{enabledProfiles.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="w-px h-3 bg-border mx-1" />

      {/* Mode indicators */}
      {isOpenFloor ? (
        <div className="flex items-center gap-1 text-blue-400">
          <Brain size={12} />
          <span>Open Floor</span>
          {openFloorState?.responses.length > 0 && (
            <span className="text-muted-foreground">({openFloorState.responses.length})</span>
          )}
        </div>
      ) : collaborationMode === 'orchestrated' ? (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Zap size={12} />
          <span>Orchestrated</span>
        </div>
      ) : null}

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
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors hover:bg-secondary ${
            isYolo
              ? 'bg-red-500/10 text-red-400 border border-red-500/30'
              : 'text-muted-foreground'
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
  )
}
