import { ipcMain } from 'electron'
import { daemon } from '../daemon/daemon'
import { runtimeRegistry } from '../daemon/runtime-registry'
import { taskQueue } from '../daemon/task-queue'
import { getAllProviderUsage } from '../ai/provider-token-tracker'
import { getDb } from '../core/db'

export function registerDaemonIpc(): void {
  ipcMain.handle('daemon:getStatus', () => {
    const agents = runtimeRegistry.getAllActive().map((r) => ({
      profileId: r.profile.id,
      name: r.profile.name,
      role: r.profile.role,
      providerId: r.profile.preferredProvider ?? null,
      isActive: r.isActive,
      isProcessing: r.isProcessing,
      pendingCount: r.pendingMessages.length,
      claimedTaskCount: r.claimedTasks.size,
      maxConcurrentTasks: r.maxConcurrentTasks,
    }))

    // Aggregate workload by provider (aligns with Multica Runtime Workload column)
    const workloadByProvider = new Map<string, { running: number; queued: number }>()
    for (const agent of agents) {
      if (!agent.providerId) continue
      const existing = workloadByProvider.get(agent.providerId) ?? { running: 0, queued: 0 }
      if (agent.isProcessing) existing.running += 1
      existing.queued += agent.pendingCount
      workloadByProvider.set(agent.providerId, existing)
    }
    const providerWorkload: Record<string, { running: number; queued: number }> = {}
    workloadByProvider.forEach((data, providerId) => {
      providerWorkload[providerId] = data
    })

    return { agents, providerWorkload, isRunning: daemon.isRunning() }
  })

  ipcMain.handle('daemon:getHeartbeat', () => {
    return {
      activeRuntimes: runtimeRegistry.getAllActive().length,
      totalPending: taskQueue.countAllPending?.() ?? 0,
      lastBeat: Date.now(),
    }
  })

  ipcMain.handle('daemon:getTokenUsage', (_event, days = 7) => {
    const usage = getAllProviderUsage(days)
    const result: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number }> = {}
    usage.forEach((data, providerId) => {
      result[providerId] = data
    })
    return result
  })

  // Per-agent activity: recent conversations + task summary for the Activity tab
  ipcMain.handle('daemon:getAgentActivity', (_event, agentProfileId: string, limit: number = 20) => {
    if (typeof agentProfileId !== 'string' || !agentProfileId.trim()) {
      throw new Error('Invalid payload: agentProfileId must be a non-empty string')
    }
    if (typeof limit !== 'number' || limit < 1 || !Number.isFinite(limit)) {
      throw new Error('Invalid payload: limit must be a positive number')
    }

    const db = getDb()

    // Recent conversations for this agent (most recent first)
    const recentConversations = db.prepare(
      `SELECT id, title, status, model, provider, created_at, updated_at
       FROM conversations
       WHERE agent_profile_id = ? AND is_draft = 0 AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(agentProfileId.trim(), limit) as Array<{
      id: string
      title: string | null
      status: string
      model: string | null
      provider: string | null
      created_at: number
      updated_at: number
    }>

    // Task summary: counts by status for this agent
    const taskSummary = db.prepare(
      `SELECT ta.status, COUNT(*) AS count
       FROM task_agents ta
       WHERE ta.agent_profile_id = ?
       GROUP BY ta.status`
    ).all(agentProfileId.trim()) as Array<{ status: string; count: number }>

    // Recent completed tasks (for "Recent work" section)
    const recentTasks = db.prepare(
      `SELECT t.id, t.title, t.status, t.completed_at, t.created_at,
              ta.status AS agent_status
       FROM tasks t
       JOIN task_agents ta ON ta.task_id = t.id
       WHERE ta.agent_profile_id = ?
         AND t.completed_at IS NOT NULL
       ORDER BY t.completed_at DESC
       LIMIT ?`
    ).all(agentProfileId.trim(), limit) as Array<{
      id: string
      title: string
      status: string
      completed_at: number | null
      created_at: number
      agent_status: string
    }>

    return { recentConversations, taskSummary, recentTasks }
  })
}
