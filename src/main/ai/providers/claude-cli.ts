import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { PERMISSION_MODE_CLI_MAP } from '../types'
import type { AIProvider, SessionConfig, Session } from '../provider'
import type { AIEvent, PermissionMode } from '../types'
import { EventParser } from '../event-parser'

export class ClaudeCLIProvider extends EventEmitter implements AIProvider {
  readonly type = 'claude-cli'

  private sessions: Map<
    string,
    {
      process: ChildProcess
      config: SessionConfig
      status: Session['status']
      parser: EventParser
      buffer: string
    }
  > = new Map()

  async startSession(config: SessionConfig): Promise<Session> {
    const sessionId = config.sessionId || `cli-${Date.now()}`
    const args = this.buildArgs(config)

    const child = spawn('claude', args, {
      cwd: config.workingDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    const entry = {
      process: child,
      config,
      status: 'idle' as Session['status'],
      parser: new EventParser(),
      buffer: ''
    }
    this.sessions.set(sessionId, entry)

    child.stdout.on('data', (data: Buffer) => {
      entry.buffer += data.toString()
      const lines = entry.buffer.split('\n')
      entry.buffer = lines.pop() || ''
      for (const line of lines) {
        const events = entry.parser.parseLine(line)
        if (!events) continue
        const eventArr = Array.isArray(events) ? events : [events]
        for (const event of eventArr) {
          this.emit(`event:${sessionId}`, event)
        }
      }
    })

    child.stderr.on('data', () => {
      /* debug logging if needed */
    })

    child.on('exit', () => {
      this.sessions.delete(sessionId)
    })

    return {
      id: sessionId,
      providerType: this.type,
      config,
      status: 'idle',
      createdAt: Date.now()
    }
  }

  async endSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.process.kill()
      this.sessions.delete(sessionId)
    }
  }

  sendMessage(sessionId: string, content: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.status = 'running'
    const msg = JSON.stringify({ type: 'user_message', content }) + '\n'
    entry.process.stdin.write(msg)
  }

  respondPermission(sessionId: string, approved: boolean): void {
    // In -p stream-json mode, permissions are handled by --permission-mode
    // This method is for PTY mode (manual) — write y/n to PTY
    // For now, if denied, abort the session
    if (!approved) {
      this.abort(sessionId)
    }
  }

  respondQuestion(sessionId: string, answer: string): void {
    // Similar to permission — in -p mode, abort if can't answer
    // In PTY mode, write answer to stdin
    this.abort(sessionId)
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.process.kill('SIGTERM')
      entry.status = 'idle'
    }
  }

  onEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.on(`event:${sessionId}`, handler)
  }

  offEvent(sessionId: string, handler: (event: AIEvent) => void): void {
    this.off(`event:${sessionId}`, handler)
  }

  private buildArgs(config: SessionConfig): string[] {
    const cliPermissionMode = PERMISSION_MODE_CLI_MAP[config.permissionMode]
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
      '--model',
      config.model,
      '--permission-mode',
      cliPermissionMode
    ]
    if (config.sessionId) {
      args.push('--resume', config.sessionId)
    }
    return args
  }
}
