interface ElectronAPI {
  system: {
    getVersion: () => Promise<string>
    showWindow: () => Promise<void>
    hideWindow: () => Promise<void>
    openExternal: (url: string) => Promise<boolean>
    getPaths: () => Promise<Record<string, string>>
  }
  workspace: {
    list: () => Promise<any[]>
    get: (id: string) => Promise<any>
    create: (data: { name: string; description?: string; icon?: string; repo_path?: string }) => Promise<any>
    update: (id: string, data: Record<string, unknown>) => Promise<any>
    delete: (id: string) => Promise<{ success: boolean }>
  }
  conversation: {
    list: (workspaceId?: string) => Promise<any[]>
    get: (id: string) => Promise<any>
    create: (data: { workspace_id?: string; title?: string; model?: string; provider?: string }) => Promise<any>
    update: (id: string, data: Record<string, unknown>) => Promise<any>
    delete: (id: string) => Promise<{ success: boolean }>
    search: (query: string) => Promise<any[]>
    autoTitle: (id: string, title: string) => Promise<{ success: boolean }>
    setTitle: (id: string, title: string) => Promise<{ success: boolean }>
    usageCreate: (data: { conversation_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number; cost_usd?: number }) => Promise<{ id: string }>
    usageList: (conversationId: string) => Promise<Array<{ model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number }>>
    todoSync: (conversationId: string, items: Array<{ content: string; completed: number; order_index: number }>) => Promise<{ success: boolean }>
    todoList: (conversationId: string) => Promise<Array<{ content: string; completed: number }>>
  }
  message: {
    create: (data: {
      conversation_id: string
      role: string
      content: string
      thinking?: string
      tool_calls?: string
      tool_results?: string
      usage?: string
      parent_tool_use_id?: string
    }) => Promise<any>
  }
  chat: {
    startSession: (config: {
      model: string
      permissionMode: string
      workingDir: string
      sessionId?: string
    }) => Promise<any>
    sendMessage: (sessionId: string, content: string) => Promise<void>
    respondPermission: (sessionId: string, approved: boolean) => Promise<void>
    respondQuestion: (sessionId: string, answer: string) => Promise<void>
    abort: (sessionId: string) => Promise<void>
    endSession: (sessionId: string) => Promise<void>
    onEvent: (callback: (event: AIEvent) => void) => () => void
  }
  dialog: {
    openDirectory: () => Promise<string | null>
  }
  memory: {
    recall: (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) => Promise<any[]>
    readProjectMemory: (workspacePath: string) => Promise<string | null>
    writeProjectMemory: (workspacePath: string, content: string) => Promise<void>
    appendProjectMemory: (workspacePath: string, section: string, entry: string) => Promise<void>
    readAgentMemory: (workspacePath: string, agentId: string) => Promise<string | null>
    writeAgentMemory: (workspacePath: string, agentId: string, content: string) => Promise<void>
    createCandidate: (data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }) => Promise<{ id: string }>
    updateCandidateStatus: (id: string, status: string) => Promise<{ success: boolean }>
    listCandidates: (workspaceId: string, status?: string) => Promise<any[]>
    listProjectItems: (workspaceId: string) => Promise<any[]>
    createProjectItem: (data: { workspace_id: string; kind: string; title: string; content: string; source_path?: string; source_hash?: string }) => Promise<{ id: string }>
    createAgentSession: (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq: number; status: string }) => Promise<{ id: string }>
    endAgentSession: (id: string) => Promise<{ success: boolean }>
    listAgentSessions: (conversationId: string) => Promise<any[]>
    getLatestSummary: (conversationId: string) => Promise<any>
    createSummary: (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }) => Promise<{ id: string }>
    upsertAgentProfile: (data: { workspace_id?: string; agent_id: string; content: string; source_path?: string; source_hash?: string }) => Promise<{ success: boolean }>
    getAgentProfile: (workspaceId: string | null, agentId: string) => Promise<any>
  }
}

// AI 事件类型（与 src/main/ai/types.ts 对应）
type AIEvent =
  | { type: 'text_delta'; id: string; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'complete'; id: string; fullText: string; usage?: UsageInfo; costUsd?: number }
  | { type: 'done'; id: string }
  | { type: 'error'; error: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; toolInput: string }
  | { type: 'tool_result'; toolCallId: string; success: boolean; result: string }
  | { type: 'tool_denied'; toolCallId: string }
  | { type: 'permission_request'; confirmId: string; id: string; toolName: string; toolInput: string }
  | { type: 'ask_user_question'; confirmId: string; id: string; questions: Array<{ question: string; options?: string[]; multiSelect?: boolean }> }
  | { type: 'todo_updated'; todos: Array<{ content: string; status: string; activeForm?: string }> }
  | { type: 'subagent_started'; agentId: string; agentType: string; name: string; description?: string }
  | { type: 'subagent_stopped'; agentId: string }
  | { type: 'subagent_completed'; agentId: string; result?: string }
  | { type: 'system_init'; sessionId: string; tools?: string[] }
  | { type: 'usage'; usage: UsageInfo }

type UsageInfo = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}