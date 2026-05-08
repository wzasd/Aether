---
status: active
owner: bytro
last_verified: 2026-05-03
doc_kind: plan
scope: P2 完整架构设计
schema_version_start: 11
---

# P2 架构设计

> **P2 = P1 功能补齐 + MCP + 成本统计 + 键盘导航 + 打包发布**
>
> P1 功能（Multi-Model Phase 2-3、主题、文件树、虚拟滚动、自动更新、对话导出）先于 P2 新功能完成。

---

## 当前基线（2026-05-03）

| 模块 | 状态 | Schema |
|------|------|--------|
| Task Execution (Module A) | ✅ 完成 | — |
| File Tracking (Module B) | ✅ 完成 | — |
| Memory Palace (Module C) | ✅ 完成 | — |
| Multi-Agent A2A (Module D) | ✅ 完成 | — |
| xterm Terminal | ✅ 完成 | — |
| Monaco Editor | ✅ 完成 | — |
| Multi-Model Phase 1 | ✅ 完成 | v11（secrets + provider_configs） |
| typecheck / build / test | ✅ 全绿 | — |

**待实现（P1 补齐）**：Multi-Model Phase 2-3、暗色/亮色主题、文件浏览器、虚拟滚动、自动更新、对话导出

**P2 新功能**：MCP 客户端、Token/成本统计、键盘导航、打包发布

---

## 整体执行顺序

依赖关系决定顺序：

```
Phase A: Multi-Model Phase 2（Codex/Gemini/Kimi CLI providers）
  ↓
Phase B: Multi-Model Phase 3（providerStore + ModelSelector UI）
  ↓ （并行可进行）
Phase C: 暗色/亮色主题
Phase D: 文件浏览器
Phase E: 虚拟滚动
Phase F: 对话导出
Phase G: 自动更新
  ↓
Phase H: MCP 客户端
  ↓
Phase I: Token/成本统计
Phase J: 键盘导航
  ↓
Phase K: 打包发布（macOS DMG + v0.2.0）
```

---

## Phase A：Multi-Model Phase 2 — CLI Providers（3-4 天）

### 目标

新增 Codex、Gemini、Kimi 三个 CLI provider，每个含独立 OutputParser 和 fixture 测试。

Phase 1 已建立的基础：`BaseCLIProvider`、`OutputParser` 接口、`ProviderRegistry`、`secrets.ts`。

### A1：CodexCLIProvider

**文件**：`src/main/ai/providers/codex-cli.ts`、`src/main/ai/providers/parsers/codex-output-parser.ts`

**Codex CLI 差异**（已 spike 验证）：

| 维度 | 值 |
|------|-----|
| binary | `codex` |
| headless flag | `codex exec` + `--json` |
| 输出模型 | 完整 item（非增量），需 fake streaming 适配层 |
| tool_calls | `codex exec` 子命令结果内嵌，无独立 tool 事件 |
| PTY 模式 | `codex`（无 flag） |
| permission flag | `-a` / `--dangerously-bypass` |
| session 恢复 | `codex resume <id>` |
| 认证 | `OPENAI_API_KEY` |

**Codex JSONL 格式（fixture）**：

```jsonl
{"type":"thread.started","thread_id":"thread_abc123"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"msg_001","type":"agent_message","text":"Hello, I can help..."}}
{"type":"turn.completed","usage":{"input_tokens":26527,"output_tokens":14}}
```

**Fake Streaming 适配层**：

`item.completed` 一次性输出全文，需要在 parser 里模拟 delta：

```typescript
// codex-output-parser.ts
parseItem(item: CodexItem): AIEvent[] {
  if (item.type !== 'agent_message') return []
  const text = item.text ?? ''
  // 按 50 字切分，模拟 delta 流
  const chunks = splitIntoChunks(text, 50)
  return chunks.map(delta => ({
    type: 'text_delta' as const,
    delta,
    requestId: this.requestId
  }))
}
```

**ProviderMeta**：

```typescript
export const CODEX_META: ProviderMeta = {
  id: 'codex-cli',
  name: 'Codex',
  binary: 'codex',
  vendor: 'OpenAI',
  models: [
    { id: 'codex-mini-latest', name: 'Codex Mini', contextWindow: 200000 },
    { id: 'o4-mini',           name: 'o4-mini',    contextWindow: 200000 },
    { id: 'o3',                name: 'o3',          contextWindow: 200000 },
  ],
  permissionFlags: {
    plan:     ['--no-git-commit'],
    autoEdit: [],
    fullAuto: ['-a'],
    manual:   [],                  // PTY: `codex`
  },
  supportsStreamJson:  true,
  supportsInteractive: true,
}
```

