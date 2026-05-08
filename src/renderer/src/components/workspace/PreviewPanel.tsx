import { useState } from 'react'
import { Monitor, ExternalLink, RotateCw } from 'lucide-react'

const LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/

export function PreviewPanel() {
  const [url, setUrl] = useState('http://localhost:5173')
  const [iframeKey, setIframeKey] = useState(0)

  const isValidLocal = LOCALHOST_PATTERN.test(url)

  const handleRefresh = () => {
    setIframeKey((k) => k + 1)
  }

  const handleOpenExternal = () => {
    window.api.system.openExternal(url)
  }

  return (
    <div className="h-full bg-card flex flex-col">
      {/* URL bar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-background shrink-0">
        {/* Traffic light dots */}
        <div className="flex gap-1.5 shrink-0">
          <div className="w-3 h-3 rounded-full bg-accent" />
          <div className="w-3 h-3 rounded-full bg-accent" />
          <div className="w-3 h-3 rounded-full bg-accent" />
        </div>

        {/* URL input */}
        <div className="flex-1 bg-card border border-border rounded flex items-center gap-2 px-3 py-1">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRefresh()
            }}
            className="flex-1 bg-transparent text-xs text-foreground font-mono outline-none placeholder:text-muted-foreground"
            placeholder="http://localhost:5173"
          />
          <button
            onClick={handleRefresh}
            title="Refresh"
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCw size={12} />
          </button>
        </div>

        <button
          onClick={handleOpenExternal}
          title="Open in browser"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {/* Preview content */}
      <div className="flex-1 min-h-0">
        {isValidLocal ? (
          <iframe
            key={iframeKey}
            src={url}
            sandbox="allow-scripts allow-same-origin allow-forms"
            className="w-full h-full border-0"
            title="Preview"
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-sm">
              <Monitor size={32} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-xs text-muted-foreground mb-1">Preview not available</p>
              <p className="text-xs text-muted-foreground">
                Enter a local dev server URL (e.g. http://localhost:5173).
                Remote URLs are not supported in preview.
              </p>
              <button
                onClick={handleOpenExternal}
                className="mt-3 flex items-center gap-1.5 mx-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <ExternalLink size={12} />
                Open in browser
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
