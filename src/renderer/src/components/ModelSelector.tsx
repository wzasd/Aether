import { useEffect, useState } from 'react'
import { useSessionConfigStore } from '../stores/sessionConfigStore'
import { useProviderStore } from '../stores/providerStore'

interface DynamicModel {
  id: string
  name: string
  contextWindow: number
}

interface ModelSelectorProps {
  /** Active ACP session id. When present, models come from the running agent and switching calls SDK. */
  activeSessionId?: string
}

export function ModelSelector({ activeSessionId }: ModelSelectorProps) {
  const providerType = useSessionConfigStore((s) => s.providerType)
  const model = useSessionConfigStore((s) => s.model)
  const setModel = useSessionConfigStore((s) => s.setModel)
  const setProviderType = useSessionConfigStore((s) => s.setProviderType)
  const { providers, loadProviders } = useProviderStore()

  const [dynamicModels, setDynamicModels] = useState<DynamicModel[] | null>(null)

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // Fetch dynamic models when an active ACP session exists
  useEffect(() => {
    if (!activeSessionId) {
      setDynamicModels(null)
      return
    }

    let cancelled = false
    window.api.chat
      .getAvailableModels(activeSessionId)
      .then((models) => {
        if (!cancelled) setDynamicModels(models)
      })
      .catch(() => {
        if (!cancelled) setDynamicModels(null)
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  // Subscribe to live models_update events from the agent
  useEffect(() => {
    if (!activeSessionId) return
    const unsubscribe = window.api.chat.onEvent((event) => {
      if (event.type === 'models_update') {
        setDynamicModels(event.models)
      }
    })
    return unsubscribe
  }, [activeSessionId])

  const selectedProvider = providers.find((p) => p.meta.id === providerType)
  const staticModels = selectedProvider?.meta.models ?? []
  const models =
    activeSessionId && dynamicModels && dynamicModels.length > 0
      ? dynamicModels
      : staticModels

  // Reset model when switching provider — pick first available
  const handleProviderChange = (newProviderType: string): void => {
    setProviderType(newProviderType)
    const newProvider = providers.find((p) => p.meta.id === newProviderType)
    if (newProvider && newProvider.meta.models.length > 0) {
      setModel(newProvider.meta.models[0].id)
    }
  }

  const handleModelChange = (modelId: string): void => {
    setModel(modelId)
    if (activeSessionId) {
      window.api.chat.setModel(activeSessionId, modelId).catch(() => {
        /* best-effort — user already sees local change, will sync on next prompt */
      })
    }
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={providerType}
        onChange={(e) => handleProviderChange(e.target.value)}
        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer max-w-[100px] truncate"
        title={selectedProvider?.meta.name ?? providerType}
        disabled={Boolean(activeSessionId)}
      >
        {providers.map((p) => (
          <option key={p.meta.id} value={p.meta.id} disabled={!p.installed}>
            {p.meta.name}{p.installed ? '' : ' (not installed)'}
          </option>
        ))}
      </select>

      <select
        value={model}
        onChange={(e) => handleModelChange(e.target.value)}
        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer max-w-[160px] truncate"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.contextWindow >= 1000 ? `${Math.round(m.contextWindow / 1000)}K` : m.contextWindow})
          </option>
        ))}
      </select>
    </div>
  )
}
