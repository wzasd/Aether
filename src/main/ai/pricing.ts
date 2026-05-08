// Pricing table — USD per 1M tokens
// Source: official vendor pricing pages, snapshot 2026-05

const PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheCreation?: number }> = {
  'claude-opus-4-7':          { input: 15,    output: 75,    cacheRead: 1.5,   cacheCreation: 18.75 },
  'claude-sonnet-4-6':        { input: 3,     output: 15,    cacheRead: 0.3,    cacheCreation: 3.75 },
  'claude-haiku-4-5-20251001':{ input: 0.8,   output: 4,     cacheRead: 0.08,   cacheCreation: 1.0  },
  'codex-mini-latest':        { input: 1.5,   output: 6                                             },
  'o4-mini':                  { input: 1.1,   output: 4.4                                           },
  'o3':                       { input: 10,    output: 40                                            },
  'gemini-2.5-pro':           { input: 1.25,  output: 10                                            },
  'gemini-2.5-flash':         { input: 0.15,  output: 0.6                                           },
  'kimi-k2.5':                { input: 0.14,  output: 2.5                                           },
}

function lookupPricing(model: string): { input: number; output: number; cacheRead?: number; cacheCreation?: number } | null {
  if (PRICING[model]) return PRICING[model]
  // Longest prefix match for versioned model IDs (e.g. "claude-sonnet-4-6-20250501")
  let bestKey = ''
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key) && key.length > bestKey.length) bestKey = key
  }
  return bestKey ? PRICING[bestKey] : null
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheCreationTokens?: number,
): number {
  const pricing = lookupPricing(model)
  if (!pricing) return 0

  let cost = 0
  cost += (inputTokens * pricing.input) / 1_000_000
  cost += (outputTokens * pricing.output) / 1_000_000

  if (cacheReadTokens && pricing.cacheRead !== undefined) {
    cost += (cacheReadTokens * pricing.cacheRead) / 1_000_000
  }
  if (cacheCreationTokens && pricing.cacheCreation !== undefined) {
    cost += (cacheCreationTokens * pricing.cacheCreation) / 1_000_000
  }
  return cost
}
