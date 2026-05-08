import { beforeEach, describe, expect, it, vi } from 'vitest'

function makeConversation(id: string) {
  return {
    id,
    workspace_id: null,
    title: 'Open Floor test',
    model: null,
    provider: null,
    status: 'Idle',
    mode: null,
    agent_count: 0,
    change_count: 0,
    team_id: null,
    is_draft: 0,
    created_at: 0,
    updated_at: 0
  }
}

async function loadStore() {
  const messageCreate = vi.fn(async (input) => ({
    id: `msg-${messageCreate.mock.calls.length}`,
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    thinking: null,
    created_at: 0
  }))

  vi.resetModules()
  vi.stubGlobal('window', {
    api: {
      orchestrator: {
        onA2ATaskCreated: vi.fn(() => vi.fn()),
        onA2ATaskCompleted: vi.fn(() => vi.fn()),
        onA2ATaskQueued: vi.fn(() => vi.fn())
      },
      chat: {
        onEvent: vi.fn(() => vi.fn())
      },
      message: {
        create: messageCreate
      }
    }
  })

  const module = await import('./chatStore')
  return { useChatStore: module.useChatStore, messageCreate }
}

describe('chatStore Open Floor state', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores pending collaboration mode per conversation', async () => {
    const { useChatStore } = await loadStore()

    useChatStore.getState().setPendingCollaborationMode('conv-a', 'open_floor')
    useChatStore.getState().setPendingCollaborationMode('conv-b', 'orchestrated')

    expect(useChatStore.getState().pendingCollaborationMode).toEqual({
      'conv-a': 'open_floor',
      'conv-b': 'orchestrated'
    })
  })

  it('records agent observations with a safe relevanceScore fallback', async () => {
    const { useChatStore, messageCreate } = await loadStore()
    useChatStore.setState({
      currentConversation: makeConversation('conv-a'),
      messages: [],
      openFloorStates: {
        'conv-a': {
          status: 'active',
          responses: [],
          startTime: 1
        }
      }
    })

    useChatStore.getState().handleAIEvent({
      type: 'agent_observation',
      conversationId: 'conv-a',
      agentProfileId: 'coder',
      agentName: 'Coder',
      content: 'Use PKCE for public OAuth clients.',
      timestamp: 123
    } as never)

    const response = useChatStore.getState().openFloorStates['conv-a'].responses[0]
    expect(response.relevanceScore).toBe(0)
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-a',
        role: 'assistant',
        content: expect.stringContaining('**Coder**')
      })
    )
  })

  it('closes the addressed Open Floor conversation without appending hidden conversation messages', async () => {
    const { useChatStore, messageCreate } = await loadStore()
    useChatStore.setState({
      currentConversation: makeConversation('conv-a'),
      messages: [],
      openFloorStates: {
        'conv-a': { status: 'active', responses: [], startTime: 1 },
        'conv-b': { status: 'active', responses: [], startTime: 2 }
      }
    })

    useChatStore.getState().handleAIEvent({
      type: 'open_floor_closed',
      conversationId: 'conv-b',
      totalResponses: 1,
      skippedAgents: 2
    })

    expect(useChatStore.getState().openFloorStates['conv-b']).toBeUndefined()
    expect(useChatStore.getState().openFloorStates['conv-a'].status).toBe('active')
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('drops late observations for already-closed Open Floor', async () => {
    const { useChatStore, messageCreate } = await loadStore()
    useChatStore.setState({
      currentConversation: makeConversation('conv-a'),
      messages: [],
      openFloorStates: {
        // State deleted (simulating closeOpenFloor behavior)
      }
    })

    useChatStore.getState().handleAIEvent({
      type: 'agent_observation',
      conversationId: 'conv-a',
      agentProfileId: 'coder',
      agentName: 'Coder',
      content: 'Late reply',
      timestamp: 999
    } as never)

    // addOpenFloorResponse correctly guards against deleted/closed state
    expect(useChatStore.getState().openFloorStates['conv-a']).toBeUndefined()

    // Fixed: handleAIEvent now checks status === 'active' before creating messages.
    // Late observations after Open Floor is closed are discarded without creating
    // orphan messages. See chatStore.ts:1596.
    expect(messageCreate).not.toHaveBeenCalled()
  })
})
