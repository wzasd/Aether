---
status: implemented
priority: P2
last_verified: 2026-05-04
doc_kind: feature
---

# Feature: MCP 客户端 (Phase H)

## Why

用户需要配置 MCP 服务器（如 filesystem、github、postgres），扩展 AI 的工具调用能力。各 CLI provider（Claude、Kimi）原生支持 MCP 协议，Bytro 负责配置管理和传递。

## What

| 编号 | 需求 | 说明 |
|------|------|------|
| H1 | 项目级 MCP 自动发现 | 扫描 workspace 下的 `.bytro/mcp.json` → `.cursor/mcp.json` → `.claude/mcp.json` |
| H2 | 全局 MCP CRUD | 添加/编辑/删除/启用禁用全局 MCP 服务器 |
| H3 | 市场添加 | 从 npm registry 拉取社区 MCP 服务器，一键安装 |
| H4 | 手动 JSON 配置 | 粘贴 JSON 配置，带安全警告 |
| H5 | 配置合并 | 项目级 + 全局合并，项目级覆盖全局同名 server |
| H6 | Settings UI | Project MCP（只读）+ Global MCP（管理）+ Add 下拉菜单 |
| H7 | CLI 集成 | 会话启动时自动传递 `--mcp-config-file`，包含合并后的配置 |

## How

### 配置来源

```
Layer 1: 全局 mcp_servers 表 (SQLite)     ← UI 管理
Layer 2: 项目级 .bytro/mcp.json          ← 用户手动编辑，覆盖 Layer 1
         ↓ 合并
  ~/.bytro/mcp-config.json
         ↓ --mcp-config-file
  Claude CLI / Kimi CLI
```

### 项目级发现

按优先级依次查找 workspace 目录下：
1. `.bytro/mcp.json`
2. `.cursor/mcp.json`
3. `.claude/mcp.json`

取第一个存在的文件，解析 `mcpServers` 字段。Settings 中只读展示，显示来源路径。

### 添加方式

| 方式 | 说明 |
|------|------|
| **From Marketplace** | 从 npm registry 拉取 `@modelcontextprotocol/server-*` 包列表，含内置 fallback 列表（15 个常用服务器）。搜索、分类筛选、一键安装 |
| **Manual JSON Config** | 粘贴 `{"mcpServers": {...}}` JSON。含安全警告：MCP 服务器可执行任意命令、访问文件和网络，请确认来源可信 |

### 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/mcp/config-file.ts` | 修改 | 项目级发现 + 全局/项目配置合并 |
| `src/main/ipc/mcp.ts` | 修改 | 9 个 IPC handler（list/add/update/remove/toggle/discoverProject/getProjectMcpEnabled/setProjectMcpEnabled/testConnection） |
| `src/main/ipc/index.ts` | 已注册 | registerMcpIpc |
| `src/preload/index.ts` | 修改 | 新增 mcp.discoverProject |
| `src/renderer/src/types/global.d.ts` | 修改 | 类型声明 |
| `src/renderer/src/data/mcp-marketplace.ts` | 新建 | 市场数据（npm fetch + 内置 fallback） |
| `src/main/ai/providers/base-cli-provider.ts` | 修改 | buildMcpArgs(workingDir) |
| `src/main/ai/providers/claude-cli.ts` | 修改 | 传入 workingDir |
| `src/main/ai/providers/kimi-cli.ts` | 修改 | 传入 workingDir |
| `src/renderer/src/components/workspace/WorkspaceArea.tsx` | 修改 | SettingsMcp v2 + MarketplaceModal + JsonEditorModal |

## Status

Phase H v2 完成。typecheck 通过，build 通过，test 127 passed。
