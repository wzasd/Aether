// Agent prompt templates — canonical source for system prompts.
// Each agent role has a dedicated .ts file exporting a const string.
// This mirrors Slock's platform-level prompt templates: prompts are
// stored independently from seed data, loaded by agent-runtime at startup.
//
// Adding a new agent role:
//   1. Create src/main/ai/prompts/agent-roles/<role>.ts
//   2. Export a const with the prompt string
//   3. Add an entry to PROMPT_REGISTRY below

import { CLAUDE_SYSTEM_PROMPT } from "./claude"
import { CODEX_SYSTEM_PROMPT } from "./codex"
import { OPENCODE_SYSTEM_PROMPT } from "./opencode"
import { PLANNER_SYSTEM_PROMPT } from "./planner"
import { ARCHITECT_SYSTEM_PROMPT } from "./architect"

/** Maps preset profile IDs to their canonical system prompt. */
export const PROMPT_REGISTRY: Record<string, string> = {
  "claude-primary": CLAUDE_SYSTEM_PROMPT,
  "codex-reviewer": CODEX_SYSTEM_PROMPT,
  "opencode-ui": OPENCODE_SYSTEM_PROMPT,
  planner: PLANNER_SYSTEM_PROMPT,
  architect: ARCHITECT_SYSTEM_PROMPT,
}

/** Get the system prompt for a preset agent profile. Returns undefined for non-preset profiles. */
export function getPresetPrompt(profileId: string): string | undefined {
  return PROMPT_REGISTRY[profileId]
}

// Re-export individual prompts for direct use
export {
  CLAUDE_SYSTEM_PROMPT,
  CODEX_SYSTEM_PROMPT,
  OPENCODE_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  ARCHITECT_SYSTEM_PROMPT,
}
