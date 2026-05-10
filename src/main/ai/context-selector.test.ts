import { describe, it, expect } from 'vitest'
import { renderContextPacket, type AgentContextPacket, type FileChangeEntry } from './context-selector'

function makePacket(overrides: Partial<AgentContextPacket> = {}): AgentContextPacket {
  return {
    task: {
      fromAgentName: 'Planner',
      toAgentName: 'Coder',
      instruction: 'Implement the upload component'
    },
    taskState: {
      goal: '',
      completed: [],
      pending: [],
      decisions: [],
      blockers: []
    },
    relevantMessages: [],
    projectMemories: [],
    recentFileChanges: [],
    agentRoster: [],
    ...overrides
  }
}

function makeFileChange(overrides: Partial<FileChangeEntry> = {}): FileChangeEntry {
  return {
    path: 'src/foo.ts',
    status: 'modified',
    additions: 10,
    deletions: 3,
    ...overrides
  }
}

describe('renderContextPacket', () => {
  it('renders basic TASK HANDOFF section', () => {
    const packet = makePacket()
    const output = renderContextPacket(packet)

    expect(output).toContain('[TASK HANDOFF]')
    expect(output).toContain('From: @Planner')
    expect(output).toContain('To: @Coder')
    expect(output).toContain('Instruction: Implement the upload component')
  })

  it('renders From as User when fromAgentName is null', () => {
    const packet = makePacket({ task: { fromAgentName: null, toAgentName: 'Coder', instruction: 'do it' } })
    const output = renderContextPacket(packet)

    expect(output).toContain('From: User')
  })

  it('renders RELEVANT CONTEXT section', () => {
    const packet = makePacket({
      relevantMessages: [
        { messageId: '1', agentProfileId: 'p1', content: 'We decided to use local-first approach', reason: '关键词匹配' },
        { messageId: '2', agentProfileId: null, content: 'The upload API should support cancellation', reason: '最近消息, 角色相关' }
      ]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('[RELEVANT CONTEXT]')
    expect(output).toContain('[@p1] We decided')
    expect(output).toContain('[@Assistant] The upload')
  })

  it('renders TASK PROGRESS with Changed Files when file changes present', () => {
    const packet = makePacket({
      recentFileChanges: [
        makeFileChange({ path: 'src/components/upload.tsx', additions: 87, deletions: 0, status: 'added' }),
        makeFileChange({ path: 'src/api/upload.ts', additions: 23, deletions: 5, status: 'modified' })
      ]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('[TASK PROGRESS]')
    expect(output).toContain('Changed Files (2):')
    expect(output).toContain('src/components/upload.tsx [added] +87 -0')
    expect(output).toContain('src/api/upload.ts [modified] +23 -5')
  })

  it('renders PROJECT MEMORY section', () => {
    const packet = makePacket({
      projectMemories: [
        { title: 'Component conventions', content: 'Use functional components with hooks' }
      ]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('[PROJECT MEMORY]')
    expect(output).toContain('### Component conventions')
    expect(output).toContain('Use functional components with hooks')
  })

  it('omits TASK PROGRESS when no progress or file changes', () => {
    const packet = makePacket()
    const output = renderContextPacket(packet)

    expect(output).not.toContain('[TASK PROGRESS]')
  })

  it('omits empty sections for RELEVANT CONTEXT and PROJECT MEMORY', () => {
    const packet = makePacket()
    const output = renderContextPacket(packet)

    expect(output).not.toContain('[RELEVANT CONTEXT]')
    expect(output).not.toContain('[PROJECT MEMORY]')
  })

  it('renders taskState goal and completed items when present', () => {
    const packet = makePacket({
      taskState: {
        goal: 'Implement JWT authentication',
        completed: ['Created auth/jwt.ts', 'Updated IPC middleware'],
        pending: ['Add unit tests'],
        decisions: [],
        blockers: []
      }
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('Goal: Implement JWT authentication')
    expect(output).toContain('- Created auth/jwt.ts')
    expect(output).toContain('- Updated IPC middleware')
    expect(output).toContain('Pending:')
    expect(output).toContain('- Add unit tests')
  })

  it('truncates message content to 300 chars', () => {
    const longContent = 'x'.repeat(500)
    const packet = makePacket({
      relevantMessages: [{ messageId: '1', agentProfileId: null, content: longContent, reason: 'test' }]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('x'.repeat(300))
    expect(output).not.toContain('x'.repeat(301))
  })

  it('truncates memory content to 500 chars', () => {
    const longContent = 'y'.repeat(600)
    const packet = makePacket({
      projectMemories: [{ title: 'Test', content: longContent }]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('y'.repeat(500))
    expect(output).not.toContain('y'.repeat(501))
  })

  it('maintains section ordering', () => {
    const packet = makePacket({
      taskState: { goal: 'test', completed: ['did something'], pending: [], decisions: [], blockers: [] },
      recentFileChanges: [makeFileChange()],
      relevantMessages: [{ messageId: '1', agentProfileId: 'p1', content: 'decision made', reason: '关键词匹配' }],
      projectMemories: [{ title: 'Rule', content: 'Always test' }]
    })
    const output = renderContextPacket(packet)

    const sectionOrder = [
      output.indexOf('[TASK HANDOFF]'),
      output.indexOf('[TASK PROGRESS]'),
      output.indexOf('[RELEVANT CONTEXT]'),
      output.indexOf('[PROJECT MEMORY]')
    ].filter(i => i >= 0) // skip sections not present in output
    for (let i = 1; i < sectionOrder.length; i++) {
      expect(sectionOrder[i]).toBeGreaterThan(sectionOrder[i - 1])
    }
  })

  // Regression: empty relevantMessages must NOT prevent PROJECT MEMORY /
  // TASK PROGRESS from appearing (fix for #13 — buildContextPacket no
  // longer early-returns when candidates.length === 0).
  it('renders PROJECT MEMORY and TASK PROGRESS when relevantMessages is empty', () => {
    const packet = makePacket({
      relevantMessages: [],
      projectMemories: [
        { title: 'Auth patterns', content: 'Use JWT with refresh tokens' }
      ],
      taskState: {
        goal: 'Add login page',
        completed: ['Created auth module'],
        pending: ['Wire up API'],
        decisions: [],
        blockers: []
      },
      recentFileChanges: [makeFileChange({ path: 'src/auth/login.tsx', status: 'added', additions: 42, deletions: 0 })]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('[PROJECT MEMORY]')
    expect(output).toContain('### Auth patterns')
    expect(output).toContain('[TASK PROGRESS]')
    expect(output).toContain('Goal: Add login page')
    expect(output).not.toContain('[RELEVANT CONTEXT]')
  })

  it('renders AGENT ROSTER section when roster data present', () => {
    const packet = makePacket({
      agentRoster: [
        { name: 'Claude', role: 'implementation' },
        { name: 'Planner', role: 'planning' }
      ]
    })
    const output = renderContextPacket(packet)

    expect(output).toContain('[AGENT ROSTER]')
    expect(output).toContain('- @Claude (implementation)')
    expect(output).toContain('- @Planner (planning)')
  })

  it('omits AGENT ROSTER when roster is empty', () => {
    const packet = makePacket()
    const output = renderContextPacket(packet)

    expect(output).not.toContain('[AGENT ROSTER]')
  })
})
