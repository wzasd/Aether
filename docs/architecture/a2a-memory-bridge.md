---
status: active
owner: bytro
last_verified: 2026-05-07
doc_kind: architecture
applies_to:
  - src/main/ai/a2a-memory-distiller.ts
  - src/main/ai/memory-extractor.ts
  - src/main/ai/orchestrator.ts
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

```typescript
// In orchestrator.drainSerialQueue()
const rootCapsule = capsuleManager.getRootCapsule(conversationId)
const activeTasks = getActiveTasks(conversationId)
if (rootCapsule?.ballState === 'completed' && activeTasks.length === 0) {
  memoryDistiller.distillChain(conversationId).then(persistToMemoryPalace)
}
```

Trigger fires when:
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
  }>
  conventions: Array<{
    pattern: string
    appliesTo: string[]
  }>
  failures: Array<{
    agent: string
    issue: string
    remediation: string
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

Chain-level distillates are written to Memory Palace as `memory_candidates` with three kinds:

| kind | title example | confidence |
|------|--------------|------------|
| `a2a_chain_summary` | "A2A 协作链: Planner → Coder → Reviewer" | 0.7 |
| `a2a_convention` | "协作惯例: 先写测试再实现" | 0.6 |
| `a2a_lesson` | "教训: Coder - 忘记错误处理" | 0.8 |

These enter the same review pipeline as per-message candidates: status `captured` → user review → `accepted`/`rejected`.

---

## Comparison: Per-Message vs Chain-Level

| Aspect | Per-Message (`memory-extractor.ts`) | Chain-Level (`a2a-memory-distiller.ts`) |
|--------|-------------------------------------|----------------------------------------|
| Trigger | Single task complete | Entire A2A chain complete |
| Source | One assistant message | All assistant messages + task graph |
| Scope | Agent-local decision | Cross-agent convention |
| Depth | Surface keywords | Interaction patterns |
| Kinds | decision, antipattern, convention | a2a_chain_summary, a2a_convention, a2a_lesson |

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
- `src/main/ai/orchestrator.ts` — trigger in `drainSerialQueue()`
- `src/main/core/memory-index.ts` — `createCandidate()` persistence
