---
adr: 012
title: Iterative Open Floor for Agent Cross-Visibility
status: proposed
date: 2026-05-09
supersedes: ADR-009 (extends)
---

# ADR-012: Iterative Open Floor for Agent Cross-Visibility

## Context

Open Floor mode (ADR-009) enables multi-agent discussion, but the current implementation uses a **parallel broadcast** model: all agents receive the same user message simultaneously and reply independently, without seeing each other's responses.

This produces "6 parallel monologues" rather than genuine group discussion. Agents cannot reference, challenge, or build upon each other's points — a fundamental gap compared to Slock's shared-message-bus model where agents see all prior messages before responding.

## Decision

Upgrade Open Floor from single-round parallel broadcast to **multi-round iterative visibility**:

- **Round 1**: All agents respond to the user message in parallel (current behavior, unchanged)
- **Round 2+**: Each agent receives the user message PLUS all Round N-1 agent replies, and may choose to respond or skip (NO_REPLY)
- **Termination**: Discussion ends when all agents NO_REPLY, max rounds reached, or user stops

## Architecture

```
┌─────────────────────────────────────────────────────┐
│            Iterative Open Floor Engine                │
│                                                       │
│  Round 1: userMsg → broadcast → collect all replies   │
│      ↓                                                │
│  Round 2: userMsg + R1 replies → broadcast → collect  │
│      ↓                                                │
│  Round N (max 3): ... → converge or user stops        │
│                                                       │
│  Termination:                                         │
│  - All agents NO_REPLY → natural end                  │
│  - maxRounds reached → forced end                     │
│  - User ⏹ → immediate stop                            │
│  - User interjects → triggers new round                │
└─────────────────────────────────────────────────────┘
```

### Context Assembly Strategy

Each round's agent input = user message + conversation history + **previous round agent replies**

```typescript
buildRoundContext(userMessage: string, previousReplies: AgentReply[]): string {
  if (previousReplies.length === 0) return userMessage

  const colleagueNotes = previousReplies
    .map(r => `@${r.agentName}: ${r.content}`)
    .join('\n\n')

  return `${userMessage}\n\n--- 同事们的观点 ---\n${colleagueNotes}`
}
```

**Key design choice**: Only inject the **previous round's** replies, not the full history. This prevents token explosion while giving agents enough context to respond to each other.

### Anti-Loop Mechanisms

| Mechanism | Implementation | Purpose |
|-----------|---------------|---------|
| Max rounds | `maxRounds = 3` (configurable) | Hard ceiling |
| Per-agent per-round limit | 1 reply per agent per round | Prevent single-agent spam |
| Token budget decay | R1: 100%, R2: 70%, R3: 50% | Later rounds produce shorter replies |
| All-NO_REPLY detection | Auto-end when zero new replies | Natural convergence |
| User stop button | Immediate termination | Human override |
| NO_REPLY sentinel | Agents explicitly skip when no new input | Prevent forced participation |

### Why Not Full Slock Architecture?

Slock agents are **persistent processes** on a shared message bus. bytro agents are **ephemeral processes** launched per-task.

| | Slock | bytro (this ADR) |
|---|---|---|
| Agent lifecycle | Persistent (24/7) | Ephemeral (per-round) |
| Message visibility | Real-time streaming | Batch per-round |
| Agent-to-agent | Direct @mention via message bus | Context injection via orchestrator |
| Infrastructure | Pub/Sub message bus | IPC events (existing) |

Full Slock architecture would require:
1. Persistent agent processes (major infra change)
2. Real-time message bus (new component)
3. Agent self-scheduling (complex orchestration)

This ADR achieves **80% of the group-discussion experience** with **~75 lines of code change** on the existing architecture. The marginal return of full Slock architecture is low for the current product stage.

### Prompt Changes

Round 2+ agents receive additional instruction:

```
上面是同事们对这个话题的观点。你可以：
- 引用或补充别人的观点（用 @AgentName 提及）
- 提出不同看法
- 如果你没有新观点，回复 NO_REPLY
```

This replaces the current single-round "发表你的专业看法" with a context-aware prompt that enables cross-referencing.

## Implementation Scope

| File | Change | Lines |
|------|--------|-------|
| orchestrator.ts | executeOpenFloor → loop + context assembly | ~40 |
| agent-runtime.ts | onObservation round context format | ~10 |
| open-floor.ts | Add "can reference others" instruction | ~5 |
| chatStore.ts | Round event handling + UI markers | ~15 |
| AgentStatusBar.tsx | Display round number | ~5 |
| **Total** | | **~75** |

## Acceptance Criteria

1. Round 1: All agents reply to user message (unchanged from current)
2. Round 2: Agents can reference Round 1 replies ("同意 @Coder 的观点")
3. All agents NO_REPLY → natural discussion end
4. Max rounds reached → forced end with summary
5. User ⏹ → immediate termination
6. User interjects → triggers new round
7. AgentStatusBar shows round number ("Open Floor · R2 · 3 thinking")
8. No token explosion (previous round only, not full history)

## Risks

| Risk | Probability | Mitigation |
|------|------------|------------|
| Round 2 token overflow | Medium | Inject summary (first 100 chars) not full replies |
| Agents argue indefinitely | Low | maxRounds=2 hard limit |
| Slower perceived response | Low | Round 1 unchanged; Round 2 is additive, not blocking |
| Quality degradation in later rounds | Low | Token budget decay + NO_REPLY option |

## Related

- ADR-009: Dual-Mode Collaboration Architecture (superseded by this ADR for Open Floor specifics)
- ADR-011: Open Floor Bug Fix Retrospective (11-layer fix history)
- `docs/features/open-floor-multi-round.md` — PRD by @需求文档师
