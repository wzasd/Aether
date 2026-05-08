---
status: design-final
priority: P1
last_verified: 2026-05-03
doc_kind: feature
---

# Feature: Multi-Model Provider System

## Why

当前只有 Claude CLI 一个 provider。用户无法切换到 Codex、Gemini、Kimi 等其他 AI CLI 工具。不同 CLI 在代码生成、推理深度、成本、速度等方面各有优势，用户应根据任务类型选择最合适的 CLI。

这不是单纯"加几个模型选项"——需要一套可扩展的 Provider 架构，让新增 CLI 的成本降到最低（~半天）。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| M1 | Provider Registry | 注册/发现/启停 provider，应用启动时自动检测已安装 CLI | P0 |
| M2 | ClaudeCLIProvider | 已有，需适配新接口 | P0 |
| M3 | CodexCLIProvider | OpenAI Codex CLI 接入 | P0 |
| M4 | GeminiCLIProvider | Google Gemini CLI 接入 | P0 |
| M5 | KimiCLIProvider | Moonshot Kimi CLI 接入 | P0 |
| M6 | 凭证管理 | 每个 provider 独立 API Key，加密存储 | P0 |
| M7 | 模型选择器升级 | UI 先选 provider 再选 model，显示上下文窗口大小 | P1 |
| M8 | Provider 配置 UI | 设置页中配置 API Key、启用/禁用 provider、测试连接 | P1 |
| M9 | 上下文窗口自适应 | 按模型实际 context window 截断提示词 | P2 |

---

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| DB 存储结构 | `secrets` 表 + `provider_configs` 表分离 | 职责隔离：密钥与配置分离，权限边界清晰，后续接系统 keychain 更干净 |
| `providerType` 来源 | SessionConfig 显式存储，UI 先选 provider 再选 model | `inferProviderType(model)` 字符串匹配脆弱：model id 碰撞、别名变化、同一模型可走不同 provider |
| `inferProviderType` 用途 | 仅作历史数据迁移 fallback | 存量 conversations 只有 model 字段时，启动时一次性补填 providerType |
| Codex 输出格式 | `codex exec --json`，JSONL 完整 item | 不是 `--output-format stream-json`；`item.completed` 一次性输出，需 fake streaming 适配层 |
| Kimi 输出格式 | `kimi --print --output-format stream-json`，role-based JSONL | thinking 内嵌于 content；无显式结束事件，靠进程退出触发 done |
| Gemini 输出格式 | `-o stream-json` flag 已确认 | 具体 JSONL schema 待 spike 补充（Gemini auth 修复后补采集） |
| 不支持 PTY 的 provider | 自动降级到 plan 模式并提示用户 | supportsInteractive=false 时 BaseCLIProvider 统一处理，不抛错 |
| Permission Mode 映射 | 每个 provider 在 `meta.permissionFlags` 中声明 | 移除全局 `PERMISSION_MODE_CLI_MAP`，解耦 claude-specific 参数 |

---

## How

**架构文档**：`docs/architecture/ai-provider.md` — 完整类型定义、BaseCLIProvider 接口、OutputParser 抽象、EventFlow 图。

### CLI 差异矩阵（spike 已验证）

