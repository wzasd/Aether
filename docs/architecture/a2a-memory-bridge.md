---
status: active
owner: bytro
last_verified: 2026-05-13
doc_kind: architecture
applies_to:
  - src/main/ai/a2a-memory-distiller.ts
  - src/main/ai/memory-extractor.ts
  - src/main/ai/orchestrator.ts
  - src/main/daemon/daemon.ts
  - src/main/core/memory-index.ts
---

# A2A Memory Bridge: Cross-Session Chain-Level Distillation

Date: 2026-05-07

## Problem

`memory-extractor.ts` extracts candidates from **single messages** after an individual Agent task completes. This misses higher-level patterns that only emerge across an entire A2A delegation chain:

- **Cross-agent conventions**: "Coder should write tests before implementation" (learned from Reviewer feedback)
- **Project-level decisions**: "Use Zod instead of Joi for validation" (decided by Planner, implemented by Coder)
- **Failure lessons**: "Reviewer found Coder often forgets error handling" (recurring pattern across multiple tasks)

These patterns are invisible to per-message extraction because they require seeing the *interaction* between agents, not just individual outputs.

---

## Solution: Chain-Level Memory Distillation

`A2AMemoryDistiller` operates on the **entire A2A task graph** plus **all assistant messages** in a conversation, extracting patterns that span multiple agents.

### Trigger Condition

There are two trigger paths during the architecture transition:

1. **Daemon path (current)**: `Daemon` publishes `conversation:completed` when a tracked conversation has no pending/claimed/running tasks, then runs `distillChain()` and `persistToMemoryPalace()`.
2. **Legacy orchestrator path**: `orchestrator.drainSerialQueue()` triggers distillation when the root continuity capsule is completed and no tasks are active.

Current daemon trigger:

```typescript
bus.publish({
  type: 'conversation:completed',
  conversationId,
  actorType: 'system',
  actorId: null,
  payload: { reason: 'all_tasks_complete', taskCount, participantIds }
})
```

Legacy trigger:

```typescript
// In orchestrator.drainSerialQueue()
const rootCapsule = capsuleManager.getRootCapsule(conversationId)
const activeTasks = getActiveTasks(conversationId)
if (rootCapsule?.ballState === 'completed' && activeTasks.length === 0) {
  memoryDistiller.distillChain(conversationId).then(persistToMemoryPalace)
}
```

Legacy trigger fires when:
1. The root task (depth=0, user-initiated) is completed
2. No tasks are still pending or working
3. This happens at the end of serial queue draining

### Distillate Structure

```typescript
interface ChainMemoryDistillate {
  conversationId: string
  agentChain: string[]           // e.g. ['Planner', 'Coder', 'Reviewer']
  taskCount: number
  maxDepth: number
  decisionPoints: Array<{
    agentsInvolved: string[]
    decision: string
    rationale: string
    suggestedCategory: 'decisions'
    confidence: number
  }>
  conventions: Array<{
    pattern: string
    appliesTo: string[]
    suggestedCategory: 'conventions'
    confidence: number
  }>
  failures: Array<{
    agent: string
    issue: string
    remediation: string
    suggestedCategory: 'antipatterns'
    confidence: number
  }>
}
```

### Extraction Strategy

Current implementation uses **lightweight regex patterns** on concatenated assistant messages:

| Pattern Type | Regex | Example Match |
|-------------|-------|---------------|
| Decisions | `(决定\|选择\|使用\|采用)...` | "决定使用 Zod 做验证" |
| Conventions | `(惯例\|习惯\|模式\|最佳实践)...` | "惯例：先写测试再实现" |
| Failures | `(错误\|失败\|异常\|忘记\|遗漏)...` | "忘记处理边界情况" |

**TODO**: Replace regex with a lightweight LLM call (Haiku 4.5) for semantic summarization. The regex approach catches explicit statements but misses implicit patterns.

---

## Persistence

Chain-level distillates are written directly to Memory Palace (`project_memory_items`) and mirrored to `memory_candidates(status=materialized)` as an audit trail.

| Distillate | Memory category | default status | confidence |
|---|---|---|---|
| chain summary | `architecture` | `draft` | 0.7 |
| decision point | `decisions` | `draft` | 0.65 |
| convention | `conventions` | `draft` | 0.6 |
| failure lesson | `antipatterns` | `active` | 0.75-0.8 |

Default status follows `DEFAULT_STATUS_BY_CATEGORY` in `context-selector.ts`. `core/antipatterns` become active automatically; `conventions/decisions/architecture` remain draft until reviewed.

---

## Comparison: Per-Message vs Chain-Level

| Aspect | Per-Message (`memory-extractor.ts`) | Chain-Level (`a2a-memory-distiller.ts`) |
|--------|-------------------------------------|----------------------------------------|
| Trigger | Single task complete | Entire A2A chain complete |
| Source | One assistant message | All assistant messages + task graph |
| Scope | Agent-local decision | Cross-agent convention |
| Depth | Surface keywords | Interaction patterns |
| Categories | decisions, antipatterns, conventions | architecture, decisions, conventions, antipatterns |

---

## Future Enhancements

1. **LLM-based summarization**: Use Haiku 4.5 to read the full chain and produce structured distillates
2. **Cross-conversation learning**: Compare chains across conversations to identify stable team dynamics
3. **Automatic convention injection**: High-confidence conventions automatically prepended to relevant agent system prompts
4. **Failure pattern detection**: Track which agent pairs have high failure rates and suggest team reconfiguration

---

## Implementation Files

- `src/main/ai/a2a-memory-distiller.ts` — distillation engine
- `src/main/ai/memory-extractor.ts` — per-message extraction (complementary)
- `src/main/daemon/daemon.ts` — `conversation:completed` trigger and observability
- `src/main/ai/orchestrator.ts` — legacy trigger in `drainSerialQueue()`
- `src/main/core/memory-index.ts` — `createProjectMemoryItem()` and `createCandidate()` persistence
- `docs/architecture/memory-palace-design.md` — full Memory Palace architecture
