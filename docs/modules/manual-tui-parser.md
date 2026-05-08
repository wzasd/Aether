---
status: reference
doc_kind: module
note: P0 设计阶段的模块 spec。当前实现以 src/main/ai/manual-tui-parser.ts 和 docs/architecture/ai-provider.md 为准。
---

# 模块: ManualTuiParser

> PTY TUI 输出解析器（manual 权限模式专用）

## 概述

解析 Claude CLI 交互式 TUI 的原始终端输出，映射为 AIEvent。用于 manual 权限模式下 `node-pty` 启动的 CLI 进程。与 `EventParser`（stream-json 模式）互补。

## 核心挑战

交互式 CLI 输出是 ANSI 转义序列混合的文本流，没有结构化 JSON 协议。解析器必须：
1. 剥离 ANSI 转义序列和控制字符
2. 识别工具调用（⏺/• 前缀 + 关键词匹配）
3. 检测权限审批提示（approve/allow/deny 关键词）
4. 检测用户提问提示（? + which/what/how 关键词）
5. 过滤 UI 噪音（版本号、快捷键提示、分隔线等）

## 解析流程

```
PTY raw output
  → normalizeChunk()     [剥离 ANSI + 控制字符]
  → split lines
  → normalizeLine()      [压缩空白]
  → filter isUiNoise()   [过滤噪音行]
  → detectTool()         [⏺/• 前缀 + 关键词 → tool_start]
  → isPermissionPrompt() [权限关键词 → permission_request]
  → isQuestionPrompt()   [提问关键词 → ask_user_question]
  → ⎿ 前缀行            [工具输出续行]
  → 其他文本             [assistant text_delta]
  → PROMPT_RE (❯)       [turn 结束 → complete + done]
```

## 工具检测模式

```typescript
const TOOL_PATTERNS = [
  { regex: /\b(reading|opened|opening|inspecting)\b/i, toolName: 'Read' },
  { regex: /\b(searching|grep|ripgrep)\b/i, toolName: 'Grep' },
  { regex: /\b(finding|listing|glob)\b/i, toolName: 'Glob' },
  { regex: /\b(running|executing|bash|command)\b/i, toolName: 'Bash' },
  { regex: /\b(editing|patching|modifying|updating)\b/i, toolName: 'Edit' },
  { regex: /\b(writing|creating|saving)\b/i, toolName: 'Write' },
  { regex: /\b(deleting|removing)\b/i, toolName: 'Delete' },
  { regex: /\b(todowrite|todo)\b/i, toolName: 'TodoWrite' },
  { regex: /\b(subagent|agent|task)\b/i, toolName: 'Task' },
  { regex: /\b(websearch|searching the web)\b/i, toolName: 'WebSearch' },
  { regex: /\b(webfetch|fetching)\b/i, toolName: 'WebFetch' }
]
```

## Turn 生命周期

```
beginTurn()           → 重置所有内部状态
consume(raw)          → 解析 PTY 输出，返回 AIEvent[]
  → 检测到 ❯ prompt → finishTurn() → emit complete + done
resolveInteraction()  → 清除 pending permission/question 状态
cancelTurn()          → 重置状态（Ctrl+C 中止时）
```

## 与 EventParser 的对比

| 特性 | EventParser | ManualTuiParser |
|------|-------------|-----------------|
| 输入格式 | JSON 行流 | 原始 ANSI 文本流 |
| 权限模式 | plan/autoEdit/fullAuto | manual |
| 解析方式 | JSON.parse + 字段映射 | 正则匹配 + 启发式 |
| 可靠性 | 高（结构化协议） | 中（依赖 TUI 格式稳定） |
| 权限交互 | 不需要（CLI 自动处理） | 需要检测提示并暂停 |

## 代码位置

`src/main/ai/manual-tui-parser.ts` (完整文件，~360 行)
