import { useState, useEffect, useCallback } from 'react'
import { BookOpen, Save, RotateCcw } from 'lucide-react'
import type { AgentProfileConfig } from '../../../../stores/agentProfileStore'

interface InstructionsTabProps {
  profile: AgentProfileConfig
  onSave: (patch: Partial<AgentProfileConfig>) => Promise<void>
}

export function InstructionsTab({ profile, onSave }: InstructionsTabProps) {
  const [systemPrompt, setSystemPrompt] = useState(profile.systemPrompt ?? '')
  const [whenToUse, setWhenToUse] = useState(profile.whenToUse ?? '')
  const [outputContract, setOutputContract] = useState(profile.outputContract ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // Track dirty state
  const isDirty =
    systemPrompt !== (profile.systemPrompt ?? '') ||
    whenToUse !== (profile.whenToUse ?? '') ||
    outputContract !== (profile.outputContract ?? '')

  // Sync when profile changes externally
  useEffect(() => {
    setSystemPrompt(profile.systemPrompt ?? '')
    setWhenToUse(profile.whenToUse ?? '')
    setOutputContract(profile.outputContract ?? '')
  }, [profile.systemPrompt, profile.whenToUse, profile.outputContract])

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return
    setIsSaving(true)
    try {
      await onSave({
        systemPrompt,
        whenToUse,
        outputContract,
      })
      setSavedAt(new Date())
    } finally {
      setIsSaving(false)
    }
  }, [isDirty, isSaving, systemPrompt, whenToUse, outputContract, onSave])

  const handleReset = useCallback(() => {
    setSystemPrompt(profile.systemPrompt ?? '')
    setWhenToUse(profile.whenToUse ?? '')
    setOutputContract(profile.outputContract ?? '')
  }, [profile.systemPrompt, profile.whenToUse, profile.outputContract])

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header with Save/Reset */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <BookOpen className="h-4 w-4" />
          <span>Instructions</span>
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

      {/* System Prompt — main editor */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-300">System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Enter the system prompt that defines this agent's behavior..."
          className="min-h-[280px] w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-colors"
        />
        <span className="text-[10px] text-zinc-500">
          {systemPrompt.length} characters
        </span>
      </div>

      {/* When To Use — secondary field */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-300">When To Use</label>
        <textarea
          value={whenToUse}
          onChange={(e) => setWhenToUse(e.target.value)}
          placeholder="Describe when this agent should be activated..."
          className="min-h-[80px] w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-colors"
        />
      </div>

      {/* Output Contract — secondary field */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-300">Output Contract</label>
        <textarea
          value={outputContract}
          onChange={(e) => setOutputContract(e.target.value)}
          placeholder="Define the expected output format and constraints..."
          className="min-h-[80px] w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-colors"
        />
      </div>
    </div>
  )
}