**测试文件**：`src/main/ai/providers/parsers/__tests__/codex-output-parser.test.ts`
- fixture：上面 4 行 JSONL → 预期 `text_delta[]` + `usage`
- fake streaming chunk 数量正确

---

### A2：GeminiCLIProvider

**文件**：`src/main/ai/providers/gemini-cli.ts`、`src/main/ai/providers/parsers/gemini-output-parser.ts`

**Gemini CLI 差异**（spike 待补充，以下为文档预判）：

| 维度 | 值 |
|------|-----|
| binary | `gemini` |
| headless flag | `-p` / `--prompt` + `-o stream-json` |
| 输出格式 flag | `-o stream-json` |
| PTY 模式 | `gemini`（无 flag） |
| permission flag | `--approval-mode` |
| session 恢复 | `-r <id>` |
| 认证 | `GEMINI_API_KEY` |

**注意**：Gemini auth 修复前无法采集真实 fixture。parser 先写接口 + TODO 注释，fixture 测试在 spike 完成后补齐。

**ProviderMeta**：

```typescript
export const GEMINI_META: ProviderMeta = {
  id: 'gemini-cli',
  name: 'Gemini',
  binary: 'gemini',
  vendor: 'Google',
  models: [
    { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   contextWindow: 1048576 },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 },
  ],
  permissionFlags: {
    plan:     ['--approval-mode', 'suggest'],
    autoEdit: ['--approval-mode', 'auto'],
    fullAuto: ['--approval-mode', 'auto'],
    manual:   [],
  },
  supportsStreamJson:  true,
  supportsInteractive: true,
}
```

---

### A3：KimiCLIProvider

**文件**：`src/main/ai/providers/kimi-cli.ts`、`src/main/ai/providers/parsers/kimi-output-parser.ts`

**Kimi CLI 差异**（已 spike 验证）：

| 维度 | 值 |
|------|-----|
| binary | `kimi` |
| headless flag | `--print` + `--output-format stream-json` |
| 输出模型 | 完整 message（非增量），同样需 fake streaming |
| thinking | `content[{type:"think","think":"..."}]` 内嵌 |
| tool_calls | `tool_calls` 数组 + `role:tool` 行 |
| PTY 模式 | `kimi`（无 flag） |
| permission flag | `--yolo` / `--afk` |
| session 恢复 | `--resume [id]` |
| 认证 | OAuth（`kimi login`），无需 API Key |

**Kimi JSONL 格式（fixture）**：

```jsonl
{"role":"assistant","content":[{"type":"think","think":"Let me analyze..."},{"type":"text","text":"Here is my solution..."}]}
{"role":"assistant","content":[{"type":"text","text":"I'll run a command"}],"tool_calls":[{"type":"function","id":"tool_abc","function":{"name":"Shell","arguments":"{\"command\":\"ls -la\"}"}}]}
{"role":"tool","content":[{"type":"text","text":"total 48\ndrwxr-xr-x..."}],"tool_call_id":"tool_abc"}
```

**Parser 关键逻辑**：

```typescript
// kimi-output-parser.ts
parseMessage(msg: KimiMessage): AIEvent[] {
  const events: AIEvent[] = []

  if (msg.role === 'assistant' && Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'think') {
        // thinking 块：按 100 字切片模拟 delta
        splitIntoChunks(block.think, 100).forEach(delta =>
          events.push({ type: 'thinking_delta', delta, requestId: this.requestId })
        )
      } else if (block.type === 'text') {
        splitIntoChunks(block.text, 50).forEach(delta =>
          events.push({ type: 'text_delta', delta, requestId: this.requestId })
        )
      }
    }
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        events.push({
          type: 'tool_start',
          requestId: this.requestId,
          toolCallId: tc.id,
          toolName: tc.function.name,
          toolInput: tc.function.arguments,
        })
      }
    }
  } else if (msg.role === 'tool') {
    events.push({
      type: 'tool_result',
      requestId: this.requestId,
      toolCallId: msg.tool_call_id,
      toolName: '',
      result: msg.content?.[0]?.text ?? '',
      success: true,
    })
  }

  return events
}
```

**ProviderMeta**：

```typescript
export const KIMI_META: ProviderMeta = {
  id: 'kimi-cli',
  name: 'Kimi',
  binary: 'kimi',
  vendor: 'Moonshot',
  models: [
    { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 131072 },
  ],
  permissionFlags: {
    plan:     [],
    autoEdit: ['--afk'],
    fullAuto: ['--yolo'],
    manual:   [],
  },
  supportsStreamJson:  true,
  supportsInteractive: true,
}
```

---

### A4：Registry 注册