| 维度 | Claude CLI | Codex CLI | Gemini CLI | Kimi CLI |
|------|-----------|-----------|------------|----------|
| **binary** | `claude` | `codex` | `gemini` | `kimi` |
| **headless flag** | `-p` | `codex exec` | `-p` / `--prompt` | `--print` |
| **输出格式 flag** | `--output-format stream-json` | `--json` | `-o stream-json` | `--output-format stream-json` |
| **输出模型** | 增量 delta 流 | 完整 item（非增量） | 待确认 | 完整 message（非增量） |
| **thinking** | `thinking_delta` 事件 | 未知 | 未知 | `content[{type:"think"}]` 内嵌 |
| **工具调用** | `tool_start` + `tool_result` | 待 spike | 待 spike | `tool_calls` 数组 + `role:tool` 行 |
| **PTY 模式** | `claude`（无 flag） | `codex`（无 flag） | `gemini`（无 flag） | `kimi`（无 flag） |
| **permission flag** | `--permission-mode` | `-a` / `--dangerously-bypass` | `--approval-mode` | `--yolo` / `--afk` |
| **会话恢复** | `--resume <id>` | `codex resume <id>` | `-r <id>` | `--resume [id]` |
| **认证** | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` | `GEMINI_API_KEY` | OAuth（`kimi login`） |

### OutputParser 各格式（spike 采集）

详见 `docs/architecture/ai-provider.md` § OutputParser 抽象。

**Codex**（已验证）：
```jsonl
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"Hello..."}}
{"type":"turn.completed","usage":{"input_tokens":26527,"output_tokens":14}}
```

**Kimi**（已验证）：
```jsonl
{"role":"assistant","content":[{"type":"think","think":"..."},{"type":"text","text":"..."}]}
{"role":"assistant","content":[...],"tool_calls":[{"type":"function","id":"tool_xxx","function":{"name":"Shell","arguments":"..."}}]}
{"role":"tool","content":[{"type":"text","text":"..."}],"tool_call_id":"tool_xxx"}
```

**Gemini**：待 spike 补充。

### 错误处理

| 场景 | 处理 |
|------|------|
| CLI 未安装 | 模型选择器灰显该 provider，hover 提示"请先安装 xxx CLI" |
| API Key 未配置 | 选择模型时弹出设置面板 |
| manual 模式但 provider 不支持 PTY | 自动降级到 plan 模式，提示用户 |
| CLI 启动失败 | 显示错误 + 降级回已有 provider |
| 输出解析失败 | 降级为透传模式（原始文本） |
| 进程崩溃 | 发出 error + done 事件，session 标记 error |

---

## Status

📐 **Phase 1 实现完成。** Phase 2 待开始。

### 实现计划

| Phase | 内容 | 预估 | 前置依赖 |
|-------|------|------|---------|
| Phase 1 | 基础架构：secrets + provider_configs DB、接口重构、BaseCLIProvider、ClaudeCLIProvider 适配、Registry、AIEngine 改造、IPC | 2-3 天 | 无 |
| Phase 2 | CodexCLIProvider + GeminiCLIProvider + KimiCLIProvider（各含独立 parser + fixture 测试） | 3-4 天 | Phase 1 |
| Phase 3 | UI：providerStore、ModelSelector 分组重写、Settings Provider 配置 Tab | 2-3 天 | Phase 1 |
| Phase 4 | 补测试、文档更新 | 1 天 | Phase 2+3 |

---

## Phase 1 详细任务

> 完成标准：`pnpm typecheck` 全过，`pnpm build` 通过，`pnpm test` 全绿，Claude CLI 行为与改造前完全一致。

### 任务列表（按实现顺序）

**#1 — secrets.ts + DB schema**
- 新建 `src/main/core/secrets.ts`：`Secrets.set / get / has / delete`，使用 `safeStorage`
- `src/main/core/db.ts`：加 `secrets` 表、`provider_configs` 表（CREATE TABLE IF NOT EXISTS）
- 单测：set/get/has/delete 覆盖正常路径和 key 不存在路径

**#2 — provider.ts 接口重构**
- 加 `PermissionFlagMap`、`ModelInfo`、`ProviderMeta`、`ProviderConfig`
- `SessionConfig` 加 `providerType: string`
- 现有 `AIProvider` 接口改名为 `CLIProvider`，加 `meta` 和 `initialize`
- 新建 `src/main/ai/providers/parsers/output-parser.ts`：`OutputParser` 接口

**#3 — 解耦 PERMISSION_MODE_CLI_MAP**
- `src/main/ai/types.ts`：删除 `PERMISSION_MODE_CLI_MAP` 导出
- `src/main/ipc/chat.ts`：移除对 `PERMISSION_MODE_CLI_MAP` 的 import 和使用（临时用硬编码 Set 过渡，#10 再彻底改）
- 确保 typecheck 通过

**#4 — ClaudeOutputParser**
- 新建 `src/main/ai/providers/parsers/claude-output-parser.ts`
- 封装现有 `EventParser`（stream-json）和 `ManualTuiParser`（PTY），实现 `OutputParser` 接口
- 原文件保留，parser 内部 delegate

**#5 — BaseCLIProvider**
- 新建 `src/main/ai/providers/base-cli-provider.ts`
- 从现有 `claude-cli.ts` 提取公共逻辑：detect、initialize、startSession、endSession、sendMessage、respondPermission、respondQuestion、abort、onEvent/offEvent、emitSessionEvent、emitTerminalFailure
- 4 个抽象方法：`buildStreamJsonArgs`、`buildManualArgs`、`buildEnv`、`createParser`
- PTY fallback：`supportsInteractive=false` 时 manual 降级为 plan

**#6 — ClaudeCLIProvider 继承 BaseCLIProvider**
- `src/main/ai/providers/claude-cli.ts`：继承 BaseCLIProvider，删除公共逻辑，只保留：
  - `meta`（含 CLAUDE_META 常量，内含 permissionFlags）
  - `buildStreamJsonArgs`（原 `buildPrintArgs`）
  - `buildManualArgs`
  - `buildEnv`（从 `Secrets.get('claude-cli')` 读 API Key）
  - `createParser`
- **验收**：typecheck 通过，`pnpm test` 全绿，行为与改造前一致

**#7 — ProviderRegistry**
- 新建 `src/main/ai/provider-registry.ts`
- `register`、`get`、`getAll`、`detectAll`（并行 detect）、`getAvailable`
- `createDefaultRegistry()`：注册 ClaudeCLIProvider，Phase 2 的其他 provider 留注释占位
- 单测：register/get/getAll、detectAll mock（spawn --version）

**#8 — AIEngine 改造**
- `src/main/ai/engine.ts`：构造函数接收 `ProviderRegistry`
- `sessions: Map<string, { session, provider }>` 替换原 `sessions: Map<string, Session>`
- 所有操作从 sessions map 找到对应 provider 再转发
- 删除 `setProvider` 方法，改为 `constructor(registry)`
- 更新 `aiEngine` 单例初始化：`export const aiEngine = new AIEngine(createDefaultRegistry())`

**#9 — IPC + Preload**
- `src/main/ipc/system.ts`：加 6 个 handler（`provider:list`、`provider:detectAll`、`provider:configure`、`provider:setApiKey`、`provider:hasApiKey`、`provider:testConnection`）
- `src/preload/index.ts`：暴露 `api.provider.*` 命名空间

**#10 — chat.ts 验证改造**
- 移除硬编码 `MODELS` Set
- `validateSessionConfig`：校验 `providerType` 为 registry 中已注册的 provider id
- `model` 校验：从对应 provider 的 `meta.models` 动态获取合法 model id 列表

**#11 — agent-runtime.ts providerType 传播**
- `AgentRuntime.start(config)` 中构造 `fullConfig` 时透传 `providerType`
- `AgentProfile` 可选加 `preferredProvider?: string`，不填则继承父 session 的 providerType

**#12 — 补测试**
- `secrets.test.ts`：覆盖 set/get/has/delete
- `provider-registry.test.ts`：register、detectAll（mock spawn）、getAvailable
- `claude-output-parser.test.ts`：用现有 EventParser 测试用例迁移验证

---

## Code（完整文件清单）

| 层 | 文件 | Phase 1 变更 |
|----|------|-------------|
| 主进程 | `src/main/ai/provider.ts` | **修改** — 接口重构 |
| 主进程 | `src/main/ai/types.ts` | **修改** — 移除全局 PERMISSION_MODE_CLI_MAP |
| 主进程 | `src/main/ai/engine.ts` | **修改** — registry 模式 |
| 主进程 | `src/main/ai/provider-registry.ts` | **新建** |
| 主进程 | `src/main/ai/providers/base-cli-provider.ts` | **新建** |
| 主进程 | `src/main/ai/providers/parsers/output-parser.ts` | **新建** — 接口定义 |
| 主进程 | `src/main/ai/providers/parsers/claude-output-parser.ts` | **新建** |
| 主进程 | `src/main/ai/providers/claude-cli.ts` | **修改** — 继承 BaseCLIProvider |
| 主进程 | `src/main/ai/providers/codex-cli.ts` | 新建（Phase 2） |
| 主进程 | `src/main/ai/providers/gemini-cli.ts` | 新建（Phase 2） |
| 主进程 | `src/main/ai/providers/kimi-cli.ts` | 新建（Phase 2） |
| 主进程 | `src/main/core/secrets.ts` | **新建** |
| 主进程 | `src/main/core/db.ts` | **修改** — +secrets +provider_configs |
| 主进程 | `src/main/ipc/system.ts` | **修改** — +6 provider handler |
| 主进程 | `src/main/ipc/chat.ts` | **修改** — 移除硬编码 MODELS，+providerType 校验 |
| 主进程 | `src/main/ai/agent-runtime.ts` | **修改** — providerType 传播 |
| 预加载 | `src/preload/index.ts` | **修改** — api.provider.* |
| 渲染 | `src/renderer/src/components/ModelSelector.tsx` | 重写（Phase 3） |
| 渲染 | `src/renderer/src/components/workspace/SettingsPanel.tsx` | 修改（Phase 3） |
| 渲染 | `src/renderer/src/stores/providerStore.ts` | 新建（Phase 3） |
| 渲染 | `src/renderer/src/stores/sessionConfigStore.ts` | 修改（Phase 3） |

**相关文档**：
- 架构参考：`docs/architecture/ai-provider.md`
- 凭证加密：`docs/features/credential-encryption.md`
- CLI 文档：`docs/modules/kimi-cli-manual.md`、`docs/modules/OpenAI_Codex_CLI_使用文档.md`、`docs/modules/Gemini_CLI_使用手册.docx`
