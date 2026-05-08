export function PlanBlock({ content }: { content: string }) {
  const lines = content.split('\n').filter(Boolean)
  const steps = lines.map((line, i) => {
    const match = line.match(/^\d+\.\s+(.*)/)
    return { index: i, text: match ? match[1] : line }
  })

  const stepStatus = (i: number): 'done' | 'running' | 'pending' =>
    i === 0 ? 'done' : i === 1 ? 'running' : 'pending'

  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/60">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        <span className="text-[11.5px] text-muted-foreground">Plan</span>
        <span className="ml-auto text-[10.5px] text-muted-foreground">{steps.length} steps</span>
      </div>
      <div className="divide-y divide-border/60">
        {steps.map((step, i) => {
          const s = stepStatus(i)
          return (
            <div
              key={step.index}
              className={`flex items-center gap-2.5 px-3 py-2 ${s === 'done' ? 'bg-background/40' : s === 'running' ? 'bg-blue-950/10' : 'bg-background'}`}
            >
              {s === 'done' && (
                <span className="w-4 h-4 rounded-full border border-emerald-600 bg-emerald-950/60 flex items-center justify-center shrink-0">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-400">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
              )}
              {s === 'running' && (
                <span className="w-4 h-4 rounded-full border border-blue-500/60 flex items-center justify-center shrink-0 relative">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                </span>
              )}
              {s === 'pending' && (
                <span className="w-4 h-4 rounded-full border border-border flex items-center justify-center shrink-0">
                  <span className="text-[9px] text-muted-foreground">{i + 1}</span>
                </span>
              )}
              <span className={`text-[12.5px] leading-snug ${
                s === 'done' ? 'text-muted-foreground line-through' :
                s === 'running' ? 'text-foreground' :
                'text-muted-foreground'
              }`}>
                {step.text}
              </span>
              {s === 'running' && (
                <span className="ml-auto text-[10.5px] text-blue-400 shrink-0">In progress</span>
              )}
              {s === 'done' && (
                <span className="ml-auto text-[10.5px] text-muted-foreground shrink-0">Done</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
