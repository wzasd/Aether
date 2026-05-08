import type { Intent, AgentProfile, PlannedTask, ExecutionPlan, EdgeType, ContextStrategy } from './a2a-types'
import type { AgentSpacePolicy } from './team-config'

export interface RoutingContext {
  fromProfile: AgentProfile
  teamMembers: AgentProfile[]
  policy: AgentSpacePolicy | null
}

// ─── Capability matching ──────────────────────────────────────────────────────

const CAPABILITY_ALIASES: Record<string, string[]> = {
  review: ['code-review', 'review', 'security-audit', 'quality-gate'],
  'code-review': ['code-review', 'review', 'quality-gate'],
  ui: ['ui-implementation', 'ui', 'css', 'responsive-design'],
  planning: ['planning', 'architecture'],
  implementation: ['implementation', 'coder'],
}

function matchByCapability(capability: string, members: AgentProfile[]): AgentProfile[] {
  const aliases = CAPABILITY_ALIASES[capability.toLowerCase()] ?? [capability.toLowerCase()]
  return members.filter((m) =>
    m.capabilities?.some((c) => aliases.includes(c.toLowerCase()))
  )
}

function matchByName(name: string, members: AgentProfile[]): AgentProfile | undefined {
  return members.find((m) => m.name.toLowerCase() === name.toLowerCase())
}

// ─── Context strategy selection ───────────────────────────────────────────────

function selectContextStrategy(intent: Intent, fromProfile: AgentProfile): ContextStrategy {
  switch (intent.type) {
    case 'user_message':
      return 'conversation'
    case 'mention':
    case 'capability_route':
      return 'handoff'
    case 'all':
      return 'summary'
  }
}

// ─── Execution mode ───────────────────────────────────────────────────────────

function selectExecutionMode(intent: Intent, policy: AgentSpacePolicy | null): 'serial' | 'parallel' {
  if (intent.type === 'all') {
    return policy?.allowParallelThinking ? 'parallel' : 'serial'
  }
  return 'serial'
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type RoutingError =
  | { type: 'no_target'; agentName: string }
  | { type: 'no_capability_match'; capability: string }
  | { type: 'no_reviewers' }

export type RoutingResult =
  | { ok: true; plan: ExecutionPlan }
  | { ok: false; error: RoutingError }

export function planRouting(intent: Intent, ctx: RoutingContext): RoutingResult {
  const { fromProfile, teamMembers, policy } = ctx
  const fromProfileId = fromProfile.id === 'default' ? null : fromProfile.id
  const executionMode = selectExecutionMode(intent, policy)
  const contextStrategy = selectContextStrategy(intent, fromProfile)

  switch (intent.type) {
    case 'user_message': {
      // No routing needed — primary agent handles it
      return { ok: true, plan: { tasks: [], executionMode: 'serial' } }
    }

    case 'mention': {
      const target = matchByName(intent.target, teamMembers)
      if (!target) {
        return { ok: false, error: { type: 'no_target', agentName: intent.target } }
      }
      const task: PlannedTask = {
        toProfileId: target.id,
        toProfileName: target.name,
        fromProfileId,
        fromProfileName: fromProfile.name,
        message: intent.task,
        edgeType: fromProfileId ? 'agent-mention' : 'user-mention',
        edgeLabel: `@${target.name}`,
        contextStrategy,
      }
      return { ok: true, plan: { tasks: [task], executionMode } }
    }

    case 'capability_route': {
      const candidates = matchByCapability(intent.capability, teamMembers)
        .filter((m) => m.id !== fromProfile.id)
      if (candidates.length === 0) {
        return { ok: false, error: { type: 'no_capability_match', capability: intent.capability } }
      }
      const target = candidates[0]
      const task: PlannedTask = {
        toProfileId: target.id,
        toProfileName: target.name,
        fromProfileId,
        fromProfileName: fromProfile.name,
        message: intent.task,
        edgeType: 'capability-route',
        edgeLabel: `@${intent.capability}`,
        contextStrategy,
      }
      return { ok: true, plan: { tasks: [task], executionMode } }
    }

    case 'all': {
      const targets = teamMembers.filter((m) => m.id !== fromProfile.id)
      const tasks: PlannedTask[] = targets.map((target) => ({
        toProfileId: target.id,
        toProfileName: target.name,
        fromProfileId,
        fromProfileName: fromProfile.name,
        message: `[READ-ONLY MODE — 你只能思考和分析，不能写文件、删文件或执行修改操作]\n\n${intent.task}`,
        edgeType: (fromProfileId ? 'agent-mention' : 'user-mention') as EdgeType,
        edgeLabel: '@All',
        contextStrategy,
        readOnly: true,
      }))
      return { ok: true, plan: { tasks, executionMode } }
    }

  }
}
