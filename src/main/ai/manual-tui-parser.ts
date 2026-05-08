import { randomUUID } from 'crypto'
import type { AIEvent } from './types'

const ANSI_ESCAPE_RE =
  /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[PX^_][^\u001B]*\u001B\\|[@-_])/g
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g
const DIVIDER_RE = /^[\s\-─━═]{4,}$/
const PROMPT_RE = /^❯(?:\s.*)?$/

type ToolMatch = {
  toolName: string
  description: string
}

const TOOL_PATTERNS: Array<{ regex: RegExp; toolName: string }> = [
  { regex: /\b(reading|opened|opening|inspecting)\b/i, toolName: 'Read' },
  { regex: /\b(searching|grep|ripgrep)\b/i, toolName: 'Grep' },
  { regex: /\b(finding|listing|glob)\b/i, toolName: 'Glob' },
  { regex: /\b(running|executing|bash|command)\b/i, toolName: 'Bash' },
  { regex: /\b(editing|patching|modifying|updating)\b/i, toolName: 'Edit' },
  { regex: /\b(writing|creating|saving)\b/i, toolName: 'Write' },
  { regex: /\b(deleting|removing)\b/i, toolName: 'Delete' },
  { regex: /\b(todowrite|todo)\b/i, toolName: 'TodoWrite' },
  { regex: /\b(subagent|agent|task)\b/i, toolName: 'Task' },
  { regex: /\b(websearch|searching the web)\b/i, toolName: 'WebSearch' },
  { regex: /\b(webfetch|fetching)\b/i, toolName: 'WebFetch' }
]

const UI_NOISE_PATTERNS = [
  /^Claude Code v/i,
  /^Sonnet\b/i,
  /^Opus\b/i,
  /^API Usage Billing$/i,
  /^https?:\/\//i,
  /^\? for shortcuts$/i,
  /^ctrl\+g to edit in Vim$/i,
  /^Showing detailed transcript\b/i,
  /^high · \/effort$/i,
  /^verbose$/i
]

