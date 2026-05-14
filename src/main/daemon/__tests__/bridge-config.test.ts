import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateBridgeConfig,
  cleanupBridgeConfig,
  getBridgeConfigPath,
} from '../bridge-config'
import { MCP_SERVER_NAME } from '../../chat-bridge/types'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockApiUrl = 'http://127.0.0.1:12345'
const mockAuthToken = 'test-auth-token-uuid'

vi.mock('../bridge-api', () => ({
  getBridgeApiServer: () => ({
    getApiUrl: () => mockApiUrl,
    issueAuthToken: (_profileId: string, _conversationId: string) => mockAuthToken,
    revokeAuthToken: vi.fn(),
  }),
}))

// Use vi.hoisted() to get a reference to the mock function
const { mockGenerateMcpConfigJson } = vi.hoisted(() => ({
  mockGenerateMcpConfigJson: vi.fn(() => null),
}))

vi.mock('../../mcp/config-file', () => ({
  generateMcpConfigJson: mockGenerateMcpConfigJson,
}))

vi.mock('../../core/logging', () => ({
  writeObservabilityEvent: vi.fn(),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateBridgeConfig', () => {
  const profileId = 'test-profile-1'
  const conversationId = 'test-conv-1'
  const workingDir = '/tmp/test-workdir'

  beforeEach(() => {
    // Reset mock
    mockGenerateMcpConfigJson.mockReturnValue(null)

    // Clean up any existing config files
    const configDir = path.join(homedir(), '.bytro', 'bridge-configs')
    if (fs.existsSync(configDir)) {
      const files = fs.readdirSync(configDir)
      for (const file of files) {
        if (file.startsWith('mcp-config-')) {
          fs.unlinkSync(path.join(configDir, file))
        }
      }
    }
  })

  it('generates BridgeConfig with correct fields', () => {
    const config = generateBridgeConfig(profileId, conversationId, workingDir)

    expect(config.apiUrl).toBe(mockApiUrl)
    expect(config.authToken).toBe(mockAuthToken)
    expect(config.profileId).toBe(profileId)
    expect(config.conversationId).toBe(conversationId)
    expect(config.workingDir).toBe(workingDir)
  })

  it('writes MCP config file with "chat" server definition', () => {
    const config = generateBridgeConfig(profileId, conversationId, workingDir)
    const configPath = getBridgeConfigPath(profileId)

    expect(fs.existsSync(configPath)).toBe(true)

    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)

    // "chat" server must be present
    expect(parsed.mcpServers).toBeDefined()
    expect(parsed.mcpServers[MCP_SERVER_NAME]).toBeDefined()

    const chatServer = parsed.mcpServers[MCP_SERVER_NAME]
    expect(chatServer.command).toBe('node')
    expect(chatServer.args).toContain('--api-url')
    expect(chatServer.args).toContain(mockApiUrl)
    expect(chatServer.args).toContain('--auth-token')
    expect(chatServer.args).toContain(mockAuthToken)
    expect(chatServer.args).toContain('--profile-id')
    expect(chatServer.args).toContain(profileId)
    expect(chatServer.args).toContain('--conversation-id')
    expect(chatServer.args).toContain(conversationId)
    expect(chatServer.args).toContain('--stdio')
  })

  it('config file has mode 0o600 (owner read/write only)', () => {
    generateBridgeConfig(profileId, conversationId, workingDir)
    const configPath = getBridgeConfigPath(profileId)

    const stat = fs.statSync(configPath)
    const fileMode = stat.mode & 0o777
    expect(fileMode).toBe(0o600)
  })

  it('uses process.cwd() as default workingDir', () => {
    const config = generateBridgeConfig(profileId, conversationId)

    expect(config.workingDir).toBe(process.cwd())
  })

  it('merges existing MCP servers with "chat" server', () => {
    // Mock generateMcpConfigJson to return existing servers
    mockGenerateMcpConfigJson.mockReturnValue(JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: {},
        },
      },
    }))

    generateBridgeConfig(profileId, conversationId, workingDir)
    const configPath = getBridgeConfigPath(profileId)
    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)

    // Both servers should be present
    expect(parsed.mcpServers.filesystem).toBeDefined()
    expect(parsed.mcpServers[MCP_SERVER_NAME]).toBeDefined()
  })

  it('overrides user-defined "chat" server with reserved namespace', () => {
    // Mock generateMcpConfigJson to return a conflicting "chat" server
    mockGenerateMcpConfigJson.mockReturnValue(JSON.stringify({
      mcpServers: {
        chat: {
          command: 'npx',
          args: ['-y', 'some-other-chat-server'],
          env: {},
        },
      },
    }))

    generateBridgeConfig(profileId, conversationId, workingDir)
    const configPath = getBridgeConfigPath(profileId)
    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)

    // Our "chat" server should override the user's
    const chatServer = parsed.mcpServers[MCP_SERVER_NAME]
    expect(chatServer.command).toBe('node')
    expect(chatServer.args).toContain('--api-url')
  })
})

describe('cleanupBridgeConfig', () => {
  const profileId = 'cleanup-test-profile'

  it('removes config file for the given profile', () => {
    // First generate a config file
    generateBridgeConfig(profileId, 'conv-1', '/tmp')
    const configPath = getBridgeConfigPath(profileId)
    expect(fs.existsSync(configPath)).toBe(true)

    // Then clean it up
    cleanupBridgeConfig(profileId)
    expect(fs.existsSync(configPath)).toBe(false)
  })

  it('does not throw if config file does not exist', () => {
    const configPath = getBridgeConfigPath('nonexistent-profile')
    expect(fs.existsSync(configPath)).toBe(false)

    // Should not throw
    cleanupBridgeConfig('nonexistent-profile')
  })
})

describe('getBridgeConfigPath', () => {
  it('returns path in ~/.bytro/bridge-configs/', () => {
    const configPath = getBridgeConfigPath('profile-1')

    expect(configPath).toContain('.bytro')
    expect(configPath).toContain('bridge-configs')
    expect(configPath).toContain('mcp-config-profile-1.json')
  })

  it('different profiles get different paths', () => {
    const path1 = getBridgeConfigPath('profile-1')
    const path2 = getBridgeConfigPath('profile-2')

    expect(path1).not.toBe(path2)
  })
})