**文件**：`src/main/ai/provider-registry.ts`

```typescript
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(new ClaudeCLIProvider())
  registry.register(new CodexCLIProvider())     // Phase 2 新增
  registry.register(new GeminiCLIProvider())    // Phase 2 新增
  registry.register(new KimiCLIProvider())      // Phase 2 新增
  return registry
}
```

### Phase A 完成标准

- [x] `pnpm typecheck` 通过
- [x] `pnpm test` 全绿（新增 Codex + Kimi fixture 测试各 ≥ 6 个）
- [x] `pnpm build` 通过
- [x] Claude CLI 行为不受影响

**Status: ✅ 完成 (2026-05-03)**

---

## Phase B：Multi-Model Phase 3 — Provider UI（2-3 天）

### 目标

用户可以在 UI 中选择 provider、配置 API Key、查看模型信息。

### B1：providerStore

**文件**：`src/renderer/src/stores/providerStore.ts`（新建）

```typescript
interface ProviderInfo {
  id: string
  name: string
  vendor: string
  models: ModelInfo[]
  isAvailable: boolean     // detect() 返回非 null
  hasApiKey: boolean
}

interface ProviderStore {
  providers: ProviderInfo[]
  isLoading: boolean

  loadProviders: () => Promise<void>
  setApiKey: (providerId: string, key: string) => Promise<void>
  testConnection: (providerId: string) => Promise<{ ok: boolean; error?: string }>
}
```

`loadProviders()` 调用 `api.provider.detectAll()` + `api.provider.hasApiKey(id)`。

在 `AppContent` 的启动 `useEffect` 中与 `loadWorkspaces` 并行调用。

### B2：ModelSelector 重写

**文件**：`src/renderer/src/components/ModelSelector.tsx`（重写）

**当前问题**（来自 Provider Phase 1 Review）：ModelSelector 仍发送 legacy 别名（`sonnet`、`opus`、`haiku`），chat:startSession 会报 `Invalid model for claude-cli: sonnet`。

**新设计**：

```
[Provider ▼]  [Model ▼]
 Claude         claude-sonnet-4-6 (200K) ✓
 Codex          claude-opus-4-7   (200K)
 Gemini         claude-haiku-4-5  (200K)
 Kimi
```

- 先选 Provider（下拉，灰显未安装的）
- 再选 Model（按所选 provider 的 `meta.models` 过滤，显示 contextWindow）
- 选中后写入 `sessionConfigStore.providerType` + `sessionConfigStore.model`（完整 model id）

**同时修复**：`sessionConfigStore` 默认 model 从 `'sonnet'` 改为 `'claude-sonnet-4-6'`，默认 `providerType` 从 `''` 改为 `'claude-cli'`。

### B3：Settings Provider 配置 Tab

**文件**：`src/renderer/src/components/workspace/SettingsPanel.tsx`

在 Settings 中新增 **Providers** tab：

```
Providers
─────────────────────────────────────────────
Claude CLI      ✓ 已安装  v1.x.x
  API Key: [********************] [更新] [测试]

Codex CLI       ✗ 未安装  [如何安装？]
  API Key: [不可用]

Gemini CLI      ✓ 已安装  v2.x.x
  API Key: [                    ] [保存] [测试]
  状态: ⚠ 需要配置 API Key

Kimi CLI        ✓ 已安装  v1.x.x
  认证: OAuth  [已登录：user@example.com]
```

**IPC 交互**：
- `provider:setApiKey(id, key)` → 调用 `secrets.ts` 加密存储
- `provider:testConnection(id)` → 发送一条最短消息，返回 `{ok, latencyMs, error}`
- `provider:hasApiKey(id)` → 返回 bool（不暴露 key 本身）

### Phase B 完成标准

- [x] ModelSelector 发送完整 model id，chat:startSession 不再报 Invalid model
- [x] Provider 配置 tab 可保存/测试 API Key，重启后保留
- [x] 选择 Codex/Gemini/Kimi 后可正常发送消息（已安装时）
- [x] `pnpm typecheck` + `pnpm build` + `pnpm test` 全通过

**Status: ✅ 完成 (2026-05-03)**

---

## Phase C：暗色/亮色主题（2 天）

### 目标

三模式主题切换（暗色/亮色/跟随系统），全组件覆盖，Monaco/xterm 同步，localStorage 持久化。

详细设计已在 `docs/features/theme.md`，以下补充实现约束。

### C1：CSS 变量迁移策略

当前代码存在内联颜色值（如 `#0d1117`、`#1c2128`），迁移步骤：

1. `globals.css` 定义两套 CSS 变量（暗色值 = 现有值，亮色值新写）
2. 全局搜索 hardcode 颜色，用 `var(--color-*)` 替换
3. 不改设计 token 命名（`mochi-design-reference.md` 保持不变）

