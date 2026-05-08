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

export type PresetProfileId = typeof PRESET_PROFILE_IDS[keyof typeof PRESET_PROFILE_IDS]

const PRESET_PROFILE_ID_SET = new Set<string>(Object.values(PRESET_PROFILE_IDS))

export function isPresetProfileId(id: string): id is PresetProfileId {
  return PRESET_PROFILE_ID_SET.has(id)
}
