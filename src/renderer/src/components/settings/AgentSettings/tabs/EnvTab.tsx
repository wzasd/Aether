import { useState, useEffect, useCallback } from 'react'
import { Variable, Plus, Trash2, Eye, EyeOff, Save, RotateCcw } from 'lucide-react'

interface EnvVar {
  key: string
  value: string
  isSecret: boolean
}

interface EnvTabProps {
  initialEnv: Record<string, string>
  onSave: (env: Record<string, string>) => Promise<void>
}

export function EnvTab({ initialEnv, onSave }: EnvTabProps) {
  const [vars, setVars] = useState<EnvVar[]>(() =>
    Object.entries(initialEnv).map(([key, value]) => ({
      key,
      value,
      isSecret: isSecretKey(key),
    }))
  )
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const isDirty =
    JSON.stringify(vars.map((v) => [v.key, v.value]).sort()) !==
    JSON.stringify(Object.entries(initialEnv).sort())

  useEffect(() => {
    setVars(
      Object.entries(initialEnv).map(([key, value]) => ({
        key,
        value,
        isSecret: isSecretKey(key),
      }))
    )
  }, [initialEnv])

  const handleAdd = useCallback(() => {
    setVars((prev) => [...prev, { key: '', value: '', isSecret: false }])
  }, [])

  const handleRemove = useCallback((index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleKeyChange = useCallback((index: number, newKey: string) => {
    setVars((prev) =>
      prev.map((v, i) =>
        i === index ? { ...v, key: newKey, isSecret: isSecretKey(newKey) } : v
      )
    )
  }, [])

  const handleValueChange = useCallback((index: number, newValue: string) => {
    setVars((prev) =>
      prev.map((v, i) => (i === index ? { ...v, value: newValue } : v))
    )
  }, [])

  const toggleShowValue = useCallback((key: string) => {
    setShowValues((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return
    setIsSaving(true)
    try {
      const envObj: Record<string, string> = {}
      for (const v of vars) {
        if (v.key.trim()) {
          envObj[v.key.trim()] = v.value
        }
      }
      await onSave(envObj)
      setSavedAt(new Date())
    } finally {
      setIsSaving(false)
    }
  }, [isDirty, isSaving, vars, onSave])

  const handleReset = useCallback(() => {
    setVars(
      Object.entries(initialEnv).map(([key, value]) => ({
        key,
        value,
        isSecret: isSecretKey(key),
      }))
    )
  }, [initialEnv])

  const hasDuplicateKeys = (() => {
    const keys = vars.map((v) => v.key.trim()).filter(Boolean)
    return new Set(keys).size !== keys.length
  })()

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Variable className="h-4 w-4" />
          <span>Environment Variables</span>
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
            disabled={!isDirty || isSaving || hasDuplicateKeys}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isDirty && !isSaving && !hasDuplicateKeys
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            <Save className="h-3 w-3" />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {hasDuplicateKeys && (
        <div className="rounded border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
          Duplicate keys found. Please use unique key names.
        </div>
      )}

      {/* Variable list */}
      <div className="flex flex-col gap-2">
        {vars.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={v.key}
              onChange={(e) => handleKeyChange(i, e.target.value)}
              placeholder="KEY"
              className="w-40 shrink-0 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none transition-colors"
            />
            <div className="relative flex-1">
              <input
                type={v.isSecret && !showValues[v.key] ? 'password' : 'text'}
                value={v.value}
                onChange={(e) => handleValueChange(i, e.target.value)}
                placeholder="value"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none transition-colors"
              />
              {v.isSecret && (
                <button
                  onClick={() => toggleShowValue(v.key)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showValues[v.key] ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
            <button
              onClick={() => handleRemove(i)}
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
        Add Variable
      </button>
    </div>
  )
}

/** Heuristic: keys containing common secret patterns should be masked by default */
function isSecretKey(key: string): boolean {
  const SECRET_PATTERNS = /api.key|secret|token|password|credential|auth/i
  return SECRET_PATTERNS.test(key)
}