**工具脚本辅助迁移**（可选）：

```bash
# 找到所有使用 hex 颜色的 tsx/ts 文件
grep -rn "#[0-9a-fA-F]\{6\}" src/renderer/src --include="*.tsx" --include="*.ts"
```

### C2：主题初始化时序

Electron 渲染进程加载时避免主题闪烁（FOUC）：

```html
<!-- index.html head 内嵌初始化脚本，在 React 加载前执行 -->
<script>
  const stored = localStorage.getItem('theme') || 'dark'
  const resolved = stored === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : stored
  document.documentElement.classList.toggle('dark', resolved === 'dark')
</script>
```

### C3：Monaco + xterm 主题同步

```typescript
// CodePanel.tsx：监听 resolved 变化
const resolved = useThemeStore(s => s.resolved)
useEffect(() => {
  if (editorRef.current) {
    monacoRef.current?.editor.setTheme(resolved === 'dark' ? 'vs-dark' : 'vs')
  }
}, [resolved])

// TerminalPanel.tsx：terminal.options.theme 动态更新
useEffect(() => {
  terminalRef.current?.options.theme = resolved === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME
}, [resolved])
```

### Phase C 完成标准

- [ ] 三种模式切换正常，localStorage 持久化
- [ ] 所有面板、组件在亮色模式下可读（无白字白底）
- [ ] Monaco Editor + xterm 跟随主题切换
- [ ] `pnpm typecheck` 通过

---

## Phase D：文件浏览器（2-3 天）

### 目标

ExplorerPanel 重构为完整文件树，懒加载、右键菜单、chokidar 自动刷新、点击在 Monaco 中打开。

详细设计已在 `docs/features/file-browser.md`，以下补充集成点。

### D1：IPC 层扩展

**文件**：`src/main/ipc/file.ts`

现有：`file:read`、`file:write`、`file:watch`

新增：

```typescript
ipcMain.handle('file:listDir', async (_, dirPath: string) => {
  // 安全检查：路径必须在 workspace.repoPath 下
  validatePathInWorkspace(dirPath, workspace.repoPath)
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
  return entries
    .filter(e => !IGNORED_NAMES.has(e.name))
    .map(e => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file',
      extension: e.isFile() ? path.extname(e.name).slice(1) : undefined,
    }))
})

ipcMain.handle('file:createFile', async (_, filePath: string) => { ... })
ipcMain.handle('file:createDir', async (_, dirPath: string) => { ... })
ipcMain.handle('file:rename', async (_, oldPath: string, newPath: string) => { ... })
ipcMain.handle('file:delete', async (_, p: string) => { ... })
```

**安全约束**：所有文件操作必须检查路径在当前 workspace.repoPath 下，防止路径穿越。

### D2：fileStore 扩展

**文件**：`src/renderer/src/stores/fileStore.ts`

```typescript
interface FileNode {
  path: string
  name: string
  type: 'file' | 'directory' | 'symlink'
  extension?: string
  children?: FileNode[]       // undefined = 未加载；[] = 空目录
  isExpanded: boolean
  isLoading: boolean
}

interface FileStore {
  root: FileNode | null
  selectedPath: string | null

  loadRoot: (repoPath: string) => Promise<void>
  expandNode: (nodePath: string) => Promise<void>
  collapseNode: (nodePath: string) => void
  selectFile: (filePath: string) => void
  refresh: (dirPath: string) => Promise<void>
  // CRUD
  createFile: (dirPath: string, name: string) => Promise<void>
  createDir: (dirPath: string, name: string) => Promise<void>
  rename: (oldPath: string, newName: string) => Promise<void>
  delete: (filePath: string) => Promise<void>
}
```

**默认忽略列表**：

```typescript
const IGNORED_NAMES = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'out', 'build',
  '.next', '.nuxt', 'coverage', '.cache', '__pycache__',
])
```

### Phase D 完成标准

- [ ] 文件树懒加载正常（展开 → 加载子节点）
- [ ] 右键菜单：新建/重命名/删除可用
- [ ] 点击文件在 Monaco 中打开
- [ ] chokidar 文件变更后自动刷新树
- [ ] 路径穿越保护有效
- [ ] `pnpm typecheck` 通过

---

## Phase E：虚拟滚动（1-2 天）

### 目标

MessageList 引入 `@tanstack/react-virtual`，只渲染可视区域消息，支持动态高度和自动跟随。

详细设计已在 `docs/features/virtual-scrolling.md`，以下补充流式消息的特殊处理。

### E1：流式消息高度处理

