import { randomUUID } from 'crypto'
import { getDb } from '../core/db'
import { createCandidate } from '../core/memory-index'

export interface ChainMemoryDistillate {
  conversationId: string
  agentChain: string[]
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

    const taskRows = db.prepare(
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

    const allText = msgRows.map((m) => m.content).join('\n\n')

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

  async persistToMemoryPalace(distillate: ChainMemoryDistillate): Promise<void> {
    const db = getDb()
    const convRow = db
      .prepare(`SELECT workspace_id FROM conversations WHERE id = ?`)
      .get(distillate.conversationId) as { workspace_id: string | null } | undefined
    if (!convRow?.workspace_id) return

    const workspaceId = convRow.workspace_id

    if (distillate.agentChain.length > 1) {
      createCandidate({
        id: randomUUID(),
        workspace_id: workspaceId,
        kind: 'a2a_chain_summary',
        title: `A2A 协作链: ${distillate.agentChain.join(' → ')}`,
        content: `任务数: ${distillate.taskCount}, 最大深度: ${distillate.maxDepth}`,
        source_conversation_id: distillate.conversationId,
        source_message_id: '',
        confidence: '0.7',
        status: 'captured',
      })
    }

    for (const convention of distillate.conventions) {
      createCandidate({
        id: randomUUID(),
        workspace_id: workspaceId,
        kind: 'a2a_convention',
        title: `协作惯例: ${convention.pattern.slice(0, 50)}`,
        content: convention.pattern,
        source_conversation_id: distillate.conversationId,
        source_message_id: '',
        confidence: '0.6',
        status: 'captured',
      })
    }

    for (const failure of distillate.failures) {
      createCandidate({
        id: randomUUID(),
        workspace_id: workspaceId,
        kind: 'a2a_lesson',
        title: `教训: ${failure.agent} - ${failure.issue.slice(0, 50)}`,
        content: `Agent: ${failure.agent}\n问题: ${failure.issue}\n修复: ${failure.remediation}`,
        source_conversation_id: distillate.conversationId,
        source_message_id: '',
        confidence: '0.8',
        status: 'captured',
      })
    }
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
        })
      }
    }

    return failures.slice(0, 10)
  }
}
