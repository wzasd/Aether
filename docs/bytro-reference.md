# Bytro 1.8.8 反解参考

来源：`Bytro-1.8.8-arm64.dmg` → `Bytro.app/Contents/Resources/remote/app.js`（2846 行，vanilla JS，WebSocket 移动端客户端）

## 1. 事件类型（handleSidecarEvent 分发）

Bytro 原版的事件类型，从 `handleSidecarEvent(evtName, data, envelopeConvId)` 的 switch 分支提取：

| 事件名 | 数据字段 | 说明 |
|--------|---------|------|
| `text_delta` | `{ id, delta }` | 文本增量流式输出 |
| `thinking_delta` | `{ delta }` | 思考过程增量 |
| `complete` | `{ id, fullText }` | AI 回复完成，fullText 为完整文本 |
| `done` | `{ id }` | 请求结束，标记 turn boundary |
| `error` | `{ error }` | 错误 |
| `tool_start` | `{ toolCallId, toolName, toolInput }` | 工具调用开始 |
| `tool_result` | `{ toolCallId, success, result }` | 工具调用结果 |
| `permission_request` | `{ confirmId, id, toolName, toolInput }` | 权限确认请求 |
| `ask_user_question` | `{ confirmId, id, questions: [{question, options}] }` | 用户提问 |
| `tool_denied` | — | 工具被拒绝 |
| `todo_updated` | `{ todos: [{content, status, activeForm}] }` | 任务列表更新 |
| `subagent_started` | `{ agentId, agentType, name, description }` | 子代理启动 |
| `subagent_stopped` | `{ agentId }` | 子代理停止 |
| `subagent_completed` | `{ agentId, result }` | 子代理完成 |
| `session` | — | 会话事件（未处理） |

**与我们的 AIEvent 类型对比**：
- 原版没有 `usage` 事件（token 统计）——我们需要从 `complete` 事件中提取
- 原版没有 `system_init` 事件——我们计划从 CLI init 消息生成
- 原版没有 `subagent_text_delta` / `subagent_thinking_delta`——我们计划添加
- 原版 `done` 是独立事件，不同于 `complete`——我们应保留这个区分

## 2. 权限模式（PERMISSION_MODES）

```typescript
// 原版 4 种权限模式
const PERMISSION_MODES = [
  { id: 'manual',    label: '手动确认', desc: '每个工具调用都需要手动确认', iconKey: 'shield' },
  { id: 'autoEdit',  label: '自动编辑', desc: '自动批准文件编辑操作', iconKey: 'pencil' },
  { id: 'plan',      label: 'Plan 模式', desc: '需要批准计划后自动执行', iconKey: 'file-text', isDefault: true },
  { id: 'fullAuto',  label: '全自动',   desc: '自动批准所有工具调用', iconKey: 'zap', warn: true },
]

// 前端 → CLI 映射（mapPermissionMode 函数）
function mapPermissionMode(mode) {
  switch (mode) {
    case 'fullAuto': return 'bypassPermissions'
    case 'autoEdit': return 'acceptEdits'
    case 'plan':     return 'plan'
    case 'manual':   return 'default'  // default 也是 CLI 的默认权限模式
  }
}
```

**关键发现**：
- `plan` 是默认模式（`isDefault: true`），对应 CLI 的 `--permission-mode plan`
- `fullAuto` 有 `warn: true` 标记，UI 应显示警告
- `autoEdit` 对应 CLI 的 `acceptEdits`——自动批准文件编辑类操作
- `manual` 对应 CLI 的 `default`——每个工具都需要确认

## 3. 工具元数据（TOOL_META）

