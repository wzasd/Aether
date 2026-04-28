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
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
