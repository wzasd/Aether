export const TOOL_META: Record<string, { label: string; color: string }> = {
  Bash: { label: '执行命令', color: '#8B5CF6' },
  Read: { label: '读取文件', color: '#3B82F6' },
  Write: { label: '写入文件', color: '#F59E0B' },
  Edit: { label: '编辑文件', color: '#F59E0B' },
  Glob: { label: '查找文件', color: '#10B981' },
  Grep: { label: '搜索内容', color: '#06B6D4' },
  WebFetch: { label: '网页获取', color: '#8B5CF6' },
  WebSearch: { label: '网页搜索', color: '#8B5CF6' },
  Task: { label: '子代理', color: '#EC4899' },
  Agent: { label: '子代理', color: '#EC4899' },
  TodoWrite: { label: '任务列表', color: '#F59E0B' },
  NotebookEdit: { label: '笔记本', color: '#10B981' },
  Delete: { label: '删除文件', color: '#EF4444' },
  AskUserQuestion: { label: 'AI 提问', color: '#8B5CF6' },
  Skill: { label: '技能', color: '#EC4899' },
  EnterPlanMode: { label: '计划模式', color: '#06B6D4' },
  ExitPlanMode: { label: '退出计划', color: '#06B6D4' },
}

export function getToolMeta(toolName: string): { label: string; color: string } {
  if (TOOL_META[toolName]) return TOOL_META[toolName]
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    return { label: `${parts[1] || 'mcp'}:${parts.slice(2).join('__')}`, color: '#06B6D4' }
  }
  return { label: toolName, color: '#6B7280' }
}

export function formatToolInput(toolName: string, input: string): string {
  try {
    const parsed = JSON.parse(input)
    switch (toolName) {
      case 'Bash': return parsed.command || input
      case 'Read': return basename(parsed.file_path || parsed.path || input)
      case 'Write': return basename(parsed.file_path || parsed.path || input)
      case 'Edit': return basename(parsed.file_path || input)
      case 'Glob': return parsed.pattern || input
      case 'Grep': return (parsed.pattern || '') + (parsed.path ? ` in ${basename(parsed.path)}` : '')
      case 'WebFetch': return parsed.url || input
      case 'WebSearch': return parsed.query || input
      case 'Delete': return basename(parsed.file_path || parsed.path || input)
      default: return input.length > 80 ? input.substring(0, 80) + '...' : input
    }
  } catch {
    return input.length > 80 ? input.substring(0, 80) + '...' : input
  }
}

export function basename(path: string): string {
  if (!path) return ''
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx >= 0 ? path.substring(idx + 1) : path
}