function normalizeChunk(raw: string): string {
  return raw
    .replace(ANSI_ESCAPE_RE, '')
    .replace(/\r/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(/\u00a0/g, ' ')
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function isUiNoise(line: string): boolean {
  if (!line) return true
  if (DIVIDER_RE.test(line)) return true
  if (PROMPT_RE.test(line)) return true
  return UI_NOISE_PATTERNS.some((pattern) => pattern.test(line))
}

function detectTool(line: string): ToolMatch | null {
  const bulletMatch = line.match(/^[⏺•]\s+(.*)$/)
  if (!bulletMatch) return null

  const description = bulletMatch[1]?.trim() || ''
  for (const pattern of TOOL_PATTERNS) {
    if (pattern.regex.test(description)) {
      return {
        toolName: pattern.toolName,
        description
      }
    }
  }
  return null
}

function isPermissionPrompt(line: string, hasActiveTool: boolean): boolean {
  if (!hasActiveTool) {
    return false
  }

  return (
    /(approve|approval|allow|deny|reject|permission)/i.test(line) ||
    /(allow|run|execute|edit|write|modify|delete).*(tool|command|file|changes?)/i.test(line) ||
    /\byes\b.*\bno\b/i.test(line)
  )
}

function isQuestionPrompt(line: string): boolean {
  if (!line.includes('?')) return false
  return /(which|what|how|choose|select|pick|proceed)/i.test(line)
}

function isAssistantBullet(line: string): boolean {
  const bulletMatch = line.match(/^[⏺•]\s+(.*)$/)
  if (!bulletMatch) return false
  return detectTool(line) === null
}

export class ManualTuiParser {
  private inTurn = false
  private sawModelActivity = false
  private assistantText = ''
  private lastAssistantLine = ''
  private currentSection: 'assistant' | 'tool' | null = null
  private activeToolId: string | null = null
  private activeToolName: string | null = null
  private activeToolTrace: string[] = []
  private pendingInteraction: 'permission' | 'question' | null = null
  private pendingInteractionFingerprint = ''

  constructor(private readonly sessionId: string) {}

  beginTurn(): void {
    this.inTurn = true
    this.sawModelActivity = false
    this.assistantText = ''
    this.lastAssistantLine = ''
    this.currentSection = null
    this.activeToolId = null
    this.activeToolName = null
    this.activeToolTrace = []
    this.pendingInteraction = null
    this.pendingInteractionFingerprint = ''
  }

  resolveInteraction(): void {
    this.pendingInteraction = null
    this.pendingInteractionFingerprint = ''
  }

  cancelTurn(): void {
    this.beginTurn()
    this.inTurn = false
  }

  consume(raw: string): AIEvent[] {
    const normalized = normalizeChunk(raw)
    const lines = normalized
      .split('\n')
      .map(normalizeLine)
      .filter(Boolean)

    if (lines.length === 0) {
      return []
    }

    const events: AIEvent[] = []
    let sawPrompt = false

    for (const line of lines) {
      if (PROMPT_RE.test(line)) {
        sawPrompt = true
        continue
      }

      if (isUiNoise(line)) {
        continue
      }

      const tool = detectTool(line)
      if (tool) {
        this.sawModelActivity = true
        this.resolveInteraction()
        events.push(...this.startTool(tool))
        continue
      }

      if (isPermissionPrompt(line, Boolean(this.activeToolId))) {
        this.sawModelActivity = true
        events.push(...this.emitPermissionPrompt(line))
        continue
      }

      if (isQuestionPrompt(line)) {
        this.sawModelActivity = true
        events.push(...this.emitQuestionPrompt(line))
        continue
      }

      if (line.startsWith('⎿')) {
        this.sawModelActivity = true
        this.currentSection = this.activeToolId ? 'tool' : this.currentSection
        this.activeToolTrace.push(line.replace(/^⎿\s*/, '').trim())
        continue
      }

      if (isAssistantBullet(line)) {
        this.sawModelActivity = true
        events.push(...this.closeActiveTool())
        events.push(...this.appendAssistantLine(line.replace(/^[⏺•]\s+/, '').trim()))
        continue
      }

      if (this.currentSection === 'assistant') {
        this.sawModelActivity = true
        events.push(...this.appendAssistantLine(line))
        continue
      }

      if (this.currentSection === 'tool' && this.activeToolId) {
        this.sawModelActivity = true
        this.activeToolTrace.push(line)
        continue
      }
    }

    if (sawPrompt && this.inTurn && this.sawModelActivity && !this.pendingInteraction) {
      events.push(...this.finishTurn())
    }

    return events
  }

  private startTool(tool: ToolMatch): AIEvent[] {
    const events = this.closeActiveTool()
    const toolCallId = randomUUID()
    this.activeToolId = toolCallId
    this.activeToolName = tool.toolName
    this.activeToolTrace = [tool.description]
    this.currentSection = 'tool'

    events.push({
      type: 'tool_start',
      toolCallId,
      toolName: tool.toolName,
      toolInput: tool.description
    } as AIEvent)

    if (tool.toolName === 'Task') {
      events.push({
        type: 'subagent_started',
        agentId: toolCallId,
        agentType: 'subagent',
        name: tool.description
      } as AIEvent)
    }

    return events
  }

  private closeActiveTool(): AIEvent[] {
    if (!this.activeToolId || !this.activeToolName) {
      return []
    }

    const toolCallId = this.activeToolId
    const toolName = this.activeToolName
    const result = this.activeToolTrace.join('\n').trim() || toolName

    this.activeToolId = null
    this.activeToolName = null
    this.activeToolTrace = []
    this.currentSection = null

    const events: AIEvent[] = [
      {
        type: 'tool_result',
        toolCallId,
        success: true,
        result
      } as AIEvent
    ]

    if (toolName === 'Task') {
      events.push({
        type: 'subagent_completed',
        agentId: toolCallId,
        result
      } as AIEvent)
    }

    return events
  }

  private appendAssistantLine(line: string): AIEvent[] {
    if (!line || line === this.lastAssistantLine) {
      return []
    }

    this.currentSection = 'assistant'
    this.lastAssistantLine = line
    this.assistantText += (this.assistantText ? '\n' : '') + line

    return [
      {
        type: 'text_delta',
        id: this.sessionId,
        delta: `${line}\n`
      } as AIEvent
    ]
  }

  private emitPermissionPrompt(line: string): AIEvent[] {
    const fingerprint = `permission:${line}`
    if (this.pendingInteraction === 'permission' && this.pendingInteractionFingerprint === fingerprint) {
      return []
    }

    this.pendingInteraction = 'permission'
    this.pendingInteractionFingerprint = fingerprint

    return [
      {
        type: 'permission_request',
        confirmId: randomUUID(),
        id: this.activeToolId || randomUUID(),
        toolName: this.activeToolName || 'Claude Action',
        toolInput: line
      } as AIEvent
    ]
  }

  private emitQuestionPrompt(line: string): AIEvent[] {
    const fingerprint = `question:${line}`
    if (this.pendingInteraction === 'question' && this.pendingInteractionFingerprint === fingerprint) {
      return []
    }

    this.pendingInteraction = 'question'
    this.pendingInteractionFingerprint = fingerprint

    return [
      {
        type: 'ask_user_question',
        confirmId: randomUUID(),
        id: randomUUID(),
        questions: [{ question: line }]
      } as AIEvent
    ]
  }

  private finishTurn(): AIEvent[] {
    const events = this.closeActiveTool()
    const fullText = this.assistantText.trim()

    this.inTurn = false
    this.sawModelActivity = false
    this.assistantText = ''
    this.lastAssistantLine = ''
    this.currentSection = null
    this.pendingInteraction = null
    this.pendingInteractionFingerprint = ''

    if (fullText) {
      events.push({
        type: 'complete',
        id: this.sessionId,
        fullText
      } as AIEvent)
    }

    events.push({
      type: 'done',
      id: this.sessionId
    } as AIEvent)

    return events
  }
}
