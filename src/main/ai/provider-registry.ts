import type { CLIProvider, ModelInfo } from './provider'
import { ClaudeProvider } from './providers/claude-cli'
import { CodexProvider } from './providers/codex-cli'
import { CopilotProvider } from './providers/copilot-cli'
import { CursorProvider } from './providers/cursor-cli'
import { GeminiProvider } from './providers/gemini-cli'
import { KimiProvider } from './providers/kimi-cli'
import { OpenCodeProvider } from './providers/opencode-cli'

export class ProviderRegistry {
  private providers = new Map<string, CLIProvider>()

  register(provider: CLIProvider): void {
    this.providers.set(provider.meta.id, provider)
  }

  get(id: string): CLIProvider | undefined {
    return this.providers.get(id)
  }

  getAll(): CLIProvider[] {
    return Array.from(this.providers.values())
  }

  async detectAll(): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>()
    const entries = Array.from(this.providers.entries())
    const detections = await Promise.all(
      entries.map(async ([id, provider]) => {
        try {
          const version = await provider.detect()
          return { id, version }
        } catch {
          return { id, version: null }
        }
      })
    )
    for (const { id, version } of detections) {
      results.set(id, version)
    }
    return results
  }

  getAvailable(): CLIProvider[] {
    return this.getAll()
  }

  /** Refresh model lists for all (or specific) providers by querying their CLIs.
   *  Updates provider.meta.models in-place and returns a map of provider id → updated model list. */
  async refreshModels(providerIds?: string[]): Promise<Map<string, ModelInfo[]>> {
    const results = new Map<string, ModelInfo[]>()
    const targets = providerIds
      ? providerIds.map((id) => this.providers.get(id)).filter((p): p is CLIProvider => p !== undefined)
      : Array.from(this.providers.values())

    const entries = await Promise.all(
      targets.map(async (provider) => {
        try {
          if ('listModels' in provider && typeof provider.listModels === 'function') {
            console.log(`[registry] refreshing models for ${provider.meta.id}...`)
            const models = await provider.listModels()
            // Update in-place so subsequent provider:list calls see fresh models
            provider.meta.models = models
            console.log(`[registry] refreshed ${provider.meta.id}: ${models.length} models`)
            return { id: provider.meta.id, models }
          }
          console.log(`[registry] ${provider.meta.id} does not support listModels`)
          return { id: provider.meta.id, models: provider.meta.models }
        } catch (err) {
          console.error(`[registry] refresh failed for ${provider.meta.id}:`, (err as Error).message)
          return { id: provider.meta.id, models: provider.meta.models }
        }
      })
    )

    for (const { id, models } of entries) {
      results.set(id, models)
    }
    return results
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()

  registry.register(new ClaudeProvider())
  registry.register(new CodexProvider())
  registry.register(new CopilotProvider())
  registry.register(new CursorProvider())
  registry.register(new GeminiProvider())
  registry.register(new KimiProvider())
  registry.register(new OpenCodeProvider())

  return registry
}

export const providerRegistry = createDefaultRegistry()
