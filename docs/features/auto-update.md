---
status: design
priority: P1
last_verified: 2026-05-02
doc_kind: feature
---

# Feature: Auto Update

## Why

桌面应用需要自动更新机制，让用户无需手动下载 DMG 安装包。electron-updater 是 Electron 生态的标准方案，支持 macOS/Windows/Linux。

**用户故事**：打开 Bytro 时自动检查更新，有新版本时后台下载，下次启动自动安装。也可以在设置里手动检查更新。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| U1 | 自动检查更新 | 应用启动时检查，静默进行 | P0 |
| U2 | 后台下载 | 不阻塞用户操作 | P0 |
| U3 | 安装提示 | 下载完成后提示用户重启安装 | P0 |
| U4 | 手动检查 | 设置页"检查更新"按钮 | P1 |
| U5 | 更新日志 | 显示新版本 changelog | P1 |
| U6 | 降级/跳过 | 用户可跳过某版本 | P2 |

## How

### 方案

使用 `electron-updater`（`electron-builder` 生态），搭配 GitHub Releases 作为更新源。

### 实现

```typescript
// src/main/updater.ts

import { autoUpdater } from 'electron-updater'

export function setupAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = true       // 自动下载
  autoUpdater.autoInstallOnAppQuit = true // 退出时自动安装

  autoUpdater.on('checking-for-update', () => {
    win.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update:available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    win.webContents.send('update:not-available', info)
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update:download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('update:downloaded', info)
  })

  autoUpdater.on('error', (error) => {
    win.webContents.send('update:error', error.message)
  })

  // 启动后 5 秒检查更新
  setTimeout(() => autoUpdater.checkForUpdates(), 5000)
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates()
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
```

### electron-builder 配置

```json
// package.json (electron-builder 部分)
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "user",
      "repo": "bytro"
    },
    "mac": {
      "target": ["dmg", "zip"],
      "artifactName": "Bytro-${version}-${arch}.${ext}"
    }
  }
}
```

### 代码签名 (macOS)

macOS 上自动更新需要代码签名：

1. Apple Developer Program 注册（$99/年）
2. 生成 Developer ID Application 证书
3. `electron-builder` 配置 `mac.identity` 和 `mac.provisioningProfile`
4. 添加 `notarize: true` 进行公证

**简化方案（开发阶段）**：先做 Sparkle 风格的手动检查 + 提示下载，等真需要发布时再加入代码签名和自动安装。

### UI 交互

```
更新状态            UI 表现
────────           ──────────
检查中            状态栏显示 "检查更新中..."
有可用更新        Toast "发现新版本 v0.2.0，正在下载..."
下载中            状态栏显示下载进度条
下载完成          Toast "更新已就绪，重启 Bytro 以安装"  + [立即重启] [稍后]
已是最新          Toast "已是最新版本"
检查失败          Toast "更新检查失败：<原因>"
```

## Status

✅ **已实现（简化方案）。** 使用 GitHub Releases API 手动检查更新，无需代码签名。

## Code

| 层 | 文件 | 变更 |
|----|------|------|
| 主进程 | `src/main/ipc/update.ts` | **新建** — GitHub Releases API 查询 + `system:checkUpdate` IPC |
| 主进程 | `src/main/ipc/index.ts` | **修改** — 注册 update IPC |
| 主进程 | `src/main/index.ts` | **修改** — 启动后 5s 静默检查 + `update:available` 推送 |
| 预加载 | `src/preload/index.ts` | **修改** — `api.system.checkUpdate()` + `onUpdateAvailable()` |
| 类型 | `src/renderer/src/types/global.d.ts` | **修改** — `UpdateInfo` 接口 + system API 类型 |
| 渲染 | `src/renderer/src/stores/updateStore.ts` | **新建** — 更新状态管理 (zustand) |
| 渲染 | `src/renderer/src/components/workspace/SettingsPanel.tsx` | **修改** — General tab 添加更新检查 UI |
| 根 | `package.json` | 无变更（使用 Node.js 内置 https，无新依赖） |

### 环境变量

- `BYTRO_UPDATE_OWNER` — GitHub 仓库 owner（默认 `bytro`）
- `BYTRO_UPDATE_REPO` — GitHub 仓库名（默认 `bytro`）
