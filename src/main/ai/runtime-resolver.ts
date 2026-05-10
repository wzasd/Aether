import { providerRegistry } from './provider-registry'
import type { CLIProvider } from './provider'
import type { AgentProfile } from './a2a-types'
import type { PermissionMode } from './types'

export interface RuntimeBinding {
  providerId: string
  modelId: string
  permissionMode?: PermissionMode
}

export interface ResolvedRuntime {
  providerType: string
  model: string
  provider: CLIProvider
}

export interface RuntimeOverrides {
  providerType?: string
  model?: string
}

export function resolveRuntime(
  profile: AgentProfile | null,
  baseConfig: { providerType?: string; model?: string },
  overrides?: RuntimeOverrides
): ResolvedRuntime {
  const resolvedProvider = resolveProvider(profile, baseConfig, overrides)
  const resolvedModel = resolveModel(profile, baseConfig, resolvedProvider, overrides)

  return {
    providerType: resolvedProvider.meta.id,
    model: resolvedModel,
    provider: resolvedProvider
  }
}

function resolveProvider(
  profile: AgentProfile | null,
  baseConfig: { providerType?: string },
  overrides?: RuntimeOverrides
): CLIProvider {
  // Priority 1: Task-level override (highest)
  if (overrides?.providerType) {
    const provider = providerRegistry.get(overrides.providerType)
    if (provider) return provider
  }

  // Priority 2: Agent profile preferredProvider
  if (profile?.preferredProvider) {
    const provider = providerRegistry.get(profile.preferredProvider)
    if (provider) return provider
  }

  // Priority 3: Session/base config providerType
  if (baseConfig.providerType) {
    const provider = providerRegistry.get(baseConfig.providerType)
    if (provider) return provider
  }

  // Priority 4: System default
  const defaultProvider = providerRegistry.get('claude')
  if (defaultProvider) return defaultProvider

  // Fallback: any available provider
  const allProviders = providerRegistry.getAll()
  if (allProviders.length > 0) return allProviders[0]

  throw new Error('No provider available in registry')
}

function resolveModel(
  profile: AgentProfile | null,
  baseConfig: { model?: string },
  provider: CLIProvider,
  overrides?: RuntimeOverrides
): string {
  const availableModels = provider.meta.models.map((m) => m.id)

  // Priority 1: Task-level model override (highest)
  if (overrides?.model && availableModels.includes(overrides.model)) {
    return overrides.model
  }

  // Priority 2: Agent profile model
  if (profile?.model && availableModels.includes(profile.model)) {
    return profile.model
  }

  // Priority 3: Session/base config model
  if (baseConfig.model && availableModels.includes(baseConfig.model)) {
    return baseConfig.model
  }

  // Priority 4: Provider's first model as default
  const firstModel = provider.meta.models[0]?.id
  if (firstModel) return firstModel

  throw new Error(`Provider ${provider.meta.id} has no models defined`)
}
