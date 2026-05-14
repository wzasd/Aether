/**
 * Bridge Config Generator — generates MCP config files with "chat" server
 * definition for the chat-bridge sidecar.
 *
 * Daemon generates the config (including auth token + API URL),
 * writes it to a temporary file, and passes the file path to the provider.
 * Provider's buildMcpArgs() injects --mcp-config-file pointing to this config.
 * MCP SDK then auto-spawns the bridge sidecar as a child process.
 *
 * ADR-015: Chat Bridge MCP Sidecar
 */

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { getBridgeApiServer } from './bridge-api'
import type { BridgeConfig } from '../chat-bridge/types'
import { MCP_SERVER_NAME } from '../chat-bridge/types'
import { generateMcpConfigJson } from '../mcp/config-file'
import { writeObservabilityEvent } from '../core/logging'

// ─── Config Path ─────────────────────────────────────────────────────────────

function getBridgeConfigDir(): string {
  const bytroDir = path.join(homedir(), '.bytro')
  if (!fs.existsSync(bytroDir)) {
    fs.mkdirSync(bytroDir, { recursive: true, mode: 0o700 })
  }
  const bridgeDir = path.join(bytroDir, 'bridge-configs')
  if (!fs.existsSync(bridgeDir)) {
    fs.mkdirSync(bridgeDir, { recursive: true, mode: 0o700 })
  }
  return bridgeDir
}

// ─── Bridge Config Generation ─────────────────────────────────────────────────

/**
 * Generate a BridgeConfig for a specific agent profile + conversation.
 *
 * This function:
 * 1. Issues an auth token from the BridgeApiServer
 * 2. Generates MCP config JSON with the "chat" server definition
 * 3. Writes it to a per-agent temporary file (mode 0o600)
 * 4. Returns the BridgeConfig for injection into SessionConfig
 *
 * The "chat" server definition tells MCP SDK to spawn the bridge sidecar:
 * - command: "node" (or the configured bridge binary)
 * - args: ["bytro-chat-bridge.js", "--api-url", ..., "--auth-token", ..., "--stdio"]
 * - env: any extra env vars
 */
export function generateBridgeConfig(
  profileId: string,
  conversationId: string,
  workingDir?: string
): BridgeConfig {
  const bridgeApi = getBridgeApiServer()
  const apiUrl = bridgeApi.getApiUrl()

  if (!apiUrl) {
    throw new Error('Bridge API server not started — call bridgeApi.start() first')
  }

  const authToken = bridgeApi.issueAuthToken(profileId, conversationId)

  // Generate MCP config with "chat" server definition
  // Layer 1: existing user-defined MCP servers (from DB + project)
  // Layer 2: "chat" server (reserved namespace, written last to override)
  const existingConfig = generateMcpConfigJson(workingDir)

  const chatServerDef = {
    command: 'node',
    args: [
      // The bridge entry point — will be resolved to the installed path
      // In production, this should point to the compiled bytro-chat-bridge.js
      getBridgeEntryPath(),
      '--api-url', apiUrl,
      '--auth-token', authToken,
      '--profile-id', profileId,
      '--conversation-id', conversationId,
      '--stdio',
    ],
    env: {},
  }

  // Merge existing servers with "chat" server (chat written last to override)
  const mergedServers: Record<string, unknown> = {}

  if (existingConfig) {
    try {
      const parsed = JSON.parse(existingConfig) as { mcpServers: Record<string, unknown> }
      // Check for "chat" namespace conflict — reject user-defined "chat" server
      if (parsed.mcpServers && parsed.mcpServers[MCP_SERVER_NAME]) {
        writeObservabilityEvent('bridge_config:namespace_conflict', {
          profileId,
          conversationId,
          existingChatServer: true,
        })
        // Remove user's "chat" definition — our reserved namespace takes priority
        delete parsed.mcpServers[MCP_SERVER_NAME]
      }
      Object.assign(mergedServers, parsed.mcpServers)
    } catch {
      // Corrupt existing config — skip it
    }
  }

  // "chat" server always written last (overrides any stale definition)
  mergedServers[MCP_SERVER_NAME] = chatServerDef

  const configJson = JSON.stringify({ mcpServers: mergedServers }, null, 2)

  // Write to per-agent config file
  const configPath = writeBridgeConfigFile(profileId, configJson)

  writeObservabilityEvent('bridge_config:generated', {
    profileId,
    conversationId,
    apiUrl,
    configPath,
  })

  return {
    apiUrl,
    authToken,
    profileId,
    conversationId,
    workingDir: workingDir || process.cwd(),
  }
}

/**
 * Clean up bridge config files for a specific agent profile.
 * Called when agent runtime is disposed.
 */
export function cleanupBridgeConfig(profileId: string): void {
  const configDir = getBridgeConfigDir()
  const configPath = path.join(configDir, `mcp-config-${profileId}.json`)

  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath)
      writeObservabilityEvent('bridge_config:cleaned_up', { profileId })
    } catch {
      // Best effort cleanup — don't block on file deletion
    }
  }

  // Revoke the auth token
  const bridgeApi = getBridgeApiServer()
  // Note: we don't have the token here, but BridgeApiServer.revokeAuthToken
  // needs it. We'll need to track tokens per profile for cleanup.
  // For now, tokens are cleaned up when BridgeApiServer is stopped.
}

/**
 * Get the path to the bridge config file for a specific agent profile.
 * This path is passed to buildMcpArgs() as --mcp-config-file.
 */
export function getBridgeConfigPath(profileId: string): string {
  const configDir = getBridgeConfigDir()
  return path.join(configDir, `mcp-config-${profileId}.json`)
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function writeBridgeConfigFile(profileId: string, configJson: string): string {
  const configDir = getBridgeConfigDir()
  const configPath = path.join(configDir, `mcp-config-${profileId}.json`)
  fs.writeFileSync(configPath, configJson, { encoding: 'utf-8', mode: 0o600 })
  return configPath
}

function getBridgeEntryPath(): string {
  // In development: point to the source TypeScript file
  // In production: point to the compiled JavaScript file in dist/
  // This will be resolved based on the app's installation path
  // For now, use a placeholder that will be replaced during build
  const isDev = !process.env.BYTRO_PROD

  if (isDev) {
    // Development: use tsx to run the TypeScript entry point directly
    return path.join(
      path.dirname(require.main?.filename || __dirname),
      '..',
      'chat-bridge',
      'index.ts'
    )
  }

  // Production: use the compiled JS file
  return path.join(
    path.dirname(require.main?.filename || __dirname),
    'chat-bridge',
    'index.js'
  )
}