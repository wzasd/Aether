import { useSessionConfigStore } from '../stores/sessionConfigStore'

const PERMISSION_OPTIONS = [
  { value: 'manual' as const, label: 'Manual', desc: '每次审批' },
  { value: 'plan' as const, label: 'Plan', desc: '只读自动，写需审批' },
  { value: 'autoEdit' as const, label: 'Auto-edit', desc: '自动批准编辑' },
  { value: 'fullAuto' as const, label: 'Full-auto', desc: '跳过所有权限' }
]

export function PermissionModeSelector() {
  const permissionMode = useSessionConfigStore((s) => s.permissionMode)
  const setPermissionMode = useSessionConfigStore((s) => s.setPermissionMode)

  return (
    <select
      value={permissionMode}
      onChange={(e) => setPermissionMode(e.target.value as 'manual' | 'autoEdit' | 'plan' | 'fullAuto')}
      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
    >
      {PERMISSION_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label} ({opt.desc})
        </option>
      ))}
    </select>
  )
}
