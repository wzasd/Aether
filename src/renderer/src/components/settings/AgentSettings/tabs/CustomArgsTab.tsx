import { useState, useEffect, useCallback } from 'react'
import { Terminal, Plus, Trash2, Save, RotateCcw } from 'lucide-react'

interface CustomArgsTabProps {
  initialArgs: string[]
  onSave: (args: string[]) => Promise<void>
}

let nextArgId = 0

interface ArgEntry {
  id: number
  value: string
}

export function CustomArgsTab({ initialArgs, onSave }: CustomArgsTabProps) {
  const [entries, setEntries] = useState<ArgEntry[]>(() =>
    initialArgs.map((value) => ({ id: nextArgId++, value }))
  )
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Each entry may contain space-separated tokens (e.g. "--model claude-sonnet-4")
  const currentArgs = entries.flatMap((e) => e.value.trim().split(/\s+/)).filter(Boolean)
  const isDirty =
    JSON.stringify(currentArgs) !== JSON.stringify(initialArgs)

  useEffect(() => {
    setEntries(initialArgs.map((value) => ({ id: nextArgId++, value })))
  }, [initialArgs])

  const handleAdd = useCallback(() => {
    setEntries((prev) => [...prev, { id: nextArgId++, value: '' }])
  }, [])

  const handleRemove = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleValueChange = useCallback((index: number, newValue: string) => {
    setEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, value: newValue } : entry))
    )
  }, [])

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return
    setIsSaving(true)
    try {
      await onSave(currentArgs)
      setSavedAt(new Date())
    } finally {
      setIsSaving(false)
    }
  }, [isDirty, isSaving, currentArgs, onSave])

  const handleReset = useCallback(() => {
    setEntries(initialArgs.map((value) => ({ id: nextArgId++, value })))
  }, [initialArgs])

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Terminal className="h-4 w-4" />
          <span>Custom Arguments</span>
          {isDirty && (
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              unsaved
            </span>
          )}
          {savedAt && !isDirty && (
            <span className="ml-2 text-[10px] text-zinc-500">
              saved {savedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isDirty && !isSaving
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <Save className="h-3 w-3" />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Helper text */}
      <p className="text-xs text-zinc-500">
        Each row is one argument. Space-separated tokens (e.g.{' '}
        <code className="rounded bg-zinc-800 px-1 font-mono text-[11px]">--model claude-sonnet-4</code>)
        are split into separate args at launch.
      </p>

      {/* Arg list */}
      <div className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <div key={entry.id} className="flex items-center gap-2">
            <input
              type="text"
              value={entry.value}
              onChange={(e) => handleValueChange(index, e.target.value)}
              placeholder="--flag value"
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none transition-colors"
            />
            <button
              onClick={() => handleRemove(index)}
              className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add button */}
      <button
        onClick={handleAdd}
        className="flex items-center gap-1.5 self-start rounded border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <Plus className="h-3 w-3" />
        Add Argument
      </button>
    </div>
  )
}
