# Bytro P0 设计总览

> 日期: 2026-04-28
> 状态: 待实现

## 目标

将 Bytro 从"基础聊天 Demo"升级为"功能完整的 Claude Chat IDE"，P0 范围聚焦 4 个模块。

## 当前状态

- 核心聊天循环已完成（创建对话、发送消息、流式响应、Thinking/ToolCall 显示、消息持久化、中止请求、侧边栏列表）
- AI 引擎层使用 SDK `query()` 函数，**无法支持权限审批和问题回答交互**
- 6 张 DB 表有 Schema 但无 IPC/UI（oauth_tokens、conversation_usage、conversation_todos、commands、mcp_servers、user_preferences）
- 多项 Store 状态已定义但无 UI（权限模式、待回答问题、Todo、Subagent、Token 用量、模型选择）

## P0 模块

| # | 模块 | 核心变更 | 依赖 |
|---|------|---------|------|
| 1 | ClaudeCLIProvider | 替换 SDK query() 为 CLI child_process + stream-json | 无 |
| 2 | 模型/权限/目录选择器 | 新增 3 个选择器 UI | 模块 1 |
| 3 | 对话管理增强 | 搜索、标题生成、删除确认 | 无 |
| 4 | AI 状态可视化 | Token 用量、Subagent 状态、Todo 列表 | 模块 1 |

模块 1 是基础，模块 2/3/4 可并行开发。

## 架构决策

1. **双模式 CLI 进程**：根据权限模式选择启动方式
   - `plan / autoEdit / fullAuto` → `child_process.spawn` + `-p --output-format stream-json --verbose --input-format stream-json`
   - `manual` → `node-pty` + 交互式 CLI（支持实时权限审批）
2. **AIProvider 抽象层**：定义 `AIProvider` 接口，`ClaudeCLIProvider` 为首个实现，后续加模型只需实现新 Provider
3. **单模型 P0**：P0 只做 Claude，架构预留 Provider 接口
4. **manual 权限审批由 PTY 承担**：`-p` 模式下 default 权限会直接拒绝工具调用，不支持交互式审批

## 模块文档

- [模块 1: ClaudeCLIProvider](../modules/ai-provider.md)
- [模块 2: 选择器](../modules/selectors.md)
- [模块 3: 对话管理增强](../modules/conversation-management.md)
- [模块 4: AI 状态可视化](../modules/ai-status-visualization.md)

## Review 入口

- [P0 设计 Review 问题清单](./2026-04-28-bytro-p0-review.md)

## 不在 P0 范围

- 多模型支持（OpenAI/DeepSeek 等）
- Monaco 代码编辑器
- xterm.js 终端
- 文件浏览器/变更面板
- Git 面板/Worktree
- MCP 服务器管理
- OAuth 认证流程
- 设置页面
