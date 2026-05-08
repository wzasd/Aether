import type { Intent, ParsedMention } from './a2a-types'
import { parseMentions } from './mention-parser'

// Special names that don't resolve to individual agents
const ALL_NAMES = new Set(['all'])

export interface ParseIntentOptions {
  // Known agent names for mention resolution
  knownAgentNames: string[]
  // Known capability tags (e.g. 'review', 'ui', 'code-review')
  knownCapabilities: string[]
}

export interface ParsedIntent {
  intent: Intent
  // The raw mention target, if applicable (for routing-planner to resolve)
  rawTarget?: string
}

// Exported for testing
export function classifyTarget(
  rawName: string,
  knownAgentNames: string[],
  knownCapabilities: string[]
): Intent['type'] {
  const lower = rawName.toLowerCase()
  if (ALL_NAMES.has(lower)) return 'all'
  if (knownAgentNames.some((n) => n.toLowerCase() === lower)) return 'mention'
  if (knownCapabilities.some((c) => c.toLowerCase() === lower)) return 'capability_route'
  return 'mention' // fallback — routing-planner will handle the miss
}

export function parseIntents(
  text: string,
  opts: ParseIntentOptions
): ParsedIntent[] {
  if (!text.trim()) return [{ intent: { type: 'user_message' } }]

  const allKnownNames = [...opts.knownAgentNames, ...opts.knownCapabilities, 'All']
  const mentions: ParsedMention[] = parseMentions(text, allKnownNames)

  if (mentions.length === 0) return [{ intent: { type: 'user_message' } }]

  return mentions.map((m) => {
    const type = classifyTarget(m.agentName, opts.knownAgentNames, opts.knownCapabilities)

    switch (type) {
      case 'all':
        return { intent: { type: 'all', task: m.taskContent }, rawTarget: m.agentName }

      case 'capability_route':
        return {
          intent: { type: 'capability_route', capability: m.agentName.toLowerCase(), task: m.taskContent },
          rawTarget: m.agentName
        }

      default:
        return {
          intent: { type: 'mention', target: m.agentName, task: m.taskContent },
          rawTarget: m.agentName
        }
    }
  })
}

