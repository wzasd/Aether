import { useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { useUIStore } from '../../stores/uiStore'
import { BottomOutput } from './BottomOutput'

interface TaskRailControls {
  collapseTaskRail: () => void
  expandTaskRail: () => void
}

interface WorkspaceShellProps {
  taskRail: ReactNode | ((controls: TaskRailControls) => ReactNode)
  sharedConversation: ReactNode
  workspaceArea: ReactNode
}

const LAYOUT_STORAGE_KEY = 'bytro-shell-layout'

export function WorkspaceShell({
  taskRail,
  sharedConversation,
  workspaceArea,
}: WorkspaceShellProps) {
  const taskRailCollapsed = useUIStore((s) => s.taskRailCollapsed)
  const setTaskRailCollapsed = useUIStore((s) => s.setTaskRailCollapsed)
  const workspaceCollapsed = useUIStore((s) => s.workspaceCollapsed)
  const setWorkspaceCollapsed = useUIStore((s) => s.setWorkspaceCollapsed)
  const bottomPanelOpen = useUIStore((s) => s.bottomPanelOpen)
  const toggleBottomPanel = useUIStore((s) => s.toggleBottomPanel)

  const taskRailPanelRef = useRef<PanelImperativeHandle>(null)
  const workspacePanelRef = useRef<PanelImperativeHandle>(null)
  const bottomPanelRef = useRef<PanelImperativeHandle>(null)

  const collapseTaskRail = useCallback(() => {
    taskRailPanelRef.current?.collapse()
  }, [])

  const expandTaskRail = useCallback(() => {
    taskRailPanelRef.current?.expand()
  }, [])

  const renderedTaskRail = typeof taskRail === 'function'
    ? taskRail({ collapseTaskRail, expandTaskRail })
    : taskRail

  useEffect(() => {
    const panel = taskRailPanelRef.current
    if (!panel) return
    if (taskRailCollapsed && !panel.isCollapsed()) panel.collapse()
    if (!taskRailCollapsed && panel.isCollapsed()) panel.expand()
  }, [taskRailCollapsed])

  useEffect(() => {
    const panel = workspacePanelRef.current
    if (!panel) return
    if (workspaceCollapsed && !panel.isCollapsed()) panel.collapse()
    if (!workspaceCollapsed && panel.isCollapsed()) panel.expand()
  }, [workspaceCollapsed])

  useEffect(() => {
    const panel = bottomPanelRef.current
    if (!panel) return
    if (bottomPanelOpen && panel.isCollapsed()) panel.expand()
    if (!bottomPanelOpen && !panel.isCollapsed()) panel.collapse()
  }, [bottomPanelOpen])

  return (
    <div className="size-full flex flex-col bg-background text-foreground relative">
      {/* Titlebar drag layer — sits above Panel content (z-30) but below interactive elements (z-40+).
          This must be outside any overflow:hidden/auto container for -webkit-app-region:drag to work.
          See Electron issue #40610: drag regions don't work inside overflow containers. */}
      <div
        className="titlebar-drag absolute top-0 left-0 right-0 h-11 z-30"
      />

      <Group
        orientation="horizontal"
        className="flex-1"
        autoSave={LAYOUT_STORAGE_KEY}
      >
        {/* 1. Task Rail */}
        <Panel
          panelRef={taskRailPanelRef}
          id="task-rail"
          defaultSize="17%"
          minSize="8%"
          maxSize="35%"
          collapsible
          collapsedSize="0%"
          onResize={(size) => setTaskRailCollapsed(size.asPercentage === 0)}
        >
          <div className="h-full border-r border-border bg-background flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0">
              {renderedTaskRail || (
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-[12px] text-muted-foreground">Tasks</span>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Separator className="titlebar-no-drag relative z-40 group w-[3px] bg-card hover:bg-blue-600/40 transition-colors cursor-col-resize flex items-center justify-center">
          <div className="h-8 w-px bg-accent group-hover:bg-blue-500 rounded-full transition-colors" />
        </Separator>

        {/* 2. Shared Conversation */}
        <Panel
          id="shared-conv"
          defaultSize="28%"
          minSize="12%"
          maxSize="100%"
          collapsible
          collapsedSize="0%"
        >
          <div className="h-full border-r border-border bg-background flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0">
              {sharedConversation || (
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-[12px] text-muted-foreground">Conversation</span>
                </div>
              )}
            </div>
          </div>
        </Panel>

        {/* Drag handle 2 */}
        <Separator className="titlebar-no-drag relative z-40 group w-[3px] bg-card hover:bg-blue-600/40 transition-colors cursor-col-resize flex items-center justify-center">
          <div className="h-8 w-px bg-accent group-hover:bg-blue-500 rounded-full transition-colors" />
        </Separator>

        {/* 3. Workspace Area */}
        <Panel
          panelRef={workspacePanelRef}
          id="workspace"
          defaultSize="55%"
          minSize="20%"
          maxSize="70%"
          collapsible
          collapsedSize="0%"
          onResize={(size) => setWorkspaceCollapsed(size.asPercentage === 0)}
        >
          <div className="h-full bg-background flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0">
              <Group orientation="vertical" className="size-full">
                <Panel id="workspace-content" defaultSize="70%" minSize="30%">
                  <div className="size-full overflow-hidden">{workspaceArea}</div>
                </Panel>
                <Separator className="relative z-40 group h-1 bg-card hover:bg-accent transition-colors cursor-row-resize flex items-center justify-center shrink-0">
                  <div className="w-8 h-0.5 rounded-full bg-accent group-hover:bg-secondary transition-colors" />
                </Separator>
                <Panel
                  panelRef={bottomPanelRef}
                  id="bottom-output"
                  defaultSize="30%"
                  minSize="10%"
                  maxSize="60%"
                  collapsible
                  collapsedSize="0%"
                  onResize={(size) => {
                    if (size.asPercentage === 0 && bottomPanelOpen) {
                      useUIStore.getState().setBottomPanelOpen(false)
                    }
                  }}
                >
                  <BottomOutput onToggleClose={toggleBottomPanel} />
                </Panel>
              </Group>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
