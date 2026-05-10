import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock agent-memory module
vi.mock('./agent-memory', () => ({
  agentMemory: {
    load: vi.fn(),
    initialize: vi.fn(),
  },
}))

import { initAgentMemory } from './init-agent-memory'
import { agentMemory } from './agent-memory'

const mockLoad = vi.mocked(agentMemory.load)
const mockInitialize = vi.mocked(agentMemory.initialize)

function makeProfile(id: string, name: string, role: string, isEnabled = true) {
  return {
    id,
    workspaceId: null,
    name,
    role,
    model: 'claude-sonnet-4-20250514',
    description: null,
    systemPrompt: null,
    isEnabled,
    whenToUse: '',
    capabilities: [],
    outputContract: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('initAgentMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes MEMORY.md for enabled profiles that have no existing memory', async () => {
    mockLoad.mockResolvedValue(null) // No existing memory
    mockInitialize.mockResolvedValue(undefined)

    const profiles = [
      makeProfile('claude', 'Claude', 'Developer'),
      makeProfile('codex', 'Codex', 'Reviewer'),
    ]

    const count = await initAgentMemory(profiles)

    expect(count).toBe(2)
    expect(mockLoad).toHaveBeenCalledTimes(2)
    expect(mockInitialize).toHaveBeenCalledTimes(2)
    expect(mockInitialize).toHaveBeenCalledWith('claude', { name: 'Claude', role: 'Developer' })
    expect(mockInitialize).toHaveBeenCalledWith('codex', { name: 'Codex', role: 'Reviewer' })
  })

  it('skips profiles that already have MEMORY.md', async () => {
    mockLoad.mockImplementation(async (profileId: string) => {
      if (profileId === 'claude') return '# Claude\n\nExisting memory'
      return null
    })
    mockInitialize.mockResolvedValue(undefined)

    const profiles = [
      makeProfile('claude', 'Claude', 'Developer'),
      makeProfile('codex', 'Codex', 'Reviewer'),
    ]

    const count = await initAgentMemory(profiles)

    expect(count).toBe(1)
    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(mockInitialize).toHaveBeenCalledWith('codex', { name: 'Codex', role: 'Reviewer' })
  })

  it('skips disabled profiles', async () => {
    mockLoad.mockResolvedValue(null)
    mockInitialize.mockResolvedValue(undefined)

    const profiles = [
      makeProfile('claude', 'Claude', 'Developer', true),
      makeProfile('codex', 'Codex', 'Reviewer', false),
    ]

    const count = await initAgentMemory(profiles)

    expect(count).toBe(1)
    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(mockInitialize).toHaveBeenCalledWith('claude', { name: 'Claude', role: 'Developer' })
  })

  it('skips the default profile', async () => {
    mockLoad.mockResolvedValue(null)
    mockInitialize.mockResolvedValue(undefined)

    const profiles = [
      makeProfile('default', 'Default', 'Assistant'),
      makeProfile('claude', 'Claude', 'Developer'),
    ]

    const count = await initAgentMemory(profiles)

    expect(count).toBe(1)
    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(mockInitialize).toHaveBeenCalledWith('claude', { name: 'Claude', role: 'Developer' })
  })

  it('continues on individual profile failure', async () => {
    mockLoad.mockImplementation(async (profileId: string) => {
      if (profileId === 'claude') throw new Error('Disk full')
      return null
    })
    mockInitialize.mockResolvedValue(undefined)

    const profiles = [
      makeProfile('claude', 'Claude', 'Developer'),
      makeProfile('codex', 'Codex', 'Reviewer'),
    ]

    const count = await initAgentMemory(profiles)

    expect(count).toBe(1)
    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(mockInitialize).toHaveBeenCalledWith('codex', { name: 'Codex', role: 'Reviewer' })
  })

  it('returns 0 when all profiles already have memory', async () => {
    mockLoad.mockResolvedValue('# Existing memory')
    mockInitialize.mockResolvedValue(undefined)

    const profiles = [makeProfile('claude', 'Claude', 'Developer')]

    const count = await initAgentMemory(profiles)

    expect(count).toBe(0)
    expect(mockInitialize).not.toHaveBeenCalled()
  })

  it('returns 0 for empty profiles array', async () => {
    const count = await initAgentMemory([])
    expect(count).toBe(0)
    expect(mockLoad).not.toHaveBeenCalled()
  })
})
