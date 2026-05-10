import { useState, type ReactNode } from 'react'
import { Cpu, FileText, Plus, SlidersHorizontal } from 'lucide-react'
import type { ProviderInfo } from '../../../stores/providerStore'

const roleOptions = ['coder', 'planning', 'implementation', 'review', 'ui', 'assistant', 'qa', 'devops', 'security']

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

interface NewAgentFormProps {
  providers: ProviderInfo[]
  onCreate: (data: {
    name: string
    role?: string
    preferredProvider?: string
    model?: string
    description?: string
    capabilities?: string[]
    whenToUse?: string
    outputContract?: string
  }) => void
  onCancel: () => void
}

export function NewAgentForm({ providers, onCreate, onCancel }: NewAgentFormProps) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('coder')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [outputContract, setOutputContract] = useState('')

  const getModelsForProvider = (providerId: string) => {
    const p = providers.find((pr) => pr.meta.id === providerId)
    return p?.meta.models ?? []
  }

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate({
      name: trimmed,
      role: role || undefined,
      preferredProvider: provider || undefined,
      model: model.trim() || undefined,
      description: description.trim() || undefined,
      capabilities: capabilities.trim() ? capabilities.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      whenToUse: whenToUse.trim() || undefined,
      outputContract: outputContract.trim() || undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-foreground">New Agent</h2>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-secondary/30">
        <div className="p-4 border-b border-border">
          <SectionTitle
            icon={<Cpu size={13} />}
            title="Basic Information"
            description="High-frequency fields used for identity and runtime selection."
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <FieldLabel>Name</FieldLabel>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name"
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Role</FieldLabel>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
              >
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <FieldLabel>Provider</FieldLabel>
              <select
                value={provider}
                onChange={(e) => {
                  const value = e.target.value
                  setProvider(value)
                  setModel(getModelsForProvider(value)[0]?.id ?? '')
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
            </div>
            <div className="space-y-1 sm:col-span-2">
              <FieldLabel>Model</FieldLabel>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none"
              >
                <option value="">Default model</option>
                {getModelsForProvider(provider).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-border">
          <SectionTitle
            icon={<FileText size={13} />}
            title="Role Template"
            description="New custom profiles start without a stored prompt snapshot."
          />
        </div>

        <details className="p-4">
          <summary className="cursor-pointer list-none">
            <SectionTitle
              icon={<SlidersHorizontal size={13} />}
              title="Capability Configuration"
              description="Advanced routing fields; collapsed by default."
            />
          </summary>
          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              <FieldLabel>Capabilities</FieldLabel>
              <input
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
                placeholder="code-review, security-audit"
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>When to use</FieldLabel>
              <textarea
                value={whenToUse}
                onChange={(e) => setWhenToUse(e.target.value)}
                placeholder="When should this agent be invited?"
                rows={2}
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Output contract</FieldLabel>
              <textarea
                value={outputContract}
                onChange={(e) => setOutputContract(e.target.value)}
                placeholder="Expected response format"
                rows={2}
                className="w-full text-xs rounded border border-border bg-card px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none resize-none"
              />
            </div>
          </div>
        </details>

        <div className="flex gap-2 justify-end px-4 pb-4">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded border border-border hover:bg-secondary transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Plus size={11} /> Add Agent
          </button>
        </div>
      </div>
    </div>
  )
}
