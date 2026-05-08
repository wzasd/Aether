import type { SessionConfig, ProviderMeta } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { CodexOutputParser } from './parsers/codex-output-parser'
import { Secrets } from '../../core/secrets'

const CODEX_META: ProviderMeta = {
  id: 'codex-cli',
  name: 'Codex',
  binary: 'codex',
  vendor: 'OpenAI',
  models: [
    { id: 'codex-mini-latest', name: 'Codex Mini', contextWindow: 200000 },
    { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000 },
    { id: 'o3', name: 'o3', contextWindow: 200000 }
  ],
  permissionFlags: {
    manual: [],
    autoEdit: [],
    plan: ['--no-git-commit'],
    fullAuto: ['-a']
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

export class CodexCLIProvider extends BaseCLIProvider {
  readonly meta = CODEX_META

  protected buildStreamJsonArgs(config: SessionConfig, resume: boolean): string[] {
    const args = ['exec', '--json', '--model', config.model]

    if (resume && config.sessionId) {
      // Codex resume is a subcommand: `codex resume <id>` — handled by startSession override if needed
      // For now pass as exec arg; actual resume may need a different flow
      args.push('--resume', config.sessionId)
    }

    const permFlags = this.meta.permissionFlags[config.permissionMode]
    args.push(...permFlags)

    return args
  }

  protected buildManualArgs(config: SessionConfig, resume: boolean): string[] {
    const args: string[] = ['--model', config.model]

    if (resume && config.sessionId) {
      args.push('resume', config.sessionId)
    }

    return args
  }

  protected buildEnv(): Record<string, string> {
    const apiKey = Secrets.get('codex-cli')
    return apiKey ? { OPENAI_API_KEY: apiKey } : {}
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new CodexOutputParser()
  }
}