```typescript
const TOOL_META = {
  // 核心工具（Claude CLI 原生）
  Bash:              { label: '执行命令',   iconKey: 'terminal',  color: '#8B5CF6' },
  Read:              { label: '读取文件',   iconKey: 'file',      color: '#3B82F6' },
  Write:             { label: '写入文件',   iconKey: 'file-edit', color: '#F59E0B' },
  Edit:              { label: '编辑文件',   iconKey: 'pencil',    color: '#F59E0B' },
  Glob:              { label: '查找文件',   iconKey: 'folder',    color: '#10B981' },
  Grep:              { label: '搜索内容',   iconKey: 'search',    color: '#06B6D4' },
  WebFetch:          { label: '网页获取',   iconKey: 'globe',     color: '#8B5CF6' },
  WebSearch:         { label: '网页搜索',   iconKey: 'globe',     color: '#8B5CF6' },
  Task:              { label: '子代理',     iconKey: 'bot',       color: '#EC4899' },
  Agent:             { label: '子代理',     iconKey: 'bot',       color: '#EC4899' },
  TodoWrite:         { label: '任务列表',   iconKey: 'list',      color: '#F59E0B' },
  NotebookEdit:      { label: '笔记本',     iconKey: 'file-edit', color: '#10B981' },
  Delete:            { label: '删除文件',   iconKey: 'trash',     color: '#EF4444' },
  AskUserQuestion:   { label: 'AI 提问',    iconKey: 'message-circle', color: '#8B5CF6' },
  Skill:             { label: '技能',       iconKey: 'zap',       color: '#EC4899' },
  EnterPlanMode:     { label: '计划模式',   iconKey: 'git-branch',color: '#06B6D4' },
  ExitPlanMode:      { label: '退出计划',   iconKey: 'git-branch',color: '#06B6D4' },

  // Bytro 扩展工具（非 CLI 原生）
  TeamCreate:        { label: '创建团队',   iconKey: 'layers',    color: '#EC4899' },
  TeamDelete:        { label: '删除团队',   iconKey: 'trash',     color: '#EF4444' },
  SendMessage:       { label: '发送消息',   iconKey: 'send-arrow',color: '#3B82F6' },
  TaskOutput:        { label: '任务输出',   iconKey: 'layers',    color: '#EC4899' },
  TaskStop:          { label: '停止任务',   iconKey: 'trash',     color: '#EF4444' },
  SecurityReview:    { label: '安全审查',   iconKey: 'shield',    color: '#EF4444' },
  CanvasQuery:       { label: '画布查询',   iconKey: 'layout',    color: '#06B6D4' },
  CanvasUpdate:      { label: '画布更新',   iconKey: 'paintbrush',color: '#A855F7' },
  CanvasCreate:      { label: '画布创建',   iconKey: 'plus',      color: '#10B981' },
  CanvasDelete:      { label: '画布删除',   iconKey: 'eraser',    color: '#EF4444' },

  // MCP 工具自动识别
  // mcp__serverName__toolName → { label: 'serverName:toolName', iconKey: 'cpu', color: '#06B6D4' }
}
```

**P0 Week 2 实现范围**：只实现核心工具（Bash/Read/Write/Edit/Glob/Grep/WebFetch/WebSearch/Task/Agent/TodoWrite/NotebookEdit/Delete/AskUserQuestion/Skill/EnterPlanMode/ExitPlanMode）。Bytro 扩展工具（Team/SendMessage/Canvas/SecurityReview）属于 P1/P2。

## 4. 权限交互路由（handlePermissionRequest）

```typescript
function handlePermissionRequest(data) {
  const toolName = data.toolName || ''

  if (toolName === 'AskUserQuestion' || toolName === 'AskQuestion') {
    showAskOverlay(data)       // 多选/单选问题覆盖层
  } else if (isMultiStepPlan(toolName, data.toolInput)) {
    showApprovalOverlay(data)  // 计划审批覆盖层
  } else {
    showInlineAskCard(data)    // 内联确认卡片
  }
}

function isMultiStepPlan(toolName, toolInput) {
  if (toolName === 'ExitPlanMode') return true
  if (toolName.toLowerCase().indexOf('plan') >= 0) return true
  // 检查 toolInput JSON 中是否有 allowedPrompts 或 steps
  const parsed = JSON.parse(toolInput)
  if (parsed.allowedPrompts) return true
  if (parsed.steps) return true
  return false
}
```

**三种权限 UI 形态**：
1. **Inline Ask Card** — 内联卡片，显示工具名+输入摘要，允许/拒绝按钮
2. **Approval Overlay** — 全屏覆盖层，显示计划步骤，批准/拒绝按钮（用于 ExitPlanMode 和多步骤操作）
3. **Ask Overlay** — 全屏覆盖层，多选/单选问题，带进度条和标签页

**ask_user_question 独立事件**：与 permission_request 分离，有专用 `handleAskUserQuestion` 处理器，数据格式 `{ confirmId, id, questions: [{question, options, multiSelect}] }`。

## 5. WebSocket 通信协议

```typescript
// 上行消息（客户端 → 服务端）
{ type: 'send_message', conversation_id, content, model, provider, permission_mode, images? }
{ type: 'subscribe',    conversation_id }
{ type: 'unsubscribe',  conversation_id }
{ type: 'abort',        request_id }
{ type: 'approve_tool', confirm_id, approved: boolean }
{ type: 'answer_question', confirm_id, answers: { questionText: answerValue } }
{ type: 'pong' }

// 下行消息（服务端 → 客户端）
{ type: 'status',       active_requests: [{request_id, conversation_id}] }
{ type: 'event',        event_name, data, conversation_id }
{ type: 'action_result', action_id, success, error? }
{ type: 'ping' }
```

