/**
 * MCP Tools — Zod schemas and implementations for chat-bridge sidecar
 *
 * These tools are registered with the MCP server and called by the agent CLI
 * via stdio MCP transport. All responses are formatted as human-readable prose.
 */

import { z } from 'zod'
import type {
  SendMessageInput,
  CheckMessagesInput,
  ReadHistoryInput,
  SearchMessagesInput,
  ClaimTaskInput,
  UpdateTaskStatusInput,
  ListChannelsOutput,
  SendMessageOutput,
  CheckMessagesOutput,
  ReadHistoryOutput,
  SearchMessagesOutput,
  ListTasksOutput,
  ClaimTaskOutput,
  UpdateTaskStatusOutput,
  UploadAttachmentOutput,
} from './types'
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  TOOL_DESCRIPTIONS,
} from './types'

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const SendMessageSchema = z.object({
  target: z.string().describe('Target channel or thread reference'),
  content: z.string().describe('Message content (markdown supported)'),
  threadRef: z.string().optional().describe('Optional thread reference'),
})

export const CheckMessagesSchema = z.object({
  channel: z.string().optional().describe('Optional channel to check'),
})

export const ReadHistorySchema = z.object({
  channel: z.string().describe('Channel reference'),
  limit: z.number().int().min(1).max(MAX_HISTORY_LIMIT).optional().describe('Number of messages'),
  before: z.number().int().optional().describe('Pagination: seq number'),
})

export const SearchMessagesSchema = z.object({
  query: z.string().describe('Search query (FTS5 syntax)'),
  channel: z.string().optional().describe('Optional channel scope'),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
})

export const ClaimTaskSchema = z.object({
  channel: z.string().describe('Channel reference'),
  taskNumber: z.number().int().positive().describe('Task number from list_tasks'),
})

export const UpdateTaskStatusSchema = z.object({
  channel: z.string().describe('Channel reference'),
  taskNumber: z.number().int().positive().describe('Task number'),
  status: z.enum(['in_progress', 'in_review', 'done', 'closed']).describe('New status'),
  result: z.string().optional().describe('Optional result summary'),
})

export const ListChannelsSchema = z.object({})

export const UploadAttachmentSchema = z.object({
  filePath: z.string().describe('Absolute file path'),
  channel: z.string().optional().describe('Optional channel association'),
})

// ─── Response Formatters ────────────────────────────────────────────────────

/** Format send_message response as human-readable prose */
export function formatSendMessageResult(result: SendMessageOutput): string {
  return `消息已发送（seq=${result.seq}，id=${result.messageId}）`
}

/** Format check_messages response as human-readable prose */
export function formatCheckMessagesResult(result: CheckMessagesOutput): string {
  if (!result.hasNew) {
    return '没有新消息。'
  }
  const lines = [
    `有 ${result.unreadCount} 条未读消息。`,
    ...result.previews.map((p, i) => `${i + 1}. [${p.channel}] ${p.sender}: ${p.preview}`),
  ]
  return lines.join('\n')
}

/** Format read_history response as human-readable prose */
export function formatReadHistoryResult(result: ReadHistoryOutput): string {
  if (result.messages.length === 0) {
    return '（暂无对话历史）'
  }
  const lines = result.messages.map((m) => {
    const header = `[seq=${m.seq} msg=${m.messageId} time=${m.timestamp} type=${m.type}] ${m.sender}:`
    return `${header}\n${m.content}`
  })
  if (result.nextBefore !== null) {
    lines.push(`\n[还有更多历史消息，使用 before=${result.nextBefore} 分页读取]`)
  }
  return lines.join('\n\n')
}

/** Format search_messages response as human-readable prose */
export function formatSearchMessagesResult(result: SearchMessagesOutput): string {
  if (result.results.length === 0) {
    return '没有找到匹配的消息。'
  }
  const lines = [
    `找到 ${result.results.length} 条相关消息：`,
    ...result.results.map((r, i) => `${i + 1}. [seq=${r.seq}] ${r.sender}: ${r.content.slice(0, 200)}${r.content.length > 200 ? '…' : ''}`),
  ]
  return lines.join('\n')
}

/** Format list_channels response as human-readable prose */
export function formatListChannelsResult(result: ListChannelsOutput): string {
  if (result.channels.length === 0) {
    return '当前没有参与的 channel。'
  }
  const lines = [
    `你参与了 ${result.channels.length} 个 channel：`,
    ...result.channels.map((c) => `- ${c.name} (${c.channelRef}) — 未读 ${c.unreadCount} 条，最后消息 ${c.lastMessageAt}`),
  ]
  return lines.join('\n')
}

/** Format list_tasks response as human-readable prose */
export function formatListTasksResult(result: ListTasksOutput): string {
  if (result.tasks.length === 0) {
    return '当前没有待办任务。'
  }
  const lines = [
    `当前有 ${result.tasks.length} 个任务：`,
    ...result.tasks.map((t) => `- #${t.taskNumber} [${t.status}] ${t.title}${t.assignee ? `（负责人：${t.assignee}）` : ''}`),
  ]
  return lines.join('\n')
}

/** Format claim_task response as human-readable prose */
export function formatClaimTaskResult(result: ClaimTaskOutput): string {
  return result.success
    ? `任务 #${result.taskNumber} 认领成功，当前状态：${result.status}`
    : `任务 #${result.taskNumber} 认领失败，可能已被他人认领。`
}

/** Format update_task_status response as human-readable prose */
export function formatUpdateTaskStatusResult(result: UpdateTaskStatusOutput): string {
  return result.success
    ? `任务 #${result.taskNumber} 状态已更新：${result.previousStatus} → ${result.currentStatus}`
    : `任务 #${result.taskNumber} 状态更新失败。`
}

/** Format upload_attachment response as human-readable prose */
export function formatUploadAttachmentResult(result: UploadAttachmentOutput): string {
  return `文件已上传：${result.fileName}（${result.attachmentId}）\n下载链接：${result.url}`
}

// ─── Tool Descriptions (for MCP server registration) ────────────────────────

export const toolDescriptions = {
  send_message: {
    description: TOOL_DESCRIPTIONS.send_message,
    schema: SendMessageSchema,
  },
  check_messages: {
    description: TOOL_DESCRIPTIONS.check_messages,
    schema: CheckMessagesSchema,
  },
  read_history: {
    description: TOOL_DESCRIPTIONS.read_history,
    schema: ReadHistorySchema,
  },
  search_messages: {
    description: TOOL_DESCRIPTIONS.search_messages,
    schema: SearchMessagesSchema,
  },
  list_tasks: {
    description: '列出当前 channel 的所有待办任务。',
    schema: z.object({ channel: z.string().describe('Channel reference') }),
  },
  claim_task: {
    description: '认领 channel 里的一个待办任务。',
    schema: ClaimTaskSchema,
  },
  update_task_status: {
    description: '更新已认领任务的状态。',
    schema: UpdateTaskStatusSchema,
  },
  list_channels: {
    description: '列出当前 agent 参与的所有活跃 channel（conversation）。',
    schema: ListChannelsSchema,
  },
  upload_attachment: {
    description: TOOL_DESCRIPTIONS.upload_attachment,
    schema: UploadAttachmentSchema,
  },
} as const
