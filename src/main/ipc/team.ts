import { ipcMain } from 'electron'
import { loadTeams, getTeam, createTeam, updateTeam, deleteTeam } from '../ai/team-config'

export function registerTeamIpc(): void {
  ipcMain.handle('team:list', () => {
    return loadTeams()
  })

  ipcMain.handle('team:get', (_event, id: string) => {
    return getTeam(id) ?? null
  })

  ipcMain.handle('team:create', (_event, data: {
    name: string
    description?: string
    members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>
    policies?: Record<string, unknown>
    workspaceId?: string
  }) => {
    return createTeam(data)
  })

  ipcMain.handle('team:update', (_event, id: string, patch: {
    name?: string
    description?: string
    members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>
    policies?: Record<string, unknown>
  }) => {
    return updateTeam(id, patch)
  })

  ipcMain.handle('team:delete', (_event, id: string) => {
    return deleteTeam(id)
  })
}
