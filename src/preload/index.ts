import { contextBridge, ipcRenderer } from 'electron'

const api = {
  system: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),
    showWindow: (): Promise<void> => ipcRenderer.invoke('system:showWindow'),
    hideWindow: (): Promise<void> => ipcRenderer.invoke('system:hideWindow'),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('system:openExternal', url),
    getPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('system:getPaths'),
    checkUpdate: (): Promise<{
      hasUpdate: boolean
      currentVersion: string
      latestVersion: string | null
      releaseUrl: string | null
      releaseNotes: string | null
      publishedAt: string | null
    }> => ipcRenderer.invoke('system:checkUpdate'),
    onUpdateAvailable: (callback: (info: {
      hasUpdate: boolean
      currentVersion: string
      latestVersion: string | null
      releaseUrl: string | null
      releaseNotes: string | null
      publishedAt: string | null
    }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: unknown): void => {
        callback(info as {
          hasUpdate: boolean
          currentVersion: string
          latestVersion: string | null
          releaseUrl: string | null
          releaseNotes: string | null
          publishedAt: string | null
        })
      }
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    }
  },
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    get: (id: string) => ipcRenderer.invoke('workspace:get', id),
    create: (data: { name: string; description?: string; icon?: string; repo_path?: string }) =>
      ipcRenderer.invoke('workspace:create', data),
    update: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('workspace:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('workspace:delete', id)
  },
  conversation: {
    list: (workspaceId?: string, status?: string) =>
      ipcRenderer.invoke('conversation:list', workspaceId, status),
    get: (id: string) => ipcRenderer.invoke('conversation:get', id),
    create: (data: { workspace_id?: string; title?: string; model?: string; provider?: string; agent_profile_id?: string; team_id?: string; task_id?: string; is_draft?: number }) =>
      ipcRenderer.invoke('conversation:create', data),
    update: (id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('conversation:update', id, data),
    promoteDraft: (id: string) =>
      ipcRenderer.invoke('conversation:promoteDraft', id),
    delete: (id: string) => ipcRenderer.invoke('conversation:delete', id),
    updateStatus: (id: string, status: string) =>
      ipcRenderer.invoke('conversation:updateStatus', id, status),
    search: (query: string) => ipcRenderer.invoke('conversation:search', query),
    autoTitle: (id: string, title: string) =>
      ipcRenderer.invoke('conversation:autoTitle', id, title),
    setTitle: (id: string, title: string) =>
      ipcRenderer.invoke('conversation:setTitle', id, title),
    incrementAgentCount: (id: string) =>
      ipcRenderer.invoke('conversation:incrementAgentCount', id),
    export: (id: string, format: 'markdown' | 'json', options?: { includeThinking?: boolean; includeToolCalls?: boolean; includeSystemMessages?: boolean; includeUsage?: boolean }) =>
      ipcRenderer.invoke('conversation:export', { conversationId: id, format, options }),
  },
  usage: {
    create: (data: { conversation_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number; cost_usd?: number; provider_id?: string }) =>
      ipcRenderer.invoke('usage:create', data),
    list: (conversationId: string) =>
      ipcRenderer.invoke('usage:list', conversationId),
    summary: (range?: { from?: number; to?: number }): Promise<Array<{
      day: string
      model: string
      provider_id: string | null
      total_input: number
      total_output: number
      total_cache_read: number
      total_cache_creation: number
      total_cost: number
    }>> => ipcRenderer.invoke('usage:summary', range),
    totalCost: (range?: { from?: number; to?: number }): Promise<number> =>
      ipcRenderer.invoke('usage:totalCost', range),
    byProvider: (days?: number): Promise<Array<{
      provider_id: string
      total_input_tokens: number
      total_output_tokens: number
      total_cost_usd: number
      total_calls: number
    }>> => ipcRenderer.invoke('usage:byProvider', days ?? 7),
    byAgent: (days?: number): Promise<Array<{
      agent_profile_id: string
      total_input_tokens: number
      total_output_tokens: number
      total_cost_usd: number
      total_calls: number
    }>> => ipcRenderer.invoke('usage:byAgent', days ?? 7)
  },
  todo: {
    sync: (conversationId: string, items: Array<{ content: string; completed: number; order_index: number }>) =>
      ipcRenderer.invoke('todo:sync', conversationId, items),
    list: (conversationId: string) =>
      ipcRenderer.invoke('todo:list', conversationId)
  },
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
    }) => ipcRenderer.invoke('message:create', data)
  },
  provider: {
    list: (): Promise<Array<{
      meta: { id: string; name: string; binary: string; vendor: string; models: Array<{ id: string; name: string; contextWindow: number; maxOutputTokens?: number }>; permissionFlags: Record<string, string[]>; supportsStreamJson: boolean; supportsInteractive: boolean }
      installed: boolean
      version: string | null
      hasApiKey: boolean
    }>> => ipcRenderer.invoke('provider:list'),
    detectAll: (): Promise<Record<string, string | null>> => ipcRenderer.invoke('provider:detectAll'),
    configure: (id: string, config: { enabled: boolean; binaryPath?: string; extraEnv?: Record<string, string> }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('provider:configure', id, config),
    setApiKey: (providerId: string, apiKey: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('provider:setApiKey', providerId, apiKey),
    hasApiKey: (providerId: string): Promise<boolean> =>
      ipcRenderer.invoke('provider:hasApiKey', providerId),
    testConnection: (id: string): Promise<{ ok: boolean; version: string | null }> =>
      ipcRenderer.invoke('provider:testConnection', id),
    refreshModels: (providerIds?: string[]): Promise<Record<string, Array<{ id: string; name: string; contextWindow: number; maxOutputTokens?: number }>>> =>
      ipcRenderer.invoke('provider:refreshModels', providerIds)
  },
  chat: {
    startSession: (config: {
      providerType?: string
      model: string
      permissionMode: string
      workingDir: string
      sessionId?: string
    }) => ipcRenderer.invoke('chat:startSession', config),
    sendMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke('chat:sendMessage', sessionId, content),
    respondPermission: (sessionId: string, approved: boolean) =>
      ipcRenderer.invoke('chat:respondPermission', sessionId, approved),
    respondQuestion: (sessionId: string, answer: string) =>
      ipcRenderer.invoke('chat:respondQuestion', sessionId, answer),
    abort: (sessionId: string) =>
      ipcRenderer.invoke('chat:abort', sessionId),
    endSession: (sessionId: string) =>
      ipcRenderer.invoke('chat:endSession', sessionId),
    getAvailableModels: (sessionId: string): Promise<Array<{ id: string; name: string; contextWindow: number }>> =>
      ipcRenderer.invoke('chat:getAvailableModels', sessionId),
    setModel: (sessionId: string, modelId: string): Promise<void> =>
      ipcRenderer.invoke('chat:setModel', sessionId, modelId),
    getConfigOptions: (sessionId: string): Promise<Array<{
      id: string; name?: string; label?: string; category?: string; type: string; currentValue?: string
      options?: Array<{ value: string; name?: string }>
    }>> =>
      ipcRenderer.invoke('chat:getConfigOptions', sessionId),
    setConfigOption: (sessionId: string, optionId: string, value: string): Promise<void> =>
      ipcRenderer.invoke('chat:setConfigOption', sessionId, optionId, value),
    onEvent: (callback: (event: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('ai:event', handler)
      return () => {
        ipcRenderer.removeListener('ai:event', handler)
      }
    }
  },
  task: {
    create: (projectId: string, data: { title: string; description?: string; mode?: string; providerOverride?: string; modelOverride?: string }) =>
      ipcRenderer.invoke('task:create', projectId, data),
    list: (projectId?: string) =>
      ipcRenderer.invoke('task:list', projectId),
    get: (id: string) => ipcRenderer.invoke('task:get', id),
    updateStatus: (id: string, status: string) =>
      ipcRenderer.invoke('task:updateStatus', id, status),
    delete: (id: string) => ipcRenderer.invoke('task:delete', id),
    listEvents: (taskId: string, limit?: number) => ipcRenderer.invoke('task:listEvents', taskId, limit),
  },
  file: {
    list: (workspaceId: string, dir?: string) =>
      ipcRenderer.invoke('file:list', workspaceId, dir),
    read: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke('file:read', workspaceId, filePath),
    write: (workspaceId: string, filePath: string, content: string) =>
      ipcRenderer.invoke('file:write', workspaceId, filePath, content),
    createFile: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke('file:createFile', workspaceId, filePath),
    createDir: (workspaceId: string, dirPath: string) =>
      ipcRenderer.invoke('file:createDir', workspaceId, dirPath),
    rename: (workspaceId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('file:rename', workspaceId, oldPath, newPath),
    delete: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke('file:delete', workspaceId, filePath),
  },
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
    }) => ipcRenderer.invoke('change:record', data),
    listForConversation: (conversationId: string) =>
      ipcRenderer.invoke('change:listForConversation', conversationId),
    getById: (changeId: string) =>
      ipcRenderer.invoke('change:getById', changeId)
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory')
  },
  logs: {
    getDirectory: () =>
      ipcRenderer.invoke('logs:getDirectory'),
    list: () =>
      ipcRenderer.invoke('logs:list'),
    read: (options?: {
      source?: string
      limit?: number
      level?: 'debug' | 'info' | 'warn' | 'error' | Array<'debug' | 'info' | 'warn' | 'error'>
      query?: string
      since?: number
      until?: number
      tailBytes?: number
    }) => ipcRenderer.invoke('logs:read', options)
  },
  memory: {
    recall: (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }) =>
      ipcRenderer.invoke('memory:recall', query, options),
    readProjectMemory: (workspaceId: string) =>
      ipcRenderer.invoke('memory:readProjectMemory', workspaceId),
    writeProjectMemory: (workspaceId: string, content: string) =>
      ipcRenderer.invoke('memory:writeProjectMemory', workspaceId, content),
    appendProjectMemory: (workspaceId: string, section: string, entry: string) =>
      ipcRenderer.invoke('memory:appendProjectMemory', workspaceId, section, entry),
    readAgentMemory: (workspaceId: string, agentId: string) =>
      ipcRenderer.invoke('memory:readAgentMemory', workspaceId, agentId),
    writeAgentMemory: (workspaceId: string, agentId: string, content: string) =>
      ipcRenderer.invoke('memory:writeAgentMemory', workspaceId, agentId, content),
    createCandidate: (data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }) =>
      ipcRenderer.invoke('memory:createCandidate', data),
    updateCandidateStatus: (id: string, status: string) =>
      ipcRenderer.invoke('memory:updateCandidateStatus', id, status),
    listCandidates: (workspaceId: string, status?: string) =>
      ipcRenderer.invoke('memory:listCandidates', workspaceId, status),
    listProjectItems: (workspaceId: string) =>
      ipcRenderer.invoke('memory:listProjectItems', workspaceId),
    deleteProjectItem: (id: string) =>
      ipcRenderer.invoke('memory:deleteProjectItem', id),
    listMarkers: (workspaceId: string) =>
      ipcRenderer.invoke('memory:listMarkers', workspaceId),
    readMarker: (workspaceId: string, name: string) =>
      ipcRenderer.invoke('memory:readMarker', workspaceId, name),
    writeMarker: (workspaceId: string, name: string, content: string) =>
      ipcRenderer.invoke('memory:writeMarker', workspaceId, name, content),
    materializeCandidate: (id: string) =>
      ipcRenderer.invoke('memory:materializeCandidate', id),
    createAgentSession: (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq?: number; status: string }) =>
      ipcRenderer.invoke('memory:createAgentSession', data),
    endAgentSession: (id: string) =>
      ipcRenderer.invoke('memory:endAgentSession', id),
    endAgentSessionByExternalId: (externalSessionId: string) =>
      ipcRenderer.invoke('memory:endAgentSessionByExternalId', externalSessionId),
    listAgentSessions: (conversationId: string) =>
      ipcRenderer.invoke('memory:listAgentSessions', conversationId),
    getLatestSummary: (conversationId: string) =>
      ipcRenderer.invoke('memory:getLatestSummary', conversationId),
    createSummary: (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }) =>
      ipcRenderer.invoke('memory:createSummary', data),
    upsertAgentProfile: (data: { workspace_id?: string; agent_id: string; content: string; source_path?: string; source_hash?: string }) =>
      ipcRenderer.invoke('memory:upsertAgentProfile', data),
    getAgentProfile: (workspaceId: string | null, agentId: string) =>
      ipcRenderer.invoke('memory:getAgentProfile', workspaceId, agentId)
  },
  memoryPalace: {
    list: (workspaceId: string, category?: string) =>
      ipcRenderer.invoke('memory-palace:list', workspaceId, category),
    create: (workspaceId: string, entry: { category: string; title: string; content: string; tags?: string[]; sourceDoc?: string }) =>
      ipcRenderer.invoke('memory-palace:create', workspaceId, entry),
    update: (id: string, patch: { title?: string; content?: string; category?: string; tags?: string[]; sourceDoc?: string }) =>
      ipcRenderer.invoke('memory-palace:update', id, patch),
    delete: (id: string) =>
      ipcRenderer.invoke('memory-palace:delete', id),
    export: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke('memory-palace:export', workspaceId, filePath),
    import: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke('memory-palace:import', workspaceId, filePath)
  },
  team: {
    list: (): Promise<Array<{ id: string; name: string; description: string; pipeline: Array<{ profileId: string; role?: string; trigger?: string; feedbackTo?: string | null }>; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> }>> =>
      ipcRenderer.invoke('team:list'),
    get: (id: string): Promise<{ id: string; name: string; description: string; pipeline: Array<{ profileId: string; role?: string; trigger?: string; feedbackTo?: string | null }>; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> } | null> =>
      ipcRenderer.invoke('team:get', id),
    create: (data: { name: string; description?: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown>; workspaceId?: string }) =>
      ipcRenderer.invoke('team:create', data),
    update: (id: string, patch: { name?: string; description?: string; members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>; policies?: Record<string, unknown> }) =>
      ipcRenderer.invoke('team:update', id, patch),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('team:delete', id)
  },
  agent: {
    listProfiles: (workspaceId?: string) =>
      ipcRenderer.invoke('agent:listProfiles', workspaceId),
    createProfile: (data: { name: string; role?: string; model?: string; description?: string; systemPrompt?: string; preferredProvider?: string | null; capabilities?: string[]; whenToUse?: string; outputContract?: string; isEnabled?: boolean; sortOrder?: number; workspaceId?: string }) =>
      ipcRenderer.invoke('agent:createProfile', data),
    updateProfile: (id: string, patch: { name?: string; role?: string; model?: string | null; description?: string | null; systemPrompt?: string | null; preferredProvider?: string | null; capabilities?: string[] | null; whenToUse?: string | null; outputContract?: string | null; isEnabled?: boolean; sortOrder?: number }) =>
      ipcRenderer.invoke('agent:updateProfile', id, patch),
    deleteProfile: (id: string) =>
      ipcRenderer.invoke('agent:deleteProfile', id),
    seedDefaults: () =>
      ipcRenderer.invoke('agent:seedDefaults')
  },
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
    }) => ipcRenderer.invoke('orchestrator:sendMessage', payload),
    abort: (conversationId: string) =>
      ipcRenderer.invoke('orchestrator:abort', conversationId),
    stopOpenFloor: (conversationId: string) =>
      ipcRenderer.invoke('orchestrator:stopOpenFloor', conversationId),
    respondPermission: (conversationId: string, approved: boolean, profileId?: string, taskId?: string) =>
      ipcRenderer.invoke('orchestrator:respondPermission', conversationId, approved, profileId, taskId),
    respondQuestion: (conversationId: string, answer: string, profileId?: string, taskId?: string) =>
      ipcRenderer.invoke('orchestrator:respondQuestion', conversationId, answer, profileId, taskId),
    getActiveTasks: (conversationId: string) =>
      ipcRenderer.invoke('orchestrator:getActiveTasks', conversationId),
    getActiveGraph: (conversationId: string): Promise<{ nodes: unknown[]; edges: unknown[] }> =>
      ipcRenderer.invoke('task:getActiveGraph', conversationId),
    onA2ATaskCreated: (callback: (task: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, task: unknown) => callback(task)
      ipcRenderer.on('a2a:taskCreated', handler)
      return () => ipcRenderer.removeListener('a2a:taskCreated', handler)
    },
    onA2ATaskCompleted: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('a2a:taskCompleted', handler)
      return () => ipcRenderer.removeListener('a2a:taskCompleted', handler)
    },
    onA2ATaskQueued: (callback: (payload: { taskId: string; conversationId: string; position: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { taskId: string; conversationId: string; position: number }) => callback(payload)
      ipcRenderer.on('a2a:taskQueued', handler)
      return () => ipcRenderer.removeListener('a2a:taskQueued', handler)
    }
  },
  terminal: {
    create: (workspaceId: string, cwd?: string) =>
      ipcRenderer.invoke('terminal:create', workspaceId, cwd),
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    kill: (sessionId: string) =>
      ipcRenderer.invoke('terminal:kill', sessionId),
    onData: (callback: (event: { sessionId: string; data: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; data: string }) => {
        callback(data)
      }
      ipcRenderer.on('terminal:onData', handler)
      return () => ipcRenderer.removeListener('terminal:onData', handler)
    },
    onExit: (callback: (event: { sessionId: string; exitCode: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; exitCode: number }) => {
        callback(data)
      }
      ipcRenderer.on('terminal:onExit', handler)
      return () => ipcRenderer.removeListener('terminal:onExit', handler)
    }
  },
  mcp: {
    list: (): Promise<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; enabled: boolean }>> =>
      ipcRenderer.invoke('mcp:list'),
    add: (data: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:add', data),
    update: (name: string, data: { command?: string; args?: string[]; env?: Record<string, string> }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:update', name, data),
    remove: (name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:remove', name),
    toggle: (name: string, enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:toggle', name, enabled),
    discoverProject: (workspaceDir: string): Promise<Array<{ name: string; command: string; args: string[]; env: Record<string, string>; source: string; sourcePath?: string }>> =>
      ipcRenderer.invoke('mcp:discoverProject', workspaceDir),
    getProjectMcpEnabled: (): Promise<boolean> =>
      ipcRenderer.invoke('mcp:getProjectMcpEnabled'),
    setProjectMcpEnabled: (enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:setProjectMcpEnabled', enabled),
    testConnection: (name: string): Promise<{ ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string }> =>
      ipcRenderer.invoke('mcp:testConnection', name),
    getMarketplaceUrls: (): Promise<string[]> =>
      ipcRenderer.invoke('mcp:getMarketplaceUrls'),
    addMarketplaceUrl: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:addMarketplaceUrl', url),
    removeMarketplaceUrl: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:removeMarketplaceUrl', url),
    resetMarketplaceUrls: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('mcp:resetMarketplaceUrls')
  },
  daemon: {
    getStatus: (): Promise<{
      agents: Array<{
        profileId: string
        name: string
        role: string
        providerId: string | null
        isActive: boolean
        isProcessing: boolean
        pendingCount: number
        claimedTaskCount: number
        maxConcurrentTasks: number
      }>
      providerWorkload: Record<string, { running: number; queued: number }>
      isRunning: boolean
    }> => ipcRenderer.invoke('daemon:getStatus'),
    getHeartbeat: (): Promise<{
      activeRuntimes: number
      totalPending: number
      lastBeat: number
    }> => ipcRenderer.invoke('daemon:getHeartbeat'),
    getTokenUsage: (days?: number): Promise<Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }>> =>
      ipcRenderer.invoke('daemon:getTokenUsage', days),
    getAgentActivity: (agentProfileId: string, limit?: number): Promise<{
      recentConversations: Array<{
        id: string
        title: string | null
        status: string
        model: string | null
        provider: string | null
        created_at: number
        updated_at: number
      }>
      taskSummary: Array<{ status: string; count: number }>
      recentTasks: Array<{
        id: string
        title: string
        status: string
        completed_at: number | null
        created_at: number
        agent_status: string
      }>
    }> => ipcRenderer.invoke('daemon:getAgentActivity', agentProfileId, limit ?? 20),
  }
}

contextBridge.exposeInMainWorld('api', api)
