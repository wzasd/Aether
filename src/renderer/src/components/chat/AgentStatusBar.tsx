import { Brain, Users, Zap } from 'lucide-react'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useSessionConfigStore } from '../../stores/sessionConfigStore'
import { useChatStore } from '../../stores/chatStore'

interface AgentStatusBarProps {
  conversationId: string
}

export function AgentStatusBar({ conversationId }: AgentStatusBarProps) {
  const { profiles } = useAgentProfileStore()
  const enabledProfiles = profiles.filter((p) => p.isEnabled)
  
  const executionMode = useSessionConfigStore((s) => s.executionMode)
  const permissionMode = useSessionConfigStore((s) => s.permissionMode)
  
  const collaborationMode = useChatStore((s) => s.pendingCollaborationMode[conversationId])
  const openFloorState = useChatStore((s) => s.openFloorStates[conversationId])
  const isOpenFloor = openFloorState?.status === 'active'

  // Permission mode label
  const permissionLabel = {
    trusted: '信任模式',
    autoEdit: '自动编辑',
    fullAuto: '全自动',
    plan: '先审后行',
    manual: '手动确认'
  }[permissionMode] ?? permissionMode

  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-border bg-secondary/30 text-xs">
      {/* All agents present */}
      <div className="flex items-center gap-1.5">
        <Users size={13} className="text-emerald-400" />
        <span className="text-foreground font-medium">
          {enabledProfiles.length} 个 Agent 在场
        </span>
      </div>

      <div className="w-px h-3 bg-border mx-1" />

      {/* Mode indicators */}
      {isOpenFloor ? (
        <div className="flex items-center gap-1 text-blue-400">
          <Brain size={12} />
          <span>自由讨论</span>
          {openFloorState?.responses.length > 0 && (
            <span className="text-muted-foreground">({openFloorState.responses.length} 回复)</span>
          )}
        </div>
      ) : collaborationMode === 'orchestrated' ? (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Zap size={12} />
          <span>编排模式</span>
        </div>
      ) : null}

      <div className="w-px h-3 bg-border mx-1" />

      {/* Permission */}
      <span className="text-muted-foreground">{permissionLabel}</span>

      {/* Execution mode */}
      <div className="w-px h-3 bg-border mx-1" />
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
        executionMode === 'parallel'
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'bg-muted text-muted-foreground'
      }`}>
        {executionMode === 'parallel' ? '并行' : '串行'}
      </span>

      {/* Edit link to settings */}
      <button
        onClick={() => {
          const event = new CustomEvent('open-agent-settings')
          window.dispatchEvent(event)
        }}
        className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
      >
        配置
      </button>
    </div>
  )
}
