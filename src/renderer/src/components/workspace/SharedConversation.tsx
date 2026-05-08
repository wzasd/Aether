import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, ChevronDown, ChevronRight,
  FolderOpen, Clock, Check, Settings,
  PanelRightOpen, Download,
} from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useChatStore } from '../../stores/chatStore'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { ConversationExportMenu } from '../ConversationExportMenu'

interface SharedConversationProps {
  children: React.ReactNode
  onOpenSettings?: () => void
  onOpenAgentSettings?: () => void
}

const AGENT_STATUS_COLORS: Record<string, string> = {
  idle:      'bg-accent',
  thinking:  'bg-blue-400',
  editing:   'bg-yellow-400',
  reviewing: 'bg-purple-400',
  waiting:   'bg-orange-400',
}

export function SharedConversation({ children, onOpenSettings, onOpenAgentSettings }: SharedConversationProps) {
  const openNewTaskDialog = useChatStore((s) => s.openNewTaskDialog)
  const taskRailCollapsed = useUIStore((s) => s.taskRailCollapsed)
  const setTaskRailCollapsed = useUIStore((s) => s.setTaskRailCollapsed)
  const workspaceCollapsed = useUIStore((s) => s.workspaceCollapsed)
  const setWorkspaceCollapsed = useUIStore((s) => s.setWorkspaceCollapsed)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const activeWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const currentConversation = useChatStore((s) => s.currentConversation)

  const [projectOpen, setProjectOpen] = useState(false)
  const [exportPos, setExportPos] = useState<{ x: number; y: number } | null>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const projectBtnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const exportBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (dropdownRef.current && !dropdownRef.current.contains(target) &&
          projectBtnRef.current && !projectBtnRef.current.contains(target))
        setProjectOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const profiles = useAgentProfileStore((s) => s.profiles)
  const enabledAgents = profiles.filter((p) => p.isEnabled)

  const allProjects = workspaces.length > 0
    ? workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        path: w.repo_path ?? '~/Projects',
        lastOpened: undefined,
      }))
    : [{ id: '1', name: 'bytro-app', path: '~/Projects/bytro-app', lastOpened: 'Now' as const }]

  return (
    <div className="h-full border-r border-border bg-background flex flex-col overflow-hidden">

      {/* ── Title bar ─────────────────────────────────────────────── */}
      <div
        className="h-11 flex items-center gap-1.5 pr-2 shrink-0 border-b border-border transition-[padding-left] duration-200 ease-in-out"
        style={{ paddingLeft: taskRailCollapsed ? 'var(--traffic-light-offset)' : 10 }}
      >
        {taskRailCollapsed && (
          <button
            onClick={() => setTaskRailCollapsed(false)}
            title="展开任务栏"
            className="titlebar-no-drag relative z-40 p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-card shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        )}

        <button
          ref={projectBtnRef}
          onClick={() => {
            if (!projectOpen && projectBtnRef.current) {
              const r = projectBtnRef.current.getBoundingClientRect()
              setDropdownPos({ top: r.bottom + 4, left: r.left })
            }
            setProjectOpen((v) => !v)
          }}
          className="titlebar-no-drag relative z-40 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-card transition-colors shrink min-w-0 max-w-[200px]"
        >
          <FolderOpen size={13} className="text-muted-foreground shrink-0" />
          <span className="text-xs text-foreground truncate">{activeWorkspace?.name ?? 'bytro-app'}</span>
          <ChevronDown size={11} className={`text-muted-foreground shrink-0 transition-transform ${projectOpen ? 'rotate-180' : ''}`} />
        </button>

        <button
          title="新建对话"
          onClick={openNewTaskDialog}
          className="titlebar-no-drag relative z-40 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors shrink-0"
        >
          <Plus size={13} />
        </button>

        <div className="flex-1" />

        {currentConversation && (
          <button
            ref={exportBtnRef}
            title="导出对话"
            onClick={(e) => {
              const rect = (e.target as HTMLElement).closest('button')?.getBoundingClientRect()
              setExportPos({ x: rect?.left ?? e.clientX, y: (rect?.bottom ?? e.clientY) + 4 })
            }}
            className="titlebar-no-drag relative z-40 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors shrink-0"
          >
            <Download size={13} />
          </button>
        )}

        {projectOpen && createPortal(
          <div ref={dropdownRef} className="fixed z-50 w-72 bg-card border border-border rounded shadow-xl" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
            <div className="px-3 py-2 border-b border-border">
              <span className="text-xs text-muted-foreground">最近项目</span>
            </div>
            {allProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  useWorkspaceStore.getState().setCurrentWorkspace(project.id)
                  setProjectOpen(false)
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary transition-colors text-left"
              >
                <FolderOpen size={14} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground truncate">{project.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{project.path}</div>
                </div>
                {project.lastOpened && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Clock size={10} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{project.lastOpened}</span>
                  </div>
                )}
                {activeWorkspace?.id === project.id && (
                  <Check size={12} className="text-blue-400 ml-1" />
                )}
              </button>
            ))}
            <div className="border-t border-border px-3 py-2">
              <button
                onClick={async () => {
                  const dir = await window.api.dialog.openDirectory()
                  if (!dir) return
                  const name = dir.split('/').pop() || dir
                  const ws = await useWorkspaceStore.getState().createWorkspace({ name, repo_path: dir })
                  if (ws) {
                    useWorkspaceStore.getState().setCurrentWorkspace(ws.id)
                    useChatStore.getState().loadConversations(ws.id)
                    setProjectOpen(false)
                  }
                }}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <FolderOpen size={13} /> 打开文件夹…
              </button>
            </div>
          </div>,
          document.body
        )}

        <button
          onClick={onOpenSettings}
          title="设置"
          className="titlebar-no-drag relative z-40 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors shrink-0"
        >
          <Settings size={13} />
        </button>

        {workspaceCollapsed && (
          <button
            onClick={() => setWorkspaceCollapsed(false)}
            title="打开工作区"
            className="titlebar-no-drag relative z-40 flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors shrink-0"
          >
            <PanelRightOpen size={13} />
            <span className="text-xs">工作区</span>
          </button>
        )}
      </div>

      {/* ── Active Agent Quick View ─────────────────────────────── */}
      <div className="px-3 py-2 border-b border-border bg-secondary/20">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">活跃 Agent</span>
          {onOpenAgentSettings && (
            <button
              onClick={onOpenAgentSettings}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
            >
              管理
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {enabledAgents.length === 0 && (
            <span className="text-xs text-muted-foreground">未配置 Agent</span>
          )}
          {enabledAgents.map((agent) => (
            <div
              key={agent.id}
              className="px-2.5 py-1 rounded flex items-center gap-1.5 text-xs bg-card border border-border text-foreground"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <span>{agent.name}</span>
              {agent.role && (
                <span className="text-[10px] text-muted-foreground">({agent.role})</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Conversation thread ───────────────────────────────────── */}
      <div className="thin-scrollbar flex-1 overflow-y-auto overflow-x-hidden">
        {children}
      </div>

      {exportPos && currentConversation && (
        <ConversationExportMenu
          conversationId={currentConversation.id}
          title={currentConversation.title || 'Untitled'}
          position={exportPos}
          onClose={() => setExportPos(null)}
        />
      )}
    </div>
  )
}
