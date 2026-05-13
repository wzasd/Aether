/**
 * ResumeContext — generates a concise textual summary of the previous turn
 * for spawn providers that do not support cross-turn session resume.
 *
 * Inspired by Slock 0.48.0's resumePrompt mechanism.
 * The summary is injected into the next turn's system prompt so the agent
 * knows what it did, what decisions it made, and what remains unfinished.
 */

import type { A2ATask } from './a2a-types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default token budget for resumeContext (approximate). */
export const DEFAULT_RESUME_TOKEN_BUDGET = 800

/** Elastic upper limit when "unfinished items" section exceeds budget. */
export const ELASTIC_RESUME_TOKEN_BUDGET = 1200

/** Rough chars-per-token estimate for CJK + English mixed text. */
const CHARS_PER_TOKEN = 3

/** Keywords for heuristic "key decision" extraction. */
const DECISION_KEYWORDS = [
  '决定', '决策', '选择', '采用', '拒绝', '确认',
  'fix', 'implement', 'refactor', 'approve', 'reject', 'decide',
  '同意', '否决', '通过', '不通过',
  'done', 'completed', 'skip', '放弃', '跳过',
]

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResumeContextInput {
  task: A2ATask
  accumulatedOutput: string
  terminalError: string | null
  userMessage: string
}

export interface ResumeContextOptions {
  tokenBudget?: number
  elasticBudget?: number
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a structured resumeContext text from the previous turn's output.
 *
 * The output is a markdown-like structured text that can be appended to the
 * system prompt. It includes:
 * - User request (original input)
 * - Status (completed / failed / aborted)
 * - Summary of work done
 * - Key decisions (heuristic extraction)
 * - Unfinished items (tool calls, sub-tasks)
 * - Error info (if any)
 */
export function generateResumeContext(
  input: ResumeContextInput,
  options: ResumeContextOptions = {}
): string {
  const { task, accumulatedOutput, terminalError, userMessage } = input
  const budget = options.tokenBudget ?? DEFAULT_RESUME_TOKEN_BUDGET
  const elastic = options.elasticBudget ?? ELASTIC_RESUME_TOKEN_BUDGET

  const statusLine = buildStatusLine(task, terminalError)
  const userRequestLine = buildUserRequestLine(userMessage)
  const workSummary = buildWorkSummary(accumulatedOutput)
  const decisions = buildDecisions(accumulatedOutput)
  const unfinished = buildUnfinishedItems(task, accumulatedOutput)
  const errorInfo = buildErrorInfo(terminalError)

  const sections = [
    statusLine,
    userRequestLine,
    workSummary,
    decisions,
    unfinished,
    errorInfo,
  ].filter(Boolean) as string[]

  let text = sections.join('\n')
  text = truncateToBudget(text, budget, elastic, unfinished)

  return text
}

/** Check whether the given text already contains a resumeContext block. */
export function hasResumeContext(text: string): boolean {
  return text.includes('## 上一轮上下文摘要')
}

// ─── Builders ───────────────────────────────────────────────────────────────

function buildStatusLine(task: A2ATask, terminalError: string | null): string {
  if (terminalError) return '- 状态: 失败（运行中断）'
  if (task.status === 'completed') return '- 状态: 已完成'
  if (task.status === 'failed') return '- 状态: 失败'
  return '- 状态: 中断'
}

function buildUserRequestLine(userMessage: string): string {
  const truncated = userMessage.slice(0, 200).replace(/\s+/g, ' ').trim()
  return `- 用户请求: ${truncated}${userMessage.length > 200 ? '…' : ''}`
}

function buildWorkSummary(accumulatedOutput: string): string {
  if (!accumulatedOutput.trim()) return '- 主要工作:（无文本输出）'
  const summary = accumulatedOutput
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 300)
  return `- 主要工作: ${summary}${accumulatedOutput.length > 300 ? '…' : ''}`
}

function buildDecisions(accumulatedOutput: string): string | null {
  if (!accumulatedOutput.trim()) return null

  const lines = accumulatedOutput.split(/\n+/)
  const decisionLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const hasKeyword = DECISION_KEYWORDS.some((kw) =>
      trimmed.toLowerCase().includes(kw.toLowerCase())
    )
    if (hasKeyword) {
      decisionLines.push(trimmed)
      if (decisionLines.length >= 5) break
    }
  }

  if (decisionLines.length === 0) return null

  const items = decisionLines
    .map((d) => `  - ${d.slice(0, 120)}${d.length > 120 ? '…' : ''}`)
    .join('\n')

  return `- 关键决策:\n${items}`
}

function buildUnfinishedItems(
  task: A2ATask,
  _accumulatedOutput: string
): string | null {
  // Heuristic: unfinished items are derived from task status.
  // We do not inspect accumulatedOutput XML because it is already parsed
  // into AIEvent streams by the provider; the raw text may not contain
  // <tool_call> tags.
  if (task.status === 'completed') {
    return null
  }

  const items: string[] = []

  if (task.status === 'working' || task.status === 'pending') {
    items.push('  - 主任务尚未完成')
  }

  if (task.status === 'failed') {
    items.push('  - 任务执行失败')
  }

  if (items.length === 0) return null
  return `- 未完成事项:\n${items.join('\n')}`
}

function buildErrorInfo(terminalError: string | null): string | null {
  if (!terminalError) return null
  const truncated = terminalError.slice(0, 200).replace(/\s+/g, ' ').trim()
  return `- 错误信息: ${truncated}${terminalError.length > 200 ? '…' : ''}`
}

// ─── Truncation ─────────────────────────────────────────────────────────────

function truncateToBudget(
  text: string,
  budget: number,
  elastic: number,
  unfinishedSection: string | null
): string {
  const maxChars = budget * CHARS_PER_TOKEN
  const elasticChars = elastic * CHARS_PER_TOKEN

  if (text.length <= maxChars) return text

  // If unfinished section is present and exceeds budget, allow elastic limit
  if (unfinishedSection && text.length <= elasticChars) {
    return text
  }

  // Hard truncate at elastic limit, preferring to keep the end (unfinished + error)
  const limit = text.length > elasticChars ? elasticChars : maxChars

  // Try to truncate gracefully at a line boundary
  const truncated = text.slice(0, limit)
  const lastNewline = truncated.lastIndexOf('\n')
  if (lastNewline > limit * 0.8) {
    return truncated.slice(0, lastNewline) + '\n\n[上下文摘要已截断…]'
  }

  return truncated + '\n\n[上下文摘要已截断…]'
}
