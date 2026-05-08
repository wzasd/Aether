import type { AgentProfile } from './a2a-types'

export interface ScannedMention {
  targetProfileId: string
  targetName: string
  mentionText: string
  lineContent: string
}

/** Max A2A targets per single agent output */
const MAX_A2A_TARGETS = 2

const TOKEN_BOUNDARY_RE = /[\s,.:;!?()[\]{}<>，。！？、：；（）【】《》「」『』〈〉]/
const HANDLE_CONTINUATION_RE = /[a-z0-9_.-]/

interface MentionPattern {
  profileId: string
  name: string
  pattern: string
}

/**
 * Scan agent output text for line-start @mentions that should trigger A2A routing.
 *
 * Rules:
 * 1. Strip fenced code blocks (```...```) before scanning
 * 2. Only line-start mentions (after optional whitespace) are actionable
 * 3. Longest-match-first to avoid prefix collisions (@Codex before @C)
 * 4. Token boundary: reject if followed by ASCII continuation char
 * 5. Filter self-mentions (current agent @ itself)
 * 6. Max 2 targets per message (safety limit)
 */
export function scanAgentOutput(
  text: string,
  currentProfileId: string,
  availableProfiles: AgentProfile[]
): ScannedMention[] {
  if (!text || availableProfiles.length === 0) return []

  // 1. Strip fenced code blocks
  const stripped = text.replace(/```[\s\S]*?```/g, '')

  // Build patterns from available profiles
  const patterns: MentionPattern[] = []
  for (const profile of availableProfiles) {
    if (profile.id === currentProfileId) continue // 5. Filter self
    patterns.push({
      profileId: profile.id,
      name: profile.name,
      pattern: `@${profile.name}`.toLowerCase()
    })
  }

  // 3. Longest-match-first
  patterns.sort((a, b) => b.pattern.length - a.pattern.length)

  const found: ScannedMention[] = []
  const seen = new Set<string>()

  const lines = stripped.split(/\r?\n/)
  for (const rawLine of lines) {
    if (found.length >= MAX_A2A_TARGETS) break

    const trimmed = rawLine.trimStart()
    if (!trimmed.startsWith('@')) continue

    const normalized = trimmed.toLowerCase()

    for (const { profileId, name, pattern } of patterns) {
      if (!normalized.startsWith(pattern)) continue

      const charAfter = normalized[pattern.length]
      const isBoundary =
        !charAfter ||
        TOKEN_BOUNDARY_RE.test(charAfter) ||
        !HANDLE_CONTINUATION_RE.test(charAfter)

      if (!isBoundary) continue

      if (!seen.has(profileId)) {
        seen.add(profileId)
        found.push({
          targetProfileId: profileId,
          targetName: name,
          mentionText: trimmed.slice(0, pattern.length),
          lineContent: trimmed
        })
      }
      break // longest-match: lock one winner at current position
    }
  }

  return found
}
