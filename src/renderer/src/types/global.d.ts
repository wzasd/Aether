declare global {
  type UsageInfo = {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }

  type AIEvent =
    | { type: 'text_delta'; id: string; delta: string }
    | { type: 'thinking_delta'; delta: string }
    | { type: 'complete'; id: string; fullText: string; usage?: UsageInfo; costUsd?: number; sessionId?: string; agentProfileId?: string | null; taskId?: string; conversationId?: string }
    | { type: 'done'; id: string }
    | { type: 'error'; error: string; id?: string; sessionId?: string }
    | { type: 'tool_start'; toolCallId: string; toolName: string; toolInput: string }
    | { type: 'tool_result'; toolCallId: string; success: boolean; result: string; sessionId?: string }
    | { type: 'tool_denied'; toolCallId: string }
    | { type: 'permission_request'; confirmId: string; id: string; toolName: string; toolInput: string; sessionId?: string }
    | { type: 'ask_user_question'; confirmId: string; id: string; questions: Array<{ question: string; header?: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> }>; sessionId?: string }
    | { type: 'todo_updated'; todos: Array<{ content: string; status: string; activeForm?: string }> }
    | { type: 'subagent_update'; subagent: { id: string; name: string; type: string; status: string } }
    | { type: 'agent_thinking'; conversationId: string; agentProfileId: string; agentName: string; agentRole?: string }
    | { type: 'agent_observation'; conversationId: string; agentProfileId: string; agentName: string; content: string; timestamp: number; relevanceScore: number }
    | { type: 'open_floor_closed'; conversationId: string; totalResponses: number; skippedAgents: number }
    | { type: 'subagent_started'; agentId: string; agentType: string; name: string; description?: string; sessionId?: string }
    | { type: 'subagent_stopped'; agentId: string }
    | { type: 'subagent_completed'; agentId: string; result?: string }
    | { type: 'system_init'; sessionId: string; tools?: string[] }
    | { type: 'system_message'; conversationId: string; content: string }
    | { type: 'usage'; usage: UsageInfo }
    | { type: 'config_option_update'; configOptions: Array<{ id: string; name?: string; label?: string; category?: string; type: string; currentValue?: string; options?: Array<{ value: string; name?: string }> }> }
    | { type: 'models_update'; models: Array<{ id: string; name: string; contextWindow: number }> }

  interface WorkspaceItem {
    id: string
    name: string
    description: string | null
    icon: string | null
    repo_path: string | null
    created_at: number
    updated_at: number
  }

  interface ConversationItem {
    id: string
    workspace_id: string | null
    title: string | null
    model: string | null
    provider: string | null
    title_source: string | null
    status: string
    mode: string | null
    agent_count: number
    change_count: number
    team_id: string | null
    is_draft: number
    messages: MessageItem[]
    created_at: number
    updated_at: number
  }

  interface ConversationSearchResult {
    id: string
    title: string | null
    snippet: string
    matchedAt: number
    rank: number
  }

  interface MessageItem {
    id: string
    conversation_id: string
    role: 'user' | 'assistant' | 'system'
    content: string | null
    thinking: string | null
    tool_calls: string | null
    tool_results: string | null
    usage: string | null
    created_at: number
  }

    interface FileEntry {
      name: string
      path: string
      isDirectory: boolean
      children?: FileEntry[] | null
    }

  interface TaskItem {
    id: string
    project_id: string
    title: string
    description: string | null
      status: string
      mode: string | null
      created_at: number
      updated_at: number
      completed_at: number | null
      agent_count: number
      change_count: number
    }

    interface TaskEventItem {
      id: string
      task_id: string
      agent_id: string | null
      event_type: string
      payload_json: string
      created_at: number
    }

  interface UsageRecord {
    id: string
    conversation_id: string
    model: string
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
    cost_usd: number
    created_at: number
  }

  interface UsageSummaryRow {
    day: string
    model: string
    provider_id: string | null
    total_input: number
    total_output: number
    total_cache_read: number
    total_cache_creation: number
    total_cost: number
  }

  type LogLevel = 'debug' | 'info' | 'warn' | 'error'

  interface LogEntry {
    ts: string
    level: LogLevel
    source: string
    message: string
    meta?: unknown
    raw?: string
  }

  interface LogFileInfo {
    source: string
    fileName: string
    path: string
    size: number
    updatedAt: number
  }

  interface LogReadOptions {
    source?: string
    limit?: number
    level?: LogLevel | LogLevel[]
    query?: string
    since?: number
    until?: number
    tailBytes?: number
  }

  interface LogReadResult {
    entries: LogEntry[]
    file: LogFileInfo | null
    truncated: boolean
    bytesRead: number
  }

  interface MemoryCandidate {
    id: string
    workspace_id: string
    kind: string
    title: string
    content: string
    source_conversation_id: string | null
    source_message_id: string | null
    confidence: string
    status: string
    created_at: number
    updated_at: number
  }

  interface ProjectMemoryItem {
    id: string
    workspace_id: string
    kind: string
    title: string
    content: string
    status: string
    source_path: string | null
    source_hash: string | null
    created_at: number
    updated_at: number
  }

  interface MemoryEntry {
    id: string
    workspaceId: string
    category: 'core' | 'architecture' | 'conventions' | 'antipatterns' | 'decisions'
    title: string
    content: string
    tags: string[]
    citedBy: string[]
    createdAt: number
    updatedAt: number
  }

  interface ConversationSummary {
    id: string
    conversation_id: string
    summary: string
    completed_items: string | null
    pending_items: string | null
    changed_files: string | null
    risks: string | null
    next_steps: string | null
    from_message_id: string | null
    to_message_id: string | null
    created_at: number
  }

  interface AgentSession {
    id: string
    workspace_id: string
    conversation_id: string
    agent_id: string
    provider: string
    external_session_id: string | null
    seq: number
    status: string
    created_at: number
    ended_at: number | null
  }

  interface FileChangeRecord {
    id: string
    conversation_id: string
    agent_id: string | null
    path: string
    status: string
    additions: number
    deletions: number
    diff_text: string | null
    tool_call_id: string | null
    created_at: number
    updated_at: number
  }

  interface AgentProfileCache {
    id: string
    workspace_id: string | null
    agent_id: string
    content: string
    source_path: string | null
    source_hash: string | null
    created_at: number
    updated_at: number
  }

  interface AgentProfileConfig {
    id: string
    workspaceId: string | null
    name: string
    role: string
    model: string
    description: string | null
    systemPrompt: string | null
    preferredProvider?: string
    capabilities?: string[]
    whenToUse?: string
    outputContract?: string
    isEnabled: boolean
    sortOrder: number
    createdAt: number
    updatedAt: number
  }

  interface UpdateInfo {
    hasUpdate: boolean
    currentVersion: string
    latestVersion: string | null
    releaseUrl: string | null
    releaseNotes: string | null
    publishedAt: string | null
  }

  interface ElectronAPI {
    system: {
      getVersion: () => Promise<string>
      showWindow: () => Promise<void>
      hideWindow: () => Promise<void>
      openExternal: (url: string) => Promise<boolean>
      getPaths: () => Promise<Record<string, string>>
      checkUpdate: () => Promise<UpdateInfo>
      onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void
    }
    workspace: {
      list: () => Promise<WorkspaceItem[]>
      get: (id: string) => Promise<WorkspaceItem | null>
      create: (data: { name: string; description?: string; icon?: string; repo_path?: string }) => Promise<WorkspaceItem>
      update: (id: string, data: Record<string, unknown>) => Promise<WorkspaceItem>
      delete: (id: string) => Promise<{ success: boolean }>
    }
    conversation: {
      list: (workspaceId?: string, status?: string) => Promise<ConversationItem[]>
      get: (id: string) => Promise<ConversationItem | null>
      create: (data: { workspace_id?: string; title?: string; model?: string; provider?: string; agent_profile_id?: string; team_id?: string; task_id?: string; is_draft?: number }) => Promise<ConversationItem>
      update: (id: string, data: Record<string, unknown>) => Promise<ConversationItem>
      promoteDraft: (id: string) => Promise<ConversationItem>
      delete: (id: string) => Promise<{ success: boolean }>
      updateStatus: (id: string, status: string) => Promise<ConversationItem>
      search: (query: string) => Promise<ConversationSearchResult[]>
      autoTitle: (id: string, title: string) => Promise<{ success: boolean }>
      setTitle: (id: string, title: string) => Promise<{ success: boolean }>
      incrementAgentCount: (id: string) => Promise<{ agent_count: number } | undefined>
      export: (id: string, format: 'markdown' | 'json', options?: { includeThinking?: boolean; includeToolCalls?: boolean; includeSystemMessages?: boolean; includeUsage?: boolean }) => Promise<{ success: boolean; path?: string; reason?: string }>
    }
    usage: {
      create: (data: { conversation_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number; cost_usd?: number; provider_id?: string }) => Promise<{ id: string; costUsd: number }>
      list: (conversationId: string) => Promise<UsageRecord[]>
      summary: (range?: { from?: number; to?: number }) => Promise<UsageSummaryRow[]>
      totalCost: (range?: { from?: number; to?: number }) => Promise<number>
    }
    todo: {
      sync: (conversationId: string, items: Array<{ content: string; completed: number; order_index: number }>) => Promise<{ success: boolean }>
      list: (conversationId: string) => Promise<Array<{ content: string; completed: number }>>
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
        agent_profile_id?: string | null
      }) => Promise<MessageItem>
    }
    provider: {
      list: () => Promise<Array<{
        meta: { id: string; name: string; binary: string; vendor: string; models: Array<{ id: string; name: string; contextWindow: number; maxOutputTokens?: number }>; permissionFlags: Record<string, string[]>; supportsStreamJson: boolean; supportsInteractive: boolean }
        installed: boolean
        version: string | null
        hasApiKey: boolean
      }>>
      detectAll: () => Promise<Record<string, string | null>>
      configure: (id: string, config: { enabled: boolean; binaryPath?: string; extraEnv?: Record<string, string> }) => Promise<{ ok: boolean }>
      setApiKey: (providerId: string, apiKey: string) => Promise<{ ok: boolean }>
      hasApiKey: (providerId: string) => Promise<boolean>
      testConnection: (id: string) => Promise<{ ok: boolean; version: string | null }>
    }
    chat: {
      startSession: (config: {
        providerType?: string
        model: string
        permissionMode: string
        workingDir: string
        sessionId?: string
      }) => Promise<{ id: string }>
      sendMessage: (sessionId: string, content: string) => Promise<void>
      respondPermission: (sessionId: string, approved: boolean) => Promise<void>
      respondQuestion: (sessionId: string, answer: string) => Promise<void>
      abort: (sessionId: string) => Promise<void>
      endSession: (sessionId: string) => Promise<void>
      onEvent: (callback: (event: AIEvent) => void) => () => void
      getAvailableModels: (sessionId: string) => Promise<Array<{ id: string; name: string; contextWindow: number }>>
      setModel: (sessionId: string, modelId: string) => Promise<void>
      getConfigOptions: (sessionId: string) => Promise<Array<{ id: string; name?: string; label?: string; category?: string; type: string; currentValue?: string; options?: Array<{ value: string; name?: string }> }>>
      setConfigOption: (sessionId: string, optionId: string, value: string) => Promise<void>
    }
      task: {
        create: (projectId: string, data: { title: string; description?: string; mode?: string; providerOverride?: string; modelOverride?: string }) => Promise<TaskItem>
        list: (projectId?: string) => Promise<TaskItem[]>
        get: (id: string) => Promise<TaskItem | null>
        updateStatus: (id: string, status: string) => Promise<TaskItem>
        delete: (id: string) => Promise<{ success: boolean }>
        listEvents: (taskId: string, limit?: number) => Promise<TaskEventItem[]>
      }
      file: {
        list: (workspaceId: string, dir?: string) => Promise<FileEntry[]>
        read: (workspaceId: string, filePath: string) => Promise<{ content: string; language: string; size: number; tooLarge?: boolean; binary?: boolean; warnLarge?: boolean }>
        write: (workspaceId: string, filePath: string, content: string) => Promise<{ success: boolean; path: string; size: number }>
        createFile: (workspaceId: string, filePath: string) => Promise<{ success: boolean; path: string }>
        createDir: (workspaceId: string, dirPath: string) => Promise<{ success: boolean; path: string }>
        rename: (workspaceId: string, oldPath: string, newPath: string) => Promise<{ success: boolean; oldPath: string; newPath: string }>
        delete: (workspaceId: string, filePath: string) => Promise<{ success: boolean; path: string }>
      }
    change: {
      record: (data: {
        conversation_id: string
        agent_id?: string
        path: string
        status: string
        additions?: number
        deletions?: number
        diff_text?: string
        tool_call_id?: string
      }) => Promise<FileChangeRecord>
      listForConversation: (conversationId: string) => Promise<FileChangeRecord[]>
      getById: (changeId: string) => Promise<FileChangeRecord | undefined>
    }
    dialog: {
      openDirectory: () => Promise<string | null>
    }
    logs: {
      getDirectory: () => Promise<string>
      list: () => Promise<LogFileInfo[]>
      read: (options?: LogReadOptions) => Promise<LogReadResult>
    }
    memory: {
      recall: (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) => Promise<ProjectMemoryItem[]>
      readProjectMemory: (workspaceId: string) => Promise<string | null>
      writeProjectMemory: (workspaceId: string, content: string) => Promise<void>
      appendProjectMemory: (workspaceId: string, section: string, entry: string) => Promise<void>
      readAgentMemory: (workspaceId: string, agentId: string) => Promise<string | null>
      writeAgentMemory: (workspaceId: string, agentId: string, content: string) => Promise<void>
      createCandidate: (data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }) => Promise<{ id: string }>
      updateCandidateStatus: (id: string, status: string) => Promise<{ success: boolean }>
      listCandidates: (workspaceId: string, status?: string) => Promise<MemoryCandidate[]>
      listProjectItems: (workspaceId: string) => Promise<ProjectMemoryItem[]>
      deleteProjectItem: (id: string) => Promise<{ success: boolean }>
      listMarkers: (workspaceId: string) => Promise<string[]>
      readMarker: (workspaceId: string, name: string) => Promise<string | null>
      writeMarker: (workspaceId: string, name: string, content: string) => Promise<void>
      materializeCandidate: (id: string) => Promise<{ id: string }>
      createAgentSession: (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq?: number; status: string }) => Promise<AgentSession>
      endAgentSession: (id: string) => Promise<{ success: boolean }>
      endAgentSessionByExternalId: (externalSessionId: string) => Promise<{ success: boolean }>
      listAgentSessions: (conversationId: string) => Promise<AgentSession[]>
      getLatestSummary: (conversationId: string) => Promise<ConversationSummary | null>
      createSummary: (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }) => Promise<{ id: string }>
      upsertAgentProfile: (data: { workspace_id?: string; agent_id: string; content: string; source_path?: string; source_hash?: string }) => Promise<{ success: boolean }>
      getAgentProfile: (workspaceId: string | null, agentId: string) => Promise<AgentProfileCache | null>
    }
    team: {
      list: () => Promise<Array<{ id: string; name: string; description: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> }>>
      get: (id: string) => Promise<{ id: string; name: string; description: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> } | null>
      create: (data: { name: string; description?: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown>; workspaceId?: string }) => Promise<{ id: string; name: string; description: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> }>
      update: (id: string, patch: { name?: string; description?: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> }) => Promise<{ id: string; name: string; description: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> } | null>
      delete: (id: string) => Promise<boolean>
    }
    agent: {
      listProfiles: (workspaceId?: string) => Promise<AgentProfileConfig[]>
      createProfile: (data: { name: string; role?: string; model?: string; description?: string; systemPrompt?: string; preferredProvider?: string | null; capabilities?: string[]; whenToUse?: string; outputContract?: string; isEnabled?: boolean; sortOrder?: number; workspaceId?: string }) => Promise<AgentProfileConfig>
      updateProfile: (id: string, patch: { name?: string; role?: string; model?: string | null; description?: string | null; systemPrompt?: string | null; preferredProvider?: string | null; capabilities?: string[] | null; whenToUse?: string | null; outputContract?: string | null; isEnabled?: boolean; sortOrder?: number }) => Promise<AgentProfileConfig>
      deleteProfile: (id: string) => Promise<void>
      seedDefaults: () => Promise<AgentProfileConfig[]>
    }
    memoryPalace: {
      list: (workspaceId: string, category?: string) => Promise<MemoryEntry[]>
      create: (workspaceId: string, entry: { category: string; title: string; content: string; tags?: string[] }) => Promise<MemoryEntry>
      update: (id: string, patch: { title?: string; content?: string; category?: string; tags?: string[] }) => Promise<MemoryEntry>
      delete: (id: string) => Promise<void>
    }
    terminal: {
      create: (workspaceId: string, cwd?: string) => Promise<string>
      write: (sessionId: string, data: string) => Promise<void>
      resize: (sessionId: string, cols: number, rows: number) => Promise<void>
      kill: (sessionId: string) => Promise<void>
      onData: (callback: (event: { sessionId: string; data: string }) => void) => () => void
      onExit: (callback: (event: { sessionId: string; exitCode: number }) => void) => () => void
    }
    mcp: {
      list: () => Promise<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; enabled: boolean }>>
      add: (data: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => Promise<{ ok: boolean }>
      update: (name: string, data: { command?: string; args?: string[]; env?: Record<string, string> }) => Promise<{ ok: boolean }>
      remove: (name: string) => Promise<{ ok: boolean }>
      toggle: (name: string, enabled: boolean) => Promise<{ ok: boolean }>
      discoverProject: (workspaceDir: string) => Promise<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; source: string; sourcePath?: string }>>
      getProjectMcpEnabled: () => Promise<boolean>
      setProjectMcpEnabled: (enabled: boolean) => Promise<{ ok: boolean }>
      testConnection: (name: string) => Promise<{ ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string }>
      getMarketplaceUrls: () => Promise<string[]>
      addMarketplaceUrl: (url: string) => Promise<{ ok: boolean }>
      removeMarketplaceUrl: (url: string) => Promise<{ ok: boolean }>
      resetMarketplaceUrls: () => Promise<{ ok: boolean }>
    }
    orchestrator: {
      sendMessage: (payload: {
        conversationId: string
        profileId: string | null
        content: string
        sessionConfig: { providerType?: string; model: string; permissionMode: string; workingDir: string; sessionId?: string }
        executionMode: 'serial' | 'parallel'
        collaborationMode?: 'orchestrated' | 'open_floor'
        overrides?: { providerType?: string; model?: string }
        initialMentions?: string
      }) => Promise<void>
      abort: (conversationId: string) => Promise<void>
      stopOpenFloor: (conversationId: string) => Promise<void>
      respondPermission: (conversationId: string, approved: boolean, profileId?: string, taskId?: string) => Promise<void>
      respondQuestion: (conversationId: string, answer: string, profileId?: string, taskId?: string) => Promise<void>
      getActiveTasks: (conversationId: string) => Promise<unknown[]>
      getActiveGraph: (conversationId: string) => Promise<{ nodes: unknown[]; edges: unknown[] }>
      onA2ATaskCreated: (callback: (task: unknown) => void) => () => void
      onA2ATaskCompleted: (callback: (payload: unknown) => void) => () => void
      onA2ATaskQueued: (callback: (payload: { taskId: string; conversationId: string; position: number }) => void) => () => void
    }
  }

  interface Window {
    api: ElectronAPI
  }
}

export {}