流式消息（正在输出中）高度随 text 增长而变化，需要每帧重新测量：

```typescript
// MessageItem.tsx
const messageRef = useRef<HTMLDivElement>(null)

// 流式状态下每 100ms 通知 virtualizer 重新测量
useEffect(() => {
  if (!isStreaming || !messageRef.current) return
  const interval = setInterval(() => {
    virtualizer.measureElement(messageRef.current!)
  }, 100)
  return () => clearInterval(interval)
}, [isStreaming])
```

### E2：与 taskStreams 的兼容

Multi-Agent 并行模式下，同一对话有多个 streaming bubble（来自 `chatStore.taskStreams`）。虚拟滚动需要将 `taskStreams` 中的活跃流作为"临时消息"追加到 messages 数组末尾：

```typescript
// MessageList.tsx
const messages = useChatStore(s => s.messages[conversationId] ?? [])
const taskStreams = useChatStore(s => s.taskStreams)

// 合并：持久化消息 + 活跃流式 bubble
const allItems: VirtualItem[] = [
  ...messages.map(m => ({ type: 'message' as const, data: m })),
  ...Array.from(taskStreams.values())
    .filter(s => s.isActive)
    .map(s => ({ type: 'stream' as const, data: s })),
]
```

### Phase E 完成标准

- [ ] 200 条消息滚动帧率 ≥ 60fps
- [ ] 流式消息边输出边正确测量高度
- [ ] 自动跟随：在底部时新消息到来自动滚到底
- [ ] "↓ 新消息"按钮（不在底部时显示）
- [ ] `pnpm typecheck` 通过

---

## Phase F：对话导出（1 天）

### 目标

TaskRail 右键菜单增加"导出为 Markdown / JSON"，调用系统保存对话框写入文件。

详细设计已在 `docs/features/conversation-export.md`，以下补充 Multi-Agent 消息格式。

### F1：Multi-Agent 消息导出格式

对话中存在多个 agent 的消息，Markdown 导出时需标注来源：

```markdown
## Assistant (Claude Sonnet 4.6) [@Planner]

分析需求结构...

---

## Assistant (Claude Opus 4.7) [@Coder]

实现上传组件：

```typescript
// src/components/upload.tsx
...
```

---

## Assistant (Claude Haiku 4.5) [@Reviewer]

代码审查完成，发现 2 个问题...
```

### F2：IPC 实现

**DB 查询**：`messages` JOIN `agent_profile_configs`（on `agent_profile_id`）获取 agent 名称。

**新增 IPC**：`conversation:export`（加入现有 `src/main/ipc/conversation.ts`）

**新增工具函数**：`src/main/utils/export.ts`（`buildMarkdownExport` + `buildJsonExport`）

### Phase F 完成标准

- [ ] Markdown / JSON 导出可用
- [ ] Multi-Agent 消息来源正确标注
- [ ] 系统保存对话框正常弹出
- [ ] `pnpm typecheck` 通过

---

## Phase G：自动更新（0.5 天）

### 目标

**简化方案**（开发阶段）：手动检查更新 + 提示下载链接，不做后台自动安装（需代码签名证书）。

完整自动更新（electron-updater + GitHub Releases）留到 v1.0 正式发布前实现。

### G1：简化实现

```typescript
// src/main/updater.ts
const RELEASES_URL = 'https://api.github.com/repos/USER/bytro/releases/latest'

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const res = await fetch(RELEASES_URL)
  const data = await res.json()
  const latest = data.tag_name?.replace('v', '') ?? '0.0.0'
  const current = app.getVersion()
  return {
    hasUpdate: semverGt(latest, current),
    latestVersion: latest,
    downloadUrl: data.html_url,
    releaseNotes: data.body ?? '',
  }
}
```

**IPC**：`system:checkUpdate` → `UpdateCheckResult`

**UI**：设置页"关于"区域显示当前版本 + "检查更新"按钮，有更新时展示版本号和下载链接。

### Phase G 完成标准

- [ ] "检查更新"按钮可用，返回正确结果（mock 或真实接口）
- [ ] 有更新时显示版本号和下载链接

---

## Phase H：MCP 客户端（3-4 天）

### 目标

让用户配置 MCP 服务器，Claude CLI（及其他支持 MCP 的 CLI）自动加载工具列表。这是 P2 核心新功能。

### H1：架构概述

```
用户在 Settings → MCP 中配置服务器
    ↓
MCPManager（主进程）启动 MCP 服务器进程（stdio transport）
    ↓
ClaudeCLIProvider 启动时：读取 MCPManager 的服务器配置
    ↓
将 --mcp-config <tempFilePath> 传给 claude CLI
    ↓
Claude CLI 连接 MCP 服务器，工具列表自动扩展
    ↓
AI 响应中的 tool_start/tool_result 透明传递到渲染进程
```

