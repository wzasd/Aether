import type { SessionConfig, ProviderMeta, ModelInfo } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { ClaudeOutputParser } from './parsers/claude-output-parser'
import { Secrets } from '../../core/secrets'
import { getMcpConfigArgs } from '../../mcp/config-file'

const CLAUDE_META: ProviderMeta = {
  id: 'claude',
  name: 'Claude',
  binary: 'claude',
  vendor: 'Anthropic',
  models: [
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 200000 },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000 },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000 }
  ],
  permissionFlags: {
    manual: ['default'],
    autoEdit: ['acceptEdits'],
    plan: ['plan'],
    fullAuto: ['bypassPermissions'],
    trusted: ['bypassPermissions']
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

export class ClaudeProvider extends BaseCLIProvider {
  readonly meta = CLAUDE_META

  protected buildStreamJsonArgs(config: SessionConfig, resume: boolean): string[] {
    const args = [
      '--allow-dangerously-skip-permissions',
      '--dangerously-skip-permissions',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--model', config.model,
      '--disallowed-tools', 'EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete'
    ]

    if (config.sessionId) {
      if (resume) {
        args.push('--resume', config.sessionId)
      } else {
        args.push('--session-id', config.sessionId)
      }
    }

    if (config.appendSystemPrompt) {
      args.push('--append-system-prompt', config.appendSystemPrompt)
    }

    return args
  }

  protected buildManualArgs(config: SessionConfig, resume: boolean): string[] {
    const args = [
      '--model', config.model,
      '--permission-mode', 'bypassPermissions',
      '--verbose',
      '--allow-dangerously-skip-permissions',
      '--dangerously-skip-permissions'
    ]

    if (config.sessionId) {
      if (resume) {
        args.push('--resume', config.sessionId)
      } else {
        args.push('--session-id', config.sessionId)
      }
    }

    return args
  }

  /** Claude uses a static model list (aligned with Multica).
   *  Dynamic discovery via `claude --print models` is available below as a
   *  commented reference; set ENABLE_DYNAMIC_MODEL_DISCOVERY to enable it.
   */
  async listModels(): Promise<ModelInfo[]> {
    return this.meta.models
  }

  // ------------------------------------------------------------------
  // Dynamic discovery (experimental — enable via feature flag later)
  // ------------------------------------------------------------------
  // async listModels(): Promise<ModelInfo[]> {
  //   const binary = this.config?.binaryPath || this.meta.binary
  //   return new Promise((resolve) => {
  //     execFile(binary, ['--print', 'models'], (err, stdout) => {
  //       if (err || !stdout) {
  //         console.error(`[${this.meta.id}] listModels failed:`, err?.message || 'no stdout')
  //         resolve(this.meta.models)
  //         return
  //       }
  //       const lines = stdout.trim().split('\n')
  //       const models: ModelInfo[] = []
  //       for (const line of lines) {
  //         // Match Markdown table rows like: | **Name** | `id` | description |
  //         const match = line.match(/^\|\s*\*\*([^*|]+)\*\*\s*\|\s*`([^`]+)`\s*\|/)
  //         if (match) {
  //           const name = match[1].trim()
  //           const id = match[2].trim()
  //           models.push({ id, name, contextWindow: 200000 })
  //         }
  //       }
  //       console.log(`[${this.meta.id}] listModels found ${models.length} models via 'claude --print models'`)
  //       resolve(models.length > 0 ? models : this.meta.models)
  //     })
  //   })
  // }

  protected buildEnv(): Record<string, string> {
    const apiKey = Secrets.get('claude-cli')
    return apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}
  }

  protected buildMcpArgs(workingDir?: string): string[] {
    return getMcpConfigArgs(workingDir)
  }

  protected createParser(transport: 'stream-json' | 'pty', sessionId: string): OutputParser {
    return new ClaudeOutputParser(transport, sessionId)
  }

  /** Claude CLI requires UUID format for --resume / --session-id.
   *  Reject OpenCode-style IDs like `oc-mozewl23-d4ql8k`. */
  protected isValidSessionId(sessionId: string): boolean {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return UUID_RE.test(sessionId)
  }
}
