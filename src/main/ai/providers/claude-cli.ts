import type { SessionConfig, ProviderMeta } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { ClaudeOutputParser } from './parsers/claude-output-parser'
import { Secrets } from '../../core/secrets'
import { getMcpConfigArgs } from '../../mcp/config-file'

const CLAUDE_META: ProviderMeta = {
  id: 'claude-cli',
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
    fullAuto: ['bypassPermissions']
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

export class ClaudeCLIProvider extends BaseCLIProvider {
  readonly meta = CLAUDE_META

  protected buildStreamJsonArgs(config: SessionConfig, resume: boolean): string[] {
    const cliPermissionMode = this.meta.permissionFlags[config.permissionMode][0]
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-hook-events',
      '--include-partial-messages',
      '--input-format', 'stream-json',
      '--model', config.model,
      '--permission-mode', cliPermissionMode
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
    const cliPermissionMode = this.meta.permissionFlags[config.permissionMode][0]
    const args = ['--model', config.model, '--permission-mode', cliPermissionMode, '--verbose']

    if (config.sessionId) {
      if (resume) {
        args.push('--resume', config.sessionId)
      } else {
        args.push('--session-id', config.sessionId)
      }
    }

    return args
  }

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
}
