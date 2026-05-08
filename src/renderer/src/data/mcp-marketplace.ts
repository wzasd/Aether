export interface McpServerTemplate {
  name: string
  description: string
  category: string
  command: string
  args: string[]
  env: Record<string, string>
  homepage?: string
}

const FALLBACK_SERVERS: McpServerTemplate[] = [
  {
    name: 'filesystem',
    description: 'File system access and manipulation',
    category: 'Files',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
  },
  {
    name: 'github',
    description: 'GitHub API integration — manage repos, issues, PRs',
    category: 'Developer Tools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<your-token>' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
  },
  {
    name: 'postgres',
    description: 'PostgreSQL database query and schema exploration',
    category: 'Database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@localhost:5432/db'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres'
  },
  {
    name: 'sqlite',
    description: 'SQLite database query and exploration',
    category: 'Database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '/path/to/database.db'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite'
  },
  {
    name: 'brave-search',
    description: 'Web search via Brave Search API',
    category: 'Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '<your-api-key>' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search'
  },
  {
    name: 'memory',
    description: 'Persistent memory and knowledge graph for AI',
    category: 'Memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'
  },
  {
    name: 'puppeteer',
    description: 'Browser automation — screenshots, scraping, web testing',
    category: 'Browser',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer'
  },
  {
    name: 'fetch',
    description: 'HTTP fetch tool — make web requests',
    category: 'Network',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch'
  },
  {
    name: 'google-maps',
    description: 'Google Maps geocoding, directions, places search',
    category: 'Location',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-maps'],
    env: { GOOGLE_MAPS_API_KEY: '<your-api-key>' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps'
  },
  {
    name: 'slack',
    description: 'Slack workspace integration — channels, messages, users',
    category: 'Communication',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '<your-bot-token>' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack'
  },
  {
    name: 'everart',
    description: 'AI image generation via EverArt API',
    category: 'AI / Media',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everart'],
    env: { EVERART_API_KEY: '<your-api-key>' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everart'
  },
  {
    name: 'sequential-thinking',
    description: 'Structured sequential reasoning for complex problems',
    category: 'Reasoning',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking'
  },
  {
    name: 'git',
    description: 'Direct Git repository operations',
    category: 'Developer Tools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git', '/path/to/repo'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git'
  },
  {
    name: 'docker',
    description: 'Docker container management',
    category: 'DevOps',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-docker'],
    env: {},
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/docker'
  },
  {
    name: 'redis',
    description: 'Redis cache and data structure server',
    category: 'Database',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-redis'],
    env: { REDIS_URL: 'redis://localhost:6379' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/redis'
  }
]

// ─── Marketplace fetch ──────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

let cachedServers: McpServerTemplate[] | null = null
let cacheTimestamp = 0

async function fetchNpmRegistry(url: string): Promise<McpServerTemplate[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const data = await res.json()
  const objects = data?.objects as Array<{ package: { name: string; description?: string; links?: { homepage?: string; npm?: string } } }> | undefined
  if (!objects || objects.length === 0) return []
  return objects.map((o) => ({
    name: o.package.name.replace(/^@.+\//, '').replace(/^server-/, ''),
    description: o.package.description || 'MCP server',
    category: 'Community',
    command: 'npx',
    args: ['-y', o.package.name],
    env: {},
    homepage: o.package.links?.homepage || o.package.links?.npm
  }))
}

async function fetchGenericRegistry(url: string): Promise<McpServerTemplate[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const data = await res.json()
  if (Array.isArray(data?.servers)) return data.servers as McpServerTemplate[]
  return []
}

async function fetchOneUrl(url: string): Promise<McpServerTemplate[]> {
  if (url.includes('registry.npmjs.org')) {
    return fetchNpmRegistry(url)
  }
  return fetchGenericRegistry(url)
}

export async function fetchMarketplace(): Promise<McpServerTemplate[]> {
  // Load URLs from preferences (via window.api)
  let urls: string[] = []
  try {
    urls = await window.api.mcp.getMarketplaceUrls()
  } catch {
    urls = []
  }

  // Check cache — invalidate if URLs changed
  const cacheKey = urls.join('|')
  if (cachedServers && Date.now() - cacheTimestamp < CACHE_TTL_MS) return cachedServers

  // Fetch all URLs in parallel
  const results = await Promise.allSettled(urls.map(fetchOneUrl))
  const merged = new Map<string, McpServerTemplate>()

  // Priority: first URL wins for same-name servers
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const s of r.value) {
        if (!merged.has(s.name)) merged.set(s.name, s)
      }
    }
  }

  const fetched = Array.from(merged.values())
  if (fetched.length > 0) {
    cachedServers = fetched
    cacheTimestamp = Date.now()
    return cachedServers
  }

  cachedServers = FALLBACK_SERVERS
  cacheTimestamp = Date.now()
  return cachedServers
}

export function getFallbackServers(): McpServerTemplate[] {
  return FALLBACK_SERVERS
}
