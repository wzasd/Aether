import { describe, test, expect } from 'vitest'
import { scanAgentOutput } from './agent-output-scanner'
import type { AgentProfile } from './a2a-types'

function makeProfile(id: string, name: string): AgentProfile {
  return {
    id,
    workspaceId: null,
    name,
    role: 'assistant',
    model: 'claude',
    description: null,
    systemPrompt: null,
    isEnabled: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0
  }
}

const PROFILES: AgentProfile[] = [
  makeProfile('claude', 'Claude'),
  makeProfile('codex', 'Codex'),
  makeProfile('opencode', 'OpenCode')
]

describe('scanAgentOutput', () => {
  test('returns empty array for empty text', () => {
    expect(scanAgentOutput('', 'claude', PROFILES)).toEqual([])
  })

  test('returns empty array for empty profiles', () => {
    expect(scanAgentOutput('@Codex: hello', 'claude', [])).toEqual([])
  })

  test('detects line-start @mention', () => {
    const result = scanAgentOutput('@Codex: review this', 'claude', PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      targetProfileId: 'codex',
      targetName: 'Codex',
      mentionText: '@Codex'
    })
  })

  test('ignores mid-line @mention', () => {
    const result = scanAgentOutput('You can ask @Codex to review', 'claude', PROFILES)
    expect(result).toEqual([])
  })

  test('ignores @mention inside code blocks', () => {
    const text = '```\n@Codex: review this\n```\n@OpenCode: fix UI'
    const result = scanAgentOutput(text, 'claude', PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].targetName).toBe('OpenCode')
  })

  test('filters self-mention', () => {
    const result = scanAgentOutput('@Claude: do something', 'claude', PROFILES)
    expect(result).toEqual([])
  })

  test('longest-match-first avoids prefix collision', () => {
    const profilesWithPrefix = [
      makeProfile('codex', 'Codex'),
      makeProfile('c', 'C')
    ]
    const result = scanAgentOutput('@Codex: review', 'claude', profilesWithPrefix)
    expect(result).toHaveLength(1)
    expect(result[0].targetName).toBe('Codex')
  })

  test('token boundary rejects ASCII continuation', () => {
    const result = scanAgentOutput('@Codex123: review', 'claude', PROFILES)
    expect(result).toEqual([])
  })

  test('token boundary allows CJK continuation', () => {
    const result = scanAgentOutput('@Codex请看', 'claude', PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].targetName).toBe('Codex')
  })

  test('token boundary allows punctuation after mention', () => {
    const result = scanAgentOutput('@Codex, please review', 'claude', PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].targetName).toBe('Codex')
  })

  test('max 2 targets per message', () => {
    const text = '@Codex: review\n@OpenCode: fix UI\n@Claude: do something'
    const result = scanAgentOutput(text, 'claude', PROFILES)
    expect(result).toHaveLength(2)
  })

  test('deduplicates same target on multiple lines', () => {
    const text = '@Codex: first\n@Codex: second'
    const result = scanAgentOutput(text, 'claude', PROFILES)
    expect(result).toHaveLength(1)
  })

  test('handles leading whitespace before @mention', () => {
    const result = scanAgentOutput('  @Codex: review', 'claude', PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].targetName).toBe('Codex')
  })

  test('is case-insensitive', () => {
    const result = scanAgentOutput('@codex: review', 'claude', PROFILES)
    expect(result).toHaveLength(1)
    expect(result[0].targetName).toBe('Codex')
  })

  test('returns lineContent with full trimmed line', () => {
    const result = scanAgentOutput('@Codex: review this code please', 'claude', PROFILES)
    expect(result[0].lineContent).toBe('@Codex: review this code please')
  })
})
