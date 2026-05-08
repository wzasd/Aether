export interface McpServerRow {
  name: string
  command: string
  args: string
  env: string
  enabled: number
}

export function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