**关键设计约束**：
- MCP 服务器进程不由 Bytro 直接管理协议（不实现 MCP 客户端协议栈）
- Claude CLI 作为 MCP 客户端桥接，Bytro 只需传配置文件
- Codex/Gemini/Kimi 暂不支持 MCP，忽略配置即可

### H2：DB Schema（SCHEMA_VERSION 12）

**文件**：`src/main/core/db.ts`

```sql
-- MCP 服务器配置
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL = 全局
  name TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL,          -- 启动命令，如 "npx"
  args TEXT NOT NULL DEFAULT '[]', -- JSON array，如 ["-y","@modelcontextprotocol/server-filesystem"]
  env TEXT NOT NULL DEFAULT '{}',  -- JSON object，额外环境变量
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_ws ON mcp_servers(workspace_id);
```

**迁移**：v11 → v12，加 `mcp_servers` 表。

### H3：MCPManager

**文件**：`src/main/modules/mcp-manager.ts`（新建）

```typescript
interface MCPServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

class MCPManager {
  private configs: MCPServerConfig[] = []

  /**
   * 从 DB 加载配置（应用启动 + workspace 切换时调用）
   */
  loadConfigs(workspaceId: string | null): void

  /**
   * 生成 claude CLI 的 --mcp-config 临时文件
   * 返回文件路径，claude CLI 启动后删除
   */
  async writeTempConfig(): Promise<string | null>

  /**
   * 获取所有启用的服务器（供 UI 展示）
   */
  getEnabledConfigs(): MCPServerConfig[]
}

// 全局单例
export const mcpManager = new MCPManager()
```

**临时配置文件格式**（claude CLI 期望的格式）：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/user/projects"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "..." }
    }
  }
}
```

### H4：ClaudeCLIProvider 集成

**文件**：`src/main/ai/providers/claude-cli.ts`

在 `buildStreamJsonArgs` 中注入 MCP 配置：

```typescript
async buildStreamJsonArgs(config: SessionConfig): Promise<string[]> {
  const args = [...BASE_STREAM_JSON_ARGS]
  const mcpConfigPath = await mcpManager.writeTempConfig()
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath)
  }
  return args
}
```

### H5：IPC 层

**文件**：`src/main/ipc/mcp.ts`（新建）

```typescript
// mcp:list(workspaceId?)          → MCPServerConfig[]
// mcp:create(data)                → MCPServerConfig
// mcp:update(id, patch)           → MCPServerConfig
// mcp:delete(id)                  → void
// mcp:setEnabled(id, enabled)     → void
// mcp:testConnection(id)          → { ok: boolean; error?: string }
```

注册入口：`src/main/ipc/index.ts`。

Preload 新增 `api.mcp.*` 命名空间。

### H6：MCP 配置 UI

**文件**：`src/renderer/src/components/workspace/SettingsPanel.tsx`

Settings 新增 **MCP** tab：

```
MCP Servers
─────────────────────────────────────────────
+ 添加服务器

▼ filesystem                    [启用 ●] [编辑] [删除]
  命令: npx -y @modelcontextprotocol/server-filesystem ~/projects
  范围: 全局

▼ github                        [禁用 ○] [编辑] [删除]
  命令: npx -y @modelcontextprotocol/server-github
  范围: 当前工作区

添加/编辑表单：
  名称: [          ]
  命令: [npx      ]
  参数: [-y @modelcontextprotocol/server-filesystem /path]
  环境变量: [GITHUB_TOKEN=xxx  ×]  [+ 添加]
  范围: [全局 ▼] / [当前工作区 ▼]
  [保存] [取消]
