---
status: reference
doc_kind: module
note: 本文档是 P0 设计阶段的模块 spec。运行时架构和事件契约以 docs/architecture/ai-provider.md 为准。
---

# 模块 1: ClaudeCLIProvider

> AIProvider 抽象层 + Claude CLI 进程实现

## 概述

替换当前 `ClaudeProvider`（基于 SDK query()），改用 Claude CLI 进程交互。定义 `AIProvider` 接口供后续多模型扩展。

## 接口定义

```typescript
// src/main/ai/provider.ts

/** AI Provider 统一接口 */
export interface AIProvider {
  /** Provider 类型标识 */
  readonly type: string

  /** 启动会话 */
  startSession(config: SessionConfig): Promise<Session>

  /** 结束会话 */
  endSession(sessionId: string): Promise<void>

  /** 发送用户消息 */
  sendMessage(sessionId: string, content: string): void

  /** 中止当前请求 */
  abort(sessionId: string): void

  /** 监听事件 */
  onEvent(sessionId: string, handler: (event: AIEvent) => void): void

  /** 移除事件监听 */
  offEvent(sessionId: string, handler: (event: AIEvent) => void): void
}

/** 会话配置 */
export interface SessionConfig {
  /** 模型选择 */
  model: 'opus' | 'sonnet' | 'haiku'
  /** 权限模式（复用现有 UI 枚举） */
  permissionMode: PermissionMode  // 'manual' | 'autoEdit' | 'plan' | 'fullAuto'
  /** 工作目录 */
  workingDir: string
  /** 恢复已有会话（--resume） */
  sessionId?: string
}

/** 会话实例 */
export interface Session {
  id: string
  providerType: string
  config: SessionConfig
  status: 'idle' | 'running' | 'waiting_permission' | 'waiting_question' | 'error'
  createdAt: number
}
```

## 权限模式映射

复用现有 `PermissionMode` 枚举和 `PERMISSION_MODE_CLI_MAP`：

```typescript
// 已存在于 src/main/ai/types.ts
type PermissionMode = 'manual' | 'autoEdit' | 'plan' | 'fullAuto'

const PERMISSION_MODE_CLI_MAP: Record<PermissionMode, string> = {
  manual: 'default',
  autoEdit: 'acceptEdits',
  plan: 'plan',
  fullAuto: 'bypassPermissions'
}
```

UI state → SessionConfig.permissionMode → CLI `--permission-mode` 参数，三层命名统一。

## ClaudeCLIProvider 实现

### 双模式启动

实测发现：CLI 的 `-p`（print）模式下，`default` 权限模式会**直接拒绝**工具调用，而非暂停等待 stdin 审批。因此需要根据权限模式选择不同启动方式：

| 权限模式 | 启动方式 | 权限交互 |
|---------|---------|---------|
| `plan` / `autoEdit` / `fullAuto` | child_process + `-p` stream-json | 无需交互，CLI 自动处理 |
| `manual` | node-pty + 交互式 CLI | PTY 支持实时权限审批 |

### 模式 A: child_process + stream-json（plan/autoEdit/fullAuto）

```typescript
const args = [
  '-p',                                    // print 模式
  '--output-format', 'stream-json',        // JSON 流输出
  '--verbose',                             // 包含 tool_use/tool_result 详情
  '--input-format', 'stream-json',         // JSON 流输入
  '--model', config.model,                 // 模型选择
  '--permission-mode', PERMISSION_MODE_CLI_MAP[config.permissionMode]
]
if (config.sessionId) {
  args.push('--resume', config.sessionId)
}
```

数据流：
```
用户消息 → stdin 写入 {"type":"user_message","content":"..."}（实测确认格式）
         ↓
CLI 处理 → stdout 输出 JSON 行流
         ↓
EventParser 逐行解析 → 映射到 AIEvent → 通过 onEvent 回调分发
```

> 注意：`-p` + stream-json 模式下 stdin 仅支持 `user_message` 类型。权限审批和问题回答不通过 stdin JSON 协议交互，而是通过 PTY 模式的文本输入实现。

### 模式 B: node-pty + 交互式 CLI（manual）

```typescript
const ptyProcess = pty.spawn('claude', [
  '--output-format', 'stream-json',
  '--verbose',
  '--model', config.model,
  '--permission-mode', 'default'
], {
  cwd: config.workingDir,
  env: process.env
})
```

