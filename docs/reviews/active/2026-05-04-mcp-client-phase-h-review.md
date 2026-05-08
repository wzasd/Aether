---
status: closed
owner: mochi
last_updated: 2026-05-04
doc_kind: code-review
---

# MCP Client Phase H Code Review (4th pass)

Review scope:

- `src/main/mcp/config-file.ts` — MCP 配置 JSON 生成 + `~/.bytro/mcp-config.json` 文件写入
- `src/main/mcp/types.ts` — 共享类型定义 + `safeParseJson<T>`
- `src/main/mcp/connector.ts` — MCP 连接测试（JSON-RPC 协议）
- `src/main/ipc/mcp.ts` — 9 个 IPC handler
- `src/main/ipc/index.ts` — 注册 `registerMcpIpc()`
- `src/preload/index.ts` — `api.mcp` 命名空间
- `src/renderer/src/types/global.d.ts` — `ElectronAPI.mcp` 类型
- `src/main/ai/providers/base-cli-provider.ts` — `buildMcpArgs()` 钩子
- `src/main/ai/providers/claude-cli.ts` / `kimi-cli.ts` — 覆盖返回 `--mcp-config-file`
- `src/renderer/src/components/workspace/WorkspaceArea.tsx` — `SettingsMcp` / `ServerItem` / `MarketplaceModal` / `JsonEditorModal`
- `src/renderer/src/data/mcp-marketplace.ts` — Marketplace 数据源
- `docs/features/mcp-client.md` — Feature 文档

Verification:

- `pnpm run typecheck` passed
- `pnpm run build` passed
- `pnpm test` 127 passed (1 pre-existing failure unchanged)

## Previous findings — resolution status

### 1st pass (10 findings)

| # | Finding | Status |
|---|---------|--------|
| P0 | Add Server 按钮因 `resetForm()` 覆盖 `setAdding(true)` 完全无效 | ✅ Fixed |
| P1 | `process.env.HOME \|\| '~'` fallback 无效 | ✅ Fixed |
| P1 | `JSON.parse` 无 try-catch | ✅ Fixed |
| P1 | `getMcpConfigArgs()` 每次会话启动都同步写文件 | ✅ Fixed |
| P2 | 配置文件权限过宽 | ✅ Fixed |
| P2 | IPC handler 未做 args/env 运行时类型校验 | ✅ Fixed |
| P2 | `handleRemove`/`handleToggle` 无错误处理 | ✅ Fixed |
| P2 | 逗号分隔 args 解析 | ✅ Fixed |
| P3 | `McpServerRow` 重复定义 | ✅ Fixed |
| P3 | `mcp:remove`/`mcp:toggle` 不检查存在性 | ✅ Fixed |

### 2nd pass (15 findings)

| # | Finding | Status |
|---|---------|--------|
| P1 #11 | `connector.ts` initialize 响应未校验 `id` 字段 | ✅ Fixed |
| P1 #12 | `waitForTools` 只读一行 | ✅ Fixed |
| P1 #13 | 未发送 `notifications/initialized` | ✅ Fixed |
| P2 #14 | `discoverProjectMcpConfig` 中 `env` 类型断言不安全 | ✅ Fixed |
| P2 #15 | env 直接展开到 `process.env`，未过滤危险键 | ✅ Fixed |
| P2 #16 | `handleJsonSave` 中 `env` 类型断言不安全 | ✅ Fixed |
| P2 #17 | `SettingsMcp` 缺少 loading 状态 | ✅ Fixed |
| P2 #18 | `McpServer`/`ProjectMcpServer` 接口与 `global.d.ts` 重复 | ✅ Fixed |
| P2 #19 | `refreshAll` 中 `servers` 闭包引用可能过期 | ✅ Fixed |
| P2 #20 | marketplace 缓存永不过期 | ✅ Fixed |
| P2 #21 | `getMcpConfigArgs(workspaceDir)` 无 workspace 时可能使用旧配置 | ✅ Fixed |
| P3 #22 | `proc.kill()` 未指定信号 | ✅ Fixed |
| P3 #23 | `stdin` 写入无错误处理 | ✅ Fixed |
| P3 #24 | 项目配置优先级未注释 | ✅ Fixed |
| P3 #25 | 9 个 IPC handler，文档不完整 | ⬜ Open |

