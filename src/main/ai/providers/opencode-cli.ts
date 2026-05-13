import { homedir } from 'os'
import { spawn, type ChildProcess, execFile } from 'child_process'
import type { SessionConfig, Session, ProviderMeta, ModelInfo } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { OpenCodeOutputParser } from './parsers/opencode-output-parser'
import { writeObservabilityEvent } from '../../core/logging'

const OPENCODE_META: ProviderMeta = {
  id: 'opencode',
  name: 'OpenCode',
  binary: 'opencode',
  vendor: 'SST/Anomaly',
  models: [
    { id: 'opencode/big-pickle', name: 'Big Pickle', contextWindow: 200000 },
    { id: 'opencode/gpt-5-nano', name: 'GPT-5 Nano', contextWindow: 200000 },
    { id: 'opencode/minimax-m2.5-free', name: 'MiniMax M2.5 Free', contextWindow: 200000 },
    { id: 'opencode/nemotron-3-super-free', name: 'Nemotron 3 Super Free', contextWindow: 200000 },
    { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000 },
    { id: 'anthropic/claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 200000 },
    { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000 }
  ],
  permissionFlags: {
    manual: [],
    autoEdit: ['--dangerously-skip-permissions'],
    plan: [],
    fullAuto: ['--dangerously-skip-permissions'],
    trusted: ['--dangerously-skip-permissions']
  },
  supportsStreamJson: true,
  supportsInteractive: true,
  supportsCrossTurnResume: true
}

export class OpenCodeProvider extends BaseCLIProvider {
  readonly meta = OPENCODE_META

  private opencodeSessionId = ''
  private activeProcess: ChildProcess | null = null

  async startSession(config: SessionConfig): Promise<Session> {
    if (config.permissionMode === 'manual') {
      return super.startSession(config)
    }

    // Validate config.sessionId — reject UUID-format IDs from other providers.
    // OpenCode only accepts `oc-` prefix session IDs. If a UUID is passed
    // (from cross-provider pollution), discard it and generate a proper `oc-` ID.
    const validProvidedSessionId = config.sessionId && this.isValidSessionId(config.sessionId)
      ? config.sessionId
      : null

    if (config.sessionId && !validProvidedSessionId) {
      writeObservabilityEvent('runtime:session_id_rejected', {
        providerType: this.meta.id,
        sessionId: config.sessionId,
      })
    }

    const sessionId = validProvidedSessionId || this.opencodeSessionId || 'oc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    const sessionConfig = { ...config, sessionId }
    const session: Session = {
      id: sessionId,
      providerType: this.meta.id,
      config: sessionConfig,
      status: 'idle',
      createdAt: Date.now()
    }

    const entry = {
      session,
      config: sessionConfig,
      status: session.status,
      transport: 'stream-json' as const,
      parser: this.createParser('stream-json', sessionId),
      buffer: '',
      stderr: '',
      doneEmitted: false
    }
    this.sessions.set(sessionId, entry)

    return session
  }

  sendMessage(sessionId: string, content: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty') {
      super.sendMessage(sessionId, content)
      return
    }

    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM')
      this.activeProcess = null
    }

    entry.doneEmitted = false
    entry.status = 'running'
    entry.session.status = 'running'

    const binary = this.resolveBinary()
    const args = this.buildRunArgs(entry.config, content)
    const env = { ...process.env, ...this.buildEnv() }

    const child = spawn(binary, args, {
      cwd: entry.config.workingDir || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })

    this.activeProcess = child

    entry.parser.beginTurn()
    entry.buffer = ''

    child.stdout.on('data', (data: Buffer) => {
      entry.buffer += data.toString()
      const lines = entry.buffer.split('\n')
      entry.buffer = lines.pop() || ''

      for (const line of lines) {
        const events = entry.parser.parseLine(line)
        for (const event of events) {
          this.emitSessionEvent(sessionId, entry, event)
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      entry.stderr += data.toString()
    })

    child.on('error', (error) => {
      this.activeProcess = null
      this.emitTerminalFailure(sessionId, entry, error.message || 'OpenCode process failed to start')
      this.sessions.delete(sessionId)
    })

    child.on('exit', (code, signal) => {
      this.activeProcess = null

      const parser = entry.parser as OpenCodeOutputParser
      if (parser.sessionId) {
        this.opencodeSessionId = parser.sessionId
      }

      if (entry.buffer.trim()) {
        const events = entry.parser.parseLine(entry.buffer)
        for (const event of events) {
          this.emitSessionEvent(sessionId, entry, event)
        }
        entry.buffer = ''
      }

      if (!entry.doneEmitted) {
        const stderr = entry.stderr.trim()
        const cleanExit = code === 0 && !signal && !stderr
        if (cleanExit) {
          const flushEvents = entry.parser.flush()
          for (const event of flushEvents) {
            this.emitSessionEvent(sessionId, entry, event)
          }
          if (!entry.doneEmitted) {
            this.emitSessionEvent(sessionId, entry, { type: 'done', id: sessionId })
          }
        } else {
          const reason = stderr || `OpenCode process exited unexpectedly (${signal || code || 'unknown'})`
          this.emitTerminalFailure(sessionId, entry, reason)
        }
      }
    })
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty') {
      super.abort(sessionId)
      return
    }

    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM')
      this.activeProcess = null
    }
    entry.status = 'idle'
    entry.session.status = 'idle'
  }

  async endSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (entry.transport === 'pty') {
      await super.endSession(sessionId)
      return
    }

    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM')
      this.activeProcess = null
    }
    this.sessions.delete(sessionId)
    this.opencodeSessionId = ''
  }

  protected buildStreamJsonArgs(_config: SessionConfig, _resume: boolean): string[] {
    return []
  }

  protected buildManualArgs(config: SessionConfig, resume: boolean): string[] {
    const args: string[] = ['-m', config.model]

    if (resume && config.sessionId) {
      args.push('-s', config.sessionId)
    } else if (!resume && this.opencodeSessionId) {
      args.push('-s', this.opencodeSessionId)
    }

    if (config.appendSystemPrompt) {
      args.push('--prompt', config.appendSystemPrompt)
    }

    return args
  }

  protected buildEnv(): Record<string, string> {
    return {}
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new OpenCodeOutputParser()
  }

  /** OpenCode session IDs use `oc-` prefix format (e.g. `oc-mozewl23-d4ql8k`).
   *  Reject UUID-format IDs from other providers. */
  protected isValidSessionId(sessionId: string): boolean {
    return sessionId.startsWith('oc-')
  }

  async listModels(): Promise<ModelInfo[]> {
    const binary = this.resolveBinary()
    return new Promise((resolve) => {
      execFile(binary, ['models'], (err, stdout) => {
        if (err || !stdout) {
          writeObservabilityEvent('runtime:models_listed', {
            profileId: this.config?.profileId,
            runtimeKey: this.meta.id,
            error: err?.message || 'no stdout',
            modelCount: 0
          })
          resolve(this.meta.models)
          return
        }
        const lines = stdout.trim().split('\n').filter(Boolean)
        const models: ModelInfo[] = lines.map((line) => {
          const id = line.trim()
          const name = id.split('/').pop() || id
          return { id, name, contextWindow: 200000 }
        })
        writeObservabilityEvent('runtime:models_listed', {
          profileId: (this as any).config?.profileId,
          runtimeKey: this.meta.id,
          modelCount: models.length
        })
        resolve(models.length > 0 ? models : this.meta.models)
      })
    })
  }

  /** OpenCode installs to ~/.opencode/bin/opencode by default. */
  protected override getBinaryCandidates(): string[] {
    return [
      `${homedir()}/.opencode/bin/${this.meta.binary}`,
      `/opt/homebrew/bin/${this.meta.binary}`,
      `/usr/local/bin/${this.meta.binary}`,
    ]
  }

  private buildRunArgs(config: SessionConfig, message: string): string[] {
    const args = [
      'run',
      '--format', 'json',
      '--pure',
      '--dir', config.workingDir || process.cwd(),
      '--model', config.model,
    ]

    // OpenCode agents: 'build' (default primary), 'plan' (for plan mode).
    // Whitelist validation: only pass valid OpenCode agent names.
    const VALID_OPENCODE_AGENTS = ['build', 'plan'] as const
    const rawAgent = config.permissionMode === 'plan' ? 'plan' : 'build'
    const agentName = VALID_OPENCODE_AGENTS.includes(rawAgent as any) ? rawAgent : 'build'
    args.push('--agent', agentName)

    const permFlags = this.meta.permissionFlags[config.permissionMode]
    if (permFlags.length > 0) {
      args.push(...permFlags)
    }

    if (this.opencodeSessionId) {
      args.push('--session', this.opencodeSessionId)
    }

    // OpenCode does not support --prompt flag. System prompt is prepended
    // to the message content, aligned with how Slock passes standingPrompt.
    // Layer 2B: For plan agent, inject a summary instruction so the LLM
    // always produces natural-language output even after pure tool calls.
    let effectiveMessage = config.appendSystemPrompt
      ? `${config.appendSystemPrompt}\n\n---\n\n${message}`
      : message

    if (agentName === 'plan') {
      effectiveMessage += '\n\n[系统指令] 完成所有操作后，你必须用自然语言总结你的操作和结果。即使你只调用了工具，也必须输出总结。'
    }

    // '--' separator prevents yargs from interpreting message content as flags.
    // Without this, messages containing '--' prefixed tokens cause parse errors.
    args.push('--', effectiveMessage)

    return args
  }
}
