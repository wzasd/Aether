import type { ContextStrategy } from './a2a-types'
import {
  buildConversationContext,
  buildHandoffContext,
  buildSummaryContext,
  buildContextPacket,
  renderContextPacket,
} from './context-selector'

export interface AssemblyOptions {
  conversationId: string
  strategy: ContextStrategy
  fromAgentName: string | null
  fromAgentProfileId: string | null
  fromAgentOutput?: string
  toAgentName: string
  toAgentRole: string
  instruction: string
  tokenBudget?: number
}

const DEFAULT_TOKEN_BUDGET = 8000

export function assembleContext(opts: AssemblyOptions): string {
  const {
    conversationId,
    strategy,
    fromAgentName,
    fromAgentProfileId,
    fromAgentOutput,
    toAgentName,
    toAgentRole,
    instruction,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
  } = opts

  switch (strategy) {
    case 'conversation':
      return buildConversationContext(conversationId, tokenBudget)

    case 'handoff':
      return buildHandoffContext({
        conversationId,
        fromAgentName,
        fromAgentProfileId,
        fromAgentOutput,
        toAgentName,
        toAgentRole,
        instruction,
        strategy: 'handoff',
      })

    case 'review':
      // review is handoff variant — same data, different semantic label
      return buildHandoffContext({
        conversationId,
        fromAgentName,
        fromAgentProfileId,
        fromAgentOutput,
        toAgentName,
        toAgentRole,
        instruction,
        strategy: 'handoff',
      })

    case 'summary':
      return buildSummaryContext(conversationId, toAgentName, instruction)

    case 'default':
    default: {
      const packet = buildContextPacket({
        conversationId,
        fromAgentName,
        toAgentName,
        toAgentRole,
        instruction,
        tokenBudget,
      })
      return renderContextPacket(packet)
    }
  }
}
