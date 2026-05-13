/**
 * Chat-Bridge Types — shared between sidecar (MCP server) and daemon (Bridge API)
 *
 * Aligned with Slock 0.48.0 chat-bridge design.
 */

// ─── Tool Input Types ───────────────────────────────────────────────────────

export interface SendMessageInput {
  /** Target channel reference. Format: `conv:<conversationId>` */
  target: string
  /** Message content. Supports markdown. */
  content: string
  /** Optional thread reference. Format: `conv:<conversationId>:<messageId>` */
  threadRef?: string
}

export interface CheckMessagesInput {
  /** Optional channel to check. If omitted, check all subscribed channels. */
  channel?: string
}

export interface ReadHistoryInput {
  /** Channel reference. Format: `conv:<conversationId>` */
  channel: string
  /** Number of messages to return (default 50, max 100) */
  limit?: number
  /** Pagination: return messages before this seq number */
  before?: number
}

export interface SearchMessagesInput {
  /** Search query. FTS5 syntax supported. */
  query: string
  /** Optional channel scope */
  channel?: string
  /** Max results (default 10, max 20) */
  limit?: number
}

export interface ClaimTaskInput {
  /** Channel reference */
  channel: string
  /** Task number (from list_tasks) */
  taskNumber: number
}

export interface UpdateTaskStatusInput {
  /** Channel reference */
  channel: string
  /** Task number */
  taskNumber: number
  /** New status */
  status: 'in_progress' | 'in_review' | 'done' | 'closed'
  /** Optional result summary */
  result?: string
}

export interface UploadAttachmentInput {
  /** Absolute file path */
  filePath: string
  /** Optional channel to associate with */
  channel?: string
}

// ─── Tool Output Types ──────────────────────────────────────────────────────

export interface SendMessageOutput {
  /** Message seq number */
  seq: number
  /** Message ID */
  messageId: string
  /** Delivery status */
  status: 'delivered' | 'pending'
}

export interface MessageEntry {
  seq: number
  messageId: string
  timestamp: string
  type: 'human' | 'agent' | 'system'
  sender: string
  content: string
  relevanceScore?: number
}

export interface CheckMessagesOutput {
  /** Whether there are new messages */
  hasNew: boolean
  /** Number of unread messages */
  unreadCount: number
  /** Summaries of new messages (first 3) */
  previews: Array<{ channel: string; sender: string; preview: string }>
}

export interface ReadHistoryOutput {
  messages: MessageEntry[]
  /** Next seq for pagination (null if no more) */
  nextBefore: number | null
}

export interface SearchMessagesOutput {
  results: Array<MessageEntry & { rank: number }>
}

export interface TaskEntry {
  taskNumber: number
  title: string
  status: string
  assignee: string | null
  messageId: string
}

export interface ListTasksOutput {
  tasks: TaskEntry[]
}

export interface ClaimTaskOutput {
  success: boolean
  taskNumber: number
  status: string
}

export interface UpdateTaskStatusOutput {
  success: boolean
  taskNumber: number
  previousStatus: string
  currentStatus: string
}

export interface ChannelEntry {
  channelRef: string
  name: string
  unreadCount: number
  lastMessageAt: string
}

export interface ListChannelsOutput {
  channels: ChannelEntry[]
}

export interface UploadAttachmentOutput {
  attachmentId: string
  fileName: string
  url: string
}

// ─── Bridge Config ──────────────────────────────────────────────────────────

export interface BridgeConfig {
  /** Daemon Bridge API base URL */
  apiUrl: string
  /** Per-agent auth token */
  authToken: string
  /** Agent profile ID */
  profileId: string
  /** Current conversation ID (primary) */
  conversationId: string
  /** Working directory */
  workingDir: string
  /** DB path for direct reads (optional, if HTTP disabled) */
  dbPath?: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const MCP_SERVER_NAME = 'chat'

export const DEFAULT_HISTORY_LIMIT = 50
export const MAX_HISTORY_LIMIT = 100

export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 20

export const MESSAGE_CACHE_SIZE = 1000

/** Human-readable tool descriptions (prose, not JSON) */
export const TOOL_DESCRIPTIONS = {
  send_message: `向指定的 channel 或 thread 发送消息。target 格式为 "conv:<conversationId>" 或 "conv:<conversationId>:<messageId>"（thread）。content 支持 markdown。`,
  check_messages: `非阻塞检查是否有新消息。返回未读消息数量和前 3 条预览。`,
  read_history: `读取指定 channel 的对话历史。limit 默认 50，最大 100。支持分页（before 参数）。返回人类可读的格式化消息列表。`,
  search_messages: `用 FTS5 全文搜索查找历史消息。query 支持关键词和短语。`,
  claim_task: `认领 channel 里的一个待办任务。需要先调用 list_tasks 获取任务编号。`,
  update_task_status: `更新已认领任务的状态。status 可选：in_progress / in_review / done / closed。`,
  list_channels: `列出当前 agent 参与的所有活跃 channel（conversation）。`,
  upload_attachment: `上传文件附件。filePath 必须是绝对路径。`,
} as const
