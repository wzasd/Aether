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
import { writeObservabilityEvent } from '../core/logging'
import { toolDescriptions } from './tools'
import { MCP_SERVER_NAME } from './types'

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

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
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

  async sendMessage(body: unknown) {
    return this.request('/message/send', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async checkMessages(params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : ''
    return this.request(`/message/check${query}`)
  }

  async readHistory(params: Record<string, string>) {
    const query = '?' + new URLSearchParams(params).toString()
    return this.request(`/message/read${query}`)
  }

  async searchMessages(params: Record<string, string>) {
    const query = '?' + new URLSearchParams(params).toString()
    return this.request(`/message/search${query}`)
  }

  async listTasks(params: Record<string, string>) {
    const query = '?' + new URLSearchParams(params).toString()
    return this.request(`/task/list${query}`)
  }

  async claimTask(body: unknown) {
    return this.request('/task/claim', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateTaskStatus(body: unknown) {
    return this.request('/task/update', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async listChannels() {
    return this.request('/channel/list')
  }

  async uploadAttachment(body: unknown) {
    return this.request('/attachment/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }
}

// ─── Message Cache ──────────────────────────────────────────────────────────

class MessageCache {
  private cache = new Map<number, boolean>()
  private maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  has(seq: number): boolean {
    return this.cache.has(seq)
  }

  add(seq: number): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(seq, true)
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
      name: 'bytro-chat-bridge',
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

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Minimal Zod-to-JSON-Schema converter for MCP registration
  // In production, use zod-to-json-schema package
  const description = schema._def.description || ''
  return {
    type: 'object',
    description,
    properties: {},
    required: [],
  }
}

function formatResult(toolName: string, result: unknown): string {
  // In production, use the formatters from tools.ts
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('[chat-bridge] Fatal error:', error)
  process.exit(1)
})