- PTY 模式下 CLI 会暂停等待用户输入权限审批
- 解析 PTY 输出中的权限请求事件
- 通过 PTY stdin 写入审批响应（y/n）
- 需要额外依赖 `node-pty`

### 权限审批交互（仅 manual 模式）

manual 模式下，CLI 需要权限审批时：
1. CLI 输出权限请求提示到 PTY
2. Provider 解析提示，发出 `PermissionRequestEvent` 到 UI
3. 用户在 UI 点击 Allow/Deny
4. Provider 通过 PTY stdin 写入 `y` 或 `n`

```typescript
respondPermission(sessionId: string, approved: boolean): void {
  // PTY 模式：写入 y/n
  this.ptyWrite(sessionId, approved ? 'y\n' : 'n\n')
}
```

### 问题回答交互（仅 manual 模式）

```typescript
respondQuestion(sessionId: string, answer: string): void {
  // PTY 模式：写入回答文本
  this.ptyWrite(sessionId, answer + '\n')
}
```

## 事件映射

CLI stream-json 输出事件，映射到现有 AIEvent 体系：

| CLI 事件 | 映射到 AIEvent type | 说明 |
|----------|-------------------|------|
| `system` subtype=`init` | `system_init` | 会话初始化，含 session_id、tools、model |
| `system` subtype=`hook_started` | `subagent_started` | Subagent 开始 |
| `system` subtype=`hook_response` | `subagent_completed` | Subagent 完成 |
| `assistant` content=`text` | `text_delta` | 文本回复 |
| `assistant` content=`thinking` | `thinking_delta` | 思考过程 |
| `assistant` content=`tool_use` | `tool_start` | 工具调用请求 |
| `user` content=`tool_result` | `tool_result` | 工具执行结果 |
| `result` subtype=`success` | `complete` + `done` | 成功结束，含 cost/usage |
| `result` subtype=`error` | `error` + `done` | 错误结束 |

> 映射目标类型名与 `src/main/ai/types.ts` 中现有 AIEvent 定义一致。

## EventParser

```typescript
// src/main/ai/event-parser.ts

export class EventParser {
  /** 解析 CLI stdout 的一行 JSON */
  parseLine(line: string): AIEvent | null {
    const data = JSON.parse(line)
    switch (data.type) {
      case 'system':
        return data.subtype === 'init'
          ? this.parseInit(data)
          : this.parseHook(data)
      case 'assistant':
        return this.parseAssistant(data)
      case 'user':
        return this.parseUser(data)
      case 'result':
        return this.parseResult(data)
      default:
        return null
    }
  }
}
```

## 会话管理

- **新建会话**：spawn 新进程（child_process 或 PTY），从 system/init 事件获取 session_id
- **恢复会话**：传入 `--resume <session_id>`，CLI 自动加载历史上下文
- **中止请求**：kill 进程
- **会话状态**：根据事件流更新 Session.status

## 文件结构

```
src/main/ai/
├── provider.ts              # AIProvider 接口 + SessionConfig + Session
├── providers/
│   └── claude-cli.ts        # ClaudeCLIProvider 实现（双模式）
├── event-parser.ts          # CLI stream-json → AIEvent 映射
├── engine.ts                # AIEngine（改造：委托给 AIProvider）
└── types.ts                 # 共享类型（PermissionMode、AIEvent 等）
```

## 与现有代码的变更

| 文件 | 变更 |
|------|------|
| `src/main/ai/providers/claude.ts` | 删除（替换为 claude-cli.ts） |
| `src/main/ai/engine.ts` | 改造：AIEngine 持有 AIProvider 实例，委托调用 |
| `src/main/ipc/chat.ts` | 适配新 AIEngine API |
| `src/preload/index.ts` | 新增 IPC 通道：permission:respond、question:respond |
| `src/renderer/src/stores/chatStore.ts` | 新增权限审批和问题回答的 action |
| `package.json` | 新增依赖：node-pty（manual 模式需要） |

## 实测确认结论

1. **`-p` + stream-json 模式下 default 权限会直接拒绝工具调用**，不会暂停等待 stdin → 需要双模式启动
2. **plan/autoEdit/fullAuto 模式下 `-p` + stream-json 完全可用** → child_process 即可
3. **manual 模式需要 PTY** → 交互式 CLI 才支持实时权限审批
4. **`--resume` 恢复会话可用** → 解决了会话历史问题
5. **并发多会话待验证** → 需在实现时测试
