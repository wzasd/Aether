/**
 * Chat-Bridge Sidecar — MCP server for agent-to-daemon communication
 *
 * Entry point for the sidecar process. Spawned by daemon per-agent.
 * Communicates with agent CLI via stdio MCP transport,
 * and with daemon via HTTP Bridge API.
 *
 * Usage: node bytro-chat-bridge.js \
 *   --api-url http://127.0.0.1:{port} \
 *   --auth-token <token> \
 *   --profile-id <profileId> \
 *   --conversation-id <conversationId> \
 *   --stdio
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { writeObservabilityEvent } from '../core/logging'
import {
  toolDescriptions,
  formatSendMessageResult,
  formatCheckMessagesResult,
  formatReadHistoryResult,
  formatSearchMessagesResult,
  formatListChannelsResult,
  formatListTasksResult,
  formatClaimTaskResult,
  formatUpdateTaskStatusResult,
  formatUploadAttachmentResult,
} from './tools'
import {
  MCP_SERVER_NAME,
  type SendMessageOutput,
  type CheckMessagesOutput,
  type ReadHistoryOutput,
  type SearchMessagesOutput,
  type ListChannelsOutput,
  type ListTasksOutput,
  type ClaimTaskOutput,
  type UpdateTaskStatusOutput,
  type UploadAttachmentOutput,
} from './types'

// ─── CLI Args ───────────────────────────────────────────────────────────────

interface BridgeCliArgs {
  apiUrl: string
  authToken: string
  profileId: string
  conversationId: string
  stdio: boolean
}

function parseArgs(): BridgeCliArgs {
  const args = process.argv.slice(2)
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined
  }

  const apiUrl = getArg('--api-url')
  const authToken = getArg('--auth-token')
  const profileId = getArg('--profile-id')
  const conversationId = getArg('--conversation-id')
  const stdio = args.includes('--stdio')

  if (!apiUrl || !authToken || !profileId) {
    console.error('[chat-bridge] Missing required args: --api-url, --auth-token, --profile-id')
    process.exit(1)
  }

  return { apiUrl, authToken, profileId, conversationId: conversationId || '', stdio }
}

// ─── API Client ─────────────────────────────────────────────────────────────

class BridgeApiClient {
  private baseUrl: string
  private authToken: string

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.authToken = authToken
  }

  private async requestJson<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Bridge API error ${response.status}: ${text}`)
    }

    return response.json() as Promise<T>
  }

  private async requestText(path: string, options?: RequestInit): Promise<string> {
    const url = `${this.baseUrl}${path}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Bridge API error ${response.status}: ${text}`)
    }

    return response.text()
  }

  async sendMessage(body: unknown) {
    return this.requestJson('/message/send', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async checkMessages(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.requestText(`/message/check${query}`)
  }

  async readHistory(params: Record<string, string>) {
    const query = '?' + new URLSearchParams(params).toString()
    return this.requestText(`/message/read${query}`)
  }

  async searchMessages(params: Record<string, string>) {
    const query = '?' + new URLSearchParams(params).toString()
    return this.requestText(`/message/search${query}`)
  }

  async listTasks(params: Record<string, string>) {
    const query = '?' + new URLSearchParams(params).toString()
    return this.requestText(`/task/list${query}`)
  }

  async claimTask(body: unknown) {
    return this.requestJson('/task/claim', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateTaskStatus(body: unknown) {
    return this.requestJson('/task/update', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async listChannels() {
    return this.requestText('/channel/list')
  }

  async uploadAttachment(body: unknown) {
    return this.requestJson('/attachment/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }
}

// ─── Message Cache ──────────────────────────────────────────────────────────

class MessageCache {
  private cache = new Map<string, boolean>()
  private maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  has(seq: number, msgId: string): boolean {
    return this.cache.has(`${seq}:${msgId}`)
  }

  add(seq: number, msgId: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(`${seq}:${msgId}`, true)
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()

  writeObservabilityEvent('chat_bridge:started', {
    profileId: args.profileId,
    conversationId: args.conversationId,
    apiUrl: args.apiUrl,
  })

  const apiClient = new BridgeApiClient(args.apiUrl, args.authToken)
  const messageCache = new MessageCache()

  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.entries(toolDescriptions).map(([name, meta]) => ({
        name,
        description: meta.description,
        inputSchema: zodToJsonSchema(meta.schema),
      })),
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: params } = request.params

    try {
      let result: unknown

      switch (name) {
        case 'send_message':
          result = await apiClient.sendMessage(params)
          break
        case 'check_messages':
          result = await apiClient.checkMessages(params as Record<string, string>)
          break
        case 'read_history':
          result = await apiClient.readHistory(params as Record<string, string>)
          break
        case 'search_messages':
          result = await apiClient.searchMessages(params as Record<string, string>)
          break
        case 'list_tasks':
          result = await apiClient.listTasks(params as Record<string, string>)
          break
        case 'claim_task':
          result = await apiClient.claimTask(params)
          break
        case 'update_task_status':
          result = await apiClient.updateTaskStatus(params)
          break
        case 'list_channels':
          result = await apiClient.listChannels()
          break
        case 'upload_attachment':
          result = await apiClient.uploadAttachment(params)
          break
        default:
          throw new Error(`Unknown tool: ${name}`)
      }

      return {
        content: [
          {
            type: 'text',
            text: formatResult(name, result),
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeObservabilityEvent('chat_bridge:tool_error', {
        profileId: args.profileId,
        tool: name,
        error: message,
      })
      return {
        content: [
          {
            type: 'text',
            text: `错误: ${message}`,
          },
        ],
        isError: true,
      }
    }
  })

  if (args.stdio) {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('[chat-bridge] MCP server connected via stdio')
  } else {
    console.error('[chat-bridge] --stdio required')
    process.exit(1)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────



function formatResult(toolName: string, result: unknown): string {
  // ADR-015: All MCP tool responses must be human-readable prose, not JSON.
  // GET endpoints (check_messages, read_history, search_messages, list_channels)
  // already return text/plain from Bridge API — pass through directly.
  // POST endpoints (send_message, claim_task, update_task_status) return JSON
  // — apply prose formatter from tools.ts.
  switch (toolName) {
    case 'send_message':
      return formatSendMessageResult(result as SendMessageOutput)
    case 'check_messages':
    case 'read_history':
    case 'search_messages':
    case 'list_channels':
      // Bridge API returns text/plain — result is already prose
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    case 'list_tasks':
      // list_tasks returns text/plain from Bridge API
      return typeof result === 'string' ? result : formatListTasksResult(result as ListTasksOutput)
    case 'claim_task':
      return formatClaimTaskResult(result as ClaimTaskOutput)
    case 'update_task_status':
      return formatUpdateTaskStatusResult(result as UpdateTaskStatusOutput)
    case 'upload_attachment':
      return formatUploadAttachmentResult(result as UploadAttachmentOutput)
    default:
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('[chat-bridge] Fatal error:', error)
  process.exit(1)
})
