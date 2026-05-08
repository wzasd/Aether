/**
 * AgentSettings — Agent profile management panel (extracted from WorkspaceArea.tsx)
 *
 * Provides CRUD operations for agent profiles, including:
 * - Create new agents with role/template selection
 * - Edit agent configuration (provider, model, capabilities, etc.)
 * - Enable/disable agents (controls participation in conversations)
 * - Delete agents
 *
 * This is the single canonical management interface for agents.
 * All other UI components (ChatInput, NewTaskDialog, etc.) should
 * read from agentProfileStore but not duplicate management logic.
 *
 * Extracted from WorkspaceArea.tsx during UI reorganization (Task #16).
 */
import { useState, useEffect } from 'react'
import { Plus, Cpu, Pencil, Trash2 } from 'lucide-react'
import { useAgentProfileStore, type AgentProfileConfig } from '../../../stores/agentProfileStore'
import { useProviderStore } from '../../../stores/providerStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

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
  const [editSystemPrompt, setEditSystemPrompt] = useState('')
  const [editCapabilities, setEditCapabilities] = useState('')
  const [editWhenToUse, setEditWhenToUse] = useState('')
  const [editOutputContract, setEditOutputContract] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('coder')
  const [newProvider, setNewProvider] = useState('')
  const [newModel, setNewModel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newSystemPrompt, setNewSystemPrompt] = useState('')
  const [newCapabilities, setNewCapabilities] = useState('')
  const [newWhenToUse, setNewWhenToUse] = useState('')
  const [newOutputContract, setNewOutputContract] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  useEffect(() => {
    loadProfiles(currentWorkspaceId ?? undefined).catch(() => {})
    loadProviders().catch(() => {})
  }, [currentWorkspaceId, loadProfiles, loadProviders])

  const startEdit = (p: AgentProfileConfig) => {
    setEditingOriginal(p)
    setEditingId(p.id)
    setEditName(p.name)
    setEditRole(p.role || 'coder')
    setEditProvider(p.preferredProvider ?? '')
    setEditModel(p.model ?? '')
    setEditDescription(p.description ?? '')
    setEditSystemPrompt(p.systemPrompt ?? '')
    setEditCapabilities(p.capabilities?.join(', ') ?? '')
    setEditWhenToUse(p.whenToUse ?? '')
    setEditOutputContract(p.outputContract ?? '')
  }

  const saveEdit = async () => {
    if (!editingId || !editingOriginal) return

    const textValue = (prev: string | null | undefined, current: string): string | null | undefined => {
      const v = current.trim()
      if (prev && !v) return null
      if (v) return v
      return undefined
    }

    const arrValue = (prev: string[] | null | undefined, current: string): string[] | null | undefined => {
      const v = current.trim()
      if (prev?.length && !v) return null
      if (v) return v.split(',').map((s) => s.trim()).filter(Boolean)
      return undefined
    }

    await updateProfile(editingId, {
      name: editName.trim() || undefined,
      role: editRole || undefined,
      preferredProvider: textValue(editingOriginal.preferredProvider, editProvider),
      model: textValue(editingOriginal.model, editModel),
      description: textValue(editingOriginal.description, editDescription),
      systemPrompt: textValue(editingOriginal.systemPrompt, editSystemPrompt),
      capabilities: arrValue(editingOriginal.capabilities, editCapabilities),
      whenToUse: textValue(editingOriginal.whenToUse, editWhenToUse),
      outputContract: textValue(editingOriginal.outputContract, editOutputContract),
    })
    setEditingId(null)
    setEditingOriginal(null)
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
      systemPrompt: newSystemPrompt.trim() || undefined,
      capabilities: newCapabilities.trim() ? newCapabilities.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      whenToUse: newWhenToUse.trim() || undefined,
      outputContract: newOutputContract.trim() || undefined,
      workspaceId: currentWorkspaceId ?? undefined,
    })
    setNewName('')
    setNewRole('coder')
    setNewProvider('')
    setNewModel('')
    setNewDescription('')
    setNewSystemPrompt('')
    setNewCapabilities('')
    setNewWhenToUse('')
    setNewOutputContract('')
    setShowNewForm(false)
  }

  const providerNameMap: Record<string, string> = Object.fromEntries(
    providers.map((p) => [p.meta.id, p.meta.name])
  )

  const getModelsForProvider = (providerId: string) => {
    const p = providers.find((pv) => pv.meta.id === providerId)
    return p?.meta.models ?? []
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-foreground">Agents</h2>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded transition-colors"
        >
          <Plus size={11} /> New Agent
        </button>
      </div>

      {showNewForm && (
        <div className="mb-4 p-3 bg-secondary/30 border border-border rounded-lg space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Agent name"
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
          >
            <option value="coder">coder</option>
            <option value="planning">planning</option>
            <option value="implementation">implementation</option>
            <option value="review">review</option>
            <option value="ui">ui</option>
            <option value="assistant">assistant</option>
          </select>
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <select
            value={newProvider}
            onChange={(e) => {
              setNewProvider(e.target.value)
              const firstModel = getModelsForProvider(e.target.value)[0]
              setNewModel(firstModel?.id ?? '')
            }}
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
          >
            <option value="">Default CLI</option>
            {providers.map((p) => (
              <option key={p.meta.id} value={p.meta.id}>
                {p.meta.name}{!p.installed ? ' (not installed)' : ''}
              </option>
            ))}
          </select>
          {getModelsForProvider(newProvider).length > 0 && (
            <select
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
            >
              <option value="">Default model</option>
              {getModelsForProvider(newProvider).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
          <textarea
            value={newSystemPrompt}
            onChange={(e) => setNewSystemPrompt(e.target.value)}
            placeholder="System prompt (optional)"
            rows={3}
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
          />
          <input
            value={newCapabilities}
            onChange={(e) => setNewCapabilities(e.target.value)}
            placeholder="Capabilities (comma-separated, e.g. code-review, security-audit)"
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <textarea
            value={newWhenToUse}
            onChange={(e) => setNewWhenToUse(e.target.value)}
            placeholder="When to use this agent (optional)"
            rows={2}
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
          />
          <textarea
            value={newOutputContract}
            onChange={(e) => setNewOutputContract(e.target.value)}
            placeholder="Expected output format (optional)"
            rows={2}
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNewForm(false)} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary transition-colors">Cancel</button>
            <button onClick={handleCreate} disabled={!newName.trim()} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">Add</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {profiles.length === 0 && (
          <p className="text-xs text-muted-foreground">No agents configured.</p>
        )}
        {profiles.map((p) => (
          <div key={p.id} className="border rounded-lg transition-colors border-border bg-secondary/30">
            {editingId === p.id ? (
              <div className="p-3 space-y-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                  placeholder="Name"
                />
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                >
                  <option value="coder">coder</option>
                  <option value="planning">planning</option>
                  <option value="implementation">implementation</option>
                  <option value="review">review</option>
                  <option value="ui">ui</option>
                  <option value="assistant">assistant</option>
                </select>
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <select
                  value={editProvider}
                  onChange={(e) => {
                    setEditProvider(e.target.value)
                    const firstModel = getModelsForProvider(e.target.value)[0]
                    setEditModel(firstModel?.id ?? '')
                  }}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                >
                  <option value="">Default CLI</option>
                  {providers.map((pv) => (
                    <option key={pv.meta.id} value={pv.meta.id}>
                      {pv.meta.name}{!pv.installed ? ' (not installed)' : ''}
                    </option>
                  ))}
                </select>
                <select
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
                >
                  <option value="">Default model</option>
                  {getModelsForProvider(editProvider).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <textarea
                  value={editSystemPrompt}
                  onChange={(e) => setEditSystemPrompt(e.target.value)}
                  placeholder="System prompt (optional)"
                  rows={3}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                />
                <input
                  value={editCapabilities}
                  onChange={(e) => setEditCapabilities(e.target.value)}
                  placeholder="Capabilities (comma-separated)"
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <textarea
                  value={editWhenToUse}
                  onChange={(e) => setEditWhenToUse(e.target.value)}
                  placeholder="When to use this agent (optional)"
                  rows={2}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                />
                <textarea
                  value={editOutputContract}
                  onChange={(e) => setEditOutputContract(e.target.value)}
                  placeholder="Expected output format (optional)"
                  rows={2}
                  className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 rounded border border-border hover:bg-secondary transition-colors">Cancel</button>
                  <button onClick={saveEdit} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">Save</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3">
                <Cpu size={14} className={`mt-0.5 shrink-0 ${p.isEnabled ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-foreground font-medium">{p.name}</span>
                    {p.role && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        p.role === 'planning' ? 'bg-blue-600/20 text-blue-400 border-blue-600/30' :
                        p.role === 'implementation' ? 'bg-green-600/20 text-green-400 border-green-600/30' :
                        p.role === 'review' ? 'bg-orange-600/20 text-orange-400 border-orange-600/30' :
                        p.role === 'ui' ? 'bg-purple-600/20 text-purple-400 border-purple-600/30' :
                        'bg-accent/20 text-muted-foreground border-border/30'
                      }`}>
                        {p.role}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    CLI: <span className="text-foreground">{providerNameMap[p.preferredProvider ?? ''] ?? p.preferredProvider ?? 'Default'}</span>
                    {p.model ? <span className="ml-2 font-mono">{p.model}</span> : null}
                  </div>
                  {p.description && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.description}</div>}
                  {p.capabilities && p.capabilities.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-1">
                      {p.capabilities.map((cap) => (
                        <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => updateProfile(p.id, { isEnabled: !p.isEnabled })}
                    title={p.isEnabled ? 'Disable' : 'Enable'}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${p.isEnabled ? 'border-emerald-600/40 text-emerald-400 hover:bg-emerald-600/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  >
                    {p.isEnabled ? 'on' : 'off'}
                  </button>
                  <button onClick={() => startEdit(p)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                    <Pencil size={11} />
                  </button>
                  {deleteConfirmId === p.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => { deleteProfile(p.id); setDeleteConfirmId(null) }} className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-500 transition-colors">Delete</button>
                      <button onClick={() => setDeleteConfirmId(null)} className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-secondary transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirmId(p.id)} className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
