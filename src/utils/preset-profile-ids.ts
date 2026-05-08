export const PRESET_PROFILE_IDS = {
  CLAUDE_PRIMARY: 'claude-primary',
  CODEX_REVIEWER: 'codex-reviewer',
  OPENCODE_UI: 'opencode-ui',
  PLANNER: 'planner',
  ARCHITECT: 'architect',
  TESTER: 'tester',
  DEVOPS: 'devops',
  SECURITY_ENGINEER: 'security-engineer',
} as const

const PRESET_PROFILE_ID_SET = new Set<string>(Object.values(PRESET_PROFILE_IDS))

export function isPresetProfileId(id: string): boolean {
  return PRESET_PROFILE_ID_SET.has(id)
}
