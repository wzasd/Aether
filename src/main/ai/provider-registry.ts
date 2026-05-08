import type { CLIProvider } from './provider'
import { ClaudeCLIProvider } from './providers/claude-cli'
import { CodexCLIProvider } from './providers/codex-cli'
import { GeminiCLIProvider } from './providers/gemini-cli'
import { KimiCLIProvider } from './providers/kimi-cli'
import { OpenCodeCLIProvider } from './providers/opencode-cli'
import { ACPProvider } from './acp/acp-provider'
import { ACP_BACKENDS } from './acp/acp-backends'

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
}

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()

  // ── Legacy providers (direct CLI spawn + per-CLI parsers) ─────────────────
  // Kept for backwards compatibility and as fallback when ACP bridge is unavailable.
  registry.register(new ClaudeCLIProvider())
  registry.register(new CodexCLIProvider())
  registry.register(new GeminiCLIProvider())   // Gemini has no ACP support — legacy only
  registry.register(new KimiCLIProvider())
  registry.register(new OpenCodeCLIProvider())

  // ── ACP providers (unified JSON-RPC/stdio protocol) ───────────────────────
  // One ACPProvider per backend config; all share the same transport logic.
  for (const backendConfig of ACP_BACKENDS) {
    if (backendConfig.enabled) {
      registry.register(new ACPProvider(backendConfig))
    }
  }

  return registry
}

export const providerRegistry = createDefaultRegistry()
