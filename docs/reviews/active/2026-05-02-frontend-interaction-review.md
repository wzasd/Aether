---
status: active
owner: mochi
date: 2026-05-02
doc_kind: review
scope: frontend-interaction
---

# Frontend Interaction Review

> Updated 2026-05-02: Integrated findings from full UI audit pass.

## Findings

### P0 — Critical (0 open)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| 1 | SharedConversation 死代码（~580行内部组件、输入框、模式切换器） | ✅ Fixed | 移除所有死代码，保留容器+titlebar+agent strip+SessionChangesSummary |
| 2 | 双底部面板（WorkspaceShell BottomOutput + WorkspaceArea 内部面板） | ✅ Fixed | 移除 WorkspaceArea 内部面板，统一使用 WorkspaceShell 的 BottomOutput |
| 3 | TOOL_META 重复定义（SharedConversation 16项 vs ToolCall 17项） | ✅ Fixed | 提取到 `utils/toolMeta.ts` 共享模块 |
| 4 | 主题系统冲突（语义 token vs zinc 硬编码值不一致） | ✅ Fixed | `.dark` 语义变量对齐 zinc 色阶 |

### P1 — High (0 open)

| # | Finding | Status | Fix |
|---|---------|--------|-----|
| 5 | 双模式切换器（SharedConversation + ChatInput 各一个） | ✅ Fixed | 随 SharedConversation 死代码清理移除 |
| 6 | 双输入框（SharedConversation + ChatInput 各一个） | ✅ Fixed | 随 SharedConversation 死代码清理移除 |
| 7 | App.tsx 双重 `loadConversations()` 调用 | ✅ Fixed | 移除无参数调用，保留带 `currentWorkspaceId` 的调用 |
| 8 | titlebar-drag z-index 问题 | ✅ N/A | 检查确认当前结构正确（内容区 z-10 在拖拽区之上） |
| 9 | Panel Picker Portal z-index | ✅ N/A | 检查确认 z-[99]/z-[100] 结构合理 |

### P2 — Medium (2 open)

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| 10 | ChatInput Paperclip 按钮无功能 | ✅ Fixed | 添加 `disabled` + `cursor-not-allowed` + `opacity-50` + tooltip "Attachments coming soon" |
| 11 | 颜色系统代码层面不统一 | 🔲 Open | 工作区组件用 zinc-* 类，聊天组件用语义 token。视觉已一致（`.dark` 对齐），但代码需统一 |
| 12 | 排版精度（text-xs vs text-[12px]） | 🔲 Open | 设计规范要求精确像素值，当前用 Tailwind 预设 |

### P3 — Low (3 open)

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| 13 | macOS Traffic Lights 无 IPC 绑定 | 🔲 Open | TaskRail 三色圆点是装饰性 div |
| 14 | type:'plan' / type:'change' 消息卡片缺失 | 🔲 Open | MessageItem 未处理这些消息类型 |
| 15 | 字体设置（缺少 Inter + JetBrains Mono） | 🔲 Open | main.css 使用系统字体栈 |

## Architecture Notes

### SharedConversation 职责（清理后）
- 作为中间面板容器（title bar + project selector + agent strip）
- 包裹 `<Routes>` 渲染对话页面
- 底部显示 SessionChangesSummary（文件变更摘要）
- 不再包含任何对话 UI 逻辑

### 底部面板架构（统一后）
- WorkspaceShell 的 `BottomOutput` 是唯一的底部面板
- 通过 `uiStore.bottomPanelOpen` 控制显隐
- WorkspaceArea 的 Terminal 按钮调用 `onToggleBottomPanel` 切换

### TOOL_META 架构（统一后）
- `utils/toolMeta.ts` 导出 `TOOL_META`、`getToolMeta`、`formatToolInput`、`basename`
- ToolCall.tsx 从共享模块导入
- SharedConversation 不再使用 TOOL_META

## Test Checklist

- [ ] 三栏布局正常显示（TaskRail 17% + SharedConversation 28% + Workspace 55%）
- [ ] SharedConversation 只显示 titlebar + agent strip + 对话内容 + SessionChangesSummary
- [ ] 底部面板只在 WorkspaceShell 层出现一次
- [ ] Terminal 按钮正确切换底部面板
- [ ] ToolCall 组件正确显示工具名称和颜色
- [ ] Paperclip 按钮显示为 disabled 状态
- [ ] 暗色模式下语义 token 和 zinc 值视觉一致
