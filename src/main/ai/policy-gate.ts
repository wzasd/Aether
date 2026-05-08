import type { Intent, AgentProfile } from './a2a-types'
import type { AgentSpacePolicy } from './team-config'

export type PolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: string }

export interface PolicyCheckContext {
  policy: AgentSpacePolicy | null
  fromProfile: AgentProfile
  teamMemberIds: Set<string>
  currentDepth: number
  maxDepth: number
  currentTaskCount: number
  maxTaskCount: number
  // How many new tasks this intent would create (for @All expansion check)
  intendedTaskCount?: number
  // True when the action originates from the user (not an agent acting autonomously)
  isUserInitiated?: boolean
}

// Policy is the ceiling — Mode can only be more restrictive, never more permissive.
// All checks return a verdict; orchestrator decides whether to hard-block or warn.

export function checkIntent(intent: Intent, ctx: PolicyCheckContext): PolicyVerdict {
  const { policy, currentDepth, maxDepth, currentTaskCount, maxTaskCount } = ctx

  // Depth guard — independent of policy
  if (currentDepth > maxDepth) {
    return { allowed: false, reason: `已达最大委托深度（${maxDepth}）` }
  }

  // Task count guard
  const newCount = ctx.intendedTaskCount ?? 1
  if (currentTaskCount + newCount > maxTaskCount) {
    return { allowed: false, reason: `任务数将超过上限（${maxTaskCount}）` }
  }

  if (!policy) return { allowed: true }

  switch (intent.type) {
    case 'user_message':
      return { allowed: true }

    case 'mention':
    case 'capability_route': {
      if (!policy.allowAgentMention) {
        return { allowed: false, reason: 'Space Policy 禁止 @mention' }
      }
      // Agent→agent delegation (fromProfile is not the default/user proxy, and action is not user-initiated)
      if (!ctx.isUserInitiated && ctx.fromProfile.id !== 'default' && !policy.allowAgentToDelegate) {
        return { allowed: false, reason: 'Space Policy 禁止 Agent 自主委托' }
      }
      if (intent.type === 'capability_route' && !policy.allowCapabilityRouting) {
        return { allowed: false, reason: 'Space Policy 禁止能力路由' }
      }
      return { allowed: true }
    }

    case 'all': {
      if (!policy.allowAgentMention) {
        return { allowed: false, reason: 'Space Policy 禁止 @All' }
      }
      if (!ctx.isUserInitiated && ctx.fromProfile.id !== 'default' && !policy.allowAgentToDelegate) {
        return { allowed: false, reason: 'Space Policy 禁止 Agent 自主委托（@All）' }
      }
      const limit = policy.maxParallelAgents ?? 0
      if (limit > 0 && newCount > limit) {
        return { allowed: false, reason: `@All 展开数（${newCount}）超过 maxParallelAgents（${limit}）` }
      }
      return { allowed: true }
    }

  }
}

export function checkTeamMembership(targetProfileId: string, ctx: PolicyCheckContext): PolicyVerdict {
  if (!ctx.policy) return { allowed: true }
  if (!ctx.teamMemberIds.has(targetProfileId)) {
    return { allowed: false, reason: `目标 Agent 不在当前 Team 中` }
  }
  return { allowed: true }
}

export function checkLoopDetection(chain: string[], targetProfileId: string): PolicyVerdict {
  if (chain.includes(targetProfileId)) {
    return { allowed: false, reason: `检测到循环委托` }
  }
  return { allowed: true }
}
