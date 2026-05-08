import type { SessionConfig, ProviderMeta } from '../provider'
import type { OutputParser } from './parsers/output-parser'
import { BaseCLIProvider } from './base-cli-provider'
import { KimiOutputParser } from './parsers/kimi-output-parser'
import { getMcpConfigArgs } from '../../mcp/config-file'

const KIMI_META: ProviderMeta = {
  id: 'kimi-cli',
  name: 'Kimi',
  binary: 'kimi',
  vendor: 'Moonshot',
  models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 131072 }],
  permissionFlags: {
    manual: [],
    autoEdit: ['--afk'],
    plan: [],
    fullAuto: ['--yolo']
  },
  supportsStreamJson: true,
  supportsInteractive: true
}

export class KimiCLIProvider extends BaseCLIProvider {
  readonly meta = KIMI_META

  protected buildStreamJsonArgs(config: SessionConfig, resume: boolean): string[] {
    const args = ['--print', '--output-format', 'stream-json', '--model', config.model]

    if (resume && config.sessionId) {
      args.push('--resume', config.sessionId)
    }

    const permFlags = this.meta.permissionFlags[config.permissionMode]
    args.push(...permFlags)

    return args
  }

  protected buildManualArgs(config: SessionConfig, resume: boolean): string[] {
    const args: string[] = ['--model', config.model]

    if (resume && config.sessionId) {
      args.push('--resume', config.sessionId)
    }

    return args
  }

  protected buildEnv(): Record<string, string> {
    // Kimi uses OAuth (kimi login); no API key needed
    return {}
  }

  protected buildMcpArgs(workingDir?: string): string[] {
    return getMcpConfigArgs(workingDir)
  }

  protected createParser(_transport: 'stream-json' | 'pty', _sessionId: string): OutputParser {
    return new KimiOutputParser()
  }
}
