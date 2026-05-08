// ACP backend configurations — one entry per CLI tool
// Source: AionUi ACP_BACKENDS_ALL (acpTypes.ts) + acpConnectors.ts

export type AcpSpawnStrategy =
  | 'npx'      // spawned via `npx <package> <acpArgs>`
  | 'cli'      // direct CLI binary with acpArgs appended

export interface AcpBackendConfig {
  /** Unique id — used as providerType in SessionConfig */
  id: string
  /** Display name shown in UI */
  name: string
  /** Vendor / maintainer */
  vendor: string

  strategy: AcpSpawnStrategy

  // ── npx strategy fields ──
  /** npm package to run via npx (e.g. '@agentclientprotocol/claude-agent-acp@0.29.2') */
  npxPackage?: string
  /** Platform-specific alternate packages tried on macOS x64/arm64, win32, linux */
  npxPlatformPackages?: Partial<Record<NodeJS.Platform, Record<string, string>>>

  // ── cli strategy fields ──
  /** Binary name detected via `which` (e.g. 'claude', 'goose') */
  cliCommand?: string
  /** Arguments appended after the binary to enable ACP mode */
  acpArgs?: string[]

  // ── Auth ──
  /** Environment variable key this backend reads for its API key */
  authEnvKey?: string
  /** Key in Bytro's Secrets store to read the API key from */
  secretsKey?: string
  /** Whether the backend requires auth before use */
  authRequired?: boolean

  // ── Metadata ──
  /** Whether this backend is enabled by default */
  enabled: boolean
  /** Short description shown in settings */
  description?: string
  /** Static model fallback shown before dynamic discovery from session/new */
  fallbackModels?: Array<{ id: string; name: string; contextWindow?: number }>
  /** Path to the native CLI's settings JSON file whose "env" block is merged into
   *  the ACP bridge process environment. Relative to home directory. */
  settingsJsonPath?: string
}

// ─── Version constants (from AionUi acpTypes.ts) ─────────────────────────────

const CODEX_ACP_VERSION = '0.9.5'
const CLAUDE_ACP_VERSION = '0.29.2'
const CODEBUDDY_ACP_VERSION = '2.73.0'

// ─── All ACP backends ─────────────────────────────────────────────────────────

