import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'path'

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
  const hasSection = existing.includes(`## ${section}`)
  const updated = hasSection
    ? existing.replace(`## ${section}`, `## ${section}\n${entry}`)
    : `${existing}\n\n## ${section}\n${entry}\n`
  await writeProjectMemory(workspacePath, updated.trim() + '\n')
}

export async function readAgentMemory(workspacePath: string, agentId: string): Promise<string | null> {
  try {
    return await readFile(join(agentsDir(workspacePath), `${agentId}.md`), 'utf-8')
  } catch {
    return null
  }
}

export async function writeAgentMemory(workspacePath: string, agentId: string, content: string): Promise<void> {
  await ensureBytroDir(workspacePath)
  await writeFile(join(agentsDir(workspacePath), `${agentId}.md`), content, 'utf-8')
}

export async function listMarkers(workspacePath: string): Promise<string[]> {
  try {
    const files = await readdir(markersDir(workspacePath))
    return files.filter((f) => f.endsWith('.yaml'))
  } catch {
    return []
  }
}

export async function readMarker(workspacePath: string, filename: string): Promise<string | null> {
  try {
    return await readFile(join(markersDir(workspacePath), filename), 'utf-8')
  } catch {
    return null
  }
}

export async function writeMarker(workspacePath: string, filename: string, content: string): Promise<void> {
  await ensureBytroDir(workspacePath)
  await writeFile(join(markersDir(workspacePath), filename), content, 'utf-8')
}

export async function computeFileHash(filePath: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
