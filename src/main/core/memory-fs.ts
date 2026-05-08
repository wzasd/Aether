import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'path'

const BYTRO_DIR = '.bytro'

function bytroDir(workspacePath: string): string {
  return join(workspacePath, BYTRO_DIR)
}

function agentsDir(workspacePath: string): string {
  return join(bytroDir(workspacePath), 'agents')
}

function markersDir(workspacePath: string): string {
  return join(bytroDir(workspacePath), 'markers')
}

export async function ensureBytroDir(workspacePath: string): Promise<void> {
  await mkdir(bytroDir(workspacePath), { recursive: true })
  await mkdir(agentsDir(workspacePath), { recursive: true })
  await mkdir(markersDir(workspacePath), { recursive: true })
}

function assertSafeAgentId(agentId: string): void {
  if (!agentId || basename(agentId) !== agentId || !/^[A-Za-z0-9_.-]+$/.test(agentId)) {
    throw new Error('Invalid agent id')
  }
}

function assertInside(parent: string, child: string): void {
  const resolvedParent = resolve(parent)
  const resolvedChild = resolve(child)
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(`${resolvedParent}/`)) {
    throw new Error('Invalid memory path')
  }
}

export async function readProjectMemory(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(join(bytroDir(workspacePath), 'project-memory.md'), 'utf-8')
  } catch {
    return null
  }
}

export async function writeProjectMemory(workspacePath: string, content: string): Promise<void> {
  await ensureBytroDir(workspacePath)
  await writeFile(join(bytroDir(workspacePath), 'project-memory.md'), content, 'utf-8')
}

export async function appendProjectMemory(workspacePath: string, section: string, entry: string): Promise<void> {
  const existing = await readProjectMemory(workspacePath) || ''
  const sectionHeader = `## ${section}`
  // Match section header only at line start to avoid corrupting entry content
  const sectionRegex = new RegExp(`^## ${escapeRegex(section)}`, 'm')
  const hasSection = sectionRegex.test(existing)
  const updated = hasSection
    ? existing.replace(sectionRegex, `${sectionHeader}\n${entry}`)
    : `${existing}\n\n${sectionHeader}\n${entry}\n`
  await writeProjectMemory(workspacePath, updated.trim() + '\n')
}

export async function removeProjectMemoryEntry(workspacePath: string, item: { kind: string; title: string; content?: string | null; id?: string }): Promise<boolean> {
  const existing = await readProjectMemory(workspacePath)
  if (!existing) return false

  const sectionPattern = escapeRegex(item.kind)
  const sectionRegex = new RegExp(`((?:^|\\n)## ${sectionPattern}\\n[\\s\\S]*?)(?=\\n## |$)`)
  const sectionMatch = existing.match(sectionRegex)
  if (!sectionMatch) return false

  const section = sectionMatch[1]
  const titlePattern = escapeRegex(item.title)
  const entryRegex = new RegExp(`((?:^|\\n)### ${titlePattern}\\n[\\s\\S]*?)(?=\\n### |\\n## |$)`)
  const match = section.match(entryRegex)
  if (!match) return false

  const entry = match[1]
  const expectedContent = item.content?.trim()
  if (expectedContent && !entry.includes(expectedContent)) {
    return false
  }

  const updatedSection = section.replace(entryRegex, '').replace(/\n{3,}/g, '\n\n')
  const updated = existing.replace(sectionRegex, updatedSection).replace(/\n{3,}/g, '\n\n').trim()
  await writeProjectMemory(workspacePath, updated ? `${updated}\n` : '')
  return true
}

export async function appendProjectMemoryDeletion(workspacePath: string, item: { id: string; kind: string; title: string }): Promise<void> {
  const entry = [
    `### ${item.title}`,
    '',
    `Status: deleted`,
    `Kind: ${item.kind}`,
    `ProjectMemoryItem: ${item.id}`,
    `Deleted At: ${new Date().toISOString()}`,
    ''
  ].join('\n')
  await appendProjectMemory(workspacePath, 'Deletions', entry)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function readAgentMemory(workspacePath: string, agentId: string): Promise<string | null> {
  assertSafeAgentId(agentId)
  try {
    const dir = agentsDir(workspacePath)
    const target = join(dir, `${agentId}.md`)
    assertInside(dir, target)
    return await readFile(target, 'utf-8')
  } catch {
    return null
  }
}

export async function writeAgentMemory(workspacePath: string, agentId: string, content: string): Promise<void> {
  assertSafeAgentId(agentId)
  await ensureBytroDir(workspacePath)
  const dir = agentsDir(workspacePath)
  const target = join(dir, `${agentId}.md`)
  assertInside(dir, target)
  await writeFile(target, content, 'utf-8')
}

export async function listMarkers(workspacePath: string): Promise<string[]> {
  try {
    const files = await readdir(markersDir(workspacePath))
    return files.filter((f) => f.endsWith('.yaml'))
  } catch {
    return []
  }
}

function assertSafeMarkerName(name: string): void {
  if (!name || basename(name) !== name || !/^[A-Za-z0-9_.-]+\.yaml$/.test(name)) {
    throw new Error('Invalid marker filename')
  }
}

export async function readMarker(workspacePath: string, filename: string): Promise<string | null> {
  assertSafeMarkerName(filename)
  try {
    const dir = markersDir(workspacePath)
    const target = join(dir, filename)
    assertInside(dir, target)
    return await readFile(target, 'utf-8')
  } catch {
    return null
  }
}

export async function writeMarker(workspacePath: string, filename: string, content: string): Promise<void> {
  assertSafeMarkerName(filename)
  await ensureBytroDir(workspacePath)
  const dir = markersDir(workspacePath)
  const target = join(dir, filename)
  assertInside(dir, target)
  await writeFile(target, content, 'utf-8')
}

export async function computeFileHash(filePath: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
