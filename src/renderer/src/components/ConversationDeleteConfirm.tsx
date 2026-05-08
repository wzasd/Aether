export function DeleteConfirmDialog({
  open,
  onConfirm,
  onCancel
}: {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-card border border-border rounded-lg p-4 w-80 shadow-lg">
        <p className="text-sm text-foreground mb-1">确定删除这个对话吗？</p>
        <p className="text-xs text-muted-foreground mb-4">会话将从列表中移除，数据保留 30 天后自动清除。</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
