/**
 * Team route handlers for Renderer API.
 */

import type { ServerResponse } from 'http'
import { loadTeams, getTeam, createTeam, updateTeam, deleteTeam } from '../../ai/team-config'

export async function handleListTeams(res: ServerResponse): Promise<void> {
  const teams = loadTeams()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, teams }))
}

export async function handleGetTeam(id: string, res: ServerResponse): Promise<void> {
  const team = getTeam(id)
  if (!team) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Team not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, team }))
}

export async function handleCreateTeam(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  if (!data?.name || typeof data.name !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'name is required' }))
    return
  }

  const team = createTeam({
    name: data.name,
    description: data.description as string | undefined,
    members: data.members as Array<{ profileId: string; providerOverride?: string; modelOverride?: string }> | undefined,
    policies: data.policies as Record<string, unknown> | undefined,
    workspaceId: data.workspaceId as string | undefined,
  })

  res.writeHead(201, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, team }))
}

export async function handleUpdateTeam(id: string, body: unknown, res: ServerResponse): Promise<void> {
  const patch = body as Record<string, unknown> | null
  if (!patch) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Request body is required' }))
    return
  }

  const team = updateTeam(id, {
    name: patch.name as string | undefined,
    description: patch.description as string | undefined,
    members: patch.members as Array<{ profileId: string; providerOverride?: string; modelOverride?: string }> | undefined,
    policies: patch.policies as Record<string, unknown> | undefined,
  })

  if (!team) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Team not found' }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, team }))
}

export async function handleDeleteTeam(id: string, res: ServerResponse): Promise<void> {
  const deleted = deleteTeam(id)
  if (!deleted) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Team not found' }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}
