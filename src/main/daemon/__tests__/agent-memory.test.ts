import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rm, mkdir, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AgentMemory } from '../agent-memory'
import type { MemoryEntry } from '../agent-memory'

function tempDir(): string {
  return join(tmpdir(), 'bytro-agent-memory-test', randomUUID())
}

function makeEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    topic: 'Test topic',
    conclusion: 'Test conclusion for this entry',
    category: 'decision',
    source: 'conversation_end',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('AgentMemory', () => {
  let memory: AgentMemory
  let basePath: string
  const profileId = 'test-agent'

  beforeEach(async () => {
    basePath = tempDir()
    memory = new AgentMemory(basePath)
    await mkdir(basePath, { recursive: true })
  })

  afterEach(async () => {
    try {
      await rm(basePath, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  describe('load', () => {
    it('returns null when MEMORY.md does not exist', async () => {
      const result = await memory.load(profileId)
      expect(result).toBeNull()
    })

    it('returns content after initialization', async () => {
      await memory.initialize(profileId, { name: 'TestAgent', role: 'tester' })
      const content = await memory.load(profileId)
      expect(content).not.toBeNull()
      expect(content!).toContain('# @TestAgent')
      expect(content!).toContain('## Role')
      expect(content!).toContain('tester')
    })

    it('returns content after append', async () => {
      await memory.initialize(profileId, { name: 'TestAgent', role: 'tester' })
      await memory.append(profileId, makeEntry({ topic: 'Added via append', conclusion: 'Appended content' }))
      const content = await memory.load(profileId)
      expect(content!).toContain('Added via append')
      expect(content!).toContain('Appended content')
    })
  })

  describe('initialize', () => {
    it('creates MEMORY.md with correct template', async () => {
      await memory.initialize(profileId, { name: 'MyAgent', role: 'developer' })

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      expect(content).toContain('# @MyAgent')
      expect(content).toContain('## Role')
      expect(content).toContain('developer')
      expect(content).toContain('## Key Knowledge')
      expect(content).toContain('## Active Context')
    })

    it('uses profileId as fallback name when profile not provided', async () => {
      await memory.initialize(profileId)

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      expect(content).toContain(`# @${profileId}`)
    })

    it('is idempotent — second initialize does not duplicate content', async () => {
      await memory.initialize(profileId, { name: 'Agent', role: 'coder' })
      const firstContent = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')

      await memory.initialize(profileId, { name: 'Agent', role: 'coder' })
      const secondContent = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')

      // Second initialize writes over the same file (template is deterministic)
      expect(secondContent).toBe(firstContent)
    })
  })

  describe('append', () => {
    it('appends entry to existing MEMORY.md', async () => {
      await memory.initialize(profileId, { name: 'Agent', role: 'coder' })

      await memory.append(profileId, makeEntry({
        topic: 'Architecture decision',
        conclusion: 'Use event-driven pattern',
        category: 'decision',
      }))

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      expect(content).toContain('Architecture decision')
      expect(content).toContain('Use event-driven pattern')
      expect(content).toContain('**Category**: decision')
      expect(content).toContain('**Source**: conversation_end')
    })

    it('auto-initializes MEMORY.md if not yet created', async () => {
      await memory.append(profileId, makeEntry({ topic: 'Auto-init test' }))

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      expect(content).toContain('# @')
      expect(content).toContain('Auto-init test')
    })

    it('appends multiple entries in order', async () => {
      await memory.initialize(profileId, { name: 'Agent', role: 'coder' })

      await memory.append(profileId, makeEntry({ topic: 'First entry', timestamp: 1000 }))
      await memory.append(profileId, makeEntry({ topic: 'Second entry', timestamp: 2000 }))

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      const firstIdx = content.indexOf('First entry')
      const secondIdx = content.indexOf('Second entry')
      expect(firstIdx).toBeGreaterThan(0)
      expect(secondIdx).toBeGreaterThan(firstIdx)
    })
  })

  describe('concurrent writes', () => {
    it('handles 3 simultaneous appends without data loss', async () => {
      await memory.initialize(profileId, { name: 'Agent', role: 'coder' })

      const entries = [
        makeEntry({ topic: 'Concurrent entry 1', timestamp: 1000 }),
        makeEntry({ topic: 'Concurrent entry 2', timestamp: 2000 }),
        makeEntry({ topic: 'Concurrent entry 3', timestamp: 3000 }),
      ]

      // Fire all appends concurrently
      await Promise.all(entries.map((e) => memory.append(profileId, e)))

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      expect(content).toContain('Concurrent entry 1')
      expect(content).toContain('Concurrent entry 2')
      expect(content).toContain('Concurrent entry 3')
    })

    it('preserves write order via serialization', async () => {
      await memory.initialize(profileId, { name: 'Agent', role: 'coder' })

      // Start all writes at the same time
      const results = await Promise.allSettled([
        memory.append(profileId, makeEntry({ topic: 'A-first', timestamp: 1 })),
        memory.append(profileId, makeEntry({ topic: 'B-second', timestamp: 2 })),
        memory.append(profileId, makeEntry({ topic: 'C-third', timestamp: 3 })),
      ])

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

      const content = await readFile(join(basePath, profileId, 'MEMORY.md'), 'utf-8')
      const posA = content.indexOf('A-first')
      const posB = content.indexOf('B-second')
      const posC = content.indexOf('C-third')

      // All entries present and in order
      expect(posA).toBeGreaterThan(0)
      expect(posB).toBeGreaterThan(posA)
      expect(posC).toBeGreaterThan(posB)
    })
  })

  describe('path traversal protection', () => {
    const invalidIds = [
      '../etc/passwd',
      './config',
      '/root/.ssh',
      'agent; rm -rf /',
      '',
      'a'.repeat(65), // too long
    ]

    it.each(invalidIds)('rejects invalid profileId: %s', async (id) => {
      await expect(memory.load(id)).rejects.toThrow('Invalid profileId')
      await expect(memory.initialize(id)).rejects.toThrow('Invalid profileId')
      await expect(memory.append(id, makeEntry())).rejects.toThrow('Invalid profileId')
    })

    it('accepts valid profileIds with alphanumeric, dash, underscore', async () => {
      const validIds = ['coder', 'test-agent', 'AI_Engineer_42', 'myAgent-007']
      for (const id of validIds) {
        await expect(memory.initialize(id)).resolves.not.toThrow()
      }
    })
  })

  describe('formatForPrompt', () => {
    it('returns full content without truncation', () => {
      const content = 'Short memory content'
      const result = memory.formatForPrompt(content)
      expect(result).toBe(content)
    })

    it('returns full content even for long input (no truncation — aligned with Slock/Multica)', () => {
      const longContent = 'x'.repeat(30_000)
      const result = memory.formatForPrompt(longContent)
      expect(result).toBe(longContent)
      expect(result.length).toBe(30_000)
    })

    it('preserves header structure', () => {
      const content = [
        '# @Agent',
        '',
        '## Role',
        'developer',
        '',
        '## Key Knowledge',
        '- Important fact about the project',
        '',
        '## Active Context',
        '- Working on memory module',
      ].join('\n')
      const result = memory.formatForPrompt(content)
      expect(result).toBe(content)
      expect(result).toContain('# @Agent')
      expect(result).toContain('## Role')
    })
  })
})
