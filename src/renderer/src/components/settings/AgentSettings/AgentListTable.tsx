import { Cpu, Pencil, Plus, Trash2 } from 'lucide-react'
import { isPresetProfileId } from '../../../../../utils/preset-profile-ids'
import type { AgentProfileConfig } from '../../../stores/agentProfileStore'
import type { ProviderInfo } from '../../../stores/providerStore'
import type { DaemonAgentStatus } from '../../../hooks/useDaemonStatus'
import { AgentStatusBadge } from './AgentStatusBadge'
import { ProviderLogo } from './ProviderLogo'

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

const providerNameMap = (providers: ProviderInfo[]) =>
  Object.fromEntries(providers.map((p) => [p.meta.id, p.meta.name]))

const providerVendorMap = (providers: ProviderInfo[]) =>
  Object.fromEntries(providers.map((p) => [p.meta.id, p.meta.vendor]))

interface AgentListTableProps {
  profiles: AgentProfileConfig[]
  providers: ProviderInfo[]
  daemonAgents: DaemonAgentStatus[]
  onSelect: (profileId: string) => void
  onToggle: (profileId: string, enabled: boolean) => void
  onDelete: (profileId: string) => void
  onNew: () => void
}

export function AgentListTable({
  profiles,
  providers,
  daemonAgents,
  onSelect,
  onToggle,
  onDelete,
  onNew,
}: AgentListTableProps) {
  const nameMap = providerNameMap(providers)
  const vendorMap = providerVendorMap(providers)

  const getDaemonStatus = (profileId: string): DaemonAgentStatus | undefined =>
    daemonAgents.find((a) => a.profileId === profileId)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground">Agents</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {profiles.length} agent{profiles.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded transition-colors"
        >
          <Plus size={11} /> New Agent
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Agent</th>
              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Role</th>
              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Provider</th>
              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Model</th>
              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Status</th>
              <th className="text-right px-3 py-2 text-muted-foreground font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No agents configured.
                </td>
              </tr>
            )}
            {profiles.map((profile) => {
              const providerName = nameMap[profile.preferredProvider ?? ''] ?? profile.preferredProvider ?? 'Default'
              const vendor = vendorMap[profile.preferredProvider ?? ''] ?? 'Default'
              const daemonStatus = getDaemonStatus(profile.id)
              const source = isPresetProfileId(profile.id) ? 'preset' : 'custom'

              return (
                <tr
                  key={profile.id}
                  className="border-b border-border/60 hover:bg-secondary/20 transition-colors cursor-pointer"
                  onClick={() => onSelect(profile.id)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Cpu size={13} className={profile.isEnabled ? 'text-emerald-400' : 'text-muted-foreground'} />
                      <div>
                        <div className="font-medium text-foreground">{profile.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {source === 'preset' ? 'Preset' : 'Custom'}
                          {profile.description && ` · ${profile.description}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {profile.role && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadgeClass(profile.role)}`}>
                        {profile.role}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <ProviderLogo vendor={vendor} />
                      <span className="text-muted-foreground">{providerName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-muted-foreground">{profile.model || '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    {daemonStatus ? (
                      <AgentStatusBadge
                        isActive={daemonStatus.isActive}
                        isProcessing={daemonStatus.isProcessing}
                        pendingCount={daemonStatus.pendingCount}
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggle(profile.id, !profile.isEnabled)
                        }}
                        title={profile.isEnabled ? 'Disable' : 'Enable'}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                          profile.isEnabled
                            ? 'border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/10'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {profile.isEnabled ? 'on' : 'off'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(profile.id)
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(profile.id)
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
