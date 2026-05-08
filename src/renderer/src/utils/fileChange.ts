export interface ExtractedChange {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  diff_text: string | null
}

const FILE_OPERATION_TOOLS = new Set(['Write', 'Edit', 'Delete'])

export function normalizeToolName(toolName: string): string {
  const segments = toolName.split('__')
  return segments[segments.length - 1]
}

export function isFileOperationTool(toolName: string): boolean {
  return FILE_OPERATION_TOOLS.has(normalizeToolName(toolName))
}

export function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

export function extractFileChange(toolName: string, input: string): ExtractedChange | null {
  if (!isFileOperationTool(toolName)) return null

  const normalizedName = normalizeToolName(toolName)

  try {
    const parsed = JSON.parse(input)
    const filePath = parsed.file_path || parsed.path
    if (!filePath) return null

    let status: ExtractedChange['status'] = 'modified'
    if (normalizedName === 'Write') status = 'added'
    else if (normalizedName === 'Delete') status = 'deleted'

    let additions = 0
    let deletions = 0
    let diff_text: string | null = null

    if (normalizedName === 'Edit') {
      const oldStr: string = parsed.old_string ?? ''
      const newStr: string = parsed.new_string ?? ''
      if (oldStr) deletions = countLines(oldStr)
      if (newStr) additions = countLines(newStr)
      if (oldStr || newStr) {
        const removed = oldStr.split('\n').map((l) => `-${l}`).join('\n')
        const added = newStr.split('\n').map((l) => `+${l}`).join('\n')
        diff_text = `${removed}\n${added}`
      }
    } else if (normalizedName === 'Write') {
      const content: string = parsed.content || parsed.text || ''
      if (content) {
        additions = countLines(content)
        diff_text = content.split('\n').map((l) => `+${l}`).join('\n')
      }
    }

    return { path: filePath, status, additions, deletions, diff_text }
  } catch {
    return null
  }
}
