import { useEffect, useState } from 'react'

interface ConfigOption {
  id: string
  name?: string
  label?: string
  category?: string
  type: string
  currentValue?: string
  options?: Array<{ value: string; name?: string }>
}

interface ConfigOptionsProps {
  /** Active ACP session id; component is a no-op when absent. */
  activeSessionId: string
}

export function ConfigOptions({ activeSessionId }: ConfigOptionsProps) {
  const [options, setOptions] = useState<ConfigOption[]>([])
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Initial fetch when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setOptions([])
      return
    }

    let cancelled = false
    window.api.chat
      .getConfigOptions(activeSessionId)
      .then((next) => {
        if (!cancelled) setOptions(next)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  // Live updates from agent
  useEffect(() => {
    if (!activeSessionId) return
    const unsubscribe = window.api.chat.onEvent((event) => {
      if (event.type === 'config_option_update') {
        setOptions(event.configOptions)
      }
    })
    return unsubscribe
  }, [activeSessionId])

  const handleChange = async (optionId: string, value: string): Promise<void> => {
    setPendingId(optionId)
    // Optimistic local update — rollback on failure
    setOptions((prev) =>
      prev.map((opt) => (opt.id === optionId ? { ...opt, currentValue: value } : opt))
    )
    try {
      await window.api.chat.setConfigOption(activeSessionId, optionId, value)
    } catch {
      // Refetch on failure to recover authoritative state
      try {
        const fresh = await window.api.chat.getConfigOptions(activeSessionId)
        setOptions(fresh)
      } catch {
        /* keep optimistic value on double failure */
      }
    } finally {
      setPendingId(null)
    }
  }

  if (options.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => {
        if (opt.type !== 'select' || !opt.options || opt.options.length === 0) return null
        const label = opt.label ?? opt.name ?? opt.id
        return (
          <select
            key={opt.id}
            value={opt.currentValue ?? ''}
            onChange={(e) => handleChange(opt.id, e.target.value)}
            disabled={pendingId === opt.id}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer max-w-[140px] truncate disabled:opacity-50"
            title={label}
          >
            {opt.options.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.name ?? choice.value}
              </option>
            ))}
          </select>
        )
      })}
    </div>
  )
}
