import { useCallback, useEffect, useState } from 'react'

export interface DaemonAgentStatus {
  profileId: string
  name: string
  role: string
  providerId: string | null
  isActive: boolean
  isProcessing: boolean
  pendingCount: number
  claimedTaskCount: number
  maxConcurrentTasks: number
}

export interface DaemonStatus {
  agents: DaemonAgentStatus[]
  providerWorkload: Record<string, { running: number; queued: number }>
  isRunning: boolean
}

export function useDaemonStatus(pollInterval = 5000): {
  status: DaemonStatus | null
  heartbeat: { activeRuntimes: number; totalPending: number; lastBeat: number } | null
  refresh: () => void
  loading: boolean
  error: string | null
} {
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  const [heartbeat, setHeartbeat] = useState<{ activeRuntimes: number; totalPending: number; lastBeat: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statusResult, heartbeatResult] = await Promise.all([
        window.api.daemon.getStatus(),
        window.api.daemon.getHeartbeat(),
      ])
      setStatus(statusResult)
      setHeartbeat(heartbeatResult)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, pollInterval)
    return () => clearInterval(timer)
  }, [refresh, pollInterval])

  return { status, heartbeat, refresh, loading, error }
}
