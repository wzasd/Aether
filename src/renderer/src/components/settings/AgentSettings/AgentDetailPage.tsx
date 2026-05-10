import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Save,
  Trash2,
  BookOpen,
  Wrench,
  Variable,
  Terminal,
  Activity,
  Plus,
  X,
} from 'lucide-react'
import { isPresetProfileId } from '../../../../../utils/preset-profile-ids'
import type { AgentProfileConfig } from '../../../stores/agentProfileStore'
import type { ProviderInfo } from '../../../stores/providerStore'
import type { DaemonAgentStatus } from '../../../hooks/useDaemonStatus'
import { AgentStatusBadge } from './AgentStatusBadge'
import { ProviderLogo } from './ProviderLogo'
import { InstructionsTab } from './tabs/InstructionsTab'
import { EnvTab } from './tabs/EnvTab'
import { CustomArgsTab } from './tabs/CustomArgsTab'

const roleBadgeClass = (role?: string) => {
  switch (role) {
    case 'planning': return 'bg-blue-600/15 text-blue-400 border-blue-600/30'
    case 'implementation':
    case 'coder': return 'bg-emerald-600/15 text-emerald-400 border-emerald-600/30'
    case 'review':
    case 'qa': return 'bg-amber-600/15 text-amber-400 border-amber-600/30'
    case 'ui': return 'bg-fuchsia-600/15 text-fuchsia-400 border-fuchsia-600/30'
    case 'assistant': return 'bg-violet-600/15 text-violet-400 border-violet-600/30'
    case 'devops': return 'bg-cyan-600/15 text-cyan-400 border-cyan-600/30'
    case 'security': return 'bg-red-600/15 text-red-400 border-red-600/30'
    default: return 'bg-accent/20 text-muted-foreground border-border/40'
  }
}

type OverviewTab = 'activity' | 'instructions' | 'skills' | 'env' | 'custom-args'

const TAB_CONFIG: { key: OverviewTab; label: string; icon: typeof BookOpen }[] = [
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'instructions', label: 'Instructions', icon: BookOpen },
  { key: 'skills', label: 'Skills', icon: Wrench },
  { key: 'env', label: 'Env', icon: Variable },
  { key: 'custom-args', label: 'Custom Args', icon: Terminal },
]

interface AgentDetailPageProps {
  profile: AgentProfileConfig
  providers: ProviderInfo[]
  daemonStatus?: DaemonAgentStatus
  onBack: () => void
  onSave: (profileId: string, updates: Partial<AgentProfileConfig>) => void
  onDelete: (profileId: string) => void
  onToggle: (profileId: string, enabled: boolean) => void
}

