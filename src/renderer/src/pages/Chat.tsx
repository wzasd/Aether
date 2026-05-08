import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileCode, User, Users, MessageSquare, Search, Hammer, ShieldCheck, Zap } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useChangeStore, type FileChange } from '../stores/changeStore'
import { useUIStore } from '../stores/uiStore'
import { useAgentProfileStore } from '../stores/agentProfileStore'
import { useProviderStore } from '../stores/providerStore'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { SubagentStatus } from '../components/SubagentStatus'
import { UsageBar } from '../components/UsageBar'
import { TaskGraph } from '../components/workspace/TaskGraph'
import { PickerItem } from '../components/PickerItem'
import { TeamTopology } from '../components/workspace/TeamTopology'

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const currentConversation = useChatStore((s) => s.currentConversation)
  const messages = useChatStore((s) => s.messages)
  const loadConversation = useChatStore((s) => s.loadConversation)
  const streamingText = useChatStore((s) => s.streamingText)
  const streamingRequestId = useChatStore((s) => s.streamingRequestId)
  const isOptimisticStreaming = useChatStore((s) => s.isOptimisticStreaming)
  const loading = useChatStore((s) => s.loading)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const updateCurrentConversation = useChatStore((s) => s.updateCurrentConversation)
  // Track whether this component has truly mounted (not a StrictMode synthetic mount).
  // useLayoutEffect only fires on real mounts, so this ref stays false during dev-only
  // double-invoke and is only set to true when the component is actually committed to the DOM.
  const isCommittedRef = useRef(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const [selectedMode, setSelectedMode] = useState<'solo' | 'team'>('solo')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('default')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('dev-team')
  const [collaborationMode, setCollaborationMode] = useState<'direct' | 'explore' | 'build' | 'review'>('direct')
  const [overrideProvider, setOverrideProvider] = useState('')
  const [overrideModel, setOverrideModel] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [initialMentions, setInitialMentions] = useState('')
  const [teams, setTeams] = useState<Array<{ id: string; name: string; members?: Array<{ profileId: string }>; policies?: Record<string, unknown> }>>([])

  const profiles = useAgentProfileStore((s) => s.profiles)
  const { activeProfileId, setActiveProfile } = useAgentProfileStore()
  const providers = useProviderStore((s) => s.providers)

  const taskRailCollapsed = useUIStore((s) => s.taskRailCollapsed)
  const workspaceCollapsed = useUIStore((s) => s.workspaceCollapsed)
  const bothCollapsed = taskRailCollapsed && workspaceCollapsed

  const isStreaming = isOptimisticStreaming || streamingRequestId !== null

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isUserScrollingRef.current = distanceFromBottom > 100
  }, [])

  useLayoutEffect(() => {
    isCommittedRef.current = true
    return () => {
      isCommittedRef.current = false
    }
  }, [])

  const hasSentRef = useRef(false)

  useEffect(() => {
    if (id) {
      hasSentRef.current = false
      loadConversation(id)
    }
  }, [id, loadConversation])

  // Clean up orphan drafts when navigating away without sending
  useEffect(() => {
    return () => {
      // isCommittedRef is false during StrictMode's synthetic cleanup — only
      // delete when this is a real unmount from a real navigation event.
      if (!isCommittedRef.current) return
      if (hasSentRef.current) return
      const conv = useChatStore.getState().currentConversation
      if (conv?.is_draft && conv.id === id) {
        deleteConversation(conv.id).catch(() => {})
      }
    }
  }, [id, deleteConversation])

  // Once the conversation has messages, the draft was promoted — no cleanup needed
  useEffect(() => {
    if (messages.length > 0) hasSentRef.current = true
  }, [messages.length])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    if (!isUserScrollingRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, streamingText, isStreaming])

  const showModeSelector = Boolean(currentConversation?.is_draft)

  useEffect(() => {
    if (showModeSelector) {
      window.api.team.list().then(setTeams).catch(() => setTeams([]))
    }
  }, [showModeSelector])

  if (loading && !currentConversation) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    )
  }

  if (!currentConversation) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Conversation not found
      </div>
    )
  }

  const handleSelectMode = async (mode: 'solo' | 'team') => {
    setSelectedMode(mode)
    if (!id) return
    const teamId = mode === 'team' ? selectedTeamId : null
    await window.api.conversation.update(id, { team_id: teamId })
    updateCurrentConversation(id, { team_id: teamId })
  }

  const handleSelectAgent = async (agentId: string) => {
    setSelectedAgentId(agentId)
    if (agentId === 'default') {
      setActiveProfile(null)
    } else {
      setActiveProfile(agentId)
    }
  }

  const handleSelectTeam = async (teamId: string) => {
    setSelectedTeamId(teamId)
    if (!id) return
    await window.api.conversation.update(id, { team_id: teamId })
    updateCurrentConversation(id, { team_id: teamId })
  }

  const enabledProfiles = profiles.filter((p) => p.isEnabled)
  const selectedProvider = providers.find((p) => p.meta.id === overrideProvider)
  const selectedTeam = teams.find((t) => t.id === selectedTeamId)

  const ROLE_EMOJI: Record<string, string> = { planning: '🧠', implementation: '🔧', review: '🔍', ui: '🎨' }

  const collaborationOptions: Array<{ id: typeof collaborationMode; label: string; icon: typeof MessageSquare; desc: string }> = [
    { id: 'direct', label: 'Direct', icon: MessageSquare, desc: '单 Agent 或按显式 @ 调度' },
    { id: 'explore', label: 'Explore', icon: Search, desc: '只读发散，倾向并行' },
    { id: 'build', label: 'Build', icon: Hammer, desc: '实现任务，遵守 Team policy' },
    { id: 'review', label: 'Review', icon: ShieldCheck, desc: '审查优先，手动权限' }
  ]

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="thin-scrollbar flex-1 min-h-0 overflow-y-auto px-3 py-4"
      >
        <div className={`mx-auto w-full ${bothCollapsed ? 'max-w-3xl' : 'max-w-[50vw]'}`}>
          {showModeSelector && (
            <div className="space-y-4 pb-4">
              {/* Mode selector */}
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSelectMode('solo')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      selectedMode === 'solo'
                        ? 'border-blue-500/40 bg-blue-500/5'
                        : 'border-border hover:bg-accent/50'
                    }`}
                  >
                    <User size={14} className={selectedMode === 'solo' ? 'text-blue-400' : 'text-muted-foreground'} />
                    <span className={`text-xs font-medium ${selectedMode === 'solo' ? 'text-foreground' : 'text-muted-foreground'}`}>Solo Agent</span>
                  </button>
                  <button
                    onClick={() => handleSelectMode('team')}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      selectedMode === 'team'
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-border hover:bg-accent/50'
                    }`}
                  >
                    <Users size={14} className={selectedMode === 'team' ? 'text-amber-400' : 'text-muted-foreground'} />
                    <span className={`text-xs font-medium ${selectedMode === 'team' ? 'text-foreground' : 'text-muted-foreground'}`}>Team</span>
                  </button>
                </div>
              </div>

              {/* Agent picker — Solo mode */}
              {selectedMode === 'solo' && (
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Agent</label>
                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    <PickerItem
                      icon="🤖"
                      name="Default"
                      subtitle="使用当前会话配置"
                      selected={selectedAgentId === 'default'}
                      variant="agent"
                      onClick={() => handleSelectAgent('default')}
                    />
                    {enabledProfiles.map((profile) => {
                      const providerName = profile.preferredProvider
                        ? (providers.find((p) => p.meta.id === profile.preferredProvider)?.meta.name ?? profile.preferredProvider)
                        : 'Default'
                      return (
                        <PickerItem
                          key={profile.id}
                          icon={ROLE_EMOJI[profile.role] ?? '🤖'}
                          name={profile.name}
                          subtitle={providerName}
                          selected={selectedAgentId === profile.id}
                          variant="agent"
                          onClick={() => handleSelectAgent(profile.id)}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Team picker — Team mode */}
              {selectedMode === 'team' && (
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Team</label>
                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    {teams.map((t) => (
                      <PickerItem
                        key={t.id}
                        icon="👥"
                        name={t.name}
                        subtitle={`${t.members?.length ?? 0} members`}
                        selected={t.id === selectedTeamId}
                        variant="team"
                        onClick={() => handleSelectTeam(t.id)}
                      />
                    ))}
                  </div>

                  {selectedTeam && (
                    <div className="mt-3 p-3 rounded-lg bg-accent/20 border border-border">
                      <TeamTopology
                        name={selectedTeam.name}
                        members={(selectedTeam.members ?? []).map((m) => ({ profileId: m.profileId }))}
                        profiles={profiles}
                        policies={selectedTeam.policies}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Collaboration mode */}
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">协作模式</label>
                <div className="flex gap-1.5">
                  {collaborationOptions.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        onClick={() => setCollaborationMode(option.id)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors ${
                          collaborationMode === option.id
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border text-muted-foreground hover:bg-accent/50'
                        }`}
                      >
                        <Icon size={11} />
                        <span className="text-[11px] font-medium">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Runtime override */}
              {providers.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown size={10} className={`transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
                    Runtime 覆盖
                  </button>
                  {showAdvanced && (
                    <div className="mt-2 flex gap-2">
                      <select
                        value={overrideProvider}
                        onChange={(e) => { setOverrideProvider(e.target.value); setOverrideModel('') }}
                        className="text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                      >
                        <option value="">默认 Provider</option>
                        {providers.map((p) => (
                          <option key={p.meta.id} value={p.meta.id}>{p.meta.name}</option>
                        ))}
                      </select>
                      {selectedProvider && (
                        <select
                          value={overrideModel}
                          onChange={(e) => setOverrideModel(e.target.value)}
                          className="text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                        >
                          <option value="">默认 Model</option>
                          {selectedProvider.meta.models.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground text-center">
                选择配置后在下方输入消息即可开始
              </p>
            </div>
          )}
          <MessageList messages={messages} />
        </div>
      </div>

      {/* Task Graph — active tasks visualization */}
      <TaskGraph conversationId={id!} />

      {/* Session Changes — file changes summary */}
      <SessionChangesSummary conversationId={id!} />

      {/* Status bars */}
      <SubagentStatus />
      <UsageBar />

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className={`mx-auto w-full ${bothCollapsed ? 'max-w-3xl' : 'max-w-[50vw]'}`}>
          <ChatInput conversationId={id!} />
        </div>
      </div>
    </div>
  )
}

/* ─── SessionChangesSummary ─────────────────────────────── */

const CHANGES_STATUS_COLORS: Record<string, string> = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
}

function changesBasename(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function SessionChangesSummary({ conversationId }: { conversationId: string }) {
  const [expanded, setExpanded] = useState(false)
  const changes = useChangeStore((s) => s.changes[conversationId] ?? [])
  const loadChanges = useChangeStore((s) => s.loadChangesForConversation)

  useEffect(() => {
    loadChanges(conversationId)
  }, [conversationId, loadChanges])

  const aggregated = (() => {
    const seen = new Map<string, FileChange>()
    for (const c of changes) {
      if (!seen.has(c.path)) {
        seen.set(c.path, c)
      }
    }
    return Array.from(seen.values())
  })()

  if (aggregated.length === 0) return null

  const totalAddition = aggregated.reduce((sum, c) => sum + c.additions, 0)
  const totalDeletion = aggregated.reduce((sum, c) => sum + c.deletions, 0)

  return (
    <div className="shrink-0 border-t border-border bg-background">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-card transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={12} className="text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="text-muted-foreground" />
          )}
          <FileCode size={12} className="text-muted-foreground" />
          <span className="text-[11px] text-foreground">
            {aggregated.length} 文件变更
          </span>
        </div>
        <div className="flex gap-2 text-[11px]">
          {totalAddition > 0 && (
            <span className="text-green-400">+{totalAddition}</span>
          )}
          {totalDeletion > 0 && (
            <span className="text-red-400">-{totalDeletion}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border max-h-[120px] overflow-y-auto scrollbar-thin"
          style={{ maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' }}
        >
          {aggregated.map((change) => (
            <div
              key={change.id}
              className="flex items-center gap-2 px-3 py-1 hover:bg-card transition-colors"
            >
              <FileCode size={10} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground font-mono truncate flex-1">
                {changesBasename(change.path)}
              </span>
              <span className={`text-[9px] ${CHANGES_STATUS_COLORS[change.status] || 'text-muted-foreground'} shrink-0`}>
                {change.status}
              </span>
              <div className="flex gap-1 text-[9px] shrink-0">
                {change.additions > 0 && (
                  <span className="text-green-400">+{change.additions}</span>
                )}
                {change.deletions > 0 && (
                  <span className="text-red-400">-{change.deletions}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
