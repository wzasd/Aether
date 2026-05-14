import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { createCandidate, createProjectMemoryItem } from '../core/memory-index'
import { DEFAULT_STATUS_BY_CATEGORY } from './context-selector'
import type { MemoryCategory } from '../ipc/memory-palace'
import { getActionCardService } from '../action-cards/action-card-service'
import { writeObservabilityEvent } from '../core/logging'

type MemoryStatus = 'draft' | 'active'

interface DistilledMemoryItem {
  suggestedCategory: MemoryCategory
  title: string
  content: string
  confidence: number
  tags: string[]
}

export interface ChainMemoryDistillate {
  conversationId: string
  agentChain: string[]
  taskCount: number
  maxDepth: number
  decisionPoints: Array<{
    agentsInvolved: string[]
    decision: string
    rationale: string
    suggestedCategory: MemoryCategory
    confidence: number
  }>
  conventions: Array<{
    pattern: string
    appliesTo: string[]
    suggestedCategory: MemoryCategory
    confidence: number
  }>
  failures: Array<{
    agent: string
    issue: string
    remediation: string
    suggestedCategory: MemoryCategory
    confidence: number
  }>
}

/**
 * Extracts chain-level memories from completed A2A conversations.
 *
 * Unlike per-message extraction (memory-extractor.ts), this operates on the
 * full A2A task graph and all assistant messages to identify cross-agent
 * conventions, project-level decisions, and failure lessons.
 *
 * TODO: Replace lightweight regex extraction with a lightweight LLM call
 * (e.g. Haiku 4.5) for richer semantic summarization.
 */
