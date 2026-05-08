import { useState, useEffect, useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import ReactDOM from 'react-dom'
import {
  X, Plus, GitCompare, Monitor, Settings as SettingsIcon,
  Terminal, Code2, BookOpen, LayoutGrid, Brain,
  FolderOpen, Search, GitBranch, Replace,
  FileCode, FileText, ChevronRight, ChevronDown,
  FileDiff, CircleDot, CheckCircle2, AlertCircle,
  GitCommit, Minimize2, LayoutList,
  Cpu, Bell, Moon, Key, Sliders,
  Database, Globe, RefreshCw, ExternalLink, Download,
  Pencil, Trash2, ShieldAlert, Package,
  BarChart3, TrendingUp, Users,
} from 'lucide-react'
import { CodePanel } from './CodePanel'
import { PreviewPanel } from './PreviewPanel'
import { DiffPanel } from './DiffPanel'
import { MemoryContent } from './MemoryContent'
import { ExplorerPanel } from './ExplorerPanel'
import { TeamTopology } from './TeamTopology'
import { useUIStore } from '../../stores/uiStore'
import { useMemoryPalaceStore } from '../../stores/memoryPalaceStore'
import { useFileStore } from '../../stores/fileStore'
import { useUpdateStore } from '../../stores/updateStore'
import { fetchMarketplace, type McpServerTemplate } from '../../data/mcp-marketplace'
import { useAgentProfileStore, type AgentProfileConfig } from '../../stores/agentProfileStore'
import { useProviderStore } from '../../stores/providerStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { AgentSettings } from '../settings/AgentSettings'

type PanelType = 'code' | 'diff' | 'docs' | 'preview' | 'settings' | 'memory'

interface WorkspacePanel {
  id: string
  type: PanelType
  label: string
}

interface WorkspaceAreaProps {
  showSidePanel: boolean
  onToggleSidePanel: () => void
  onToggleBottomPanel: () => void
  onCollapseWorkspace?: () => void
  openSettingsTrigger?: number
  openAgentSettingsTrigger?: number
  openTrackChangesTrigger?: number
  openMemoryTrigger?: number
}

const PANEL_CATALOGUE: { type: PanelType; label: string; icon: React.ReactNode; shortLabel: string }[] = [
  { type: 'code',     label: 'Code Editor',     shortLabel: 'Editor',   icon: <Code2 size={15} /> },
  { type: 'diff',     label: 'Track Changes',   shortLabel: 'Changes',  icon: <GitCompare size={15} /> },
  { type: 'docs',     label: 'Documentation',   shortLabel: 'Docs',     icon: <BookOpen size={15} /> },
  { type: 'preview',  label: 'Preview',         shortLabel: 'Preview',  icon: <Monitor size={15} /> },
  { type: 'memory',   label: 'Memory Palace',   shortLabel: 'Memory',   icon: <Brain size={15} /> },
  { type: 'settings', label: 'Settings',        shortLabel: 'Settings', icon: <SettingsIcon size={15} /> },
]

let panelCounter = 3

export function WorkspaceArea({
  showSidePanel,
  onToggleSidePanel,
  onToggleBottomPanel,
  onCollapseWorkspace,
  openSettingsTrigger,
  openAgentSettingsTrigger,
  openTrackChangesTrigger,
  openMemoryTrigger,
}: WorkspaceAreaProps) {
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen)
  const [panels, setPanels] = useState<WorkspacePanel[]>([
    { id: '1', type: 'code',     label: 'Code Editor' },
    { id: '2', type: 'diff',     label: 'Track Changes' },
    { id: '3', type: 'settings', label: 'Settings' },
  ])
  const [activePanelId, setActivePanelId] = useState('1')

  const [settingsSection, setSettingsSection] = useState('general')
  const [showPanelPicker, setShowPanelPicker] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'explorer' | 'search' | 'git'>('explorer')
  const [showExplorer, setShowExplorer] = useState(true)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 })

  const activePanel = panels.find((p) => p.id === activePanelId)

  const handleTogglePicker = () => {
    if (!showPanelPicker && addBtnRef.current) {
      const r = addBtnRef.current.getBoundingClientRect()
      setPickerPos({ top: r.bottom + 4, left: r.left })
    }
    setShowPanelPicker((v) => !v)
  }

  const addPanel = (type: PanelType) => {
    const already = panels.find((p) => p.type === type)
    if (already) { setActivePanelId(already.id); setShowPanelPicker(false); return }
    const cat = PANEL_CATALOGUE.find((c) => c.type === type)!
    const id = String(++panelCounter)
    setPanels((prev) => [...prev, { id, type, label: cat.label }])
    setActivePanelId(id)
    setShowPanelPicker(false)
  }

  const closePanel = (panelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== panelId)
      if (activePanelId === panelId && next.length > 0) {
        const idx = prev.findIndex((p) => p.id === panelId)
        setActivePanelId((next[idx] ?? next[idx - 1]).id)
      }
      return next
    })
  }

  const getPanelIcon = (type: PanelType) =>
    PANEL_CATALOGUE.find((c) => c.type === type)?.icon ?? <LayoutGrid size={15} />

  const openPanelSeq = useMemoryPalaceStore((s) => s._openPanelSeq)
  useEffect(() => {
    if (openPanelSeq > 0) addPanel('memory')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPanelSeq])

  const openInCodeSeq = useFileStore((s) => s._openInCodePanelSeq)
  const openInCodePath = useFileStore((s) => s._openInCodePanelPath)
  useEffect(() => {
    if (openInCodeSeq === 0 || !openInCodePath) return
    addPanel('code')
    useFileStore.getState().openFile(openInCodePath)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openInCodeSeq])

  useEffect(() => {
    if (!openSettingsTrigger) return
    const existing = panels.find((p) => p.type === 'settings')
    if (existing) {
      setActivePanelId(existing.id)
    } else {
      const cat = PANEL_CATALOGUE.find((c) => c.type === 'settings')!
      const id = String(++panelCounter)
      setPanels((prev) => [...prev, { id, type: 'settings', label: cat.label }])
      setActivePanelId(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSettingsTrigger])

  useEffect(() => {
    if (!openAgentSettingsTrigger) return
    const existing = panels.find((p) => p.type === 'settings')
    if (existing) {
      setActivePanelId(existing.id)
    } else {
      const cat = PANEL_CATALOGUE.find((c) => c.type === 'settings')!
      const id = String(++panelCounter)
      setPanels((prev) => [...prev, { id, type: 'settings', label: cat.label }])
      setActivePanelId(id)
    }
    setSettingsSection('agents')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAgentSettingsTrigger])

  useEffect(() => {
    if (!openTrackChangesTrigger) return
    const existing = panels.find((p) => p.type === 'diff')
    if (existing) {
      setActivePanelId(existing.id)
    } else {
      const cat = PANEL_CATALOGUE.find((c) => c.type === 'diff')!
      const id = String(++panelCounter)
      setPanels((prev) => [...prev, { id, type: 'diff', label: cat.label }])
      setActivePanelId(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrackChangesTrigger])

  useEffect(() => {
    if (!openMemoryTrigger) return
    const existing = panels.find((p) => p.type === 'memory')
    if (existing) {
      setActivePanelId(existing.id)
    } else {
      const cat = PANEL_CATALOGUE.find((c) => c.type === 'memory')!
      const id = String(++panelCounter)
      setPanels((prev) => [...prev, { id, type: 'memory', label: cat.label }])
      setActivePanelId(id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMemoryTrigger])



  const showFileExplorer = activePanel?.type === 'code' && showExplorer
  const showOutline = showSidePanel && activePanel?.type !== 'code'

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden min-w-0">

      {/* ══ PANEL TAB BAR ═══════════════════════════ */}
      <div className="border-b border-border bg-background flex items-center h-11 shrink-0">
        <div className="flex items-center flex-1 min-w-0 px-2 gap-0.5">
          <div className="hide-scrollbar flex items-center flex-1 overflow-x-auto min-w-0 gap-0.5">
          {panels.map((panel) => {
            const cat = PANEL_CATALOGUE.find((c) => c.type === panel.type)!
            return (
              <div key={panel.id} className="relative group shrink-0">
                <button
                  onClick={() => setActivePanelId(panel.id)}
                  className={`titlebar-no-drag relative z-40 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                    activePanelId === panel.id
                      ? 'bg-secondary/80 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-card'
                  }`}
                >
                  {cat.icon}
                  <span>{cat.label}</span>
                  <span
                    role="button"
                    onClick={(e) => closePanel(panel.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 p-0.5 rounded hover:bg-secondary hover:text-foreground text-muted-foreground relative z-40"
                  >
                    <X size={9} />
                  </span>
                  {activePanelId === panel.id && (
                    <span className="absolute bottom-0 left-2 right-2 h-px rounded-full bg-blue-500" />
                  )}
                </button>
              </div>
            )
          })}

          <button
            ref={addBtnRef}
            onClick={handleTogglePicker}
            title="Add panel"
            className={`titlebar-no-drag relative z-40 shrink-0 flex items-center justify-center w-7 h-7 rounded text-xs transition-colors ${
              showPanelPicker ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-card'
            }`}
          >
            <Plus size={13} />
          </button>
          </div>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
        </div>

        {showPanelPicker && ReactDOM.createPortal(
          <>
            <div className="fixed inset-0 z-[99]" onClick={() => setShowPanelPicker(false)} />
            <div
              className="fixed z-[100] w-52 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
              style={{ top: pickerPos.top, left: pickerPos.left }}
            >
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs text-muted-foreground">Open panel</p>
              </div>
              <div className="py-1">
                {PANEL_CATALOGUE.map((cat) => {
                  const isOpen = !!panels.find((p) => p.type === cat.type)
                  return (
                    <button
                      key={cat.type}
                      onClick={() => addPanel(cat.type)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                        isOpen ? 'text-muted-foreground hover:bg-secondary/50' : 'text-foreground hover:bg-secondary'
                      }`}
                    >
                      <span className={isOpen ? 'text-muted-foreground' : 'text-muted-foreground'}>{cat.icon}</span>
                      <span className="text-xs">{cat.label}</span>
                      {isOpen && <span className="ml-auto text-[10px] text-muted-foreground">open</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </>,
          document.body
        )}

        <div className="flex items-center gap-1 px-2 border-l border-border shrink-0">
          {activePanel?.type === 'code' && (
            <button
              onClick={() => setShowExplorer((v) => !v)}
              title={showExplorer ? 'Hide Explorer' : 'Show Explorer'}
              className={`titlebar-no-drag relative z-40 p-1.5 rounded transition-colors ${showExplorer ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {showExplorer ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="15" y1="3" x2="15" y2="21"/>
                  <rect x="16" y="4.5" width="3.5" height="15" rx="0.5" fill="currentColor" stroke="none"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="15" y1="3" x2="15" y2="21"/>
                </svg>
              )}
            </button>
          )}
          {activePanel?.type !== 'code' && activePanel?.type !== 'settings' && activePanel?.type !== 'memory' && (
            <button
              onClick={onToggleSidePanel}
              className={`titlebar-no-drag relative z-40 p-1.5 rounded transition-colors ${showSidePanel ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="Outline"
            >
              <LayoutList size={14} />
            </button>
          )}
          {(activePanel?.type === 'code' || activePanel?.type === 'diff' || activePanel?.type === 'preview') && (
            <button
              onClick={onToggleBottomPanel}
              className={`titlebar-no-drag relative z-40 p-1.5 rounded transition-colors ${bottomPanelOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="Terminal"
            >
              <Terminal size={14} />
            </button>
          )}

          <div className="w-px h-4 bg-secondary mx-0.5" />

          {onCollapseWorkspace && (
            <button
              onClick={onCollapseWorkspace}
              title="Collapse Workspace"
              className="titlebar-no-drag relative z-40 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors"
            >
              <Minimize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ══ MAIN WORKSPACE ══════════════════════════════ */}
      <div className="flex-1 overflow-hidden min-w-0">
        <Group orientation="horizontal" autoSave="workspace-horizontal" className="h-full">

          {/* ── Left: file tabs + breadcrumb + editor + bottom panel ── */}
          <Panel defaultSize="75%" minSize="30%" id="editor-area">
            <div className="h-full flex flex-col overflow-hidden min-w-0">

              <div className="h-full overflow-auto">
                {activePanel?.type === 'code'     && <CodePanel />}
                {activePanel?.type === 'diff'     && <DiffPanel />}
                {activePanel?.type === 'docs'     && <DocsContent />}
                {activePanel?.type === 'preview'  && <PreviewPanel />}
                {activePanel?.type === 'settings' && (
                  <SettingsContent section={settingsSection} onSection={setSettingsSection} />
                )}
                {activePanel?.type === 'memory'   && <MemoryContent />}
              </div>
            </div>
          </Panel>

          {/* Tabbed Sidebar — Code panel only */}
          {showFileExplorer && (
            <>
              <Separator className="relative z-40 group w-1 bg-card hover:bg-accent transition-colors cursor-col-resize flex items-center justify-center">
                <div className="w-px h-8 rounded-full bg-accent group-hover:bg-secondary transition-colors" />
              </Separator>
              <Panel defaultSize="25%" minSize="12%" maxSize="50%" id="sidebar">
                <div className="h-full border-l border-border bg-background flex flex-col">
                  <div className="flex items-center justify-center gap-1 border-b border-border shrink-0 px-2">
                    {([
                      { id: 'explorer' as const, icon: <FolderOpen size={13} />, title: 'Explorer' },
                      { id: 'search' as const,   icon: <Search size={13} />,     title: 'Search' },
                      { id: 'git' as const,      icon: <GitBranch size={13} />,  title: 'Git' },
                    ]).map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setSidebarTab(tab.id)}
                        title={tab.title}
                        className={`relative w-8 h-8 my-1 flex items-center justify-center rounded transition-colors ${
                          sidebarTab === tab.id
                            ? 'text-foreground bg-secondary'
                            : 'text-muted-foreground hover:text-muted-foreground hover:bg-secondary/50'
                        }`}
                      >
                        {tab.icon}
                        {sidebarTab === tab.id && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-px rounded-full bg-blue-500" />
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="px-3 py-1.5 border-b border-border/60 shrink-0">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {sidebarTab === 'explorer' ? 'Explorer' : sidebarTab === 'search' ? 'Search & Replace' : 'Source Control'}
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 py-1">
                    {sidebarTab === 'explorer' && (
                      <ExplorerPanel embedded onOpenFile={(path) => {
                        useFileStore.getState().openFile(path)
                        useFileStore.getState().requestOpenInCodePanel(path)
                      }} />
                    )}
                    {sidebarTab === 'search'   && <SearchSidebar />}
                    {sidebarTab === 'git'      && <GitSidebar />}
                  </div>
                </div>
              </Panel>
            </>
          )}

          {/* Outline panel */}
          {showOutline && (
            <>
              <Separator className="relative z-40 group w-1 bg-card hover:bg-accent transition-colors cursor-col-resize flex items-center justify-center">
                <div className="w-px h-8 rounded-full bg-accent group-hover:bg-secondary transition-colors" />
              </Separator>
              <Panel defaultSize="25%" minSize="12%" maxSize="50%" id="outline">
                <div className="h-full border-l border-border bg-background flex flex-col">
                  <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground">Outline</div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 text-xs">
                    <div className="text-muted-foreground mb-1">Functions</div>
                    <div className="ml-2 text-foreground flex items-center gap-1.5"><span className="text-blue-400">fn</span> ToolCall()</div>
                    <div className="ml-2 text-muted-foreground flex items-center gap-1.5"><span className="text-blue-400">fn</span> useState</div>
                    <div className="text-muted-foreground mt-3 mb-1">Exports</div>
                    <div className="ml-2 text-foreground flex items-center gap-1.5"><span className="text-emerald-400">↗</span> ToolCall</div>
                  </div>
                </div>
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  )
}

/* ─── Docs Content ──────────────────────────────────────────────── */
function DocsContent() {
  return (
    <div className="h-full p-6 bg-card overflow-auto">
      <div className="max-w-2xl space-y-4 text-sm">
        <h1 className="text-foreground">CLAUDE.md</h1>
        <p className="text-muted-foreground">This file provides guidance to Claude Code when working with code in this repository.</p>
        <h2 className="text-foreground">Project Structure</h2>
        <p className="text-muted-foreground">Standard React + TypeScript structure with Tailwind CSS.</p>
        <div className="font-mono text-xs bg-background border border-border rounded p-3 text-muted-foreground">
          src/<br />{'  '}app/<br />{'    '}App.tsx<br />{'    '}components/
        </div>
        <h2 className="text-foreground">Commands</h2>
        <div className="font-mono text-xs bg-background border border-border rounded p-3 text-muted-foreground space-y-1">
          <div><span className="text-muted-foreground"># dev</span></div>
          <div>pnpm dev</div>
          <div><span className="text-muted-foreground"># build</span></div>
          <div>pnpm build</div>
        </div>
      </div>
    </div>
  )
}

/* ─── Settings Content ──────────────────────────────────────────── */
const SETTINGS_NAV = [
  { id: 'general',     label: 'General',        icon: <Sliders size={13} /> },
  { id: 'appearance',  label: 'Appearance',     icon: <Moon size={13} /> },
  { id: 'agents',      label: 'Agents',         icon: <Cpu size={13} /> },
  { id: 'runtimes',    label: 'Runtimes',       icon: <Monitor size={13} /> },
  { id: 'teams',       label: 'Teams',          icon: <Users size={13} /> },
  { id: 'keys',        label: 'API Keys',       icon: <Key size={13} /> },
  { id: 'network',     label: 'Network',        icon: <Globe size={13} /> },
  { id: 'git',         label: 'Git',            icon: <GitBranch size={13} /> },
  { id: 'data',        label: 'Data & Storage', icon: <Database size={13} /> },
  { id: 'notifs',      label: 'Notifications',  icon: <Bell size={13} /> },
  { id: 'mcp',         label: 'MCP Servers',    icon: <Cpu size={13} /> },
  { id: 'usage',       label: 'Usage',           icon: <BarChart3 size={13} /> },
]

function SettingsContent({ section, onSection }: { section: string; onSection: (s: string) => void }) {
  return (
    <div className="h-full bg-card flex overflow-hidden">
      <div className="w-44 border-r border-border bg-background overflow-y-auto shrink-0">
        <div className="px-3 py-3 border-b border-border">
          <p className="text-xs text-muted-foreground">Settings</p>
        </div>
        <nav className="p-2 space-y-0.5">
          {SETTINGS_NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => onSection(n.id)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs transition-colors text-left ${
                section === n.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              {n.icon}{n.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {section === 'general'    && <SettingsGeneral />}
        {section === 'appearance' && <SettingsAppearance />}
        {section === 'agents'     && <AgentSettings />}
        {section === 'runtimes'   && <SettingsRuntimes />}
        {section === 'teams'      && <SettingsTeams />}
        {section === 'keys'       && <SettingsKeys />}
        {section === 'mcp'        && <SettingsMcp />}
        {section === 'usage'      && <SettingsUsage />}
        {!['general','appearance','agents','runtimes','teams','keys','mcp','usage'].includes(section) && (
          <div>
            <h2 className="text-foreground mb-1 capitalize">{section}</h2>
            <p className="text-xs text-muted-foreground">Settings for this section are coming soon.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-border/60 gap-4">
      <div className="flex-1">
        <div className="text-xs text-foreground">{label}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on = false }: { on?: boolean }) {
  const [val, setVal] = useState(on)
  return (
    <button onClick={() => setVal(!val)} className={`w-9 h-5 rounded-full transition-colors relative ${val ? 'bg-blue-500' : 'bg-accent'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${val ? 'left-4' : 'left-0.5'}`} />
    </button>
  )
}

function Sel({ options, def }: { options: string[]; def: string }) {
  return (
    <select defaultValue={def} className="bg-secondary border border-border rounded text-xs text-foreground px-2 py-1 outline-none">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  )
}

function SettingsGeneral() {
  const { checking, lastResult, checkUpdate, dismissUpdate } = useUpdateStore()

  useEffect(() => {
    const unsubscribe = window.api.system.onUpdateAvailable((info) => {
      useUpdateStore.getState().setOnStartupResult(info)
    })
    return unsubscribe
  }, [])

  return (
    <div>
      <h2 className="text-foreground mb-4">General</h2>
      <SettingsRow label="Auto-save" desc="Save files automatically on change"><Toggle on /></SettingsRow>
      <SettingsRow label="Tab size"><Sel options={['2','4','8']} def="2" /></SettingsRow>
      <SettingsRow label="Format on save" desc="Run formatter when a file is saved"><Toggle on /></SettingsRow>
      <SettingsRow label="Telemetry" desc="Send anonymous usage data"><Toggle /></SettingsRow>
      <SettingsRow label="Language"><Sel options={['English','中文','日本語']} def="English" /></SettingsRow>

      {/* Updates */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs text-foreground">Updates</h3>
          <button
            onClick={checkUpdate}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-secondary hover:bg-accent text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>

        {lastResult && (
          <div className={`p-3 rounded-lg border text-xs ${
            lastResult.hasUpdate
              ? 'bg-blue-500/10 border-blue-500/30'
              : 'bg-secondary/50 border-border'
          }`}>
            {lastResult.hasUpdate ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Download size={13} className="text-blue-400 shrink-0" />
                  <span className="text-foreground">
                    New version available: <span className="text-blue-400">{lastResult.latestVersion}</span>
                  </span>
                  <span className="text-muted-foreground">(current: {lastResult.currentVersion})</span>
                </div>
                {lastResult.releaseNotes && (
                  <div className="text-muted-foreground max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {lastResult.releaseNotes}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {lastResult.releaseUrl && (
                    <button
                      onClick={() => window.api.system.openExternal(lastResult.releaseUrl!)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                    >
                      <ExternalLink size={10} />
                      Download
                    </button>
                  )}
                  <button
                    onClick={dismissUpdate}
                    className="px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw size={12} />
                You're up to date (v{lastResult.currentVersion})
              </div>
            )}
          </div>
        )}

        {!lastResult && !checking && (
          <p className="text-xs text-muted-foreground">
            Bytro checks GitHub Releases for new versions. No code signing required for manual updates.
          </p>
        )}
      </div>
    </div>
  )
}

function SettingsAppearance() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  return (
    <div>
      <h2 className="text-foreground mb-4">Appearance</h2>
      <SettingsRow label="Theme">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
          className="bg-secondary border border-border rounded text-xs text-foreground px-2 py-1 outline-none"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </SettingsRow>
      <SettingsRow label="Font family"><Sel options={['JetBrains Mono','Fira Code','Menlo']} def="JetBrains Mono" /></SettingsRow>
      <SettingsRow label="Font size"><Sel options={['12','13','14','16']} def="13" /></SettingsRow>
      <SettingsRow label="Minimap" desc="Show minimap in editor"><Toggle /></SettingsRow>
    </div>
  )
}

function SettingsRuntimes() {
  const providers = useProviderStore((s) => s.providers)
  const isLoading = useProviderStore((s) => s.isLoading)
  const loadProviders = useProviderStore((s) => s.loadProviders)
  const setApiKey = useProviderStore((s) => s.setApiKey)
  const testConnection = useProviderStore((s) => s.testConnection)
  const [editingPath, setEditingPath] = useState<Record<string, string>>({})
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<Record<string, string>>({})

  useEffect(() => {
    loadProviders().catch(() => {})
  }, [loadProviders])

  const configureRuntime = async (id: string, binaryPath?: string) => {
    await window.api.provider.configure(id, { enabled: true, binaryPath: binaryPath?.trim() || undefined })
    await loadProviders()
  }

  const saveKey = async (id: string) => {
    const key = apiKeys[id]?.trim()
    if (!key) return
    await setApiKey(id, key)
    setApiKeys((prev) => ({ ...prev, [id]: '' }))
  }

  const runTest = async (id: string) => {
    setTesting((prev) => ({ ...prev, [id]: 'Testing...' }))
    try {
      const result = await testConnection(id)
      setTesting((prev) => ({
        ...prev,
        [id]: result.ok ? `OK${result.version ? ` · ${result.version}` : ''}` : 'Failed'
      }))
    } catch (err) {
      setTesting((prev) => ({ ...prev, [id]: String(err) }))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-foreground">Runtimes</h2>
        <button
          onClick={() => loadProviders().catch(() => {})}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded transition-colors"
        >
          <RefreshCw size={11} /> Detect
        </button>
      </div>

      <div className="space-y-3">
        {providers.map((provider) => {
          const pathValue = editingPath[provider.meta.id] ?? ''
          return (
            <div key={provider.meta.id} className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="flex items-start gap-3">
                <Monitor size={14} className={provider.installed ? 'text-emerald-400 mt-0.5' : 'text-muted-foreground mt-0.5'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-foreground">{provider.meta.name}</span>
                    <span className="text-[10px] rounded border border-border px-1.5 py-0.5 text-muted-foreground">{provider.meta.id}</span>
                    <span className={`text-[10px] rounded px-1.5 py-0.5 ${provider.installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {provider.installed ? provider.version ?? 'installed' : 'not detected'}
                    </span>
                    {provider.hasApiKey && (
                      <span className="text-[10px] rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-400">key set</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Binary <span className="font-mono text-foreground">{provider.meta.binary}</span> · {provider.meta.vendor}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {provider.meta.models.slice(0, 5).map((model) => (
                      <span key={model.id} className="text-[10px] rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground">
                        {model.name}
                      </span>
                    ))}
                    {provider.meta.models.length > 5 && (
                      <span className="text-[10px] text-muted-foreground">+{provider.meta.models.length - 5}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 mt-3 md:grid-cols-2">
                <div className="flex gap-2">
                  <input
                    value={pathValue}
                    onChange={(e) => setEditingPath((prev) => ({ ...prev, [provider.meta.id]: e.target.value }))}
                    placeholder="Custom binary path"
                    className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <button
                    onClick={() => configureRuntime(provider.meta.id, pathValue)}
                    className="shrink-0 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Save
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={apiKeys[provider.meta.id] ?? ''}
                    onChange={(e) => setApiKeys((prev) => ({ ...prev, [provider.meta.id]: e.target.value }))}
                    placeholder={provider.hasApiKey ? 'Replace API key' : 'API key'}
                    type="password"
                    className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <button
                    onClick={() => saveKey(provider.meta.id)}
                    className="shrink-0 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Key
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => runTest(provider.meta.id)}
                  className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Test
                </button>
                {testing[provider.meta.id] && (
                  <span className="text-[10px] text-muted-foreground">{testing[provider.meta.id]}</span>
                )}
              </div>
            </div>
          )
        })}
        {providers.length === 0 && (
          <p className="text-xs text-muted-foreground">{isLoading ? 'Detecting runtimes...' : 'No runtimes registered.'}</p>
        )}
      </div>
    </div>
  )
}

interface SettingsTeamConfig {
  id: string
  name: string
  description: string
  members?: Array<{ profileId: string; providerOverride?: string; modelOverride?: string }>
  policies?: Record<string, unknown>
}

function SettingsTeams() {
  const [teams, setTeams] = useState<SettingsTeamConfig[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [saving, setSaving] = useState(false)
  const [configOpen, setConfigOpen] = useState(true)
  const [topologyOpen, setTopologyOpen] = useState(true)
  const profiles = useAgentProfileStore((s) => s.profiles)
  const loadProfiles = useAgentProfileStore((s) => s.loadProfiles)
  const seedDefaults = useAgentProfileStore((s) => s.seedDefaults)
  const providers = useProviderStore((s) => s.providers)
  const loadProviders = useProviderStore((s) => s.loadProviders)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const handleCreateTeam = async () => {
    setSaving(true)
    try {
      const created = await window.api.team.create({ name: 'New Team', description: '', members: [] })
      if (created) {
        const rows = await window.api.team.list()
        setTeams(rows as SettingsTeamConfig[])
        setSelectedTeamId((created as { id: string }).id)
        setConfigOpen(true)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTeam = async () => {
    if (!team) return
    if (!window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) return
    setSaving(true)
    try {
      await window.api.team.delete(team.id)
      const rows = await window.api.team.list()
      setTeams(rows as SettingsTeamConfig[])
      setSelectedTeamId(rows[0]?.id || '')
    } finally {
      setSaving(false)
    }
  }

  const loadTeams = async () => {
    const rows = await window.api.team.list()
    setTeams(rows as SettingsTeamConfig[])
    setSelectedTeamId((prev) => prev || rows[0]?.id || '')
  }

  useEffect(() => {
    loadTeams().catch(() => setTeams([]))
    loadProfiles(currentWorkspaceId ?? undefined).then(() => {
      // Auto-seed default agents if no profiles exist yet (prevents empty agent list)
      const current = useAgentProfileStore.getState().profiles
      if (current.length === 0) {
        seedDefaults().catch((err) => console.error('Failed to seed default agents:', err))
      }
    }).catch(() => {})
    loadProviders().catch(() => {})
  }, [currentWorkspaceId, loadProfiles, loadProviders, seedDefaults])

  const team = teams.find((t) => t.id === selectedTeamId) ?? teams[0]
  const policies = team?.policies ?? {}
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? id
  const getModelsForProvider = (providerId: string) =>
    providers.find((p) => p.meta.id === providerId)?.meta.models ?? []

  const updateSelectedTeam = async (patch: { members?: SettingsTeamConfig['members']; policies?: Record<string, unknown>; name?: string; description?: string }) => {
    if (!team) return
    setSaving(true)
    try {
      const updated = await window.api.team.update(team.id, patch)
      if (updated) {
        setTeams((prev) => prev.map((t) => t.id === updated.id ? updated as SettingsTeamConfig : t))
      }
    } finally {
      setSaving(false)
    }
  }

  const updatePolicy = async (key: string, value: unknown) => {
    await updateSelectedTeam({ policies: { ...policies, [key]: value } })
  }

  const updateMembers = async (members: NonNullable<SettingsTeamConfig['members']>) => {
    await updateSelectedTeam({ members })
  }

  const updateMember = async (index: number, patch: Partial<NonNullable<SettingsTeamConfig['members']>[number]>) => {
    const members = [...(team?.members ?? [])]
    const current = members[index]
    if (!current) return
    members[index] = { ...current, ...patch }
    await updateMembers(members)
  }

  const addMember = async () => {
    const members = [...(team?.members ?? [])]
    const existing = new Set(members.map((m) => m.profileId))
    const next = profiles.find((p) => p.isEnabled && !existing.has(p.id)) ?? profiles.find((p) => !existing.has(p.id))
    if (!next) return
    await updateMembers([...members, { profileId: next.id }])
  }

  const removeMember = async (index: number) => {
    const members = [...(team?.members ?? [])]
    members.splice(index, 1)
    await updateMembers(members)
  }

  const PolicyToggle = ({ id, label, desc }: { id: string; label: string; desc: string }) => {
    const enabled = Boolean(policies[id])
    return (
      <SettingsRow label={label} desc={desc}>
        <button
          disabled={saving}
          onClick={() => updatePolicy(id, !enabled)}
          className={`w-9 h-5 rounded-full transition-colors relative disabled:opacity-50 ${enabled ? 'bg-blue-500' : 'bg-accent'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-4' : 'left-0.5'}`} />
        </button>
      </SettingsRow>
    )
  }

  return (
    <div>
      <h2 className="text-foreground mb-4">Teams</h2>
      {teams.length === 0 ? (
        <p className="text-xs text-muted-foreground">No teams configured.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <select
              value={team?.id ?? ''}
              onChange={(e) => { setSelectedTeamId(e.target.value); setConfigOpen(true) }}
              className="bg-secondary border border-border rounded text-xs text-foreground px-2 py-1.5 outline-none min-w-52"
            >
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              disabled={saving}
              onClick={handleCreateTeam}
              className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <Plus size={12} /> Create
            </button>
            <button
              onClick={() => setConfigOpen((v) => !v)}
              className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown size={12} className={`transition-transform ${configOpen ? '' : '-rotate-90'}`} />
              Configure
            </button>
          </div>

          {team && configOpen && (
            <>
              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-start gap-2">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 flex-1">
                    <input
                      value={team.name}
                      onChange={(e) => {
                        const name = e.target.value
                        setTeams((prev) => prev.map((t) => t.id === team.id ? { ...t, name } : t))
                      }}
                      onBlur={(e) => updateSelectedTeam({ name: e.target.value.trim() || team.name })}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none"
                    />
                    <input
                      value={team.description}
                      onChange={(e) => {
                        const description = e.target.value
                        setTeams((prev) => prev.map((t) => t.id === team.id ? { ...t, description } : t))
                      }}
                      onBlur={(e) => updateSelectedTeam({ description: e.target.value.trim() })}
                      className="rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none"
                    />
                  </div>
                  <button
                    disabled={saving}
                    onClick={handleDeleteTeam}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-red-400 disabled:opacity-50 shrink-0"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(team.members ?? []).map((m) => (
                    <span key={m.profileId} className="text-[10px] rounded-full border border-border bg-card px-2 py-1 text-muted-foreground">
                      {profileName(m.profileId)}
                      {(m.providerOverride || m.modelOverride) && ' · runtime override'}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-foreground">Topology</h3>
                  <button
                    onClick={() => setTopologyOpen((v) => !v)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown size={12} className={`transition-transform ${topologyOpen ? '' : '-rotate-90'}`} />
                  </button>
                </div>
                {topologyOpen && (
                  <TeamTopology
                    name={team.name}
                    members={team.members ?? []}
                    profiles={profiles}
                    policies={team.policies}
                  />
                )}
              </div>

              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-foreground">Members & Runtime Overrides</h3>
                  <button
                    disabled={saving}
                    onClick={addMember}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <Plus size={11} /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {(team.members ?? []).map((member, index) => {
                    const providerId = member.providerOverride ?? ''
                    const models = getModelsForProvider(providerId)
                    return (
                      <div key={`${member.profileId}-${index}`} className="grid grid-cols-1 gap-2 rounded border border-border/60 bg-card p-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                        <select
                          value={member.profileId}
                          onChange={(e) => updateMember(index, { profileId: e.target.value })}
                          className="min-w-0 rounded border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none"
                        >
                          {profiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.name}</option>
                          ))}
                        </select>
                        <select
                          value={providerId}
                          onChange={(e) => {
                            const nextProvider = e.target.value || undefined
                            const firstModel = nextProvider ? getModelsForProvider(nextProvider)[0]?.id : undefined
                            updateMember(index, { providerOverride: nextProvider, modelOverride: firstModel })
                          }}
                          className="min-w-0 rounded border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none"
                        >
                          <option value="">Default runtime</option>
                          {providers.map((provider) => (
                            <option key={provider.meta.id} value={provider.meta.id}>{provider.meta.name}</option>
                          ))}
                        </select>
                        <select
                          value={member.modelOverride ?? ''}
                          disabled={!providerId}
                          onChange={(e) => updateMember(index, { modelOverride: e.target.value || undefined })}
                          className="min-w-0 rounded border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none disabled:opacity-50"
                        >
                          <option value="">Default model</option>
                          {models.map((model) => (
                            <option key={model.id} value={model.id}>{model.name}</option>
                          ))}
                        </select>
                        <button
                          disabled={saving}
                          onClick={() => removeMember(index)}
                          className="rounded border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-red-400 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    )
                  })}
                  {(team.members ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No members yet.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-foreground mb-1">Space Policy</h3>
                <PolicyToggle id="allowAgentMention" label="Allow @mention" desc="允许用户或 Agent 调度 Team 内成员" />
                <PolicyToggle id="allowAgentToDelegate" label="Allow Agent delegation" desc="允许 Agent 自主继续 @ 其他成员" />
                <PolicyToggle id="allowCapabilityRouting" label="Capability routing" desc="允许 @review / @ui 这类能力标签路由" />
                <PolicyToggle id="allowParallelThinking" label="Parallel thinking" desc="允许 @All / Explore 并行发散" />
                <SettingsRow label="Max parallel agents" desc="限制 @All 一次展开的 Agent 数">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={Number(policies.maxParallelAgents ?? 5)}
                    onChange={(e) => updatePolicy('maxParallelAgents', Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 bg-secondary border border-border rounded text-xs text-foreground px-2 py-1 outline-none"
                  />
                </SettingsRow>
                <SettingsRow label="Write mode" desc="多写入 Agent 需要更严格的审批边界">
                  <select
                    value={String(policies.writeMode ?? 'single-writer')}
                    onChange={(e) => updatePolicy('writeMode', e.target.value)}
                    className="bg-secondary border border-border rounded text-xs text-foreground px-2 py-1 outline-none"
                  >
                    <option value="single-writer">single-writer</option>
                    <option value="multi-writer-with-approval">multi-writer-with-approval</option>
                  </select>
                </SettingsRow>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SettingsKeys() {
  return (
    <div>
      <h2 className="text-foreground mb-4">API Keys</h2>
      <div className="space-y-3">
        {[
          { name: 'Anthropic', key: 'sk-ant-••••••3f9a' },
          { name: 'OpenAI',    key: '—' },
          { name: 'GitHub',    key: 'ghp_••••••7b2c' },
        ].map((k) => (
          <div key={k.name} className="flex items-center gap-3 p-3 bg-secondary/50 border border-border rounded-lg">
            <Key size={13} className="text-muted-foreground shrink-0" />
            <div className="flex-1">
              <div className="text-xs text-foreground">{k.name}</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{k.key}</div>
            </div>
            <button className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded transition-colors">Edit</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── MCP Servers Settings ──────────────────────────────────────── */

type McpServerItem = Awaited<ReturnType<typeof window.api.mcp.list>>[number]
type ProjectMcpServerItem = Awaited<ReturnType<typeof window.api.mcp.discoverProject>>[number]

/* ─── MCP Server Item ────────────────────────────────────────────── */

function ServerItem({ name, command, source, enabled, status, tools, connError, expanded, onToggleExpand, onToggle, onEdit, onDelete, isProject }: {
  name: string
  command: string
  source?: string
  enabled: boolean
  status: 'idle' | 'testing' | 'ok' | 'error'
  tools: Array<{ name: string; description?: string }>
  connError?: string
  expanded: boolean
  onToggleExpand: () => void
  onToggle?: () => void
  onEdit?: () => void
  onDelete?: () => void
  isProject?: boolean
}) {
  const [showSettings, setShowSettings] = useState(false)

  const statusIcon = () => {
    if (status === 'testing') return <RefreshCw size={10} className="animate-spin text-muted-foreground" />
    if (status === 'ok') return <CheckCircle2 size={10} className="text-green-400" />
    if (status === 'error') return <AlertCircle size={10} className="text-red-400" />
    return null
  }

  useEffect(() => {
    if (!showSettings) return
    const handler = () => setShowSettings(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showSettings])

  return (
    <div>
      <div className={`flex items-center gap-2.5 p-2.5 bg-secondary/30 border rounded-lg transition-colors ${
        expanded ? 'border-blue-500/30 rounded-b-none' : 'border-border/60'
      }`}>
        <button onClick={onToggleExpand} className="text-muted-foreground hover:text-foreground shrink-0 transition-colors">
          <ChevronRight size={10} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
        <Cpu size={12} className={isProject ? 'text-blue-400 shrink-0' : 'text-muted-foreground shrink-0'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-foreground">{name}</span>
            {isProject && <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 shrink-0">project</span>}
            {statusIcon() && <span className="shrink-0">{statusIcon()}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">{command}</div>
        </div>

        {/* Settings gear */}
        {!isProject && (
          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <SettingsIcon size={12} />
            </button>
            {showSettings && (
              <div className="absolute right-0 top-7 w-32 bg-card border border-border rounded-lg shadow-xl z-50 py-1">
                <button onClick={() => { setShowSettings(false); onEdit?.() }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors text-left">
                  <Pencil size={10} className="text-muted-foreground" /> Edit
                </button>
                <button onClick={() => { setShowSettings(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors text-left">
                  <RefreshCw size={10} className="text-muted-foreground" /> Restart
                </button>
                <div className="h-px bg-border mx-2 my-1" />
                <button onClick={() => { setShowSettings(false); onDelete?.() }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 transition-colors text-left">
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            )}
          </div>
        )}

        {/* Toggle — turning ON triggers optimistic enable + auto-test */}
        {!isProject && onToggle && (
          <button
            onClick={onToggle}
            className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${
              enabled ? 'bg-blue-500' : 'bg-accent'
            }`}
            title={enabled ? 'Disable' : 'Enable and test connection'}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
              enabled ? 'left-4' : 'left-0.5'
            }`} />
          </button>
        )}
      </div>
      {/* Expanded: tool list */}
      {expanded && (
        <div className="bg-secondary/20 border border-blue-500/30 border-t-0 rounded-b-lg p-3 space-y-1">
          {tools.length === 0 && status !== 'testing' && (
            <p className="text-xs text-muted-foreground">
              {status === 'idle' ? 'Click refresh to discover available tools.' :
               status === 'error' ? `Connection failed: ${connError || 'Unknown error'}` :
               'No tools discovered.'}
            </p>
          )}
          {status === 'testing' && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <RefreshCw size={10} className="animate-spin" />
              Testing connection...
            </p>
          )}
          {tools.map((t) => (
            <div key={t.name} className="flex items-start gap-2 text-xs">
              <span className="text-blue-400 font-mono shrink-0 mt-0.5">{t.name}</span>
              {t.description && <span className="text-muted-foreground">{t.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingsMcp() {
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [projectServers, setProjectServers] = useState<ProjectMcpServerItem[]>([])
  const [projectEnabled, setProjectEnabled] = useState(true)
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<McpServerItem | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showMarketplace, setShowMarketplace] = useState(false)
  const [showJsonEditor, setShowJsonEditor] = useState(false)
  const [form, setForm] = useState({ name: '', command: '', args: '', env: '' })
  const [jsonInput, setJsonInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [connStatus, setConnStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'error'>>({})
  const [connTools, setConnTools] = useState<Record<string, Array<{ name: string; description?: string }>>>({})
  const [connError, setConnError] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const loadServers = () => {
    setLoading(true)
    window.api.mcp.list().then((list) => { setServers(list); setLoading(false) }).catch(() => { setServers([]); setLoading(false) })
  }

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showAddMenu) return
    const handler = () => setShowAddMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showAddMenu])

  useEffect(() => {
    loadServers()
    window.api.mcp.getProjectMcpEnabled().then(setProjectEnabled)
  }, [])

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const testServer = async (name: string) => {
    setConnStatus((prev) => ({ ...prev, [name]: 'testing' }))
    setConnError((prev) => { const n = { ...prev }; delete n[name]; return n })
    try {
      const res = await window.api.mcp.testConnection(name)
      if (res.ok) {
        setConnStatus((prev) => ({ ...prev, [name]: 'ok' }))
        setConnTools((prev) => ({ ...prev, [name]: res.tools || [] }))
        setExpanded((prev) => { const next = new Set(prev); next.add(name); return next })
        // Auto-enable on successful connection
        window.api.mcp.toggle(name, true)
        setServers((prev) => prev.map((s) => s.name === name ? { ...s, enabled: true } : s))
      } else {
        setConnStatus((prev) => ({ ...prev, [name]: 'error' }))
        setConnError((prev) => ({ ...prev, [name]: res.error || 'Connection failed' }))
        // Auto-disable on connection failure
        window.api.mcp.toggle(name, false)
        setServers((prev) => prev.map((s) => s.name === name ? { ...s, enabled: false } : s))
      }
    } catch (e) {
      setConnStatus((prev) => ({ ...prev, [name]: 'error' }))
      setConnError((prev) => ({ ...prev, [name]: e instanceof Error ? e.message : 'Connection failed' }))
      window.api.mcp.toggle(name, false)
      setServers((prev) => prev.map((s) => s.name === name ? { ...s, enabled: false } : s))
    }
  }

  const refreshAll = () => {
    setConnStatus({})
    setConnTools({})
    setConnError({})
    window.api.mcp.list().then((freshServers) => {
      setServers(freshServers)
      setLoading(false)
      freshServers.forEach((s) => {
        if (s.enabled) testServer(s.name)
      })
    }).catch(() => setServers([]))
  }

  useEffect(() => {
    const loadProject = async () => {
      try {
        const dirs = await window.api.system.getPaths()
        const wd = (dirs as Record<string, string>).workspace || (dirs as Record<string, string>).home || ''
        if (wd) {
          const discovered = await window.api.mcp.discoverProject(wd)
          setProjectServers(discovered)
        }
      } catch { setProjectServers([]) }
    }
    loadProject()
  }, [])

  const handleToggleProject = async (enabled: boolean) => {
    setProjectEnabled(enabled)
    await window.api.mcp.setProjectMcpEnabled(enabled)
  }

  const resetForm = () => {
    setForm({ name: '', command: '', args: '', env: '' })
    setFormMode(null)
    setError(null)
    setEditing(null)
    setShowAddMenu(false)
  }

  const handleFormSave = async () => {
    setError(null)
    try {
      const data = {
        command: form.command,
        args: form.args ? form.args.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        env: form.env ? Object.fromEntries(
          form.env.split('\n').map((s) => { const [k, ...v] = s.split('='); return [k.trim(), v.join('=').trim()] }).filter(([k]) => k)
        ) : {}
      }
      const wasAdd = formMode === 'add'
      const serverName = formMode === 'edit' && editing ? editing.name : form.name
      if (formMode === 'edit' && editing) {
        await window.api.mcp.update(editing.name, data)
      } else {
        await window.api.mcp.add({ name: form.name, ...data })
      }
      resetForm()
      loadServers()
      // Auto-enable and test new server
      if (wasAdd) {
        window.api.mcp.toggle(serverName, true)
        setServers((prev) => prev.map((s) => s.name === serverName ? { ...s, enabled: true } : s))
      }
      testServer(serverName)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const handleRemove = async (name: string) => {
    try {
      await window.api.mcp.remove(name)
      loadServers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove')
    }
  }

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      if (enabled) {
        // Optimistic: turn ON immediately, then test
        await window.api.mcp.toggle(name, true)
        setServers((prev) => prev.map((s) => s.name === name ? { ...s, enabled: true } : s))
        await testServer(name)
        // testServer auto-disables on failure
      } else {
        await window.api.mcp.toggle(name, false)
        loadServers()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle')
    }
  }

  const startEdit = (s: McpServerItem) => {
    setFormMode('edit')
    setEditing(s)
    setShowAddMenu(false)
    setForm({
      name: s.name,
      command: s.command,
      args: s.args.join('\n'),
      env: Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n')
    })
    setError(null)
  }

  const handleMarketplaceInstall = (tmpl: McpServerTemplate) => {
    setFormMode('add')
    setForm({
      name: tmpl.name,
      command: tmpl.command,
      args: tmpl.args.join('\n'),
      env: Object.entries(tmpl.env).map(([k, v]) => `${k}=${v}`).join('\n')
    })
    setShowMarketplace(false)
    setEditing(null)
    setError(null)
  }

  const handleJsonSave = async () => {
    setError(null)
    try {
      const parsed = JSON.parse(jsonInput)
      const mcpServers = parsed?.mcpServers
      if (!mcpServers || typeof mcpServers !== 'object') {
        setError('JSON must have a "mcpServers" object')
        return
      }
      const isValidEnv = (v: unknown): v is Record<string, string> =>
        typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string')
      const errors: string[] = []
      for (const [name, def] of Object.entries(mcpServers)) {
        const d = def as Record<string, unknown>
        if (typeof d.command !== 'string' || !d.command.trim()) continue
        const args = Array.isArray(d.args) ? d.args.filter((a): a is string => typeof a === 'string') : []
        const env = isValidEnv(d.env) ? d.env : {}
        try {
          await window.api.mcp.add({ name, command: d.command, args, env })
        } catch (e) {
          if (e instanceof Error && e.message.includes('already exists')) {
            try {
              await window.api.mcp.update(name, { command: d.command, args, env })
            } catch (e2) {
              errors.push(`${name}: ${e2 instanceof Error ? e2.message : 'Update failed'}`)
            }
          } else {
            errors.push(`${name}: ${e instanceof Error ? e.message : 'Add failed'}`)
          }
        }
      }
      if (errors.length > 0) setError(`Some servers failed: ${errors.join('; ')}`)
      setShowJsonEditor(false)
      setJsonInput('')
      loadServers()
      // Auto-test imported servers sequentially
      for (const n of Object.keys(mcpServers)) {
        try { await window.api.mcp.toggle(n, true) } catch { /* ok */ }
        setServers((prev) => prev.map((s) => s.name === n ? { ...s, enabled: true } : s))
        testServer(n)
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError('Invalid JSON format')
      } else {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    }
  }

  return (
    <div>
      <h2 className="text-foreground mb-4">MCP Servers</h2>

      {error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">{error}</div>
      )}

      {/* ── Edit / Add form ─────────────────────────────── */}
      {formMode && (
        <div className="mb-4 p-3 bg-secondary/50 border border-border rounded-lg space-y-2">
          <div className="text-xs text-foreground mb-1">{formMode === 'edit' && editing ? `Edit ${editing.name}` : 'Add MCP Server'}</div>
          {formMode === 'add' && (
            <input
              placeholder="Name (e.g. filesystem)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none"
            />
          )}
          <input
            placeholder="Command (e.g. npx -y @modelcontextprotocol/server-filesystem)"
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none"
          />
          <textarea
            placeholder="Args (one per line)"
            value={form.args}
            onChange={(e) => setForm({ ...form, args: e.target.value })}
            rows={2}
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none font-mono resize-none"
          />
          <textarea
            placeholder="Env (one per line, KEY=VALUE)"
            value={form.env}
            onChange={(e) => setForm({ ...form, env: e.target.value })}
            rows={2}
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none font-mono resize-none"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleFormSave} disabled={!form.name.trim() || !form.command.trim()} className="px-3 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50">Save</button>
            <button onClick={resetForm} className="px-3 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Project MCP toggle ──────────────────────────── */}
      <div className="mb-4 p-3 bg-secondary/30 border border-border/60 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FolderOpen size={11} />
              Project MCP
            </h3>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Auto-discover from .bytro/mcp.json, .cursor/mcp.json, .claude/mcp.json</p>
          </div>
          <button
            onClick={() => handleToggleProject(!projectEnabled)}
            className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${projectEnabled ? 'bg-blue-500' : 'bg-accent'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${projectEnabled ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* ── Configured MCP Services ────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Globe size={11} />
            Configured MCP Services
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={refreshAll}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Test all connections"
            >
              <RefreshCw size={12} />
            </button>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-secondary hover:bg-accent text-foreground transition-colors"
              >
                <Plus size={12} />
                Add
                <ChevronDown size={10} />
              </button>
              {showAddMenu && (
                <div className="absolute right-0 top-8 w-48 bg-card border border-border rounded-lg shadow-lg z-50 py-1">
                  <button
                    onClick={() => { setFormMode('add'); setEditing(null); setForm({ name: '', command: '', args: '', env: '' }); setError(null); setShowAddMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left"
                  >
                    <Pencil size={12} className="text-muted-foreground" />
                    Manual
                  </button>
                  <button
                    onClick={() => { setShowMarketplace(true); setShowAddMenu(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left"
                  >
                    <Globe size={12} className="text-muted-foreground" />
                    From Marketplace
                  </button>
                  <button
                    onClick={() => { setShowJsonEditor(true); setShowAddMenu(false); setJsonInput('{\n  "mcpServers": {\n    "name": {\n      "command": "npx",\n      "args": ["-y", "@scope/server-name"],\n      "env": {}\n    }\n  }\n}') }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-secondary transition-colors text-left"
                  >
                    <FileText size={12} className="text-muted-foreground" />
                    Manual JSON Config
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {loading && servers.length === 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <RefreshCw size={10} className="animate-spin" /> Loading...
          </p>
        )}
        {!loading && servers.length === 0 && (!projectEnabled || projectServers.length === 0) && !formMode && (
          <p className="text-xs text-muted-foreground">No MCP services configured. Click Add to get started.</p>
        )}
        <div className="space-y-1.5">
          {/* Project servers (read-only, shown when enabled) */}
          {projectEnabled && projectServers.map((s) => (
            <ServerItem
              key={`project-${s.name}`}
              name={s.name}
              command={s.command}
              enabled={true}
              status={connStatus[s.name] || 'idle'}
              tools={connTools[s.name] || []}
              connError={connError[s.name]}
              expanded={expanded.has(s.name)}
              onToggleExpand={() => toggleExpand(s.name)}
              isProject
            />
          ))}
          {/* Global servers */}
          {servers.map((s) => (
            <ServerItem
              key={s.name}
              name={s.name}
              command={s.command}
              enabled={s.enabled}
              status={connStatus[s.name] || 'idle'}
              tools={connTools[s.name] || []}
              connError={connError[s.name]}
              expanded={expanded.has(s.name)}
              onToggleExpand={() => toggleExpand(s.name)}
              onToggle={() => handleToggle(s.name, !s.enabled)}
              onEdit={() => startEdit(s)}
              onDelete={() => handleRemove(s.name)}
            />
          ))}
        </div>
      </div>

      {/* ── Marketplace Modal ───────────────────────────── */}
      {showMarketplace && (
        <MarketplaceModal
          installed={servers.map((s) => s.name)}
          onInstall={handleMarketplaceInstall}
          onClose={() => setShowMarketplace(false)}
        />
      )}

      {/* ── JSON Editor Modal ───────────────────────────── */}
      {showJsonEditor && (
        <JsonEditorModal
          value={jsonInput}
          onChange={setJsonInput}
          onSave={handleJsonSave}
          onClose={() => { setShowJsonEditor(false); setJsonInput(''); setError(null) }}
          error={error}
        />
      )}

      {/* ── Marketplace URLs ────────────────────────────── */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Globe size={11} />
            Marketplace Sources
          </h3>
        </div>
        <MarketplaceUrls />
      </div>
    </div>
  )
}

/* ─── Marketplace URLs Manager ───────────────────────────────────── */

function MarketplaceUrls() {
  const [urls, setUrls] = useState<string[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    window.api.mcp.getMarketplaceUrls().then(setUrls).catch(() => setUrls([]))
  }, [])

  const add = async () => {
    setError(null)
    try {
      await window.api.mcp.addMarketplaceUrl(newUrl.trim())
      setNewUrl('')
      setAdding(false)
      const updated = await window.api.mcp.getMarketplaceUrls()
      setUrls(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid URL')
    }
  }

  const remove = async (url: string) => {
    await window.api.mcp.removeMarketplaceUrl(url)
    const updated = await window.api.mcp.getMarketplaceUrls()
    setUrls(updated)
  }

  const reset = async () => {
    await window.api.mcp.resetMarketplaceUrls()
    const updated = await window.api.mcp.getMarketplaceUrls()
    setUrls(updated)
    setError(null)
  }

  return (
    <div className="space-y-1.5">
      {urls.map((u) => (
        <div key={u} className="flex items-center gap-2 p-2 bg-secondary/20 border border-border/40 rounded text-xs">
          <span className="flex-1 text-muted-foreground font-mono truncate text-[11px]">{u}</span>
          {urls.length > 1 && (
            <button onClick={() => remove(u)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0">
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {error && <div className="text-xs text-red-400 p-1">{error}</div>}
      {adding ? (
        <div className="flex items-center gap-2">
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none font-mono"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          />
          <button onClick={add} className="px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors">Add</button>
          <button onClick={() => { setAdding(false); setNewUrl(''); setError(null) }} className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Plus size={11} /> Add source
          </button>
          <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Reset to default</button>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/60">
        Supports npm registry search results and custom JSON endpoints with {`{"servers": [...]}`} format.
      </p>
    </div>
  )
}

/* ─── Usage Stats Settings ───────────────────────────────────────── */

function SettingsUsage() {
  const [summary, setSummary] = useState<UsageSummaryRow[]>([])
  const [totalCost, setTotalCost] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [rows, cost] = await Promise.all([
          window.api.usage.summary(),
          window.api.usage.totalCost()
        ])
        if (!cancelled) {
          setSummary(rows)
          setTotalCost(cost)
        }
      } catch {
        if (!cancelled) setSummary([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Aggregate by model
  const modelTotals = new Map<string, { input: number; output: number; cacheRead: number; cost: number }>()
  const dailyTotals = new Map<string, number>()
  let grandInput = 0
  let grandOutput = 0
  let grandCacheRead = 0

  for (const row of summary) {
    grandInput += row.total_input
    grandOutput += row.total_output
    grandCacheRead += row.total_cache_read

    const existing = modelTotals.get(row.model) || { input: 0, output: 0, cacheRead: 0, cost: 0 }
    modelTotals.set(row.model, {
      input: existing.input + row.total_input,
      output: existing.output + row.total_output,
      cacheRead: existing.cacheRead + row.total_cache_read,
      cost: existing.cost + row.total_cost
    })

    const dayCost = dailyTotals.get(row.day) || 0
    dailyTotals.set(row.day, dayCost + row.total_cost)
  }

  const modelEntries = Array.from(modelTotals.entries()).sort((a, b) => b[1].cost - a[1].cost)
  const maxModelCost = modelEntries.length > 0 ? modelEntries[0][1].cost : 1
  const dailyEntries = Array.from(dailyTotals.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-7)
  const maxDailyCost = dailyEntries.length > 0 ? Math.max(...dailyEntries.map(d => d[1])) : 1

  const loadData = async () => {
    setLoading(true)
    try {
      const [rows, cost] = await Promise.all([
        window.api.usage.summary(),
        window.api.usage.totalCost()
      ])
      setSummary(rows)
      setTotalCost(cost)
    } catch {
      setSummary([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-foreground mb-4">Token Usage & Cost</h2>
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-foreground">Token Usage & Cost</h2>
        <button
          onClick={loadData}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="p-3 bg-secondary/30 border border-border/60 rounded-lg">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Total Input</div>
          <div className="text-sm text-foreground tabular-nums">{grandInput.toLocaleString()}</div>
        </div>
        <div className="p-3 bg-secondary/30 border border-border/60 rounded-lg">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Total Output</div>
          <div className="text-sm text-foreground tabular-nums">{grandOutput.toLocaleString()}</div>
        </div>
        <div className="p-3 bg-secondary/30 border border-border/60 rounded-lg">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cache Hits</div>
          <div className="text-sm text-emerald-400 tabular-nums">{grandCacheRead.toLocaleString()}</div>
        </div>
        <div className="p-3 bg-secondary/30 border border-border/60 rounded-lg">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Total Cost</div>
          <div className="text-sm text-foreground tabular-nums">${totalCost.toFixed(4)}</div>
        </div>
      </div>

      {/* Per-model distribution */}
      {modelEntries.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs text-foreground mb-3 flex items-center gap-1.5">
            <TrendingUp size={12} className="text-muted-foreground" />
            Per Model
          </h3>
          <div className="space-y-2">
            {modelEntries.map(([model, data]) => (
              <div key={model} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-36 truncate shrink-0 font-mono">{model}</span>
                <div className="flex-1 h-4 bg-secondary rounded overflow-hidden relative">
                  <div
                    className="h-full bg-blue-500/60 rounded transition-all"
                    style={{ width: `${Math.max(2, (data.cost / maxModelCost) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-foreground tabular-nums w-16 text-right shrink-0">${data.cost.toFixed(4)}</span>
                <span className="text-[10px] text-muted-foreground w-12 text-right shrink-0">
                  {((data.cost / (totalCost || 1)) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily trend */}
      {dailyEntries.length > 0 && (
        <div>
          <h3 className="text-xs text-foreground mb-3 flex items-center gap-1.5">
            <BarChart3 size={12} className="text-muted-foreground" />
            Daily Cost (Last 7 Days)
          </h3>
          <div className="flex items-end gap-1 h-20">
            {dailyEntries.map(([day, cost]) => (
              <div key={day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  ${cost.toFixed(2)}
                </span>
                <div
                  className="w-full bg-blue-500/50 rounded-t hover:bg-blue-500/70 transition-colors min-h-[4px]"
                  style={{ height: `${Math.max(4, (cost / maxDailyCost) * 100)}%` }}
                />
                <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                  {day.slice(5)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            {dailyEntries.length > 0 && `${dailyEntries[0][0]} → ${dailyEntries[dailyEntries.length - 1][0]}`}
          </div>
        </div>
      )}

      {summary.length === 0 && (
        <div className="py-8 text-center">
          <BarChart3 size={24} className="text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No usage data yet.</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Usage stats appear here after your first AI conversation.</p>
        </div>
      )}
    </div>
  )
}

/* ─── Marketplace Modal ──────────────────────────────────────────── */

function MarketplaceModal({ installed, onInstall, onClose }: {
  installed: string[]
  onInstall: (t: McpServerTemplate) => void
  onClose: () => void
}) {
  const [templates, setTemplates] = useState<McpServerTemplate[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMarketplace().then((list) => {
      setTemplates(list)
      setLoading(false)
    })
  }, [])

  const filtered = templates.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm text-foreground">MCP Marketplace</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Install MCP servers from the community</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={14} /></button>
        </div>
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search servers..."
              className="w-full bg-background border border-border rounded pl-8 pr-3 py-1.5 text-xs text-foreground outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <div className="text-xs text-muted-foreground p-4">Loading marketplace...</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-xs text-muted-foreground p-4">No servers found{search ? ` matching "${search}"` : ''}.</div>
          )}
          {filtered.map((t) => {
            const isInstalled = installed.includes(t.name)
            return (
              <div key={t.name} className="flex items-start gap-3 p-3 hover:bg-secondary/50 rounded-lg transition-colors">
                <Package size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground">{t.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{t.category}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-1 truncate">{t.command} {t.args.join(' ')}</div>
                </div>
                {isInstalled ? (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 mt-0.5">Installed</span>
                ) : (
                  <button
                    onClick={() => onInstall(t)}
                    className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0 mt-0.5"
                  >
                    Install
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ─── JSON Editor Modal ──────────────────────────────────────────── */

function JsonEditorModal({ value, onChange, onSave, onClose, error }: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onClose: () => void
  error: string | null
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[560px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm text-foreground">Manual JSON Config</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Paste MCP server configuration in JSON format</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X size={14} /></button>
        </div>

        {/* Security Warning */}
        <div className="mx-4 mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex items-start gap-2.5">
          <ShieldAlert size={14} className="text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-yellow-600 font-medium">Security Warning</div>
            <div className="text-xs text-yellow-600/80 mt-0.5 leading-relaxed">
              MCP servers can execute arbitrary commands, access files and networks. Only add servers from trusted sources. When unsure, run the server in a sandbox or container.
            </div>
          </div>
        </div>

        <div className="p-4">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-48 bg-background border border-border rounded-lg p-3 text-xs text-foreground font-mono outline-none resize-none"
            spellCheck={false}
          />
          {error && (
            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">{error}</div>
          )}
          <div className="flex items-center justify-between mt-3">
            <p className="text-[10px] text-muted-foreground">
              Format: {`{"mcpServers": {"name": {"command": "...", "args": [...], "env": {...}}}}}`}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-3 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button onClick={onSave} className="px-3 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors">Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── File Tree ─────────────────────────────────────────────────── */
/* ─── Search Sidebar ────────────────────────────────────────────── */
function SearchSidebar() {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [showReplace, setShowReplace] = useState(false)

  const results = query ? [
    { file: 'ToolCall.tsx',      line: 4,  preview: `const [expanded, setExpanded] = ${query}(true)` },
    { file: 'MessageCard.tsx',   line: 12, preview: 'return <div className="card">' },
    { file: 'WorkspaceArea.tsx', line: 88, preview: 'const activePanel = panels.find(...)' },
  ] : []

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="relative">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="w-full bg-secondary border border-border focus:border-border rounded pl-6 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors"
        />
        <button
          onClick={() => setShowReplace((v) => !v)}
          title="Toggle replace"
          className={`absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded transition-colors ${showReplace ? 'text-foreground' : 'text-muted-foreground hover:text-muted-foreground'}`}
        >
          <Replace size={11} />
        </button>
      </div>

      {showReplace && (
        <div className="relative">
          <Replace size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Replace"
            className="w-full bg-secondary border border-border focus:border-border rounded pl-6 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors"
          />
        </div>
      )}

      <div className="flex items-center gap-1">
        {[
          { label: 'Aa', title: 'Match case',  val: matchCase, set: setMatchCase },
          { label: '\\b', title: 'Whole word',  val: wholeWord, set: setWholeWord },
          { label: '.*', title: 'Use regex',   val: useRegex,  set: setUseRegex  },
        ].map((t) => (
          <button
            key={t.label}
            onClick={() => t.set((v) => !v)}
            title={t.title}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
              t.val ? 'bg-blue-600/30 text-blue-400 border border-blue-700/40' : 'text-muted-foreground hover:text-muted-foreground border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
        {showReplace && results.length > 0 && (
          <button className="ml-auto text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 border border-border rounded transition-colors">
            Replace all
          </button>
        )}
      </div>

      {query && (
        <div className="mt-1">
          {results.length === 0 ? (
            <p className="text-[11px] text-muted-foreground px-1">No results</p>
          ) : (
            <div>
              <p className="text-[10px] text-muted-foreground px-1 mb-1">{results.length} results in {results.length} files</p>
              {results.map((r, i) => (
                <button
                  key={i}
                  className="w-full text-left group px-2 py-1.5 rounded hover:bg-secondary/80 transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <FileCode size={10} className="text-muted-foreground shrink-0" />
                    <span className="text-[11px] text-muted-foreground">{r.file}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">:{r.line}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono truncate pl-4 group-hover:text-muted-foreground transition-colors">
                    {r.preview}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!query && (
        <p className="text-[11px] text-muted-foreground px-1 mt-1">Type to search across files</p>
      )}
    </div>
  )
}

/* ─── Git Sidebar ───────────────────────────────────────────────── */
function GitCollapse({ title, count, defaultOpen = true, children }: {
  title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-2 text-left hover:bg-secondary/40 transition-colors"
      >
        {open
          ? <ChevronDown size={11} className="text-muted-foreground shrink-0" />
          : <ChevronRight size={11} className="text-muted-foreground shrink-0" />}
        <span className="text-[11px] text-muted-foreground flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">{count}</span>
        )}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

function GitSidebar() {
  const [stagedFile, setStagedFile] = useState<string | null>(null)

  const changedFiles = [
    { name: 'ToolCall.tsx',      status: 'M', adds: 12, dels: 8  },
    { name: 'MessageCard.tsx',   status: 'M', adds: 5,  dels: 2  },
    { name: 'WorkspaceArea.tsx', status: 'A', adds: 34, dels: 0  },
    { name: 'theme.css',         status: 'M', adds: 2,  dels: 1  },
  ]

  const statusColor = (s: string) =>
    s === 'M' ? 'text-yellow-500' : s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : 'text-muted-foreground'

  return (
    <div className="flex flex-col">
      <GitCollapse title="Changes" count={changedFiles.length} defaultOpen>
        {changedFiles.map((f) => (
          <button
            key={f.name}
            onClick={() => setStagedFile(f.name === stagedFile ? null : f.name)}
            className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors ${
              stagedFile === f.name ? 'bg-secondary/60' : 'hover:bg-secondary/40'
            }`}
          >
            <FileDiff size={11} className="text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground flex-1 truncate">{f.name}</span>
            <span className={`text-[10px] font-mono ${statusColor(f.status)}`}>{f.status}</span>
            <span className="text-[10px] text-green-600">+{f.adds}</span>
            <span className="text-[10px] text-red-600">-{f.dels}</span>
          </button>
        ))}
        {stagedFile && (
          <div className="mx-2 mt-1 mb-2 p-2 bg-card border border-border rounded text-[10px] font-mono text-muted-foreground">
            Diff preview: <span className="text-muted-foreground">{stagedFile}</span>
            <div className="mt-1 space-y-0.5">
              <div className="text-red-500/70">- const old = true</div>
              <div className="text-green-500/70">+ const updated = true</div>
            </div>
          </div>
        )}
      </GitCollapse>

      <GitCollapse title="Repository" defaultOpen>
        <div className="px-3 py-1.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <GitBranch size={11} className="text-blue-500 shrink-0" />
            <span className="text-[11px] text-foreground font-mono">bytro / feat/workspace</span>
          </div>
          <div className="flex items-center gap-2">
            <GitCommit size={11} className="text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground font-mono">a3f9d2c</span>
            <span className="text-[10px] text-muted-foreground">ahead 2</span>
          </div>
          <div className="flex gap-1.5 mt-1">
            <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
              <div className="h-full w-2/5 bg-blue-600/60 rounded-full" />
            </div>
            <span className="text-[10px] text-muted-foreground">↑2 ↓0</span>
          </div>
          <div className="flex gap-1 mt-1">
            <button className="flex-1 text-[10px] border border-border hover:border-border rounded py-0.5 text-muted-foreground hover:text-foreground transition-colors">Pull</button>
            <button className="flex-1 text-[10px] border border-border hover:border-border rounded py-0.5 text-muted-foreground hover:text-foreground transition-colors">Push</button>
            <button className="flex-1 text-[10px] border border-border hover:border-border rounded py-0.5 text-muted-foreground hover:text-foreground transition-colors">Sync</button>
          </div>
        </div>
      </GitCollapse>

      <GitCollapse title="Agent Review" defaultOpen={false}>
        <div className="px-3 py-1.5 space-y-2">
          {[
            { icon: <AlertCircle size={11} />, color: 'text-yellow-500', file: 'ToolCall.tsx', line: 12, msg: 'Unused variable "x" detected' },
            { icon: <CheckCircle2 size={11} />, color: 'text-green-500', file: 'MessageCard.tsx', line: 0, msg: 'No issues found' },
            { icon: <CircleDot size={11} />, color: 'text-blue-400', file: 'WorkspaceArea.tsx', line: 88, msg: 'Consider memoizing activePanel' },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 ${item.color}`}>{item.icon}</span>
              <div>
                <p className="text-[11px] text-muted-foreground">{item.msg}</p>
                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {item.file}{item.line > 0 ? `:${item.line}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </GitCollapse>

      <GitCollapse title="Commit Tree" defaultOpen={false}>
        <div className="px-3 py-1.5 space-y-0">
          {[
            { hash: 'a3f9d2c', msg: 'feat: workspace sidebar tabs', branch: 'feat/workspace', current: true,  time: 'just now' },
            { hash: 'b12cc45', msg: 'fix: panel height overflow',   branch: null,              current: false, time: '2h ago' },
            { hash: 'e9a1f87', msg: 'feat: memory palace panel',    branch: null,              current: false, time: '1d ago' },
            { hash: '77d3b09', msg: 'chore: initial scaffold',      branch: 'main',            current: false, time: '3d ago' },
          ].map((c, i, arr) => (
            <div key={c.hash} className="flex gap-2 items-stretch">
              <div className="flex flex-col items-center w-4 shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full border-2 mt-1.5 shrink-0 ${c.current ? 'border-blue-500 bg-blue-500/30' : 'border-border bg-card'}`} />
                {i < arr.length - 1 && <div className="flex-1 w-px bg-secondary" />}
              </div>
              <div className="pb-2.5 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">{c.hash}</span>
                  {c.branch && (
                    <span className={`text-[9px] px-1 py-0.5 rounded ${c.current ? 'bg-blue-600/20 text-blue-400 border border-blue-700/30' : 'bg-secondary text-muted-foreground border border-border'}`}>
                      {c.branch}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">{c.time}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{c.msg}</p>
              </div>
            </div>
          ))}
        </div>
      </GitCollapse>
    </div>
  )
}
