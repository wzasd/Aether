/**
 * init-agent-memory — proactively initialize MEMORY.md for all enabled agents.
 *
 * Called during Daemon.start() to ensure every agent has a MEMORY.md file
 * before any conversation starts. This avoids lazy initialization during
 * the first AgentRuntime.start() call, which could cause a race condition
 * if multiple agents start concurrently.
 *
 * Aligned with Slock: MEMORY.md is the agent's persistent knowledge index,
 * created at workspace initialization time.
 */

import { agentMemory } from './agent-memory'
import type { AgentProfile } from '../ai/a2a-types'

/**
 * Initialize MEMORY.md for all enabled agent profiles.
 * Safe to call multiple times — skips profiles that already have MEMORY.md.
 *
 * @param profiles - All agent profiles (only enabled ones are initialized)
 * @returns Number of profiles initialized (newly created)
 */
export async function initAgentMemory(profiles: AgentProfile[]): Promise<number> {
  let initialized = 0

  for (const profile of profiles) {
    if (!profile.isEnabled) continue
    if (profile.id === 'default') continue // Skip default profile

    try {
      const existing = await agentMemory.load(profile.id)
      if (existing === null) {
        await agentMemory.initialize(profile.id, {
          name: profile.name,
          role: profile.role,
        })
        initialized++
      }
    } catch (err) {
      console.warn(
        `[init-agent-memory] failed for ${profile.name} (${profile.id}):`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  if (initialized > 0) {
    console.info(`[init-agent-memory] initialized ${initialized} agent memory files`)
  } else {
    console.debug('[init-agent-memory] all agent memory files already exist')
  }

  return initialized
}
