export interface MemoryCandidateInput {
  workspaceId: string
  conversationId: string
  messageId: string
  agentRole: string
  fullText: string
}

interface ExtractedCandidate {
  kind: string
  title: string
  content: string
  confidence: 'low' | 'medium'
}

const DECISION_PATTERNS = [
  /决定[：:]\s*(.+)/g,
  /选择[：:]\s*(.+)/g,
  /采用[：:]\s*(.+)/g,
  /决策[：:]\s*(.+)/g,
  /最终方案[：:]\s*(.+)/g,
  /decided?\s*(?:to\s)?[：:]\s*(.+)/gi,
  /chosen?\s*(?:to\s)?[：:]\s*(.+)/gi,
  /(?:应该|建议|推荐|优先)\s*[：:]\s*(.+)/g
]

const ANTIPATTERN_PATTERNS = [
  /注意[：:]\s*(.+)/g,
  /避免[：:]\s*(.+)/g,
  /不要[：:]\s*(.+)/g,
  /切勿[：:]\s*(.+)/g,
  /必须[：:]\s*(.+)/g,
  /警告[：:]\s*(.+)/g,
  /avoid\s*[：:]\s*(.+)/gi,
  /don['']?t\s*[：:]\s*(.+)/gi,
  /must\s+not\s*[：:]\s*(.+)/gi
]

const CONVENTION_PATTERNS = [
  /约定[：:]\s*(.+)/g,
  /规范[：:]\s*(.+)/g,
  /统一[：:]\s*(.+)/g,
  /惯例[：:]\s*(.+)/g,
  /convention\s*[：:]\s*(.+)/gi,
  /pattern\s*[：:]\s*(.+)/gi
]

const MAX_CONTENT_LENGTH = 1000
const MAX_TITLE_LENGTH = 80
const MAX_CANDIDATES = 10

function extractByPatterns(
  text: string,
  patterns: RegExp[],
  kind: string
): ExtractedCandidate[] {
  const results: ExtractedCandidate[] = []
  const seen = new Set<string>()

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const captured = match[1]?.trim()
      if (!captured || captured.length < 4) continue

      const normalized = captured.slice(0, MAX_CONTENT_LENGTH)
      const title = extractTitle(normalized)

      // Deduplicate by normalized start
      const key = title.slice(0, 30)
      if (seen.has(key)) continue
      seen.add(key)

      results.push({
        kind,
        title,
        content: normalized,
        confidence: 'low'
      })
    }
  }

  return results.slice(0, MAX_CANDIDATES)
}

function extractTitle(content: string): string {
  // Use first sentence or first line as title
  const firstLine = content.split(/[。\n]/)[0] ?? content
  return firstLine.trim().slice(0, MAX_TITLE_LENGTH)
}

export function extractCandidates(input: MemoryCandidateInput): ExtractedCandidate[] {
  if (!input.fullText || input.fullText.trim().length === 0) {
    return []
  }

  const decisions = extractByPatterns(input.fullText, DECISION_PATTERNS, 'decisions')
  const antipatterns = extractByPatterns(input.fullText, ANTIPATTERN_PATTERNS, 'antipatterns')
  const conventions = extractByPatterns(input.fullText, CONVENTION_PATTERNS, 'conventions')

  return [...decisions, ...antipatterns, ...conventions].slice(0, MAX_CANDIDATES)
}
