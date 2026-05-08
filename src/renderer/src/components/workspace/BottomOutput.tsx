import { useState } from 'react'
import { X } from 'lucide-react'
import { TerminalPanel } from './TerminalPanel'

type OutputTab = 'terminal' | 'build' | 'test' | 'diagnostics'

interface BottomOutputProps {
  onToggleClose?: () => void
}

export function BottomOutput({ onToggleClose }: BottomOutputProps) {
  const [activeTab, setActiveTab] = useState<OutputTab>('terminal')

  return (
    <div className="h-full border-t border-border bg-background flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border shrink-0">
        {(['terminal', 'build', 'test', 'diagnostics'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 rounded text-xs capitalize transition-colors ${
              activeTab === tab
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onToggleClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Close panel"
        >
          <X size={12} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'terminal' && <TerminalPanel />}
        {activeTab !== 'terminal' && (
          <div className="p-3 overflow-auto font-mono text-xs h-full">
            {activeTab === 'build' && <BuildContent />}
            {activeTab === 'test' && <TestContent />}
            {activeTab === 'diagnostics' && <DiagnosticsContent />}
          </div>
        )}
      </div>
    </div>
  )
}

function BuildContent() {
  return (
    <div className="text-muted-foreground">No recent builds. Run a build command to see output.</div>
  )
}

function TestContent() {
  return (
    <>
      <div><span className="text-green-400">✓ </span><span className="text-muted-foreground">ToolCall.test.tsx — 3 passed</span></div>
      <div><span className="text-green-400">✓ </span><span className="text-muted-foreground">MessageCard.test.tsx — 5 passed</span></div>
      <div className="text-muted-foreground mt-1">8 tests passed in 1.2s</div>
    </>
  )
}

function DiagnosticsContent() {
  return (
    <>
      <div><span className="text-yellow-400">⚠ </span><span className="text-muted-foreground">ToolCall.tsx:12 — Unused variable 'x'</span></div>
      <div className="text-muted-foreground mt-1">No errors.</div>
    </>
  )
}