```

### H7：测试覆盖

| 测试目标 | 类型 |
|---------|------|
| `mcp:list/create/update/delete` IPC | 单测 |
| schema v12 迁移 + mcp_servers 表 | 集成 |
| `mcpManager.writeTempConfig()` 正确序列化 | 单测 |
| `mcpManager.writeTempConfig()` 空配置返回 null | 单测 |
| ClaudeCLIProvider 注入 --mcp-config | 单测（mock writeTempConfig） |

### Phase H 完成标准

- [ ] MCP 配置 tab 可 CRUD 服务器，重启后保留
- [ ] Claude CLI 启动时正确携带 --mcp-config
- [ ] MCP 工具调用出现在 chat 的 tool_start/tool_result 事件中
- [ ] SCHEMA_VERSION = 12
- [ ] `pnpm typecheck` + `pnpm build` + `pnpm test` 全通过

---

## Phase I：Token / 成本统计（1-2 天）

### 目标

对话中显示实时 token 使用量，按天/周/月汇总，按 provider/model 估算成本。

### I1：价格表

**文件**：`src/main/ai/pricing.ts`（新建）

```typescript
// 单位：USD / 1M tokens（输入/输出）
// 来源：各官网公开价格，2026-05 版本，需定期更新
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':          { input: 15,    output: 75    },
  'claude-sonnet-4-6':        { input: 3,     output: 15    },
  'claude-haiku-4-5-20251001':{ input: 0.8,   output: 4     },
  'codex-mini-latest':        { input: 1.5,   output: 6     },
  'gemini-2.5-pro':           { input: 1.25,  output: 10    },
  'gemini-2.5-flash':         { input: 0.15,  output: 0.6   },
  'kimi-k2.5':                { input: 0.14,  output: 2.5   },
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}
```

### I2：DB 扩展（SCHEMA_VERSION 13）

现有 `conversation_usage` 表已有 `cost_usd` 字段（per-message）。

新增汇总视图（`CREATE VIEW` 不增加 SCHEMA_VERSION）：

```sql
-- 按天统计（视图，无需迁移）
CREATE VIEW IF NOT EXISTS usage_daily AS
SELECT
  date(created_at, 'unixepoch', 'localtime') AS day,
  model,
  SUM(input_tokens)            AS total_input,
  SUM(output_tokens)           AS total_output,
  SUM(cache_read_tokens)       AS total_cache_read,
  SUM(cache_creation_tokens)   AS total_cache_creation,
  SUM(cost_usd)                AS total_cost
FROM conversation_usage
GROUP BY day, model;
```

**注意**：`cost_usd` 历史数据由 Phase I 上线时一次性补填（读取 model + input/output tokens，按 pricing 重算，写回 cost_usd）。

v12 → v13 迁移：`conversation_usage` 增加 `provider_id TEXT`（追踪用哪个 provider）。

```sql
ALTER TABLE conversation_usage ADD COLUMN provider_id TEXT;
```

### I3：IPC

**文件**：`src/main/ipc/usage.ts`（增强）

```typescript
// 现有
// usage:create(data)
// usage:list(conversationId)

// 新增
// usage:summary(range: { from: number; to: number }) → UsageSummary
// usage:totalCost(range?) → number
```

### I4：UI：对话级统计条

现有 `UsageBar.tsx` 已显示单次对话的 token。增强为：

```
输入 12,450 ｜ 输出 2,180 ｜ 缓存命中 8,200 ｜ 本次费用 $0.0042
```

### I5：UI：全局统计页

**文件**：`src/renderer/src/components/workspace/UsageStatsPanel.tsx`（新建）

在 Settings 中新增 **Usage** tab，展示：

```
本月统计（2026-05）
────────────────────────────────────────
  总输入     1,234,567 tokens
  总输出       234,890 tokens
  缓存命中    890,123 tokens（节省 $2.30）
  累计费用       $4.82

按模型分布
  Claude Sonnet 4.6  65%  ████████████░░░
  Claude Opus 4.7    28%  █████░░░░░░░░░░
  Codex Mini          7%  █░░░░░░░░░░░░░░

日趋势（最近 7 天）
  05-03  ██████  $0.42
  05-02  ████    $0.31
  ...
