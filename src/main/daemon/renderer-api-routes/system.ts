/**
 * System route handlers for Renderer API.
 */

import type { ServerResponse } from 'http'
import https from 'https'
import { safeOpenExternal } from '../../utils/external'
import { createStandaloneAppPaths } from '../../core/app-paths'
import { getElectronApp } from '../electron-availability'

function electronOnly(res: ServerResponse): void {
  res.writeHead(501, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not available in headless mode' }))
}

// ─── System ──────────────────────────────────────────────────────────────

export async function handleGetVersion(res: ServerResponse): Promise<void> {
  let version: string
  const electronApp = getElectronApp()
  if (electronApp) {
    version = electronApp.getVersion()
  } else {
    version = process.env.npm_package_version ?? '0.0.0'
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, version }))
}

export async function handleShowWindow(res: ServerResponse): Promise<void> {
  electronOnly(res)
}

export async function handleHideWindow(res: ServerResponse): Promise<void> {
  electronOnly(res)
}

export async function handleOpenExternal(body: unknown, res: ServerResponse): Promise<void> {
  const data = body as Record<string, unknown> | null
  const url = data?.url as string | undefined
  if (!url || typeof url !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'url is required' }))
    return
  }

  try {
    await safeOpenExternal(url)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: String(err) }))
  }
}

export async function handleGetPaths(res: ServerResponse): Promise<void> {
  const electronApp = getElectronApp()
  if (electronApp) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      paths: {
        home: electronApp.getPath('home'),
        userData: electronApp.getPath('userData'),
        documents: electronApp.getPath('documents'),
        desktop: electronApp.getPath('desktop'),
        downloads: electronApp.getPath('downloads'),
      },
    }))
    return
  }

  // Headless fallback
  const paths = createStandaloneAppPaths()
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    paths: {
      home: paths.homeDir,
      userData: paths.dataDir,
      documents: paths.documentsDir,
      desktop: paths.desktopDir,
      downloads: paths.downloadsDir,
    },
  }))
}

// ─── Update ─────────────────────────────────────────────────────────────────

interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
}

function getRepoConfig(): { owner: string; repo: string } {
  return {
    owner: process.env.BYTRO_UPDATE_OWNER || 'bytro',
    repo: process.env.BYTRO_UPDATE_REPO || 'bytro'
  }
}

function fetchLatestRelease(): Promise<{
  tagName: string
  htmlUrl: string
  body: string | null
  publishedAt: string
} | null> {
  const { owner, repo } = getRepoConfig()
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`

  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'bytro-app',
          Accept: 'application/vnd.github+json'
        },
        timeout: 10000
      },
      (res) => {
        if (res.statusCode === 404) {
          resolve(null)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          resolve(null)
          return
        }
        let body = ''
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        res.on('end', () => {
          try {
            const release = JSON.parse(body)
            resolve({
              tagName: release.tag_name.replace(/^v/, ''),
              htmlUrl: release.html_url,
              body: release.body || null,
              publishedAt: release.published_at
            })
          } catch {
            resolve(null)
          }
        })
      }
    )

    req.on('error', () => {
      req.destroy()
      resolve(null)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

export async function handleCheckUpdate(res: ServerResponse): Promise<void> {
  const electronApp = getElectronApp()
  const currentVersion = electronApp ? electronApp.getVersion() : (process.env.npm_package_version ?? '0.0.0')
  const release = await fetchLatestRelease()

  if (!release) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null
    }))
    return
  }

  const hasUpdate = release.tagName !== currentVersion

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    hasUpdate,
    currentVersion,
    latestVersion: release.tagName,
    releaseUrl: release.htmlUrl,
    releaseNotes: release.body,
    publishedAt: release.publishedAt
  }))
}
