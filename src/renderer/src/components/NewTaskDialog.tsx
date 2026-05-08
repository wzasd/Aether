import { useState, useEffect } from 'react'
import { User, Users, ChevronDown, MessageSquare, Search, Hammer, ShieldCheck } from 'lucide-react'
import { useAgentProfileStore } from '../stores/agentProfileStore'
import { useChatStore } from '../stores/chatStore'
import { useProviderStore } from '../stores/providerStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { TeamTopology } from './workspace/TeamTopology'
import { PickerItem } from './PickerItem'

interface TeamConfig {
  id: string
  name: string
  description: string
  pipeline?: Array<{ profileId: string; role?: string }>
  members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>
  policies?: Record<string, unknown>
}

interface NewTaskDialogProps {
  open: boolean
  onSelect: (mode: 'solo' | 'team', teamId?: string, taskId?: string) => void
  onCancel: () => void
}

const STORAGE_KEY = 'bytro.last-new-task-mode'
const AGENT_STORAGE_KEY = 'bytro.last-new-task-agent'
const COLLAB_STORAGE_KEY = 'bytro.last-collaboration-mode'

type CollaborationMode = 'direct' | 'explore' | 'build' | 'review'

function loadLastMode(): 'solo' | 'team' {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'solo' || stored === 'team') return stored
  } catch { /* ignore */ }
  return 'solo'
}

function saveLastMode(mode: 'solo' | 'team'): void {
  try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* ignore */ }
}

function loadLastAgent(): string {
  try {
    const stored = localStorage.getItem(AGENT_STORAGE_KEY)
    if (stored) return stored
  } catch { /* ignore */ }
  return 'default'
}

function saveLastAgent(agentId: string): void {
  try { localStorage.setItem(AGENT_STORAGE_KEY, agentId) } catch { /* ignore */ }
}

function loadLastCollaborationMode(): CollaborationMode {
  try {
    const stored = localStorage.getItem(COLLAB_STORAGE_KEY)
    if (stored === 'direct' || stored === 'explore' || stored === 'build' || stored === 'review') return stored
  } catch { /* ignore */ }
  return 'direct'
}

function saveLastCollaborationMode(mode: CollaborationMode): void {
  try { localStorage.setItem(COLLAB_STORAGE_KEY, mode) } catch { /* ignore */ }
}

const ROLE_COLORS: Record<string, string> = {
  coder: 'bg-blue-500',
  planning: 'bg-amber-500',
  implementation: 'bg-emerald-500',
  review: 'bg-purple-500',
  ui: 'bg-pink-500',
  assistant: 'bg-slate-500'
}

const ROLE_EMOJI: Record<string, string> = {
  planning: '🧠',
  implementation: '🔧',
  review: '🔍',
  ui: '🎨'
}

function getAgentIcon(role: string, name: string): string {
  return ROLE_EMOJI[role] ?? '🤖'
}