```

### Phase I 完成标准

- [ ] `UsageBar` 显示本次费用估算
- [ ] Usage tab 显示月度汇总和按模型分布
- [ ] `pnpm typecheck` 通过

---

## Phase J：键盘导航（1 天）

### 目标

全键盘操作最常用的功能，减少鼠标依赖。

### J1：全局快捷键

**文件**：`src/main/ipc/system.ts` + `src/renderer/src/hooks/useKeyboardShortcuts.ts`

| 快捷键（macOS）| 功能 |
|----------------|------|
| `Cmd+N` | 新建对话 |
| `Cmd+W` | 关闭/删除当前对话 |
| `Cmd+K` | 聚焦对话搜索框 |
| `Cmd+,` | 打开 Settings |
| `Cmd+\` | 切换侧边栏 |
| `Cmd+Shift+T` | 切换 Terminal tab |
| `Cmd+Shift+E` | 切换 Explorer tab |
| `Cmd+Enter` | 发送消息 |
| `Escape` | 中止当前 AI 请求 |
| `Cmd+1~9` | 切换第 N 个对话 |

**实现**：

```typescript
// src/renderer/src/hooks/useKeyboardShortcuts.ts
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey

      if (isMeta && e.key === 'n') { e.preventDefault(); actions.newConversation() }
      if (isMeta && e.key === 'k') { e.preventDefault(); actions.focusSearch() }
      if (isMeta && e.key === ',') { e.preventDefault(); actions.openSettings() }
      if (isMeta && e.key === '\\') { e.preventDefault(); actions.toggleSidebar() }
      if (isMeta && e.key === 'Enter') { e.preventDefault(); actions.sendMessage() }
      if (e.key === 'Escape') { actions.abortRequest() }
      // ...
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
}
```

在 `App.tsx` 或根组件中调用一次。

### J2：对话列表键盘导航

TaskRail 的对话列表支持：
- `↑↓` 切换选中对话
- `Enter` 打开选中对话
- `Delete` / `Backspace` 删除选中对话（需二次确认）
- `F2` 重命名选中对话

### Phase J 完成标准

- [ ] 全部快捷键可用
- [ ] TaskRail 键盘导航可用
- [ ] 无快捷键冲突（特别是 Monaco Editor 内不触发全局快捷键）
- [ ] `pnpm typecheck` 通过

---

## Phase K：打包发布（v0.2.0）

### 目标

macOS DMG 打包，发布 v0.2.0。

### K1：electron-builder 配置

**文件**：`package.json`（`build` 字段）

```json
{
  "build": {
    "appId": "com.bytro.app",
    "productName": "Bytro",
    "mac": {
      "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
      "icon": "resources/icons/icon.icns",
      "category": "public.app-category.developer-tools"
    },
    "dmg": {
      "title": "Bytro ${version}",
      "window": { "width": 540, "height": 380 }
    },
    "files": [
      "out/**/*",
      "resources/**/*",
      "!node_modules/.pnpm/**/*.{md,txt}"
    ],
    "extraResources": [],
    "publish": {
      "provider": "github",
      "owner": "USER",
      "repo": "bytro"
    }
  }
}
```

### K2：发布前检查清单

- [ ] `pnpm dist` 打出 `.dmg` 可安装运行
- [ ] 应用图标正确（`resources/icons/icon.icns` 存在）
- [ ] About 页显示正确版本号
- [ ] 冷启动时 sqlite 数据库自动初始化（无 userData 目录时）
- [ ] Claude CLI 未安装时给出清晰提示
- [ ] 错误边界覆盖（无 unhandled crash）
- [ ] 日志写入 `app.getPath('logs')` 而非 console

### K3：发布流程

```
1. 更新 package.json version → 0.2.0
2. pnpm typecheck && pnpm build && pnpm test
3. pnpm dist → 生成 dist/Bytro-0.2.0-arm64.dmg
4. 手动测试 DMG 安装 + 运行
5. git tag v0.2.0
6. GitHub Release：上传 DMG + 写 changelog
```

---

## DB Schema 版本规划

| 版本 | 变更内容 | Phase |
|------|---------|-------|
| v11 | 当前：secrets + provider_configs | Multi-Model Phase 1（已完成） |
| v12 | mcp_servers 表 | Phase H |
| v13 | conversation_usage 增加 provider_id | Phase I |

---

## 测试覆盖要求

每个 Phase 完成时必须：

1. `pnpm typecheck` 通过
2. `pnpm build` 通过
3. `pnpm test` 全绿
4. 新增单测覆盖本 Phase 的 IPC handler 和核心工具函数
5. 更新 `docs/PROGRESS.md`

**P2 测试目标**（在 P1 baseline 101 个测试的基础上新增）：

| Phase | 预计新增测试数 |
|-------|-------------|
| A（Codex/Kimi parser） | ≥ 12 |
| B（providerStore） | ≥ 6 |
| H（MCP manager/IPC） | ≥ 10 |
| I（usage IPC） | ≥ 6 |
| 合计 | ≥ 34 |

---

## 关键约束（继承 P1）

1. **不引入 BrowserRouter**：继续用 HashRouter
2. **IPC 只暴露窄接口**：新增命名空间（`api.mcp.*`、`api.provider.*`）
3. **路径安全**：`file:*` 操作必须验证路径在 workspace.repoPath 下
4. **SCHEMA_VERSION 单调递增**：每次 DB 结构变更递增，不可跳号
5. **native CJS 依赖**：`better-sqlite3`、`node-pty` 保持在 main process 边界内
6. **MCP 不实现协议栈**：Bytro 只传配置文件，由 claude CLI 处理 MCP 协议

---

## 文档更新约定

每个 Phase 完成后：

1. `docs/PROGRESS.md` — Feature 状态总览 + 已完成列表
2. `docs/features/<feature>.md` — status 改为 ✅ 完成
3. 本文档 — 对应 Phase 完成标准打钩
4. `docs/reviews/active/README.md` — 更新索引
