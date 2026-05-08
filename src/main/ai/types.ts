// AI Engine 类型定义
// 参考 docs/bytro-reference.md §1-3

// ─── 权限模式 ───
// 4 种权限模式，映射到 Claude CLI 的 --permission-mode 参数
export type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto'

export const PERMISSION_MODES: {
  id: PermissionMode
  label: string
  desc: string
  isDefault?: boolean
  warn?: boolean
}[] = [
  { id: 'manual', label: '手动确认', desc: '每个工具调用都需要手动确认' },
  { id: 'autoEdit', label: '自动编辑', desc: '自动批准文件编辑操作' },
  { id: 'plan', label: 'Plan 模式', desc: '需要批准计划后自动执行', isDefault: true },
  { id: 'fullAuto', label: '全自动', desc: '自动批准所有工具调用', warn: true }
]

// ─── 工具元数据 ───
export interface ToolMeta {
  label: string
  iconKey: string
  color: string
}

/** 核心工具元数据（P0 实现），参考原版 TOOL_META */
export const TOOL_META: Record<string, ToolMeta> = {
  Bash: { label: '执行命令', iconKey: 'terminal', color: '#8B5CF6' },
  Read: { label: '读取文件', iconKey: 'file', color: '#3B82F6' },
  Write: { label: '写入文件', iconKey: 'file-edit', color: '#F59E0B' },
  Edit: { label: '编辑文件', iconKey: 'pencil', color: '#F59E0B' },
  Glob: { label: '查找文件', iconKey: 'folder', color: '#10B981' },
  Grep: { label: '搜索内容', iconKey: 'search', color: '#06B6D4' },
  WebFetch: { label: '网页获取', iconKey: 'globe', color: '#8B5CF6' },
  WebSearch: { label: '网页搜索', iconKey: 'globe', color: '#8B5CF6' },
  Task: { label: '子代理', iconKey: 'bot', color: '#EC4899' },
  Agent: { label: '子代理', iconKey: 'bot', color: '#EC4899' },
  TodoWrite: { label: '任务列表', iconKey: 'list', color: '#F59E0B' },
  NotebookEdit: { label: '笔记本', iconKey: 'file-edit', color: '#10B981' },
  Delete: { label: '删除文件', iconKey: 'trash', color: '#EF4444' },
  AskUserQuestion: { label: 'AI 提问', iconKey: 'message-circle', color: '#8B5CF6' },
  Skill: { label: '技能', iconKey: 'zap', color: '#EC4899' },
  EnterPlanMode: { label: '计划模式', iconKey: 'git-branch', color: '#06B6D4' },
  ExitPlanMode: { label: '退出计划', iconKey: 'git-branch', color: '#06B6D4' }
}

/** 获取工具元数据，MCP 工具自动识别 mcp__serverName__toolName */
export function getToolMeta(toolName: string): ToolMeta {
  if (TOOL_META[toolName]) return TOOL_META[toolName]
  // MCP 工具：mcp__serverName__toolName → serverName:toolName
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    const serverName = parts[1] || ''
    const toolId = parts.slice(2).join('__') || ''
    return { label: `${serverName}:${toolId}`, iconKey: 'cpu', color: '#06B6D4' }
  }
  return { label: toolName, iconKey: 'cpu', color: '#6B7280' }
}

// ─── 消息类型 ───
export interface Message {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCallRecord[]
  usage?: UsageInfo
  createdAt?: string
}

export interface ToolCallRecord {
  id: string
  toolName: string
  toolInput: string
  status: 'running' | 'completed' | 'error'
  result?: string
}

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

// ─── AI 事件类型 ───
// 参考原版 15 种事件 + CLI 特有事件

/** 文本增量 */
export interface TextDeltaEvent {
  type: 'text_delta'
  id: string
  delta: string
}

/** 思考过程增量 */
export interface ThinkingDeltaEvent {
  type: 'thinking_delta'
  delta: string
}

/** AI 回复完成 */
export interface CompleteEvent {
  type: 'complete'
  id: string
  fullText: string
  usage?: UsageInfo
  costUsd?: number
}

/** 请求结束（turn boundary） */
export interface DoneEvent {
  type: 'done'
  id: string
}

/** 错误 */
export interface ErrorEvent {
  type: 'error'
  error: string
}

/** 工具调用开始 */
export interface ToolStartEvent {
  type: 'tool_start'
  toolCallId: string
  toolName: string
  toolInput: string
}

/** 工具调用结果 */
export interface ToolResultEvent {
  type: 'tool_result'
  toolCallId: string
  success: boolean
  result: string
}

/** 工具被拒绝 */
export interface ToolDeniedEvent {
  type: 'tool_denied'
  toolCallId: string
}

/** 权限确认请求 */
export interface PermissionRequestEvent {
  type: 'permission_request'
  confirmId: string
  id: string
  toolName: string
  toolInput: string
}

/** 用户提问 */
export interface AskUserQuestionEvent {
  type: 'ask_user_question'
  confirmId: string
  id: string
  questions: Array<{
    question: string
    header?: string
    multiSelect?: boolean
    options?: Array<{ label: string; description?: string }>
  }>
}

/** 任务列表更新 */
export interface TodoUpdatedEvent {
  type: 'todo_updated'
  todos: Array<{
    content: string
    status: string
    activeForm?: string
  }>
}

/** 子代理启动 */
export interface SubagentStartedEvent {
  type: 'subagent_started'
  agentId: string
  agentType: string
  name: string
  description?: string
}

/** 子代理停止 */
export interface SubagentStoppedEvent {
  type: 'subagent_stopped'
  agentId: string
}

/** 子代理完成 */
export interface SubagentCompletedEvent {
  type: 'subagent_completed'
  agentId: string
  result?: string
}

/** 系统初始化（CLI init 消息） */
export interface SystemInitEvent {
  type: 'system_init'
  sessionId: string
  tools?: string[]
}

/** Token 使用统计 */
export interface UsageEvent {
  type: 'usage'
  usage: UsageInfo
}

/** 配置选项更新（来自 ACP config_option_update） */
export interface ConfigOptionUpdateEvent {
  type: 'config_option_update'
  configOptions: Array<{
    id: string
    name?: string
    label?: string
    category?: string
    type: string
    currentValue?: string
    options?: Array<{ value: string; name?: string }>
  }>
}

/** 模型列表更新（来自 ACP session/new 或 session/update） */
export interface ModelsUpdateEvent {
  type: 'models_update'
  models: Array<{ id: string; name: string; contextWindow: number }>
}

/** 统一 AI 事件联合类型 */
export type AIEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | CompleteEvent
  | DoneEvent
  | ErrorEvent
  | ToolStartEvent
  | ToolResultEvent
  | ToolDeniedEvent
  | PermissionRequestEvent
  | AskUserQuestionEvent
  | TodoUpdatedEvent
  | SubagentStartedEvent
  | SubagentStoppedEvent
  | SubagentCompletedEvent
  | SystemInitEvent
  | UsageEvent
  | ConfigOptionUpdateEvent
  | ModelsUpdateEvent

// ─── AI 请求 ───
export interface AIRequest {
  conversationId: string
  messages: Message[]
  model: string
  provider: string
  permissionMode: PermissionMode
  workingDir?: string
}

