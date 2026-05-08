import { spawn, ChildProcess } from 'child_process'

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface McpTestResult {
  ok: boolean
  tools?: McpTool[]
  error?: string
}

const MCP_PROTOCOL_VERSION = '2024-11-05'

const DANGEROUS_ENV_KEYS = new Set([
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH'
])

function sendJson(proc: ChildProcess, data: unknown): void {
  if (!proc.stdin?.writable) return
  proc.stdin.write(JSON.stringify(data) + '\n')
}

function killProc(proc: ChildProcess): void {
  proc.kill()
  // SIGKILL fallback after 2s
  setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* best-effort */ } }, 2000)
}

function readJsonLine(buffer: string): { parsed: unknown | null; rest: string } {
  const newline = buffer.indexOf('\n')
  if (newline === -1) return { parsed: null, rest: buffer }
  const line = buffer.slice(0, newline).trim()
  const rest = buffer.slice(newline + 1)
  if (!line) return { parsed: null, rest }
  try {
    return { parsed: JSON.parse(line), rest }
  } catch {
    return { parsed: null, rest }
  }
}

function filterEnv(env: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (!DANGEROUS_ENV_KEYS.has(k)) safe[k] = v
  }
  return safe
}

export function testMcpConnection(
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<McpTestResult> {
  return new Promise((resolve) => {
    const timeout = 15000
    let buffer = ''
    let settled = false
    let phase: 'init' | 'tools' = 'init'

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killProc(proc)
      resolve({ ok: false, error: 'Connection timed out' })
    }, timeout)

    const safeEnv = filterEnv(env)
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...safeEnv }
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, error: `Failed to start: ${err.message}` })
    })

    proc.stderr?.on('data', () => {
      // MCP servers may log to stderr; ignore
    })

    const handleData = (chunk: Buffer) => {
      if (settled) return
      buffer += chunk.toString()

      while (true) {
        const result = readJsonLine(buffer)
        if (!result.parsed) { buffer = result.rest; break }
        buffer = result.rest
        const msg = result.parsed as Record<string, unknown>

        if (phase === 'init') {
          // Validate it's actually the initialize response (id=1)
          if (msg.id !== 1) continue
          phase = 'tools'

          // Send notifications/initialized per MCP spec
          sendJson(proc, { jsonrpc: '2.0', method: 'notifications/initialized' })
          // Then request tools/list
          sendJson(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        } else if (phase === 'tools') {
          // Validate it's the tools/list response (id=2)
          if (msg.id !== 2) continue

          if (msg.error) {
            clearTimeout(timer)
            settled = true
            const errObj = msg.error as Record<string, unknown>
            killProc(proc)
            resolve({ ok: false, error: String(errObj.message || msg.error) })
          } else if (msg.result) {
            clearTimeout(timer)
            settled = true
            const resResult = msg.result as Record<string, unknown>
            const rawTools = Array.isArray(resResult.tools) ? resResult.tools : []
            const tools: McpTool[] = (rawTools as Array<Record<string, unknown>>).map((t) => ({
              name: String(t.name || ''),
              description: t.description ? String(t.description) : undefined,
              inputSchema: t.inputSchema as Record<string, unknown> | undefined
            }))
            killProc(proc)
            resolve({ ok: true, tools })
          }
        }
      }
    }

    proc.stdout?.on('data', handleData)

    // Send initialize after a short delay to let the process start
    setTimeout(() => {
      if (settled) return
      sendJson(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'bytro', version: '0.1.0' }
        }
      })
    }, 200)
  })
}
