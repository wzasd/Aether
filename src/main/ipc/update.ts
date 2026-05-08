import { ipcMain, app } from 'electron'
import https from 'https'

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

  return new Promise((resolve, reject) => {
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

export function registerUpdateIpc(): void {
  ipcMain.handle('system:checkUpdate', async (): Promise<UpdateInfo> => {
    const currentVersion = app.getVersion()
    const release = await fetchLatestRelease()

    if (!release) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: null,
        releaseUrl: null,
        releaseNotes: null,
        publishedAt: null
      }
    }

    const hasUpdate = release.tagName !== currentVersion

    return {
      hasUpdate,
      currentVersion,
      latestVersion: release.tagName,
      releaseUrl: release.htmlUrl,
      releaseNotes: release.body,
      publishedAt: release.publishedAt
    }
  })
}

export async function checkForUpdatesSilent(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  const release = await fetchLatestRelease()

  if (!release) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null
    }
  }

  const hasUpdate = release.tagName !== currentVersion

  return {
    hasUpdate,
    currentVersion,
    latestVersion: release.tagName,
    releaseUrl: release.htmlUrl,
    releaseNotes: release.body,
    publishedAt: release.publishedAt
  }
}
