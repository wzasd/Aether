/**
 * AgentMemory — per-agent persistent MEMORY.md file management.
 *
 * Phase B: Each agent maintains a private MEMORY.md (aligned with Slock's
 * agent workspace pattern). Memory accumulates across conversations using
 * rule-driven updates (zero LLM token cost).
 *
 * Storage: ~/.bytro/agent-memory/{profileId}/MEMORY.md
 * Safety:   profileId regex validation, Promise-write queue, file permissions
 */

import { readFile, writeFile, appendFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const VALID_PROFILE_ID = /^[a-zA-Z0-9_-]{1,64}$/

export interface MemoryEntry {
  topic: string
  conclusion: string
  category: 'decision' | 'preference' | 'context' | 'feedback'
  source: 'conversation_end' | 'user_remember' | 'agent_save'
  timestamp: number
}

function validateProfileId(profileId: string): void {
  if (!VALID_PROFILE_ID.test(profileId)) {
    throw new Error(`Invalid profileId: ${profileId}`)
  }
}

export class AgentMemory {
  private readonly basePath: string
  private writeQueue = new Map<string, Promise<void>>()

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(homedir(), '.bytro', 'agent-memory')
  }

  private getMemoryPath(profileId: string): string {
    validateProfileId(profileId)
    return join(this.basePath, profileId, 'MEMORY.md')
  }

  private getAgentDir(profileId: string): string {
    validateProfileId(profileId)
    return join(this.basePath, profileId)
  }

  /** Load MEMORY.md content. Returns null if not yet initialized. */
  async load(profileId: string): Promise<string | null> {
    validateProfileId(profileId)
    try {
      const content = await readFile(this.getMemoryPath(profileId), 'utf-8')
      console.info(`[AgentMemory] loaded ${profileId}: ${content.length} chars`)
      return content
    } catch {
      return null
    }
  }

  /** Create MEMORY.md from template if it doesn't exist. */
  async initialize(
    profileId: string,
    profile?: { name: string; role: string }
  ): Promise<void> {
    validateProfileId(profileId)
    const dir = this.getAgentDir(profileId)
    await mkdir(dir, { recursive: true, mode: 0o700 })

    const name = profile?.name ?? profileId
    const role = profile?.role ?? 'agent'
    const template = [
      `# @${name}`,
      '',
      '## Role',
      role,
      '',
      '## Key Knowledge',
      '',
      '## Active Context',
      '- Currently working on:',
      '- Last interaction:',
      '',
      '---',
      '',
      '**Compaction Safety**: Your context will be periodically compressed to stay within limits. When this happens, you lose in-conversation history but MEMORY.md is always re-read. After reading MEMORY.md, you should understand who you are, what you know, and what you were working on. Before a long task, write a brief "Active Context" note here. After completing work, update Key Knowledge and Active Context.',
      '',
    ].join('\n')

    await writeFile(this.getMemoryPath(profileId), template, { mode: 0o600 })
    console.info(`[AgentMemory] initialized ${profileId}`)
  }

  /** Append a memory entry. Writes are serialized per profileId. */
  async append(profileId: string, entry: MemoryEntry): Promise<void> {
    validateProfileId(profileId)
    const prev = this.writeQueue.get(profileId) ?? Promise.resolve()
    const next = prev
      .then(() => this.doAppend(profileId, entry))
      .catch((err) => {
        console.error(`[AgentMemory] append failed for ${profileId}:`, err)
      })
    this.writeQueue.set(profileId, next)
    return next
  }

  private async doAppend(profileId: string, entry: MemoryEntry): Promise<void> {
    // Ensure MEMORY.md exists
    try {
      await access(this.getMemoryPath(profileId))
    } catch {
      await this.initialize(profileId)
    }

    const dateStr = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19)
    const content = [
      '',
      `## ${dateStr}`,
      `- **Category**: ${entry.category}`,
      `- **Source**: ${entry.source}`,
      `- **Topic**: ${entry.topic}`,
      `- **Conclusion**: ${entry.conclusion}`,
      '',
    ].join('\n')

    await appendFile(this.getMemoryPath(profileId), content)
    console.info(`[AgentMemory] updated ${profileId}: ${entry.category} — ${entry.topic}`)
  }

  /** Return MEMORY.md content for system prompt injection.
   *  No truncation — aligned with Slock/Multica (full injection). */
  formatForPrompt(content: string): string {
    return content
  }
}

/** Singleton instance */
export const agentMemory = new AgentMemory()