export const ACP_BACKENDS: AcpBackendConfig[] = [
  // ── npx-based (bridge packages) ──────────────────────────────────────────

  {
    id: 'claude-acp',
    name: 'Claude Code',
    vendor: 'Anthropic',
    strategy: 'npx',
    npxPackage: `@agentclientprotocol/claude-agent-acp@${CLAUDE_ACP_VERSION}`,
    authEnvKey: 'ANTHROPIC_API_KEY',
    secretsKey: 'claude-cli',
    authRequired: true,
    enabled: true,
    description: 'Claude Code CLI via ACP bridge',
    settingsJsonPath: '.claude/settings.json',
    fallbackModels: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 200000 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000 },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000 },
    ],
  },

  {
    id: 'codex-acp',
    name: 'Codex',
    vendor: 'OpenAI',
    strategy: 'npx',
    npxPackage: `@zed-industries/codex-acp@${CODEX_ACP_VERSION}`,
    // Platform-specific binary packages (preferred on win32/linux)
    npxPlatformPackages: {
      win32: {
        x64: `@zed-industries/codex-acp-win32-x64@${CODEX_ACP_VERSION}`,
        arm64: `@zed-industries/codex-acp-win32-arm64@${CODEX_ACP_VERSION}`
      },
      linux: {
        x64: `@zed-industries/codex-acp-linux-x64@${CODEX_ACP_VERSION}`,
        arm64: `@zed-industries/codex-acp-linux-arm64@${CODEX_ACP_VERSION}`
      },
      darwin: {
        x64: `@zed-industries/codex-acp-darwin-x64@${CODEX_ACP_VERSION}`,
        arm64: `@zed-industries/codex-acp-darwin-arm64@${CODEX_ACP_VERSION}`
      }
    },
    acpArgs: [],  // codex-acp is ACP by default, no extra flag needed
    authEnvKey: 'OPENAI_API_KEY',
    secretsKey: 'codex-cli',
    authRequired: true,
    enabled: true,
    description: 'OpenAI Codex via codex-acp bridge',
    settingsJsonPath: '.codex/settings.json',
    fallbackModels: [
      { id: 'codex-mini-latest', name: 'Codex Mini', contextWindow: 200000 },
      { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000 },
      { id: 'o3', name: 'o3', contextWindow: 200000 },
    ],
  },

  {
    id: 'codebuddy-acp',
    name: 'CodeBuddy',
    vendor: 'Tencent',
    strategy: 'npx',
    npxPackage: `@tencent-ai/codebuddy-code@${CODEBUDDY_ACP_VERSION}`,
    acpArgs: ['--acp'],
    authRequired: true,
    enabled: true,
    description: 'Tencent CodeBuddy CLI via npx bridge',
    fallbackModels: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 200000 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000 },
    ],
  },

  {
    id: 'qwen-acp',
    name: 'Qwen Code',
    vendor: 'Alibaba',
    strategy: 'npx',
    npxPackage: '@qwen-code/qwen-code@0.15.6',
    cliCommand: 'qwen',
    acpArgs: ['--acp'],
    authRequired: true,
    enabled: true,
    description: 'Alibaba Qwen Code CLI (v0.0.10+)',
    fallbackModels: [
      { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', contextWindow: 128000 },
      { id: 'qwen-coder', name: 'Qwen Coder', contextWindow: 128000 },
    ],
  },

  // ── CLI-native ACP (direct spawn) ─────────────────────────────────────────

  {
    id: 'goose-acp',
    name: 'Goose',
    vendor: 'Block',
    strategy: 'cli',
    cliCommand: 'goose',
    acpArgs: ['acp'],  // subcommand: `goose acp`
    authRequired: false,
    enabled: true,
    description: "Block's Goose CLI"
  },

  {
    id: 'kimi-acp',
    name: 'Kimi',
    vendor: 'Moonshot',
    strategy: 'cli',
    cliCommand: 'kimi',
    acpArgs: ['acp'],  // subcommand: `kimi acp`
    authRequired: false,
    enabled: true,
    description: 'Kimi CLI by Moonshot AI (OAuth auth)'
  },

  {
    id: 'opencode-acp',
    name: 'OpenCode',
    vendor: 'SST/Anomaly',
    strategy: 'cli',
    cliCommand: 'opencode',
    acpArgs: ['acp'],  // subcommand: `opencode acp`
    authRequired: false,
    enabled: true,
    description: 'OpenCode CLI'
  },

  {
    id: 'auggie-acp',
    name: 'Augment Code',
    vendor: 'Augment Code',
    strategy: 'cli',
    cliCommand: 'auggie',
    acpArgs: ['--acp'],
    authRequired: false,
    enabled: true,
    description: 'Augment Code CLI'
  },

  {
    id: 'copilot-acp',
    name: 'GitHub Copilot',
    vendor: 'GitHub',
    strategy: 'cli',
    cliCommand: 'copilot',
    acpArgs: ['--acp', '--stdio'],
    authRequired: false,
    enabled: true,
    description: 'GitHub Copilot CLI (requires active Copilot subscription)'
  },

  {
    id: 'droid-acp',
    name: 'Factory Droid',
    vendor: 'Factory AI',
    strategy: 'cli',
    cliCommand: 'droid',
    acpArgs: ['exec', '--output-format', 'acp'],
    authEnvKey: 'FACTORY_API_KEY',
    authRequired: false,
    enabled: true,
    description: 'Factory Droid CLI (uses FACTORY_API_KEY env var)'
  },

  {
    id: 'cursor-acp',
    name: 'Cursor Agent',
    vendor: 'Anysphere',
    strategy: 'cli',
    cliCommand: 'agent',  // note: generic binary name — `agent acp`
    acpArgs: ['acp'],
    authRequired: true,
    enabled: true,
    description: 'Cursor AI Agent CLI (requires active Cursor subscription)'
  },

  {
    id: 'kiro-acp',
    name: 'Kiro',
    vendor: 'Amazon Web Services',
    strategy: 'cli',
    cliCommand: 'kiro-cli',
    acpArgs: ['acp'],  // subcommand: `kiro-cli acp`
    authRequired: true,
    enabled: true,
    description: 'Kiro CLI by AWS (requires Kiro / AWS Builder ID login)'
  },

  {
    id: 'hermes-acp',
    name: 'Hermes Agent',
    vendor: 'Nous Research',
    strategy: 'cli',
    cliCommand: 'hermes',
    acpArgs: ['acp'],  // subcommand: `hermes acp`
    authRequired: true,
    enabled: true,
    description: 'Nous Research Hermes Agent with 90+ tools and persistent memory'
  },

  {
    id: 'vibe-acp',
    name: 'Mistral Vibe',
    vendor: 'Mistral AI',
    strategy: 'cli',
    cliCommand: 'vibe-acp',
    acpArgs: [],  // `vibe-acp` is ACP by default
    authRequired: false,
    enabled: true,
    description: 'Mistral Vibe coding CLI'
  },

  {
    id: 'qoder-acp',
    name: 'Qoder',
    vendor: 'Qoder',
    strategy: 'cli',
    cliCommand: 'qodercli',
    acpArgs: ['--acp'],
    authRequired: false,
    enabled: true,
    description: 'Qoder CLI'
  },

  {
    id: 'snow-acp',
    name: 'Snow',
    vendor: 'Snow AI',
    strategy: 'cli',
    cliCommand: 'snow',
    acpArgs: ['--acp'],
    authRequired: false,
    enabled: true,
    description: 'Snow AI coding CLI'
  },
]

/** Convenience map: id → config */
export const ACP_BACKEND_MAP = new Map<string, AcpBackendConfig>(
  ACP_BACKENDS.map((b) => [b.id, b])
)