export function AgentDetailPage({
  profile,
  providers,
  daemonStatus,
  onBack,
  onSave,
  onDelete,
  onToggle,
}: AgentDetailPageProps) {
  const [editProvider, setEditProvider] = useState(profile.preferredProvider ?? '')
  const [editModel, setEditModel] = useState(profile.model ?? '')
  const [editCapabilities, setEditCapabilities] = useState<string[]>(profile.capabilities ?? [])
  const [editWhenToUse, setEditWhenToUse] = useState(profile.whenToUse ?? '')
  const [editOutputContract, setEditOutputContract] = useState(profile.outputContract ?? '')
  const [newSkillInput, setNewSkillInput] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [activeTab, setActiveTab] = useState<OverviewTab>('activity')

  const [agentUsage, setAgentUsage] = useState<{
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    calls: number
  } | null>(null)
  const [agentActivity, setAgentActivity] = useState<{
    recentConversations: Array<{
      id: string
      title: string | null
      status: string
      model: string | null
      provider: string | null
      created_at: number
      updated_at: number
    }>
    taskSummary: Array<{ status: string; count: number }>
    recentTasks: Array<{
      id: string
      title: string
      status: string
      completed_at: number | null
      created_at: number
      agent_status: string
    }>
  } | null>(null)

  useEffect(() => {
    setEditProvider(profile.preferredProvider ?? '')
    setEditModel(profile.model ?? '')
    setEditCapabilities(profile.capabilities ?? [])
    setEditWhenToUse(profile.whenToUse ?? '')
    setEditOutputContract(profile.outputContract ?? '')
    setHasChanges(false)
    setShowDeleteConfirm(false)
  }, [profile.id])

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const rows = await window.api.usage.byAgent(7)
        const row = rows.find((r) => r.agent_profile_id === profile.id)
        if (row) {
          setAgentUsage({
            inputTokens: row.total_input_tokens,
            outputTokens: row.total_output_tokens,
            totalTokens: row.total_input_tokens + row.total_output_tokens,
            costUsd: row.total_cost_usd,
            calls: row.total_calls,
          })
        } else {
          setAgentUsage(null)
        }
      } catch {
        setAgentUsage(null)
      }
    }
    fetchUsage()
  }, [profile.id])

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const data = await window.api.daemon.getAgentActivity(profile.id, 10)
        setAgentActivity(data)
      } catch {
        setAgentActivity(null)
      }
    }
    fetchActivity()
  }, [profile.id])

  const getModelsForProvider = (providerId: string) => {
    const provider = providers.find((p) => p.meta.id === providerId)
    return provider?.meta.models ?? []
  }

  const vendor = providers.find((p) => p.meta.id === editProvider)?.meta.vendor ?? 'Default'
  const source = isPresetProfileId(profile.id) ? 'preset' : 'custom'

  const handleSave = () => {
    onSave(profile.id, {
      preferredProvider: editProvider || null,
      model: editModel.trim() || null,
      capabilities: editCapabilities.length > 0 ? editCapabilities : null,
      whenToUse: editWhenToUse.trim() || null,
      outputContract: editOutputContract.trim() || null,
    })
    setHasChanges(false)
  }

  const trackChange = () => setHasChanges(true)

  const handleAddSkill = () => {
    const skill = newSkillInput.trim()
    if (skill && !editCapabilities.includes(skill)) {
      setEditCapabilities([...editCapabilities, skill])
      setNewSkillInput('')
      trackChange()
    }
  }

  const handleRemoveSkill = (skill: string) => {
    setEditCapabilities(editCapabilities.filter((s) => s !== skill))
    trackChange()
  }

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return `${n}`
  }

  const formatCost = (n: number) => {
    if (n >= 1) return `$${n.toFixed(2)}`
    if (n >= 0.01) return `$${n.toFixed(3)}`
    return `$${n.toFixed(4)}`
  }

  const timeAgo = (ts: number) => {
    const mins = Math.floor((Date.now() - ts) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  const totalTasks = agentActivity?.taskSummary.reduce((sum, ts) => sum + ts.count, 0) ?? 0

  return (
    <div className="flex h-full">
      {/* ─── Left Inspector (320px) ─── */}
      <div className="w-80 shrink-0 border-r border-border overflow-y-auto p-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={13} /> Agents
          </button>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                onClick={handleSave}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Save size={11} /> Save
              </button>
            )}
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onDelete(profile.id)}
                  className="text-[10px] px-2 py-1 rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-[10px] px-2 py-1 rounded border border-border hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1.5 rounded text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Identity */}
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-lg font-semibold text-foreground mb-2">
            {profile.name.charAt(0).toUpperCase()}
          </div>
          <h2 className="text-sm font-semibold text-foreground">{profile.name}</h2>
          {profile.description && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{profile.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-2">
            {daemonStatus && (
              <AgentStatusBadge
                isActive={daemonStatus.isActive}
                isProcessing={daemonStatus.isProcessing}
                pendingCount={daemonStatus.pendingCount}
              />
            )}
            {profile.role && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadgeClass(profile.role)}`}>
                {profile.role}
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              source === 'preset'
                ? 'bg-sky-600/15 text-sky-400 border-sky-600/30'
                : 'bg-violet-600/15 text-violet-400 border-violet-600/30'
            }`}>
              {source}
            </span>
          </div>
        </div>

        {/* Properties */}
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Properties</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Runtime</span>
              <div className="flex items-center gap-1.5">
                <ProviderLogo vendor={vendor} />
                <select
                  value={editProvider}
                  onChange={(e) => {
                    const value = e.target.value
                    setEditProvider(value)
                    setEditModel(getModelsForProvider(value)[0]?.id ?? '')
                    trackChange()
                  }}
                  className="text-[11px] rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-foreground focus:outline-none"
                >
                  <option value="">Default CLI</option>
                  {providers.map((provider) => (
                    <option key={provider.meta.id} value={provider.meta.id}>
                      {provider.meta.name}{!provider.installed ? ' (not installed)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Model</span>
              <select
                value={editModel}
                onChange={(e) => { setEditModel(e.target.value); trackChange() }}
                className="text-[11px] rounded border border-border bg-secondary/30 px-1.5 py-0.5 text-foreground focus:outline-none"
              >
                <option value="">Default model</option>
                {getModelsForProvider(editProvider).map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Concurrency</span>
              <span className="text-[11px] text-foreground">{daemonStatus?.maxConcurrentTasks ?? 1}</span>
            </div>
          </div>
        </div>

        {/* Details */}
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Details</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Created</span>
              <span className="text-[11px] text-muted-foreground">{profile.createdAt ? timeAgo(profile.createdAt) : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Updated</span>
              <span className="text-[11px] text-muted-foreground">{profile.updatedAt ? timeAgo(profile.updatedAt) : '—'}</span>
            </div>
          </div>
        </div>

        {/* Skills — editable in Inspector */}
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Skills</h3>
          <div className="flex items-center gap-1.5 mb-2">
            <input
              value={newSkillInput}
              onChange={(e) => setNewSkillInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddSkill() }}
              placeholder="Add skill..."
              className="flex-1 text-[11px] rounded border border-border bg-secondary/30 px-2 py-1 text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              onClick={handleAddSkill}
              className="p-1 rounded border border-border hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <Plus size={11} />
            </button>
          </div>
          {editCapabilities.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {editCapabilities.map((cap) => (
                <span
                  key={cap}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] text-muted-foreground group"
                >
                  {cap}
                  <button
                    onClick={() => handleRemoveSkill(cap)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">No skills configured.</p>
          )}
        </div>
      </div>

      {/* ─── Right Overview (flex-1) ─── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border pb-0">
          {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* ─── Activity Tab ─── */}
        {activeTab === 'activity' && (
          <div className="space-y-5">
            {/* Now */}
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Now</h4>
              <div className="rounded-lg border border-border bg-card p-3">
                {daemonStatus?.isProcessing ? (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-foreground">Processing task</span>
                  </div>
                ) : daemonStatus?.pendingCount ? (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-xs text-foreground">{daemonStatus.pendingCount} pending</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                    <span className="text-xs text-muted-foreground">Idle</span>
                  </div>
                )}
              </div>
            </div>

            {/* Last 7d */}
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Last 7d</h4>
              {agentUsage ? (
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="grid grid-cols-5 gap-3">
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Input</div>
                      <div className="text-sm font-medium text-foreground">{formatTokens(agentUsage.inputTokens)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Output</div>
                      <div className="text-sm font-medium text-foreground">{formatTokens(agentUsage.outputTokens)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Total</div>
                      <div className="text-sm font-semibold text-foreground">{formatTokens(agentUsage.totalTokens)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Calls</div>
                      <div className="text-sm font-medium text-foreground">{agentUsage.calls}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Cost</div>
                      <div className="text-sm font-semibold text-emerald-400">{formatCost(agentUsage.costUsd)}</div>
                    </div>
                  </div>
                  {agentActivity && agentActivity.taskSummary.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground">{totalTasks} tasks</span>
                      {agentActivity.taskSummary.map((ts) => (
                        <span key={ts.status} className="text-[10px] text-muted-foreground">
                          {ts.status}: {ts.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] text-muted-foreground">No usage data yet.</p>
                </div>
              )}
            </div>

            {/* Recent work */}
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Recent work</h4>
              <div className="rounded-lg border border-border bg-card p-3">
                {agentActivity?.recentTasks && agentActivity.recentTasks.length > 0 ? (
                  <div className="space-y-2">
                    {agentActivity.recentTasks.slice(0, 5).map((task) => (
                      <div key={task.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-2">
                          <Activity size={11} className="text-muted-foreground shrink-0" />
                          <span className="text-[11px] text-foreground truncate max-w-[280px]">{task.title}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(task.completed_at ?? task.created_at)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {daemonStatus?.claimedTaskCount
                      ? `${daemonStatus.claimedTaskCount} task(s) claimed`
                      : 'No completed tasks yet.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Instructions Tab ─── */}
        {activeTab === 'instructions' && (
          <InstructionsTab
            profile={profile}
            onSave={async (patch) => {
              onSave(profile.id, patch)
            }}
          />
        )}

        {/* ─── Skills Tab — read-only, matching Multica ─── */}
        {activeTab === 'skills' && (
          <div className="space-y-3">
            {editCapabilities.length > 0 ? (
              <div className="space-y-1.5">
                {editCapabilities.map((cap) => (
                  <div key={cap} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                    <Wrench size={12} className="shrink-0 text-muted-foreground" />
                    <span className="text-xs text-foreground">{cap}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <Wrench size={20} className="mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-[11px] text-muted-foreground">No skills configured yet.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Add skills in the left inspector panel.</p>
              </div>
            )}
          </div>
        )}

        {/* ─── Env Tab ─── */}
        {activeTab === 'env' && (
          <EnvTab
            initialEnv={profile.customEnv ?? {}}
            onSave={async (env) => {
              onSave(profile.id, { customEnv: env })
            }}
          />
        )}

        {/* ─── Custom Args Tab ─── */}
        {activeTab === 'custom-args' && (
          <CustomArgsTab
            initialArgs={profile.customArgs ?? []}
            onSave={async (args) => {
              onSave(profile.id, { customArgs: args })
            }}
          />
        )}
      </div>
    </div>
  )
}