export function NewTaskDialog({ open, onSelect, onCancel }: NewTaskDialogProps) {
  const [mode, setMode] = useState<'solo' | 'team'>(loadLastMode)
  const [teams, setTeams] = useState<TeamConfig[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('dev-team')
  const [selectedAgentId, setSelectedAgentId] = useState<string>(loadLastAgent)

  const { profiles, activeProfileId, loadProfiles, setActiveProfile } = useAgentProfileStore()
  const setPendingTaskOverrides = useChatStore((s) => s.setPendingTaskOverrides)
  const setPendingInitialMentions = useChatStore((s) => s.setPendingInitialMentions)
  const setPendingCollaborationMode = useChatStore((s) => s.setPendingCollaborationMode)
  const providers = useProviderStore((s) => s.providers)
  const loadProviders = useProviderStore((s) => s.loadProviders)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const [overrideProvider, setOverrideProvider] = useState('')
  const [overrideModel, setOverrideModel] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [initialMentions, setInitialMentions] = useState('')
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>(loadLastCollaborationMode)

  useEffect(() => {
    if (open) {
      setMode(loadLastMode())
      setCollaborationMode(loadLastCollaborationMode())
      setSelectedAgentId(activeProfileId ?? loadLastAgent())
      window.api.team.list().then(setTeams).catch(() => setTeams([]))
      loadProfiles().catch(() => {})
      loadProviders().catch(() => {})
    }
  }, [open, activeProfileId, loadProfiles, loadProviders])

  if (!open) return null

  const handleConfirm = async () => {
    saveLastMode(mode)
    saveLastCollaborationMode(collaborationMode)
    if (mode === 'solo') {
      saveLastAgent(selectedAgentId)
      setActiveProfile(selectedAgentId === 'default' ? null : selectedAgentId)
    }
    // Store task-level Runtime overrides for next sendMessage
    if (overrideProvider || overrideModel) {
      setPendingTaskOverrides({
        providerType: overrideProvider || undefined,
        model: overrideModel || undefined
      })
    } else {
      setPendingTaskOverrides(null)
    }
    // Store initial @mentions (AC #3)
    const trimmed = initialMentions.trim()
    setPendingInitialMentions(trimmed || null)
    setPendingCollaborationMode(collaborationMode)

    // 创建 Task 记录，关联到 conversation
    let taskId: string | undefined
    if (currentWorkspaceId) {
      try {
        const task = await window.api.task.create(currentWorkspaceId, {
          title: mode === 'team' ? 'Team Session' : 'New Task',
          mode: collaborationMode,
          providerOverride: overrideProvider || undefined,
          modelOverride: overrideModel || undefined
        })
        taskId = task.id
      } catch {
        // Task 创建失败不阻塞流程
      }
    }

    onSelect(mode, mode === 'team' ? selectedTeamId : undefined, taskId)
  }

  const enabledProfiles = profiles.filter((p) => p.isEnabled)
  const selectedProvider = providers.find((p) => p.meta.id === overrideProvider)
  const collaborationOptions: Array<{ id: CollaborationMode; label: string; icon: typeof MessageSquare; desc: string }> = [
    { id: 'direct', label: 'Direct', icon: MessageSquare, desc: '单 Agent 或按显式 @ 调度' },
    { id: 'explore', label: 'Explore', icon: Search, desc: '只读发散，倾向并行' },
    { id: 'build', label: 'Build', icon: Hammer, desc: '实现任务，遵守 Team policy' },
    { id: 'review', label: 'Review', icon: ShieldCheck, desc: '审查优先，手动权限' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-lg p-6 w-[440px] shadow-lg">
        <h2 className="text-base font-semibold text-foreground mb-4">新建任务</h2>

        {/* Mode selector */}
        <div className="space-y-2 mb-4">
          <button
            onClick={() => setMode('solo')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
              mode === 'solo'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent/50'
            }`}
          >
            <div className={`p-2 rounded-md ${mode === 'solo' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <User size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">Solo Agent</div>
              <div className="text-xs text-muted-foreground">选择一个 Agent 独立工作</div>
            </div>
          </button>

          {/* Agent selector — Solo mode only */}
          {mode === 'solo' && (
            <div className="pl-12 pr-3 pb-1">
              <div className="flex gap-2 overflow-x-auto pb-2">
                <PickerItem
                  icon="🤖"
                  name="Default"
                  subtitle="使用当前会话配置"
                  selected={selectedAgentId === 'default'}
                  variant="agent"
                  onClick={() => setSelectedAgentId('default')}
                />
                {enabledProfiles.map((profile) => {
                  const providerName = profile.preferredProvider
                    ? (providers.find((p) => p.meta.id === profile.preferredProvider)?.meta.name ?? profile.preferredProvider)
                    : 'Default Provider'
                  return (
                    <PickerItem
                      key={profile.id}
                      icon={getAgentIcon(profile.role, profile.name)}
                      name={profile.name}
                      subtitle={providerName}
                      selected={selectedAgentId === profile.id}
                      variant="agent"
                      onClick={() => setSelectedAgentId(profile.id)}
                    />
                  )
                })}
              </div>
            </div>
          )}

          <button
            onClick={() => setMode('team')}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
              mode === 'team'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-accent/50'
            }`}
          >
            <div className={`p-2 rounded-md ${mode === 'team' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              <Users size={20} />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">Dev Team</div>
              <div className="text-xs text-muted-foreground">Claude 架构 + Codex 审查 + OpenCode UI</div>
            </div>
          </button>
        </div>

        {/* Collaboration mode */}
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-2 block">协作模式</label>
          <div className="grid grid-cols-2 gap-2">
            {collaborationOptions.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.id}
                  onClick={() => setCollaborationMode(option.id)}
                  className={`text-left rounded-lg border p-2 transition-colors ${
                    collaborationMode === option.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Icon size={12} />
                    {option.label}
                  </div>
                  <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                    {option.desc}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Advanced — Runtime override */}
        {providers.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown size={12} className={`transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
              Runtime 覆盖（可选）
            </button>
            {showAdvanced && (
              <div className="mt-2 p-3 rounded-lg bg-accent/30 border border-border space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Provider</label>
                  <select
                    value={overrideProvider}
                    onChange={(e) => { setOverrideProvider(e.target.value); setOverrideModel('') }}
                    className="w-full text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                  >
                    <option value="">使用默认 Provider</option>
                    {providers.map((p) => (
                      <option key={p.meta.id} value={p.meta.id}>{p.meta.name}</option>
                    ))}
                  </select>
                </div>
                {selectedProvider && (
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Model</label>
                    <select
                      value={overrideModel}
                      onChange={(e) => setOverrideModel(e.target.value)}
                      className="w-full text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                    >
                      <option value="">使用默认 Model</option>
                      {selectedProvider.meta.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Team selector (shown when multiple teams available) */}
        {mode === 'team' && teams.length > 1 && (
          <div className="mb-3">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">选择团队</label>
            <div className="flex gap-2 overflow-x-auto">
              {teams.map((t) => (
                <PickerItem
                  key={t.id}
                  icon="👥"
                  name={t.name}
                  subtitle={`${t.members?.length ?? 0} members`}
                  selected={t.id === selectedTeamId}
                  variant="team"
                  onClick={() => setSelectedTeamId(t.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Team preview — topology */}
        {mode === 'team' && teams.length > 0 && (() => {
          const team = teams.find((t) => t.id === selectedTeamId)
          if (!team) return null
          return (
            <div className="mb-4 p-3 rounded-lg bg-accent/30 border border-border">
              <TeamTopology
                name={team.name}
                members={(team.members ?? []).map((m: { profileId: string }) => ({
                  profileId: m.profileId
                }))}
                profiles={profiles}
                policies={team.policies}
              />
              {/* Initial @mentions (AC #3) */}
              <div className="mt-3">
                <label className="text-[10px] text-muted-foreground block mb-1">
                  初始 @mention（可选，每行一个）
                </label>
                <textarea
                  value={initialMentions}
                  onChange={(e) => setInitialMentions(e.target.value)}
                  placeholder={`@Codex Reviewer: 请审查这次变更。\n@OpenCode UI: 请评估设置页的信息层级。`}
                  rows={3}
                  className="w-full text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground/50 resize-none"
                />
              </div>

              <p className="text-[10px] text-muted-foreground text-center mt-2">
                Agent 会根据任务上下文自主 @ 其他成员
              </p>
            </div>
          )
        })()}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs rounded-md border border-border hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            开始任务
          </button>
        </div>
      </div>
    </div>
  )
}
