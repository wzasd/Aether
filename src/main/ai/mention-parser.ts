import type { ParsedMention } from './a2a-types'

// Matches @AgentName: <content>, @AgentName：<content>, or @AgentName <content>
// at start of string or after whitespace. The space-delimited form matches how
// chat mentions are naturally typed (`@Codex review this`) while keeping the
// colon form for multi-agent task lists.
// Stops at the next @mention or end of string (no `m` flag — `$` = end of string)
const MENTION_PATTERN = /(?:^|(?<=\s))@([\w-]+)(?::|：|\s+)\s*([\s\S]*?)(?=(?:\s)@[\w-]+(?::|：|\s+)|$)/g

export function stripMentionSegments(text: string): string {
  MENTION_PATTERN.lastIndex = 0
  return text.replace(MENTION_PATTERN, '').trim()
}

export function parseMentions(text: string, knownAgentNames: string[]): ParsedMention[] {
  if (!text || knownAgentNames.length === 0) return []

  const normalizedNames = knownAgentNames.map((n) => n.toLowerCase())
  const results: ParsedMention[] = []

  // Reset regex state
  MENTION_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const rawName = match[1]
    const taskContent = match[2].trim()

    if (!rawName || !taskContent) continue

    const idx = normalizedNames.indexOf(rawName.toLowerCase())
    if (idx === -1) continue

    results.push({
      agentName: knownAgentNames[idx],
      taskContent
    })
  }

  return results
}

export function hasMentions(text: string, knownAgentNames: string[]): boolean {
  return parseMentions(text, knownAgentNames).length > 0
}