### 3rd pass (12 findings)

| # | Finding | Status |
|---|---------|--------|
| P1 #26 | `tools/list` 响应中 `msg.result` 存在但不含 `tools` 时超时 | ✅ Fixed — `msg.result` 存在即视为有效，`tools` 缺失时 fallback `[]` |
| P1 #27 | `testMcpConnection` spawn 安全上下文不够明确 | ✅ Fixed — `console.info` 安全日志 |
| P2 #28 | `safeParseJson` 重复定义 | ✅ Fixed — 提取到 `types.ts`，泛型 `safeParseJson<T>` |
| P2 #29 | `handleFormSave` 中 `resetForm()` 后 `formMode` 闭包引用 | ✅ Fixed — `wasAdd` 标志 |
| P2 #30 | `handleJsonSave` 中 `forEach` + `testServer` 并发无序 | ✅ Fixed — `for...of` 顺序执行 |
| P2 #31 | `handleJsonSave` 非 "already exists" 错误被静默吞掉 | ⬜ Open |
| P2 #32 | `loadProject` 中 `getPaths()` 结果未使用 | ✅ Fixed — 调用 `discoverProject` |
| P2 #33 | `mcpAgents` state 不持久化 | ✅ Fixed — 已移除 agent 选择器 UI |
| P2 #34 | `safeParseJson` 返回 `unknown` + `as` 断言 | ✅ Fixed — 泛型 `safeParseJson<T>` |
| P3 #35 | `protocolVersion` 硬编码 | ✅ Fixed — `MCP_PROTOCOL_VERSION` 常量 |
| P3 #36 | NPM 搜索只匹配 `@` 开头的包 | ✅ Fixed — 移除 `.startsWith('@')` 过滤 |
| P3 #25 | IPC handler 文档不完整 | ⬜ Open |

**Summary**: 1st pass 10/10 ✅, 2nd pass 14/15 ✅, 3rd pass 10/12 ✅. Remaining: #31 (P2) + #25 (P3).

## 4th-pass findings

### [P2] #37 `connector.ts` — `tools` phase 中 `msg.result` 存在但无 `tools` 字段时，进程未被终止

File:

- `src/main/mcp/connector.ts` L118-130

```ts
} else if (msg.result) {
  clearTimeout(timer)
  settled = true
  const resResult = msg.result as Record<string, unknown>
  const rawTools = Array.isArray(resResult.tools) ? resResult.tools : []
  const tools: McpTool[] = (rawTools as Array<Record<string, unknown>>).map((t) => ({
    name: String(t.name || ''),
    description: t.description ? String(t.description) : undefined,
    inputSchema: t.inputSchema as Record<string, unknown> | undefined
  }))
  killProc(proc)
  resolve({ ok: true, tools })
}
```

3rd pass #26 已修复了 `msg.result` 存在但不含 `tools` 时不再超时的问题。但当前实现中，`killProc(proc)` 在 `resolve()` 之前调用。`killProc` 内部有 `setTimeout(() => proc.kill('SIGKILL'), 2000)` 的延迟 SIGKILL。如果 `resolve()` 触发后 Promise 消费方立即启动了同名 server 的另一个 `testMcpConnection`，2 秒后 SIGKILL 可能误杀新进程（因为 `proc` 变量引用的是旧进程对象，`killProc` 中的 `proc.kill('SIGKILL')` 操作的是旧 ChildProcess 实例，PID 可能已被回收）。

