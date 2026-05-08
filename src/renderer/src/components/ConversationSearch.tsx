import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'

export function ConversationSearch({ onSelect }: { onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setResults([])
      return
    }
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await window.api.conversation.search(query)
        setResults(res)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  const highlightSnippet = (snippet: string) => {
    const parts = snippet.split(/(<<.*?>>)/g)
    return parts.map((part, i) =>
      part.startsWith('<<') && part.endsWith('>>')
        ? <mark key={i} className="bg-yellow-200/50 rounded px-0.5">{part.slice(2, -2)}</mark>
        : part
    )
  }

  if (!query.trim() && results.length === 0) {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background text-sm">
          <Search size={14} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话..."
            className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background text-sm">
        <Search size={14} className="text-muted-foreground shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话..."
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r) => (
            <div
              key={r.id}
              onClick={() => {
                onSelect(r.id)
                setQuery('')
                setResults([])
              }}
              className="px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer text-xs"
            >
              <div className="font-medium truncate">{r.title || 'Untitled'}</div>
              <div className="text-muted-foreground line-clamp-2">{highlightSnippet(r.snippet)}</div>
            </div>
          ))}
        </div>
      )}
      {searching && <div className="text-xs text-muted-foreground px-2">搜索中...</div>}
    </div>
  )
}
