import { useState, useEffect } from 'react'
import { ChevronDown, Brain, Hammer } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useProviderStore } from '../stores/providerStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

interface NewTaskDialogProps {
  open: boolean
  onSelect: (collaborationMode?: 'orchestrated' | 'open_floor', taskId?: string) => void
  onCancel: () => void
}

const COLLAB_STORAGE_KEY = 'bytro.last-collaboration-mode'

type CollaborationMode = 'orchestrated' | 'open_floor'
type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto' | 'trusted'

function loadLastCollaborationMode(): CollaborationMode {
  try {
    const stored = localStorage.getItem(COLLAB_STORAGE_KEY)
    if (stored === 'orchestrated' || stored === 'open_floor') return stored
    if (stored === 'direct' || stored === 'explore' || stored === 'build' || stored === 'review') {
      localStorage.setItem(COLLAB_STORAGE_KEY, 'orchestrated')
      return 'orchestrated'
    }
  } catch { /* ignore */ }
  return 'orchestrated'
}

function loadLastPermissionMode(): PermissionMode {
  try {
    const stored = localStorage.getItem('bytro.last-permission-mode')
    if (stored === 'manual' || stored === 'autoEdit' || stored === 'plan' || stored === 'fullAuto' || stored === 'trusted') return stored
  } catch { /* ignore */ }
  return 'autoEdit'
}

function saveLastCollaborationMode(mode: CollaborationMode): void {
  try { localStorage.setItem(COLLAB_STORAGE_KEY, mode) } catch { /* ignore */ }
}

function saveLastPermissionMode(mode: PermissionMode): void {
  try { localStorage.setItem('bytro.last-permission-mode', mode) } catch { /* ignore */ }
}

export function NewTaskDialog({ open, onSelect, onCancel }: NewTaskDialogProps) {
  const setPendingTaskOverrides = useChatStore((s) => s.setPendingTaskOverrides)
  const providers = useProviderStore((s) => s.providers)
  const loadProviders = useProviderStore((s) => s.loadProviders)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const [overrideProvider, setOverrideProvider] = useState('')
  const [overrideModel, setOverrideModel] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>(loadLastCollaborationMode)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(loadLastPermissionMode)

  useEffect(() => {
    if (open) {
      setCollaborationMode(loadLastCollaborationMode())
      setPermissionMode(loadLastPermissionMode())
      loadProviders().catch(() => {})
    }
  }, [open, loadProviders])

  if (!open) return null

  const handleConfirm = async () => {
    saveLastCollaborationMode(collaborationMode)
    saveLastPermissionMode(permissionMode)

    if (overrideProvider || overrideModel) {
      setPendingTaskOverrides({
        providerType: overrideProvider || undefined,
        model: overrideModel || undefined
      })
    } else {
      setPendingTaskOverrides(null)
    }

    let taskId: string | undefined
    if (currentWorkspaceId) {
      try {
        const task = await window.api.task.create(currentWorkspaceId, {
          title: 'New Chat',
          mode: collaborationMode,
          providerOverride: overrideProvider || undefined,
          modelOverride: overrideModel || undefined
        })
        taskId = task.id
      } catch {
        // Task 创建失败不阻塞流程
      }
    }

    onSelect(collaborationMode, taskId)
  }

  const selectedProvider = providers.find((p) => p.meta.id === overrideProvider)
  const collaborationOptions: Array<{ id: CollaborationMode; label: string; icon: typeof Brain; desc: string }> = [
    { id: 'open_floor', label: '自由讨论', icon: Brain, desc: '多 Agent 自由参与讨论，适合头脑风暴、方案探索' },
    { id: 'orchestrated', label: '编排执行', icon: Hammer, desc: 'Agent 按流水线执行任务，适合代码实现、Bug 修复' }
  ]

  const permissionOptions: Array<{ id: PermissionMode; label: string; desc: string }> = [
    { id: 'manual', label: '手动确认', desc: '每个工具调用弹窗确认' },
    { id: 'autoEdit', label: '自动编辑', desc: '写文件自动允许，执行 shell 需确认（默认）' },
    { id: 'plan', label: '先审后行', desc: '先出 plan，确认后批量执行' },
    { id: 'fullAuto', label: '全自动', desc: '全自动化（高风险，需显式开启）' },
    { id: 'trusted', label: '信任模式', desc: '全部跳过弹窗，事后审计（Slock 风格）' }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-lg p-6 w-[440px] shadow-lg">
        <h2 className="text-base font-semibold text-foreground mb-4">新建对话</h2>

        {/* Collaboration mode */}
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-2 block">协作模式</label>
          <div className="flex gap-2">
            {collaborationOptions.map((option) => {
              const Icon = option.icon
              const isSelected = collaborationMode === option.id
              return (
                <button
                  key={option.id}
                  onClick={() => setCollaborationMode(option.id)}
                  className={`flex-1 text-left rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <div className={`flex items-center gap-2 mb-1 ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                    <div className={`p-1.5 rounded-md ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                      <Icon size={16} />
                    </div>
                    <span className="text-sm font-medium">{option.label}</span>
                  </div>
                  <div className="text-[10px] leading-snug text-muted-foreground">
                    {option.desc}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Permission mode — orchestrated only */}
        {collaborationMode === 'orchestrated' && (
          <div className="mb-4">
            <label className="text-xs font-medium text-muted-foreground mb-2 block">权限模式</label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              className="w-full text-xs rounded-md border border-border bg-card px-3 py-2 text-foreground"
            >
              {permissionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} — {option.desc}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Open Floor mode note */}
        {collaborationMode === 'open_floor' && (
          <div className="mb-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1">
              <Brain size={12} className="text-blue-400" />
              <span className="font-medium text-foreground">自由讨论模式</span>
            </div>
            <p>所有启用的 Agent 自动参与对话。使用 @mention 指定特定 Agent，Agent 只能读取文件不能修改代码。</p>
          </div>
        )}

        {/* Advanced — Runtime override */}
        {providers.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown size={12} className={`transition-transform ${showAdvanced ? '' : '-rotate-90'}`} />
              Runtime 覆盖（可选）
            </button>
            {showAdvanced && (
              <div className="mt-2 p-3 rounded-lg bg-accent/30 border border-border space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Provider</label>
                  <select
                    value={overrideProvider}
                    onChange={(e) => { setOverrideProvider(e.target.value); setOverrideModel('') }}
                    className="w-full text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                  >
                    <option value="">使用默认 Provider</option>
                    {providers.map((p) => (
                      <option key={p.meta.id} value={p.meta.id}>{p.meta.name}</option>
                    ))}
                  </select>
                </div>
                {selectedProvider && (
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Model</label>
                    <select
                      value={overrideModel}
                      onChange={(e) => setOverrideModel(e.target.value)}
                      className="w-full text-xs rounded-md border border-border bg-card px-2 py-1.5 text-foreground"
                    >
                      <option value="">使用默认 Model</option>
                      {selectedProvider.meta.models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs rounded-md border border-border hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            创建对话
          </button>
        </div>
      </div>
    </div>
  )
}