实际上这在 Node.js 中是安全的——`proc.kill('SIGKILL')` 操作的是 `ChildProcess` 对象，如果进程已退出，`kill` 会抛出 `ESRCH` 错误（被 `try {} catch {}` 捕获）。PID 回收的风险极低（2 秒窗口内 PID 被复用且恰好是另一个 Node 子进程的概率接近零）。

**降级为 P3**：这是一个理论上的竞态，实际影响极低。当前 `try {} catch {}` 已足够防御。

Status: Open (P3).

### [P2] #38 `handleJsonSave` 中 `mcp:update` 失败时错误仍被静默吞掉

File:

- `src/renderer/src/components/workspace/WorkspaceArea.tsx` L1019-1026

```ts
try {
  await window.api.mcp.add({ name, command: d.command, args, env })
} catch (e) {
  if (e instanceof Error && e.message.includes('already exists')) {
    await window.api.mcp.update(name, { command: d.command, args, env })
  }
}
```

3rd pass #31 指出非 "already exists" 错误被静默吞掉。当前代码仍未修复。此外，即使 `e.message.includes('already exists')` 为 true，`mcp:update` 本身也可能失败（如 DB 错误），但这个错误也被外层 `catch` 捕获后只显示最后一个错误，丢失了上下文。

Recommended fix:

收集所有失败：

```ts
const errors: string[] = []
for (const [name, def] of Object.entries(mcpServers)) {
  const d = def as Record<string, unknown>
  if (typeof d.command !== 'string' || !d.command.trim()) continue
  const args = Array.isArray(d.args) ? d.args.filter((a): a is string => typeof a === 'string') : []
  const env = isValidEnv(d.env) ? d.env : {}
  try {
    await window.api.mcp.add({ name, command: d.command, args, env })
  } catch (e) {
    if (e instanceof Error && e.message.includes('already exists')) {
      try {
        await window.api.mcp.update(name, { command: d.command, args, env })
      } catch (e2) {
        errors.push(`${name}: ${e2 instanceof Error ? e2.message : 'Update failed'}`)
      }
    } else {
      errors.push(`${name}: ${e instanceof Error ? e.message : 'Add failed'}`)
    }
  }
}
if (errors.length > 0) setError(`Some servers failed: ${errors.join('; ')}`)
```

Status: Open.

### [P3] #39 `mcp-marketplace.ts` — NPM 搜索移除 `@` 过滤后，非 MCP 包可能混入

File:

- `src/renderer/src/data/mcp-marketplace.ts` L166-175

3rd pass #36 建议移除 `.startsWith('@')` 过滤，已修复。但 NPM 搜索关键词 `keywords:mcp modelcontextprotocol` 可能返回非 MCP server 的包（如 MCP 客户端库、文档包等）。这些包的 `command: 'npx'` + `args: ['-y', packageName]` 可能不是有效的 MCP server 启动命令。

当前 fallback 到 `FALLBACK_SERVERS` 是安全的，NPM 搜索结果的质量问题只影响 marketplace 浏览体验，不影响核心功能。

Status: Open.

### [P3] #25 Feature 文档不完整

(继承自 2nd pass，3rd pass)

9 个 IPC handler 未在 feature 文档中完整列出。

Status: Open.

## Positive Observations

- 3rd pass 的 10/12 finding 已修复，修复质量持续提升。
- `safeParseJson<T>` 泛型设计干净，消除了 `as` 断言和重复定义。
- `wasAdd` 标志解决了 React 闭包陷阱。
- `handleJsonSave` 改为 `for...of` 顺序测试，避免了并发 spawn 风暴。
- `discoverProject` 前端已接入，项目级 MCP 功能可用。
- `mcpAgents` 不持久化的问题通过移除 UI 解决，避免了误导用户。
- `MCP_PROTOCOL_VERSION` 常量提取，便于未来更新。
- NPM 搜索过滤已放宽，社区 server 可被发现。
- 整体代码从 1st pass 到 4th pass 质量提升显著：P1 从 6→2→0，P2 从 8→7→1。