export class A2AMemoryDistiller {
  async distillChain(conversationId: string): Promise<ChainMemoryDistillate | null> {
    const db = getDb()

    let taskRows = db.prepare(
      `SELECT to_profile_id, depth, status, message
       FROM a2a_tasks
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    ).all(conversationId) as Array<{
      to_profile_id: string
      depth: number
      status: string
      message: string
    }>

    taskRows = taskRows.filter((t) => Boolean(t.to_profile_id))

    if (taskRows.length === 0) {
      taskRows = db.prepare(
        `SELECT agent_profile_id AS to_profile_id, depth, status, message
         FROM agent_task_queue
         WHERE conversation_id = ?
         ORDER BY created_at ASC`
      ).all(conversationId) as Array<{
        to_profile_id: string
        depth: number
        status: string
        message: string
      }>
      taskRows = taskRows.filter((t) => Boolean(t.to_profile_id))
    }

    if (taskRows.length === 0) return null

    const agentChain = Array.from(new Set(taskRows.map((t) => t.to_profile_id)))
    const maxDepth = Math.max(...taskRows.map((t) => t.depth))
    const failedTasks = taskRows.filter((t) => t.status === 'failed')

    const msgRows = db.prepare(
      `SELECT content
       FROM messages
       WHERE conversation_id = ? AND role = 'assistant' AND content IS NOT NULL
       ORDER BY created_at ASC`
    ).all(conversationId) as Array<{ content: string }>

    const taskResultRows = db.prepare(
      `SELECT result AS content
       FROM agent_task_queue
       WHERE conversation_id = ? AND result IS NOT NULL AND result != '[NO_REPLY]'
       ORDER BY completed_at ASC`
    ).all(conversationId) as Array<{ content: string }>

    const allText = [...msgRows, ...taskResultRows].map((m) => m.content).join('\n\n')

    return {
      conversationId,
      agentChain,
      taskCount: taskRows.length,
      maxDepth,
      decisionPoints: this.extractDecisions(allText, agentChain),
      conventions: this.extractConventions(allText, agentChain),
      failures: this.extractFailures(allText, failedTasks),
    }
  }

  async persistToMemoryPalace(distillate: ChainMemoryDistillate): Promise<number> {
    const db = getDb()
    const convRow = db
      .prepare(`SELECT workspace_id FROM conversations WHERE id = ?`)
      .get(distillate.conversationId) as { workspace_id: string | null } | undefined
    if (!convRow?.workspace_id) return 0

    const workspaceId = convRow.workspace_id
    const items = this.toMemoryItems(distillate)
    let written = 0

    for (const item of items) {
      const status = DEFAULT_STATUS_BY_CATEGORY[item.suggestedCategory] as MemoryStatus
      const id = randomUUID()
      try {
        createProjectMemoryItem({
          id,
          workspace_id: workspaceId,
          kind: item.suggestedCategory,
          category: item.suggestedCategory,
          title: item.title,
          content: item.content,
          status,
          tags: item.tags,
          source_doc: `conversation:${distillate.conversationId}`,
        })
        try {
          createCandidate({
            id: randomUUID(),
            workspace_id: workspaceId,
            kind: item.suggestedCategory,
            title: item.title,
            content: item.content,
            source_conversation_id: distillate.conversationId,
            source_message_id: id,
            confidence: String(item.confidence),
            status: 'materialized',
          })
        } catch {
          // Audit writes are best-effort; the Memory Palace item is canonical.
        }

        // For draft categories, create a memory:activate action card
        // so the human can confirm or reject the draft (PR-5).
        if (status === 'draft') {
          try {
            const service = getActionCardService()
            await service.createMemoryActivationCard({
              workspaceId,
              conversationId: distillate.conversationId,
              memoryItemId: id,
              title: `确认记忆: ${item.title}`,
              draftHint: item.content.slice(0, 200),
            })
          } catch (err) {
            // Action card creation is best-effort; the draft item is canonical.
            writeObservabilityEvent('action_card:create_failed', {
              conversationId: distillate.conversationId,
              memoryItemId: id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        written++
      } catch {
        // Ignore individual duplicate/insert failures so one bad item does not
        // block the rest of the distillation batch.
      }
    }

    return written
  }

  private toMemoryItems(distillate: ChainMemoryDistillate): DistilledMemoryItem[] {
    const items: DistilledMemoryItem[] = []

    if (distillate.agentChain.length > 1) {
      items.push({
        suggestedCategory: 'architecture',
        title: `A2A 协作链: ${distillate.agentChain.join(' → ')}`,
        content: `任务数: ${distillate.taskCount}, 最大深度: ${distillate.maxDepth}`,
        confidence: 0.7,
        tags: ['a2a', 'conversation', 'architecture'],
      })
    }

    for (const decision of distillate.decisionPoints) {
      items.push({
        suggestedCategory: decision.suggestedCategory,
        title: `决策: ${decision.decision.slice(0, 50)}`,
        content: `决策: ${decision.decision}\n理由: ${decision.rationale}`,
        confidence: decision.confidence,
        tags: ['decision', ...decision.agentsInvolved],
      })
    }

    for (const convention of distillate.conventions) {
      items.push({
        suggestedCategory: convention.suggestedCategory,
        title: `协作惯例: ${convention.pattern.slice(0, 50)}`,
        content: convention.pattern,
        confidence: convention.confidence,
        tags: ['convention', ...convention.appliesTo],
      })
    }

    for (const failure of distillate.failures) {
      items.push({
        suggestedCategory: failure.suggestedCategory,
        title: `教训: ${failure.agent} - ${failure.issue.slice(0, 50)}`,
        content: `Agent: ${failure.agent}\n问题: ${failure.issue}\n修复: ${failure.remediation}`,
        confidence: failure.confidence,
        tags: ['failure', failure.agent],
      })
    }

    return items
  }

  private extractDecisions(
    text: string,
    agentChain: string[]
  ): ChainMemoryDistillate['decisionPoints'] {
    const decisions: ChainMemoryDistillate['decisionPoints'] = []
    const patterns = [
      /(?:决定|选择|使用|采用|改为|切换至)\s*[:：]?\s*([^。\n]{3,80})/g,
      /(?:应该|需要|必须)\s*[:：]?\s*([^。\n]{3,80})/g,
    ]

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        decisions.push({
          agentsInvolved: agentChain,
          decision: match[1].trim(),
          rationale: '从对话上下文中提取',
          suggestedCategory: 'decisions',
          confidence: 0.65,
        })
      }
    }

    return decisions.slice(0, 10)
  }

  private extractConventions(
    text: string,
    agentChain: string[]
  ): ChainMemoryDistillate['conventions'] {
    const conventions: ChainMemoryDistillate['conventions'] = []
    const patterns = [
      /(?:惯例|习惯|模式|最佳实践|推荐)\s*[:：]?\s*([^。\n]{3,80})/g,
      /(?:先.*再.*|首先.*然后.*|步骤[一二三四五].*)/g,
    ]

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        conventions.push({
          pattern: match[0].trim(),
          appliesTo: agentChain,
          suggestedCategory: 'conventions',
          confidence: 0.6,
        })
      }
    }

    return conventions.slice(0, 10)
  }

  private extractFailures(
    text: string,
    failedTasks: Array<{ to_profile_id: string; message: string }>
  ): ChainMemoryDistillate['failures'] {
    const failures: ChainMemoryDistillate['failures'] = []

    for (const task of failedTasks) {
      failures.push({
        agent: task.to_profile_id,
        issue: task.message.slice(0, 200),
        remediation: '需要检查任务执行日志',
        suggestedCategory: 'antipatterns',
        confidence: 0.8,
      })
    }

    const patterns = [
      /(?:错误|失败|异常|问题|bug)\s*[:：]?\s*([^。\n]{3,120})/gi,
      /(?:忘记|遗漏|缺失|缺少)\s*([^。\n]{3,80})/g,
    ]

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        failures.push({
          agent: 'unknown',
          issue: match[0].trim(),
          remediation: '从对话上下文中识别',
          suggestedCategory: 'antipatterns',
          confidence: 0.75,
        })
      }
    }

    return failures.slice(0, 10)
  }
}
