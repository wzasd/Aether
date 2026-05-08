/**
 * AgentSettings — canonical Agent profile management panel.
 *
 * The UI separates frequently edited runtime metadata from prompt templates and
 * collaboration capabilities:
 * - Basic information is editable.
 * - Role templates are preview-only and show preset/custom source.
 * - Capability configuration is advanced and collapsed by default.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, Cpu, FileText, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { isPresetProfileId } from '../../../../../utils/preset-profile-ids'
import { useAgentProfileStore, type AgentProfileConfig } from '../../../stores/agentProfileStore'
import { useProviderStore } from '../../../stores/providerStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

const roleOptions = ['coder', 'planning', 'implementation', 'review', 'ui', 'assistant', 'qa', 'devops', 'security']

const roleBadgeClass = (role?: string) => {
  switch (role) {
    case 'planning':
      return 'bg-blue-600/15 text-blue-400 border-blue-600/30'
    case 'implementation':
    case 'coder':
      return 'bg-emerald-600/15 text-emerald-400 border-emerald-600/30'
    case 'review':
    case 'qa':
      return 'bg-amber-600/15 text-amber-400 border-amber-600/30'
    case 'ui':
      return 'bg-fuchsia-600/15 text-fuchsia-400 border-fuchsia-600/30'
    case 'assistant':
      return 'bg-violet-600/15 text-violet-400 border-violet-600/30'
    case 'devops':
      return 'bg-cyan-600/15 text-cyan-400 border-cyan-600/30'
    case 'security':
      return 'bg-red-600/15 text-red-400 border-red-600/30'
    default:
      return 'bg-accent/20 text-muted-foreground border-border/40'
  }
}

const parseCommaSeparatedTags = (value: string): string[] => value.split(',').map((s) => s.trim()).filter(Boolean)

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div>
        <div className="text-xs font-medium text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{children}</label>
}

function TemplateSourceBadge({ profile }: { profile?: AgentProfileConfig | null }) {
  const source = profile && isPresetProfileId(profile.id) ? 'preset' : 'custom'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
      source === 'preset'
        ? 'bg-sky-600/15 text-sky-400 border-sky-600/30'
        : 'bg-violet-600/15 text-violet-400 border-violet-600/30'
    }`}>
      {source}
    </span>
  )
}

function TemplatePreview({ profile, prompt }: { profile?: AgentProfileConfig | null; prompt: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TemplateSourceBadge profile={profile} />
        <span className="text-[11px] text-muted-foreground">
          {profile && isPresetProfileId(profile.id)
            ? 'Loaded from preset prompt template; edit profile metadata above.'
            : 'Custom profile metadata; prompt template preview is read-only here.'}
        </span>
      </div>
      <div className="max-h-28 overflow-auto rounded border border-border bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {prompt.trim() || 'No role template snapshot is stored for this profile.'}
      </div>
    </div>
  )
}

export function AgentSettings() {
  const profiles = useAgentProfileStore((s) => s.profiles)
  const loadProfiles = useAgentProfileStore((s) => s.loadProfiles)
  const createProfile = useAgentProfileStore((s) => s.createProfile)
  const updateProfile = useAgentProfileStore((s) => s.updateProfile)
  const deleteProfile = useAgentProfileStore((s) => s.deleteProfile)
  const providers = useProviderStore((s) => s.providers)
  const loadProviders = useProviderStore((s) => s.loadProviders)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const [editingOriginal, setEditingOriginal] = useState<AgentProfileConfig | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('coder')
  const [editProvider, setEditProvider] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCapabilities, setEditCapabilities] = useState('')
  const [editWhenToUse, setEditWhenToUse] = useState('')
  const [editOutputContract, setEditOutputContract] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('coder')
  const [newProvider, setNewProvider] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newCapabilities, setNewCapabilities] = useState('')
  const [newWhenToUse, setNewWhenToUse] = useState('')
  const [newOutputContract, setNewOutputContract] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  useEffect(() => {
    loadProfiles(currentWorkspaceId ?? undefined).catch(() => {})
    loadProviders().catch(() => {})
  }, [currentWorkspaceId, loadProfiles, loadProviders])

  const startEdit = (profile: AgentProfileConfig) => {
    setEditingOriginal(profile)
    setEditingId(profile.id)
    setEditName(profile.name)
    setEditRole(profile.role || 'coder')
    setEditProvider(profile.preferredProvider ?? '')
    setEditModel(profile.model ?? '')
    setEditDescription(profile.description ?? '')
    setEditCapabilities(profile.capabilities?.join(', ') ?? '')
    setEditWhenToUse(profile.whenToUse ?? '')
    setEditOutputContract(profile.outputContract ?? '')
  }

  const closeEdit = () => {
    setEditingId(null)
    setEditingOriginal(null)
  }

  const saveEdit = async () => {
    if (!editingId || !editingOriginal) return

    const textValue = (prev: string | null | undefined, current: string): string | null | undefined => {
      const value = current.trim()
      if (prev && !value) return null
      if (value) return value
      return undefined
    }

    const arrValue = (prev: string[] | null | undefined, current: string): string[] | null | undefined => {
      const value = current.trim()
      if (prev?.length && !value) return null
      if (value) return parseCommaSeparatedTags(value)
      return undefined
    }

    await updateProfile(editingId, {
      name: editName.trim() || undefined,
      role: editRole || undefined,
      preferredProvider: textValue(editingOriginal.preferredProvider, editProvider),
      model: textValue(editingOriginal.model, editModel),
      description: textValue(editingOriginal.description, editDescription),
      capabilities: arrValue(editingOriginal.capabilities, editCapabilities),
      whenToUse: textValue(editingOriginal.whenToUse, editWhenToUse),
      outputContract: textValue(editingOriginal.outputContract, editOutputContract),
    })
    closeEdit()
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return

    await createProfile({
      name,
      role: newRole || undefined,
      preferredProvider: newProvider || undefined,
      model: newModel.trim() || undefined,
      description: newDescription.trim() || undefined,
      capabilities: newCapabilities.trim() ? parseCommaSeparatedTags(newCapabilities) : undefined,
      whenToUse: newWhenToUse.trim() || undefined,
      outputContract: newOutputContract.trim() || undefined,
      workspaceId: currentWorkspaceId ?? undefined,
    })
    setNewName('')
    setNewRole('coder')
    setNewProvider('')
    setNewModel('')
    setNewDescription('')
    setNewCapabilities('')
    setNewWhenToUse('')
    setNewOutputContract('')
    setShowNewForm(false)
  }

  const providerNameMap: Record<string, string> = Object.fromEntries(providers.map((p) => [p.meta.id, p.meta.name]))

  const getModelsForProvider = (providerId: string) => {
    const provider = providers.find((p) => p.meta.id === providerId)
    return provider?.meta.models ?? []
  }

  const renderProviderSelect = (value: string, onChange: (value: string) => void) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
    >
      <option value="">Default CLI</option>
      {providers.map((provider) => (
        <option key={provider.meta.id} value={provider.meta.id}>
          {provider.meta.name}{!provider.installed ? ' (not installed)' : ''}
        </option>
      ))}
    </select>
  )

  const renderModelSelect = (providerId: string, value: string, onChange: (value: string) => void) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
    >
      <option value="">Default model</option>
      {getModelsForProvider(providerId).map((model) => (
        <option key={model.id} value={model.id}>{model.name}</option>
      ))}
    </select>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-foreground">Agents</h2>
          <p className="text-xs text-muted-foreground mt-1">Manage profile metadata, template visibility, and collaboration capabilities.</p>
        </div>
        <button
          onClick={() => setShowNewForm((value) => !value)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded transition-colors"
        >
          <Plus size={11} /> New Agent
        </button>
      </div>

      {showNewForm && (
        <div className="mb-4 border border-border rounded-lg bg-secondary/30">
          <div className="p-3 border-b border-border">
            <SectionTitle
              icon={<Cpu size={13} />}
              title="Basic information"
              description="High-frequency fields used for identity and runtime selection."
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <FieldLabel>Name</FieldLabel>
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Agent name"
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Role</FieldLabel>
                <select
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value)}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                >
                  {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel>Provider</FieldLabel>
                {renderProviderSelect(newProvider, (value) => {
                  setNewProvider(value)
                  setNewModel(getModelsForProvider(value)[0]?.id ?? '')
                })}
              </div>
              <div className="space-y-1 sm:col-span-2">
                <FieldLabel>Model</FieldLabel>
                {renderModelSelect(newProvider, newModel, setNewModel)}
              </div>
              <div className="space-y-1 sm:col-span-2">
                <FieldLabel>Description</FieldLabel>
                <input
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder="Description (optional)"
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="p-3 border-b border-border">
            <SectionTitle
              icon={<FileText size={13} />}
              title="Role template"
              description="Read-only preview and source marker."
            />
            <div className="mt-3">
              <TemplatePreview profile={null} prompt="New custom profiles start without a stored prompt snapshot. Runtime behavior is driven by the selected metadata and orchestration context." />
            </div>
          </div>

          <details className="p-3">
            <summary className="cursor-pointer list-none">
              <SectionTitle
                icon={<SlidersHorizontal size={13} />}
                title="Capability configuration"
                description="Advanced routing fields; collapsed by default."
              />
            </summary>
            <div className="mt-3 space-y-2">
              <div className="space-y-1">
                <FieldLabel>Capabilities</FieldLabel>
                <input
                  value={newCapabilities}
                  onChange={(event) => setNewCapabilities(event.target.value)}
                  placeholder="code-review, security-audit"
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>When to use</FieldLabel>
                <textarea
                  value={newWhenToUse}
                  onChange={(event) => setNewWhenToUse(event.target.value)}
                  placeholder="When should this agent be invited?"
                  rows={2}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Output contract</FieldLabel>
                <textarea
                  value={newOutputContract}
                  onChange={(event) => setNewOutputContract(event.target.value)}
                  placeholder="Expected response format"
                  rows={2}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                />
              </div>
            </div>
          </details>

          <div className="flex gap-2 justify-end px-3 pb-3">
            <button onClick={() => setShowNewForm(false)} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim()} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">Add</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {profiles.length === 0 && (
          <p className="text-xs text-muted-foreground">No agents configured.</p>
        )}

        {profiles.map((profile) => {
          const providerName = providerNameMap[profile.preferredProvider ?? ''] ?? profile.preferredProvider ?? 'Default'
          const promptPreview = editingId === profile.id && editingOriginal
            ? editingOriginal.systemPrompt ?? ''
            : profile.systemPrompt ?? ''

          return (
            <div key={profile.id} className="border rounded-lg transition-colors border-border bg-secondary/30">
              {editingId === profile.id ? (
                <div>
                  <div className="p-3 border-b border-border">
                    <SectionTitle
                      icon={<Cpu size={13} />}
                      title="Basic information"
                      description="Editable profile identity and runtime defaults."
                    />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <FieldLabel>Name</FieldLabel>
                        <input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                          placeholder="Name"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Role</FieldLabel>
                        <select
                          value={editRole}
                          onChange={(event) => setEditRole(event.target.value)}
                          className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                        >
                          {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Provider</FieldLabel>
                        {renderProviderSelect(editProvider, (value) => {
                          setEditProvider(value)
                          setEditModel(getModelsForProvider(value)[0]?.id ?? '')
                        })}
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <FieldLabel>Model</FieldLabel>
                        {renderModelSelect(editProvider, editModel, setEditModel)}
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <FieldLabel>Description</FieldLabel>
                        <input
                          value={editDescription}
                          onChange={(event) => setEditDescription(event.target.value)}
                          placeholder="Description (optional)"
                          className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 border-b border-border">
                    <SectionTitle
                      icon={<FileText size={13} />}
                      title="Role template"
                      description="Preview-only prompt source, separated from editable profile fields."
                    />
                    <div className="mt-3">
                      <TemplatePreview profile={editingOriginal} prompt={promptPreview} />
                    </div>
                  </div>

                  <details className="p-3">
                    <summary className="cursor-pointer list-none">
                      <SectionTitle
                        icon={<SlidersHorizontal size={13} />}
                        title="Capability configuration"
                        description="Routing, invocation timing, and response contract."
                      />
                    </summary>
                    <div className="mt-3 space-y-2">
                      <div className="space-y-1">
                        <FieldLabel>Capabilities</FieldLabel>
                        <input
                          value={editCapabilities}
                          onChange={(event) => setEditCapabilities(event.target.value)}
                          placeholder="Capabilities (comma-separated)"
                          className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>When to use</FieldLabel>
                        <textarea
                          value={editWhenToUse}
                          onChange={(event) => setEditWhenToUse(event.target.value)}
                          placeholder="When to use this agent (optional)"
                          rows={2}
                          className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <FieldLabel>Output contract</FieldLabel>
                        <textarea
                          value={editOutputContract}
                          onChange={(event) => setEditOutputContract(event.target.value)}
                          placeholder="Expected output format (optional)"
                          rows={2}
                          className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                        />
                      </div>
                    </div>
                  </details>

                  <div className="flex gap-2 justify-end px-3 pb-3">
                    <button onClick={closeEdit} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary transition-colors">Cancel</button>
                    <button onClick={saveEdit} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start gap-3 p-3 border-b border-border">
                    <Cpu size={14} className={`mt-0.5 shrink-0 ${profile.isEnabled ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-foreground font-medium">{profile.name}</span>
                        {profile.role && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadgeClass(profile.role)}`}>
                            {profile.role}
                          </span>
                        )}
                        {profile.isEnabled && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                            <CheckCircle2 size={10} /> active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        CLI: <span className="text-foreground">{providerName}</span>
                        {profile.model ? <span className="ml-2 font-mono">{profile.model}</span> : null}
                      </div>
                      {profile.description && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{profile.description}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateProfile(profile.id, { isEnabled: !profile.isEnabled })}
                        title={profile.isEnabled ? 'Disable' : 'Enable'}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${profile.isEnabled ? 'border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
                      >
                        {profile.isEnabled ? 'on' : 'off'}
                      </button>
                      <button onClick={() => startEdit(profile)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                        <Pencil size={11} />
                      </button>
                      {deleteConfirmId === profile.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => { deleteProfile(profile.id); setDeleteConfirmId(null) }} className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-500 transition-colors">Delete</button>
                          <button onClick={() => setDeleteConfirmId(null)} className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-secondary transition-colors">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(profile.id)} className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors">
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-2 border-b border-border">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={12} className="text-muted-foreground shrink-0" />
                        <span className="text-[11px] text-muted-foreground truncate">
                          Role template
                        </span>
                      </div>
                      <TemplateSourceBadge profile={profile} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                      {profile.systemPrompt?.trim() || 'No stored prompt snapshot. Runtime context will compose the final prompt.'}
                    </div>
                  </div>

                  <details className="px-3 py-2">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal size={12} className="text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground">Capability configuration</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{profile.capabilities?.length ?? 0} tags</span>
                    </summary>
                    <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
                      {profile.capabilities && profile.capabilities.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {profile.capabilities.map((capability) => (
                            <span key={capability} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                              {capability}
                            </span>
                          ))}
                        </div>
                      )}
                      {profile.whenToUse && <div><span className="text-foreground">When:</span> {profile.whenToUse}</div>}
                      {profile.outputContract && <div><span className="text-foreground">Output:</span> {profile.outputContract}</div>}
                      {!profile.capabilities?.length && !profile.whenToUse && !profile.outputContract && (
                        <div>No capability routing configured.</div>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