**与我们的 IPC 通信对比**：
- 原版用 WebSocket（移动端远程连接），我们用 Electron IPC（本地通信）
- 上行消息类型可直接映射到 IPC invoke 通道
- 下行事件映射到 ipcRenderer.on 推送
- `action_result` 是创建会话后的确认消息，包含 `action_id`（即 `request_id`）

## 6. 流式状态管理

```typescript
// 关键状态字段
streamingRequestId: null          // 当前流式请求 ID
isOptimisticStreaming: false      // 发送消息后到收到第一个事件之间的乐观状态
streamingText: ''                 // 累积文本
thinkingText: ''                  // 累积思考文本
tools: {}                         // { toolCallId: { name, input, status, result } }
currentTurnToolIds: []            // 当前 turn 的工具 ID 列表
turnBoundary: false               // turn 边界标记（防止跨 turn 合并工具卡片）
conversationRequestIds: {}        // 当前会话的请求 ID 过滤器
doneRequestIds: {}                // 已完成请求 ID（防止 ActionResult 竞态）
pendingPermission: null           // 待确认权限
todos: []                         // 任务列表
subagents: {}                     // { agentId: { id, name, type, description, status } }
```

**关键设计模式**：
- **Optimistic Streaming**：发送消息后立即显示"运行中"状态，等第一个真实事件到达后切换
- **Turn Boundary**：`done` 事件设置 `turnBoundary = true`，下一个 `tool_start` 不与上一 turn 的工具合并
- **Request ID Filter**：`conversationRequestIds` 过滤事件，只处理当前会话当前请求的事件
- **Done Request Guard**：`doneRequestIds` 防止迟到的 `ActionResult` 重新激活流式状态
- **Streaming Safety Timeout**：5 分钟超时自动清理流式状态

## 7. 工具卡片分组逻辑

原版实现了工具卡片的智能分组——同名连续工具合并为一个 group：

```typescript
// handleToolStart 中的分组逻辑
if (lastToolEl && lastToolEl.getAttribute('data-tool-name') === data.toolName) {
  if (lastToolEl.classList.contains('tool-group')) {
    appendToGroup(lastToolEl, data)       // 已是 group →追加
  } else {
    convertToGroup(lastToolEl, data)      // 单卡片 →转为 group
  }
} else {
  createToolElement(...)                   // 新建单卡片
}
```

**分组 UI**：
- Group header：图标 + 标签 + 计数徽章 + 聚合状态（"2/3 完成"）
- Group items：折叠列表，每项显示输入摘要 + 状态图标
- 点击 header 展开/折叠

## 8. 消息持久化

```typescript
// handleComplete 中保存 AI 消息
const saveBody = { role: 'assistant', content: fullText }
if (toolCallsJson) saveBody.tool_calls = toolCallsJson
apiPost('/conversations/' + conversationId + '/messages', saveBody)

// tool_calls JSON 格式
[
  { id, toolName, toolInput, status: 'completed'|'error', result }
]
```

**与我们的数据模型对比**：
- 原版 tool_calls 是 JSON 字符串，存储在消息表的 `tool_calls` 列
- 我们的设计类似，但增加了 `thinking` 和 `usage` 字段

## 9. 模型列表（动态加载）

```typescript
// 硬编码默认模型
const MODELS = [
  { id: 'claude-opus-4-6',           name: 'Opus 4.6',   provider: 'claude' },
  { id: 'claude-sonnet-4-6',         name: 'Sonnet 4.6', provider: 'claude' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5',  provider: 'claude' },
]

// 动态加载（loadConfig → apiGet('/providers'))
// 返回 providers 数组，每个 provider 有：
// { id, name, has_key, is_active, default_model, agent_type, models: [{id, label, tier}] }
// 动态模型会覆盖硬编码列表
```

## 10. Preview Template 技术栈

Bytro 内置的 preview-template（用于生成预览项目）：

- **Vite + React 18 + TypeScript**
- **shadcn/ui 组件体系**：radix-ui primitives + tailwind-merge + clsx + CVA
- **状态管理**：zustand + immer
- **数据层**：@tanstack/react-query + @tanstack/react-table + axios
- **表单**：react-hook-form + zod
- **图表**：recharts
- **图标**：lucide-react + react-icons + @heroicons/react
- **动画**：framer-motion
- **日期**：date-fns + dayjs

这与我们的技术栈高度一致（React + zustand + tailwind），验证了选型方向正确。