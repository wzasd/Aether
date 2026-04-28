import { shell } from 'electron'

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export async function safeOpenExternal(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return false
    }

    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}
