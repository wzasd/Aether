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
    search: (query: string): Promise<any[]> => ipcRenderer.invoke('conversation:search', query)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
