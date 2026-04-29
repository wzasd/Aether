import { contextBridge, ipcRenderer } from 'electron'

const api = {
  system: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),
    showWindow: (): Promise<void> => ipcRenderer.invoke('system:showWindow'),
    hideWindow: (): Promise<void> => ipcRenderer.invoke('system:hideWindow'),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('system:openExternal', url),
    getPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('system:getPaths')
  },
  workspace: {
    list: (): Promise<any[]> => ipcRenderer.invoke('workspace:list'),
    get: (id: string): Promise<any> => ipcRenderer.invoke('workspace:get', id),
    create: (data: { name: string; description?: string; icon?: string; repo_path?: string }): Promise<any> =>
      ipcRenderer.invoke('workspace:create', data),
    update: (id: string, data: Record<string, unknown>): Promise<any> =>
      ipcRenderer.invoke('workspace:update', id, data),
    delete: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('workspace:delete', id)
  },
  conversation: {
    list: (workspaceId?: string): Promise<any[]> =>
      ipcRenderer.invoke('conversation:list', workspaceId),
    get: (id: string): Promise<any> => ipcRenderer.invoke('conversation:get', id),
    create: (data: { workspace_id?: string; title?: string; model?: string; provider?: string }): Promise<any> =>
      ipcRenderer.invoke('conversation:create', data),
    update: (id: string, data: Record<string, unknown>): Promise<any> =>
      ipcRenderer.invoke('conversation:update', id, data),
    delete: (id: string): Promise<{ success: boolean }> => ipcRenderer.invoke('conversation:delete', id),
    search: (query: string): Promise<any[]> => ipcRenderer.invoke('conversation:search', query),
    autoTitle: (id: string, title: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('conversation:autoTitle', id, title),
    setTitle: (id: string, title: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('conversation:setTitle', id, title),
    usageCreate: (data: { conversation_id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number; cost_usd?: number }): Promise<{ id: string }> =>
      ipcRenderer.invoke('usage:create', data),
    usageList: (conversationId: string): Promise<any[]> =>
      ipcRenderer.invoke('usage:list', conversationId),
    todoSync: (conversationId: string, items: Array<{ content: string; completed: number; order_index: number }>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('todo:sync', conversationId, items),
    todoList: (conversationId: string): Promise<any[]> =>
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
    }): Promise<any> => ipcRenderer.invoke('message:create', data)
  },
  chat: {
    startSession: (config: {
      model: string
      permissionMode: string
      workingDir: string
      sessionId?: string
    }): Promise<any> => ipcRenderer.invoke('chat:startSession', config),
    sendMessage: (sessionId: string, content: string): Promise<void> =>
      ipcRenderer.invoke('chat:sendMessage', sessionId, content),
    respondPermission: (sessionId: string, approved: boolean): Promise<void> =>
      ipcRenderer.invoke('chat:respondPermission', sessionId, approved),
    respondQuestion: (sessionId: string, answer: string): Promise<void> =>
      ipcRenderer.invoke('chat:respondQuestion', sessionId, answer),
    abort: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('chat:abort', sessionId),
    endSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('chat:endSession', sessionId),
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
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory')
  },
  memory: {
    recall: (query: string, options: { scope?: string; workspaceId?: string; conversationId?: string; limit?: number }): Promise<any[]> =>
      ipcRenderer.invoke('memory:recall', query, options),
    readProjectMemory: (workspacePath: string): Promise<string | null> =>
      ipcRenderer.invoke('memory:readProjectMemory', workspacePath),
    writeProjectMemory: (workspacePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('memory:writeProjectMemory', workspacePath, content),
    appendProjectMemory: (workspacePath: string, section: string, entry: string): Promise<void> =>
      ipcRenderer.invoke('memory:appendProjectMemory', workspacePath, section, entry),
    readAgentMemory: (workspacePath: string, agentId: string): Promise<string | null> =>
      ipcRenderer.invoke('memory:readAgentMemory', workspacePath, agentId),
    writeAgentMemory: (workspacePath: string, agentId: string, content: string): Promise<void> =>
      ipcRenderer.invoke('memory:writeAgentMemory', workspacePath, agentId, content),
    createCandidate: (data: { workspace_id: string; kind: string; title: string; content: string; source_conversation_id?: string; source_message_id?: string; confidence: string }): Promise<{ id: string }> =>
      ipcRenderer.invoke('memory:createCandidate', data),
    updateCandidateStatus: (id: string, status: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory:updateCandidateStatus', id, status),
    listCandidates: (workspaceId: string, status?: string): Promise<any[]> =>
      ipcRenderer.invoke('memory:listCandidates', workspaceId, status),
    listProjectItems: (workspaceId: string): Promise<any[]> =>
      ipcRenderer.invoke('memory:listProjectItems', workspaceId),
    createProjectItem: (data: { workspace_id: string; kind: string; title: string; content: string; source_path?: string; source_hash?: string }): Promise<{ id: string }> =>
      ipcRenderer.invoke('memory:createProjectItem', data),
    createAgentSession: (data: { workspace_id: string; conversation_id: string; agent_id: string; provider: string; external_session_id?: string; seq: number; status: string }): Promise<{ id: string }> =>
      ipcRenderer.invoke('memory:createAgentSession', data),
    endAgentSession: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory:endAgentSession', id),
    listAgentSessions: (conversationId: string): Promise<any[]> =>
      ipcRenderer.invoke('memory:listAgentSessions', conversationId),
    getLatestSummary: (conversationId: string): Promise<any> =>
      ipcRenderer.invoke('memory:getLatestSummary', conversationId),
    createSummary: (data: { conversation_id: string; summary: string; completed_items?: string; pending_items?: string; changed_files?: string; risks?: string; next_steps?: string; from_message_id?: string; to_message_id?: string }): Promise<{ id: string }> =>
      ipcRenderer.invoke('memory:createSummary', data),
    upsertAgentProfile: (data: { workspace_id?: string; agent_id: string; content: string; source_path?: string; source_hash?: string }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('memory:upsertAgentProfile', data),
    getAgentProfile: (workspaceId: string | null, agentId: string): Promise<any> =>
      ipcRenderer.invoke('memory:getAgentProfile', workspaceId, agentId)
  }
}

contextBridge.exposeInMainWorld('api', api)