/**
 * AgentSettings — two-layer agent profile management.
 *
 * Layer 1: AgentListTable — overview of all agents with daemon status.
 * Layer 2: AgentDetailPage — full edit form for a single agent.
 */
import { useState, useEffect } from 'react'
import { useAgentProfileStore, type AgentProfileConfig } from '../../../stores/agentProfileStore'
import { useProviderStore } from '../../../stores/providerStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useDaemonStatus } from '../../../hooks/useDaemonStatus'
import { AgentListTable } from './AgentListTable'
import { AgentDetailPage } from './AgentDetailPage'
import { NewAgentForm } from './NewAgentForm'

type ViewMode = 'list' | 'detail' | 'new'

interface AgentSettingsProps {
  initialProfileId?: string | null
}

export function AgentSettings({ initialProfileId }: AgentSettingsProps = {}) {
  const profiles = useAgentProfileStore((s) => s.profiles)
  const loadProfiles = useAgentProfileStore((s) => s.loadProfiles)
  const createProfile = useAgentProfileStore((s) => s.createProfile)
  const updateProfile = useAgentProfileStore((s) => s.updateProfile)
  const deleteProfile = useAgentProfileStore((s) => s.deleteProfile)
  const providers = useProviderStore((s) => s.providers)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const { status: daemonStatus } = useDaemonStatus(5000)

  const [view, setView] = useState<ViewMode>(initialProfileId ? 'detail' : 'list')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initialProfileId ?? null)

  useEffect(() => {
    if (initialProfileId) {
      setSelectedProfileId(initialProfileId)
      setView('detail')
    }
  }, [initialProfileId])

  const selectedProfile = selectedProfileId
    ? profiles.find((p) => p.id === selectedProfileId) ?? null
    : null

  const handleSelect = (profileId: string) => {
    setSelectedProfileId(profileId)
    setView('detail')
  }

  const handleBack = () => {
    setSelectedProfileId(null)
    setView('list')
  }

  const handleNew = () => {
    setView('new')
  }

  const handleCreate = async (data: {
    name: string
    role?: string
    preferredProvider?: string
    model?: string
    description?: string
    capabilities?: string[]
    whenToUse?: string
    outputContract?: string
  }) => {
    await createProfile({
      ...data,
      workspaceId: currentWorkspaceId ?? undefined,
    })
    setView('list')
  }

  const handleSave = async (profileId: string, updates: Partial<AgentProfileConfig>) => {
    await updateProfile(profileId, updates)
    // Stay on detail page after save
  }

  const handleToggle = async (profileId: string, enabled: boolean) => {
    await updateProfile(profileId, { isEnabled: enabled })
  }

  const handleDelete = async (profileId: string) => {
    await deleteProfile(profileId)
    setView('list')
    setSelectedProfileId(null)
  }

  if (view === 'detail' && selectedProfile) {
    return (
      <AgentDetailPage
        profile={selectedProfile}
        providers={providers}
        daemonStatus={daemonStatus?.agents.find((a) => a.profileId === selectedProfile.id)}
        onBack={handleBack}
        onSave={handleSave}
        onDelete={handleDelete}
        onToggle={handleToggle}
      />
    )
  }

  if (view === 'new') {
    return (
      <NewAgentForm
        providers={providers}
        onCreate={handleCreate}
        onCancel={handleBack}
      />
    )
  }

  return (
    <AgentListTable
      profiles={profiles}
      providers={providers}
      daemonAgents={daemonStatus?.agents ?? []}
      onSelect={handleSelect}
      onToggle={handleToggle}
      onDelete={handleDelete}
      onNew={handleNew}
    />
  )
}
