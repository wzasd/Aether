---
status: closed
owner: mochi
last_updated: 2026-05-05
doc_kind: code-review
---

# Token/Cost Tracking Phase I Code Review

Review scope:

- `src/main/ai/pricing.ts` — 模型定价表 + `estimateCost()` 函数
- `src/main/core/db.ts` — SCHEMA_VERSION 11→13，v12 迁移(mcp_servers) + v13 迁移(provider_id + usage_daily view)
- `src/main/ipc/conversation.ts` — `usage:create` 自动计算成本、`usage:summary` / `usage:totalCost` IPC
- `src/preload/index.ts` — 暴露 `usage.summary` / `usage.totalCost`
- `src/renderer/src/types/global.d.ts` — `UsageSummaryRow` 类型
- `src/renderer/src/components/UsageBar.tsx` — 增强显示：缓存命中 + 费用
- `src/renderer/src/stores/chatStore.ts` — `usage:create` 传递真实 model/provider_id
- `src/renderer/src/stores/usageStore.ts` — 前端 usage 状态管理
- `src/renderer/src/components/workspace/WorkspaceArea.tsx` — Settings > Usage tab (月度汇总卡片/模型分布/日趋势图)

Verification:

- `pnpm run typecheck` passed
- `pnpm run build` passed
- `pnpm test` 127 passed (3 skipped, 1 pre-existing failure)

## 1st-pass findings — resolution status

| # | Finding | Status |
|---|---------|--------|
| P1 #1 | `usage:create` IPC 缺少输入校验 | ✅ Fixed — L224-235 完整校验 conversation_id/model/input_tokens/output_tokens |
| P1 #2 | `usage:summary` / `usage:totalCost` 缺少 range 校验 | ✅ Fixed — L33-44 `validateRange()` 辅助函数 |
| P1 #3 | `usageStore.loadFromDB` model 聚合 bug | ✅ Fixed — L47-56 dominant model（token 总量最大） |
| P2 #4 | `estimateCost()` 缺少缓存 token 定价 | ✅ Fixed — PRICING 表增加 cacheRead/cacheCreation，estimateCost 签名扩展 |
| P2 #5 | PRICING 模型 key 不匹配风险 | ✅ Fixed — `lookupPricing()` 先精确匹配再前缀匹配 |
| P2 #6 | SettingsUsage cache savings 硬编码 $1.25/MTok | ✅ Fixed — 已移除硬编码近似值 |
| P2 #7 | SettingsUsage 无刷新机制 | ✅ Fixed — Refresh 按钮 + `loadData()` 提取 |
| P2 #8 | UsageBar 不显示 cache_creation_tokens | ✅ Fixed — 分离显示 `缓存命中`(绿) + `缓存写入`(琥珀) |
| P3 #9 | v12 迁移与 createTables() 中 mcp_servers DDL 重复 | ✅ Fixed — createTables 中已移除 mcp_servers |
| P3 #10 | usage_daily view 缺少复合索引 | ✅ Fixed — `idx_usage_day_model` 索引 |
| P3 #11 | UsageRecord 类型在两处重复定义 | Won't Fix — DB row (snake_case) vs app model (camelCase) 有意分离 |
| P3 #12 | chatStore `usage:create` model 来源可能不准确 | Won't Fix — complete event 不含 model 字段，best-effort 可接受 |

1st pass: 10/12 fixed, 2 Won't Fix.

2nd pass: 3/3 fixed.

## 2nd-pass findings

### [P2] #13 `usage:create` — `cache_read_tokens` / `cache_creation_tokens` / `provider_id` 未校验

File:

- `src/main/ipc/conversation.ts` L223-244

1st pass 修复了 `conversation_id`、`model`、`input_tokens`、`output_tokens` 的校验，但可选字段 `cache_read_tokens`、`cache_creation_tokens`、`provider_id` 仍然未校验。如果 renderer 传入 `cache_read_tokens: "100"` (字符串) 或 `provider_id: 123` (数字)，`?? 0` / `?? null` 不会捕获类型错误，导致 DB 中写入错误类型。

