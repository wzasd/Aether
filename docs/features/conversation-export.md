---
status: implemented
priority: P2
last_verified: 2026-05-03
doc_kind: feature
---

# Feature: Conversation Export

## Why

用户需要将对话导出为可分享、可存档的格式。Markdown 适合导入笔记工具，JSON 适合程序化处理或数据迁移。

**用户故事**：在 TaskRail 右键一个会话 → 导出为 Markdown → 保存到本地文件，包含完整的对话内容、工具调用和代码块。

## What

| 编号 | 需求 | 说明 | 优先级 |
|------|------|------|--------|
| E1 | 导出为 Markdown | 格式化对话为可读的 .md 文件 | P0 |
| E2 | 导出为 JSON | 原始数据格式，适合迁移/处理 | P0 |
| E3 | 导出选项 | 可选择包含/排除 思考块、工具调用、系统消息 | P1 |
| E4 | 批量导出 | 选择多个会话一次性导出为 .zip | P2 |
| E5 | 导出进度 | 大文件导出时显示进度 | P2 |

## How

### Markdown 导出格式

```markdown
# <对话标题>

> 模型: Claude Sonnet 4.6 | 时间: 2026-05-02 14:30:00
> 工作目录: /Users/xxx/my-project
> 消息数: 24 | Token: 输入 8,200 / 输出 1,450

---

## User

请帮我重构 auth 模块，提取公共逻辑

## Assistant (Claude Sonnet 4.6)

我来分析现有的 auth 模块结构...

```ts
// src/auth/login.ts
export async function login() { ... }
```

### 工具调用

| 工具 | 参数 | 结果 |
|------|------|------|
| Read | `src/auth/login.ts` | ✅ |
| Grep | `pattern: "login"` | ✅ 找到 3 个匹配 |
| Write | `src/auth/login.ts` | ✅ +12 / -3 |

---

## User

很好，继续优化

## Assistant

...
```

### 导出 IPC

```
Renderer                          Main Process
────────                          ────────────
exportConversation(id, format)
  ──────── IPC ────────────────→
                                  db 查询 messages
                                  构建 Markdown / JSON
                                  调用 dialog.showSaveDialog()
                                  fs.writeFile(path, content)
  ←─────── IPC ────────────────
  { success: true, path: "..." }
```

### IPC Handler

```typescript
// src/main/ipc/conversation.ts

ipcMain.handle('conversation:export', async (_event, params: {
  conversationId: string
  format: 'markdown' | 'json'
  options?: ExportOptions
}) => {
  const conv = getConversation(params.conversationId)
  const messages = getMessages(params.conversationId)
  const content = params.format === 'markdown'
    ? buildMarkdownExport(conv, messages, params.options)
    : buildJsonExport(conv, messages, params.options)

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${sanitizeFilename(conv.title)}.${params.format === 'markdown' ? 'md' : 'json'}`,
    filters: [{
      name: params.format === 'markdown' ? 'Markdown' : 'JSON',
      extensions: [params.format === 'markdown' ? 'md' : 'json']
    }]
  })

  if (filePath) {
    await fs.promises.writeFile(filePath, content, 'utf-8')
    return { success: true, path: filePath }
  }
  return { success: false, reason: 'cancelled' }
})
```

### 导出选项

```typescript
interface ExportOptions {
  includeThinking: boolean     // 是否包含思考过程（默认 false）
  includeToolCalls: boolean    // 是否包含工具调用详情（默认 true）
  includeSystemMessages: boolean // 是否包含系统消息（默认 false）
  includeUsage: boolean        // 是否包含 token 统计（默认 true）
}
```

## Status

✅ **已实现。** 2026-05-03

## Code

| 层 | 文件 | 变更 |
|----|------|------|
| 主进程 | `src/main/ipc/conversation.ts` | **增强** — 增加 `conversation:export` handler |
| 主进程 | `src/main/utils/export.ts` | **新建** — Markdown/JSON 构建逻辑 |
| 预加载 | `src/preload/index.ts` | **增强** — `api.conversation.export()` |
| 渲染 | `src/renderer/src/components/ConversationExportMenu.tsx` | **新建** — 导出菜单 |
| 渲染 | TaskRail 右键菜单 | **增强** — 增加导出选项 |
