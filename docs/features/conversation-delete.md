---
status: implemented
priority: P1
last_verified: 2026-05-06
doc_kind: feature
---

# Feature: Conversation Soft Delete（会话软删除）

## Why

当前 `conversation:delete` 是硬删除，级联清除 `messages`、`file_changes`、`conversation_usage` 等所有关联数据。这带来两个问题：

1. **误删不可恢复** — 会话历史和工具调用日志消失，无法找回。
2. **费用统计断层** — `conversation_usage` 被 `ON DELETE CASCADE` 一并删除，`usage_daily` 聚合视图出现历史空洞。

**用户故事**：我右键 TaskRail 里一个会话，点击"删除" → 会话从列表消失，但数据在后台保留 30 天，期间费用统计仍然完整。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| D1 | 软删除 | 删除 = 写 `deleted_at`，数据不丢失 | P0 |
| D2 | 列表过滤 | 所有 `conversation:list` 查询默认排除 `deleted_at IS NOT NULL` | P0 |
| D3 | 确认对话框更新 | 删除确认文案更新为"会话将从列表移除，数据保留 30 天后自动清除" | P1 |
| D4 | TTL 自动清理 | 应用启动时清除 `deleted_at` 超过 30 天的行（含级联子表） | P1 |
| D5 | 批量删除（Shift 选中） | 键盘 Shift+Delete 批量软删除，后续迭代实现 | P2 |

## How

### 数据层变更（Schema Migration v16）

```sql
-- conversations 表新增列
ALTER TABLE conversations ADD COLUMN deleted_at INTEGER DEFAULT NULL;

-- 加索引（list 查询的 WHERE 条件）
CREATE INDEX IF NOT EXISTS idx_conv_deleted ON conversations(deleted_at);
```

**不新增 `is_archived` 列**：归档是独立的功能诉求，现阶段 YAGNI。`deleted_at` 既是软删除标记，也是 TTL 计算基准，一列两用，语义清晰。

### IPC 层变更

#### `conversation:delete` — 改为软删除

```ts
// 旧：物理删除
db.prepare('DELETE FROM conversations WHERE id = ?').run(id)

// 新：写 deleted_at
db.prepare(
  'UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?'
).run(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), id)
```

#### `conversation:list` — 所有查询加过滤

所有 5 个查询变体统一追加 `AND deleted_at IS NULL`：

```ts
// 示例（带 workspaceId）
db.prepare(
  'SELECT * FROM conversations WHERE workspace_id = ? AND is_draft = 0 AND deleted_at IS NULL ORDER BY updated_at DESC'
).all(workspaceId)
```

#### `conversation:purgeExpired`（新增）

应用启动时由 `initDatabase()` 调用，清理 TTL 过期行：

```ts
db.prepare(
  'DELETE FROM conversations WHERE deleted_at IS NOT NULL AND deleted_at < ?'
).run(Math.floor(Date.now() / 1000) - 30 * 24 * 3600)
```

级联清除通过已有的 `ON DELETE CASCADE` 约束自动完成，无需额外 SQL。

### Store 层变更

`chatStore.deleteConversation` 逻辑不变，IPC 层已透明处理。

### TTL 清理时机

- 不做后台定时器，避免在对话进行中执行 DELETE。
- 在 `initDatabase()` 末尾调用一次 `purgeExpired()`，每次应用冷启动触发。
- SQLite 的 `VACUUM` 由 WAL checkpoint 自动处理，不需手动调用。

---

## UI 变更

### DeleteConfirmDialog 文案更新

```
旧：此操作不可撤销。
新：会话将从列表中移除，数据保留 30 天后自动清除。
```

### Sidebar 会话行 — 删除按钮不变

位置、样式、触发方式与现有实现一致（group-hover 显示 `Trash2` 图标）。  
无需新增"回收站"入口或归档 UI — YAGNI，等有明确诉求再加。

### TaskRail 右键菜单 — 删除项文案更新

```
旧：删除（红色，立即执行）
新：删除（红色，弹确认框）
```

确认框统一使用更新后的 `DeleteConfirmDialog`。

---

## 状态覆盖

| 状态 | 行为 |
|------|------|
| 删除进行中 | 按钮不 debounce，IPC 是同步 SQLite write，<1ms 完成 |
| 删除后当前会话被删 | `navigate('/')` 同现有逻辑 |
| TTL 到期清理时 | 应用重启时静默清理，不通知用户 |

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/main/core/db.ts` | 修改 | Migration v16：加列、加索引；`initDatabase()` 末尾调用 `purgeExpired()` |
| `src/main/ipc/conversation.ts` | 修改 | `conversation:delete` 改软删除；所有 `list` 查询加 `AND deleted_at IS NULL`；新增 `purgeExpired` 内部函数 |
| `src/renderer/src/components/ConversationDeleteConfirm.tsx` | 修改 | 更新确认文案 |
| `src/renderer/src/components/workspace/TaskRail.tsx` | 修改 | 键盘 Delete/Backspace 路径：`window.confirm` → 统一使用 `DeleteConfirmDialog`（P1，可后续迭代） |

**不需要改动的文件**：
- `chatStore.ts` — `deleteConversation` 调用 IPC，IPC 透明，无需修改
- `preload/index.ts` — `conversation.delete` 签名不变
- `global.d.ts` — `Conversation` 接口暂不暴露 `deleted_at`（内部实现细节）

---

## 验证标准

- [ ] 删除会话后，侧边栏和 TaskRail 列表中不再显示该会话
- [ ] 删除后 `conversation_usage` 数据仍保留在 DB（`usage_daily` 视图数字不变）
- [ ] 应用重启后，已删除会话仍不出现在列表
- [ ] 30 天后（或将 TTL 改为 60s 手动测试）重启应用，过期会话及其子表数据被清除
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm test` 通过（无新增失败）
