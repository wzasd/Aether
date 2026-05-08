---
status: design
priority: P1
last_verified: 2026-05-02
doc_kind: feature
---

# Feature: Credential Encryption

## Why

多模型支持后，用户需要输入多个 API Key（Anthropic、OpenAI、Google、Moonshot 等）。这些 Key 不能明文存储在 SQLite 中。需要利用操作系统原生安全机制加密存储。

**用户故事**：在设置页输入 API Key 后，Key 被加密存储。即使数据库文件泄露，Key 也无法被直接读取。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| C1 | API Key 加密存储 | 使用 Electron safeStorage 加密后存入 SQLite | P0 |
| C2 | API Key 脱敏显示 | 设置页只显示 Key 的前 4 后 4 位，中间用 `****` 代替 | P0 |
| C3 | 连接测试 | 输入 Key 后可测试连接是否有效 | P1 |
| C4 | Key 轮换提醒 | 可选：Key 设置 90 天过期提醒 | P2 |
| C5 | Key 状态指示 | 设置页显示各 provider Key 是否已配置/是否有效 | P1 |

## How

### safeStorage API

Electron 的 `safeStorage` 使用操作系统原生加密：

| 平台 | 加密后端 |
|------|---------|
| macOS | Keychain Services |
| Windows | DPAPI (Data Protection API) |
| Linux | libsecret (GNOME Keyring / KDE Wallet) |

```typescript
// src/main/core/secrets.ts

import { safeStorage } from 'electron'
import { getDb } from './db'

const Secrets = {
  /** 存储加密后的 API Key */
  set(providerId: string, apiKey: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统不支持加密存储，请检查操作系统密钥链是否可用')
    }
    const encrypted = safeStorage.encryptString(apiKey)
    const db = getDb()
    db.prepare(`
      INSERT INTO secrets (id, provider_id, encrypted_value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = excluded.updated_at
    `).run(`cred:${providerId}`, providerId, encrypted.toString('base64'))
  },

  /** 获取解密后的 API Key */
  get(providerId: string): string | null {
    if (!safeStorage.isEncryptionAvailable()) return null
    const db = getDb()
    const row = db.prepare(
      `SELECT encrypted_value FROM secrets WHERE provider_id = ?`
    ).get(providerId) as { encrypted_value: string } | undefined
    if (!row) return null
    try {
      return safeStorage.decryptString(Buffer.from(row.encrypted_value, 'base64'))
    } catch {
      return null
    }
  },

  /** 删除 API Key */
  delete(providerId: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM secrets WHERE provider_id = ?`).run(providerId)
  },

  /** 检查是否有已存储的 Key */
  has(providerId: string): boolean {
    const db = getDb()
    const row = db.prepare(
      `SELECT 1 FROM secrets WHERE provider_id = ?`
    ).get(providerId)
    return !!row
  }
}
```

### DB Schema

```sql
-- secrets 表（独立于 adapter_configs，更小粒度的权限隔离）
CREATE TABLE IF NOT EXISTS secrets (
  id              TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 启动时注入

Provider 启动 CLI 时从 Secrets 读取 Key 并注入环境变量：

```typescript
// provider 初始化时
async initialize(config: ProviderConfig): Promise<void> {
  const apiKey = config.apiKey || Secrets.get(this.meta.id)
  if (!apiKey) throw new Error(`${this.meta.name}: API Key 未配置`)

  // 注入环境变量，不写磁盘
  process.env[this.getEnvVarName()] = apiKey
}
```

### 安全边界

- API Key 仅在内存中存在，从不写入明文日志或文件
- 启动 CLI 时通过 `env` 参数传入（`spawn('claude', args, { env })`），不通过 shell 传递
- 设置页显示脱敏后的 Key（如 `sk-a***b123`）
- 错误日志中自动过滤 Key 模式（正则匹配 `sk-`/`AIza` 等前缀）

## Status

📋 **设计阶段。** 需在 multi-model provider 实现前完成，因为 provider 初始化依赖凭证读取。

## Code

| 层 | 文件 | 变更 |
|----|------|------|
| 主进程 | `src/main/core/secrets.ts` | **新建** |
| 主进程 | `src/main/core/db.ts` | **修改** — 增加 secrets 表 |
| 主进程 | `src/main/ipc/system.ts` | **修改** — 增加 credential IPC |
| 预加载 | `src/preload/index.ts` | **修改** — `api.system.setCredential()` 等 |