虽然 `better-sqlite3` 对类型不匹配会抛出运行时错误（SQLite 的弱类型系统可能不会），但这违反了项目 "IPC 必须校验 payload" 的硬规则。

Recommended fix:

```ts
if (data.cache_read_tokens !== undefined && (typeof data.cache_read_tokens !== 'number' || data.cache_read_tokens < 0 || !Number.isFinite(data.cache_read_tokens))) {
  throw new Error('Invalid payload: cache_read_tokens must be a non-negative number')
}
if (data.cache_creation_tokens !== undefined && (typeof data.cache_creation_tokens !== 'number' || data.cache_creation_tokens < 0 || !Number.isFinite(data.cache_creation_tokens))) {
  throw new Error('Invalid payload: cache_creation_tokens must be a non-negative number')
}
if (data.provider_id !== undefined && typeof data.provider_id !== 'string') {
  throw new Error('Invalid payload: provider_id must be a string')
}
```

Status: **✅ Fixed** — 添加了 `cache_read_tokens`、`cache_creation_tokens`、`provider_id`、`cost_usd` 的运行时校验。

### [P3] #14 `pricing.ts` — `lookupPricing` 前缀匹配存在歧义风险

File:

- `src/main/ai/pricing.ts` L23-30

```ts
for (const key of Object.keys(PRICING)) {
  if (model.startsWith(key)) return PRICING[key]
}
```

前缀匹配按 `Object.keys()` 插入顺序遍历，返回第一个匹配。如果未来添加了 `o3-mini`，而 `o3` 在表中先出现，那么 `o3-mini-latest` 会错误匹配到 `o3` 的定价。当前表中没有这种前缀冲突，但设计上存在隐患。

Recommended fix:

改为最长前缀匹配（找最长的匹配 key）：

```ts
let bestKey = ''
for (const key of Object.keys(PRICING)) {
  if (model.startsWith(key) && key.length > bestKey.length) bestKey = key
}
return bestKey ? PRICING[bestKey] : null
```

Status: **✅ Fixed** — 改为最长前缀匹配（`key.length > bestKey.length`），消除 `o3` vs `o3-mini` 的歧义风险。

### [P3] #15 `pricing.ts` — `getModelPricing` 已导出但未使用

File:

- `src/main/ai/pricing.ts` L55-63

`getModelPricing()` 是一个新导出的公共函数，返回完整的 `TokenPricing` 对象（含 cacheRead/cacheCreation 的默认值回退），但当前没有任何调用方。这是 dead code。

如果设计意图是给前端 SettingsUsage 使用（计算真实 cache savings），那么应该接入。否则应移除以避免维护负担。

Status: **✅ Fixed** — 已移除 `getModelPricing()` 和 `TokenPricing` interface。需要时再加回来。

## Positive Observations

- 1st pass 的 10 个 finding 修复质量高，所有修复都遵循了项目惯例。
- `validateRange()` 提取为独立函数，被 `usage:summary` 和 `usage:totalCost` 复用，DRY。
- `lookupPricing()` 前缀匹配解决了日期后缀问题（如 `claude-sonnet-4-6-20250501`），实用。
- `estimateCost()` 签名扩展为可选 cache tokens，向后兼容。
- `getModelPricing()` 的 `cacheRead ?? input * 0.1` / `cacheCreation ?? input * 1.25` 默认值回退，对未提供缓存定价的模型（如 Gemini/OpenAI）使用 Anthropic 的比例作为近似值，合理。
- `usageStore.loadFromDB` 的 dominant model 算法正确：先按 model 聚合 token 总量，再取最大值。
- `UsageBar` 的 `缓存写入` 用琥珀色区分 `缓存命中` 的绿色，视觉层次清晰。
- SettingsUsage 的 Refresh 按钮用 `RefreshCw` 图标，与项目 lucide-react 图标体系一致。
- DB v13 迁移中 `idx_usage_day_model` 索引覆盖了 `usage_daily` view 的 GROUP BY 列，查询性能有保障。