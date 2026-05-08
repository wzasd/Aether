# OpenAI Codex CLI 使用文档

> 官网：https://developers.openai.com/codex/cli  
> 开源仓库：https://github.com/openai/codex  
> 文档版本：2026年5月

---

## 目录

1. [Codex CLI 简介](#1-codex-cli-简介)
2. [安装与设置](#2-安装与设置)
3. [快速入门](#3-快速入门)
4. [交互式 TUI 模式](#4-交互式-tui-模式)
5. [命令行选项与参数](#5-命令行选项与参数)
6. [审批模式与安全沙箱](#6-审批模式与安全沙箱)
7. [Slash 命令](#7-slash-命令)
8. [恢复对话](#8-恢复对话)
9. [图像输入](#9-图像输入)
10. [模型与推理控制](#10-模型与推理控制)
11. [MCP 工具集成](#11-mcp-工具集成)
12. [本地代码审查](#12-本地代码审查)
13. [Web 搜索](#13-web-搜索)
14. [非交互式自动化模式](#14-非交互式自动化模式)
15. [主题与高亮](#15-主题与高亮)
16. [实用技巧与快捷键](#16-实用技巧与快捷键)
17. [配置文件](#17-配置文件)
18. [故障排除](#18-故障排除)

---

## 1. Codex CLI 简介

**Codex CLI** 是 OpenAI 推出的开源编码助手，基于 Rust 构建，以追求极致的速度和效率。它可以直接在你的终端中运行，能够：

- **读取** 你当前目录下的代码仓库
- **修改** 项目中的文件
- **执行** 终端命令（如编译、测试、运行等）
- **理解** 截图和设计稿（图像输入）

### 包含 Codex 的订阅计划

Codex CLI 对以下 ChatGPT 订阅用户开放：

| 订阅类型 | 是否包含 |
|---------|---------|
| ChatGPT Plus | ✅ |
| ChatGPT Pro | ✅ |
| ChatGPT Business | ✅ |
| ChatGPT Edu | ✅ |
| ChatGPT Enterprise | ✅ |

### 支持的操作系统

- macOS
- Linux
- Windows（原生 PowerShell 或 WSL2）

---

## 2. 安装与设置

### 2.1 使用 npm 安装（推荐）

```bash
# 全局安装
npm i -g @openai/codex
```

### 2.2 使用 Homebrew 安装（macOS/Linux）

```bash
brew install codex
```

### 2.3 升级 Codex

Codex 会定期发布新版本，建议保持更新：

```bash
# 使用 npm 升级
npm i -g @openai/codex@latest
```

### 2.4 首次运行认证

安装完成后，在终端运行：

```bash
codex
```

首次运行时会提示你登录。支持两种认证方式：

1. **ChatGPT 账号登录** — 使用你的 OpenAI 账号
2. **API Key** — 使用 OpenAI API 密钥

```bash
# 登出（在共享机器上使用）
codex logout
```

---

## 3. 快速入门

### 3.1 启动交互式会话

```bash
# 进入项目目录后启动
cd my-project
codex

# 或者直接指定工作目录
codex --cd /path/to/project
```

### 3.2 带初始提示启动

```bash
# 启动时直接给出指令
codex "请解释这个代码库的结构"

# 或者
codex "帮我修复 src/utils.js 中的所有 bug"
```

### 3.3 附加图像

```bash
# 附加截图或设计稿
codex -i screenshot.png "按照这个设计稿实现页面"

# 附加多张图片
codex -i "design.png,spec.png" "参考这些图片实现功能"
```

### 3.4 基本工作流程

1. 运行 `codex` 启动交互式界面
2. 在底部输入框中描述你的需求
3. 查看 Codex 给出的执行计划
4. 批准或拒绝每个步骤
5. 查看代码修改和命令执行结果
6. 继续迭代或结束会话

---

## 4. 交互式 TUI 模式

运行 `codex` 后会进入全屏终端用户界面（TUI），这是 Codex 的核心交互模式。

### 4.1 TUI 界面元素

| 区域 | 说明 |
|------|------|
| 主区域 | 显示对话历史、代码块、diff 对比 |
| 底部输入框 | 输入提示词、代码片段、截图 |
| 状态栏 | 显示当前模型、审批模式等信息 |

### 4.2 交互式操作

- **发送提示**：在输入框中输入内容按 `Enter` 发送
- **粘贴代码**：直接粘贴代码片段到输入框
- **查看计划**：Codex 会在执行前展示操作计划，你可以逐条审批
- **查看 Diff**：所有文件修改会以语法高亮的 diff 形式展示
- **图片输入**：支持将截图或设计稿直接拖入或粘贴到输入框

### 4.3 常用控制命令

| 操作 | 快捷键/命令 |
|------|------------|
| 清除终端并新开会话 | `/clear` |
| 清屏（不开始新对话） | `Ctrl + L` |
| 复制最新输出 | `/copy` 或 `Ctrl + O` |
| 查看 Git diff | `/diff` |
| 退出会话 | `Ctrl + C` 或 `/exit` |
| 搜索历史记录 | `Ctrl + R` |
| 导航草稿历史 | `↑` / `↓` |
| 排队后续指令 | `Tab` |

### 4.4 在运行中排队指令

当 Codex 正在执行任务时，你可以按 `Tab` 键排队下一条指令，包括：

- 后续文本提示
- Slash 命令
- `!` 开头的 shell 命令

Codex 会在当前回合完成后自动处理排队的指令。

---

## 5. 命令行选项与参数

### 5.1 全局标志（Global Flags）

以下标志适用于 `codex` 主命令及其子命令：

| 标志 | 简写 | 类型 | 说明 |
|------|------|------|------|
| `--add-dir` | | path | 授予额外目录的写入权限，可重复使用多个路径 |
| `--ask-for-approval` | `-a` | untrusted / on-request / never | 控制何时暂停等待人工审批 |
| `--cd` | `-C` | path | 设置代理的工作目录 |
| `--config` | `-c` | key=value | 覆盖配置文件中的值 |
| `--dangerously-bypass-approvals-and-sandbox` | `--yolo` | boolean | ⚠️ 跳过所有审批和沙箱（仅在外部已加固的环境中使用） |
| `--disable` | | feature | 强制禁用某个功能标志 |
| `--enable` | | feature | 强制启用某个功能标志 |
| `--image` | `-i` | path[,path...] | 附加一个或多个图像文件 |
| `--model` | `-m` | string | 覆盖配置的模型（如 `gpt-5.4`） |
| `--no-alt-screen` | | boolean | 禁用 TUI 的备用屏幕模式 |
| `--oss` | | boolean | 使用本地开源模型（需 Ollama 运行） |
| `--profile` | `-p` | string | 加载指定的配置配置文件 |
| `--remote` | | ws://host:port | 连接到远程应用服务器 |
| `--sandbox` | `-s` | read-only / workspace-write / danger-full-access | 选择沙箱策略 |

### 5.2 子命令概览

| 子命令 | 成熟度 | 说明 |
|--------|--------|------|
| `codex` | Stable | 启动终端 UI，接受全局标志和可选提示 |
| `codex resume` | Stable | 恢复之前的会话 |
| `codex exec` | Stable | 非交互式执行模式 |
| `codex fork` | Stable | 基于已有会话创建分支 |
| `codex review` | Stable | 运行本地代码审查 |

### 5.3 使用示例

```bash
# 使用特定模型启动
codex -m gpt-5.4

# 只读沙箱模式
codex -s read-only

# 指定工作目录并添加额外目录
codex -C /path/to/project --add-dir /path/to/shared

# 非交互式执行
codex exec -a never "运行所有测试"

# 恢复最近的会话
codex resume --last

# 恢复特定会话
codex resume <SESSION_ID>

# 使用 OSS 模型
codex --oss "解释这段代码"
```

---

## 6. 审批模式与安全沙箱

Codex 重视安全性，提供了多种审批模式和沙箱策略。

### 6.1 审批模式（--ask-for-approval / -a）

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `untrusted` | 对不受信任的命令要求审批 | 默认保守模式 |
| `on-request` | 按请求审批（推荐用于交互式运行） | 日常开发 |
| `never` | 从不审批（推荐用于非交互式运行） | CI/CD 自动化 |

> **注意**：`on-failure` 模式已弃用，请使用 `on-request` 或 `never`。

### 6.2 沙箱策略（--sandbox / -s）

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| `read-only` | 只读访问，不能修改文件 | 安全审查、代码阅读 |
| `workspace-write` | 可读写当前工作目录 | 日常开发（推荐） |
| `danger-full-access` | 完全文件系统访问 | ⚠️ 仅在受信环境中使用 |

### 6.3 安全建议

- **默认使用 workspace-write 沙箱**，限制文件访问范围
- **不要在生产服务器上使用 `--yolo` 模式**
- **在共享机器上使用完毕后执行 `/logout` 清除凭据**
- **对于自动化场景**，使用 `codex exec -a never -s workspace-write`

---

## 7. Slash 命令

Slash 命令是 Codex 交互式会话中的快捷控制指令。在输入框中输入 `/` 即可弹出命令菜单。

### 7.1 会话控制

| 命令 | 说明 |
|------|------|
| `/clear` | 清除终端并开始新的聊天 |
| `/compact` | 压缩对话历史以释放 Token |
| `/copy` | 复制最新完成的 Codex 输出 |
| `/diff` | 显示 Git diff（包括未跟踪的文件） |
| `/exit` 或 `/quit` | 退出 CLI 会话 |
| `/logout` | 登出 Codex |

### 7.2 模型与性能

| 命令 | 说明 |
|------|------|
| `/model` | 切换当前使用的模型 |
| `/fast` | 切换到快速模式（较低推理深度） |
| `/full` | 切换到完整推理模式 |

### 7.3 审批与权限

| 命令 | 说明 |
|------|------|
| `/permissions` | 设置 Codex 无需询问即可执行的操作 |
| `/sandbox-add-read-dir` | 授予沙箱对额外目录的读取权限（Windows） |

### 7.4 智能体与子任务

| 命令 | 说明 |
|------|------|
| `/agent` | 切换活跃的子智能体线程 |
| `/subagents` | 管理子智能体 |

### 7.5 工具与集成

| 命令 | 说明 |
|------|------|
| `/apps` | 浏览并插入应用连接器 |
| `/plugins` | 浏览已安装和可发现的插件 |
| `/mcp` | 列出已配置的 MCP 工具 |
| `/web` | 执行 Web 搜索 |

### 7.6 项目配置

| 命令 | 说明 |
|------|------|
| `/init` | 在当前目录生成 AGENTS.md 脚手架文件 |
| `/personality` | 切换 Codex 的性格/风格 |

### 7.7 其他

| 命令 | 说明 |
|------|------|
| `/experimental` | 切换实验性功能 |
| `/feedback` | 向 Codex 维护者发送日志反馈 |
| `/status` | 查看当前会话状态 |
| `/theme` | 预览和切换主题 |

### 7.8 排队 Slash 命令

当 Codex 正在运行时，你可以输入 slash 命令并按 `Tab` 将其排队到下一回合执行。Codex 会在当前回合完成后解析并执行排队的命令。

---

## 8. 恢复对话

Codex 会在本地存储所有对话记录，方便你随时从中断处继续。

### 8.1 恢复交互式会话

```bash
# 启动会话选择器（显示最近的会话）
codex resume

# 显示所有会话（不限于当前目录）
codex resume --all

# 直接恢复最近的一个会话
codex resume --last

# 恢复特定会话（从选择器、/status 或 ~/.codex/sessions/ 中获取 ID）
codex resume <SESSION_ID>
```

### 8.2 恢复非交互式执行

```bash
# 恢复最近的执行会话并继续
codex exec resume --last "修复你发现的竞态条件"

# 恢复特定执行会话
codex exec resume 7f9f9a2e-1b3c-4c7a-9b0e-.... "实施计划"
```

### 8.3 恢复时的额外选项

```bash
# 恢复时覆盖工作目录
codex resume --last --cd /new/path

# 恢复时添加额外目录
codex resume --last --add-dir /extra/dir
```

每次恢复的会话都会保留：原始对话记录、计划历史、审批决策，使 Codex 能够利用之前的上下文继续工作。

---

## 9. 图像输入

Codex 支持将截图、设计稿等图像作为输入，让它"看见"视觉内容。

### 9.1 启动时附加图像

```bash
# 附加单张图片
codex -i screenshot.png "按照这张设计稿实现"

# 附加多张图片
codex -i "ui-mockup.png,flowchart.png" "参考这些图片"
```

### 9.2 会话中附加图像

在交互式会话中，你可以直接将图片拖入输入框，或使用系统的粘贴快捷键粘贴截图。

### 9.3 常见使用场景

- **UI 实现**：将 Figma 截图或设计稿发给 Codex，让它生成对应的 HTML/CSS
- **Bug 报告**：附上错误截图，让 Codex 定位和修复问题
- **流程图理解**：发送架构图，让 Codex 理解系统结构
- **代码审查**：高亮问题区域的截图，辅助说明问题

---

## 10. 模型与推理控制

### 10.1 切换模型

在会话中使用 `/model` 命令切换模型：

```
/model
```

支持的模型包括：

| 模型 | 说明 |
|------|------|
| GPT-5.4 | 最强大的通用模型 |
| GPT-5.3-Codex | 针对编码优化的模型 |

也可以在启动时指定：

```bash
codex -m gpt-5.4
codex -m gpt-5.3-codex
```

### 10.2 调整推理级别

| 命令 | 说明 |
|------|------|
| `/fast` | 快速响应，推理深度较低 |
| `/full` | 完整推理，更深入但较慢 |

### 10.3 使用本地开源模型

如果你有 Ollama 在本地运行，可以使用 `--oss` 标志：

```bash
codex --oss "解释这段代码"
```

> 确保 Ollama 服务已在运行。Codex 会自动验证 Ollama 是否可用。

---

## 11. MCP 工具集成

Model Context Protocol (MCP) 允许 Codex 调用外部工具来扩展能力。

### 11.1 查看可用 MCP 工具

在交互式会话中：

```
/mcp
```

这将列出当前配置的所有 MCP 工具，Codex 可以在会话中调用这些工具来完成任务。

### 11.2 MCP 应用场景

- 数据库查询和操作
- 文件系统操作
- API 调用
- 第三方服务集成

---

## 12. 本地代码审查

Codex 可以在本地运行代码审查，发现潜在问题。

### 12.1 运行代码审查

```bash
# 审查当前目录的代码
codex review

# 审查特定文件
codex review src/main.js

# 审查特定目录
codex review src/
```

### 12.2 审查内容

Codex 会检查：

- 代码风格和格式问题
- 潜在的 Bug 和逻辑错误
- 安全漏洞
- 性能优化机会
- 代码异味

---

## 13. Web 搜索

Codex 可以执行 Web 搜索来获取最新信息。

### 13.1 使用 Web 搜索

在交互式会话中：

```
/web 搜索最新的 React 19 特性
```

或者在提示中直接请求：

```
请搜索并总结最新的 TypeScript 5.8 新功能
```

### 13.2 应用场景

- 查找最新的库版本和 API 文档
- 了解技术新闻和趋势
- 验证解决方案的最佳实践
- 获取框架的最新更新

---

## 14. 非交互式自动化模式

`codex exec` 用于 CI/CD 管道和自动化脚本，无需人工交互。

### 14.1 基本用法

```bash
# 执行单个任务
codex exec -a never "运行测试套件"

# 指定工作目录
codex exec -C /path/to/project -a never "构建项目"

# 使用特定模型
codex exec -m gpt-5.4 -a never "重构代码"
```

### 14.2 自动化最佳实践

- **始终使用 `-a never`** 避免交互式等待
- **使用 `-s workspace-write`** 限制文件访问
- **在 CI 中指定明确的工作目录**
- **使用 `codex exec resume` 继续之前的自动化任务**

### 14.3 CI/CD 集成示例

```bash
#!/bin/bash
# CI 脚本示例
set -e

echo "运行 Codex 代码审查..."
codex review -a never -s read-only

echo "执行测试..."
codex exec -a never -s workspace-write "运行所有单元测试和集成测试"

echo "生成发布说明..."
codex exec -a never "基于最近的提交生成发布说明"
```

---

## 15. 主题与高亮

Codex TUI 支持语法高亮和主题切换。

### 15.1 切换主题

在交互式会话中：

```
/theme
```

这将打开主题选择器，你可以预览和保存喜欢的主题。

### 15.2 支持的语法高亮

- Markdown 代码块
- Git diff 对比
- 常见编程语言（Python、JavaScript、TypeScript、Rust、Go 等）

---

## 16. 实用技巧与快捷键

### 16.1 快捷键速查表

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + L` | 清屏（不开始新对话） |
| `Ctrl + O` | 复制最新完成的输出 |
| `Ctrl + R` | 搜索提示历史 |
| `Ctrl + C` | 退出会话 |
| `Tab` | 排队后续指令 |
| `↑` / `↓` | 导航草稿历史 |
| `Enter` | 接受历史搜索匹配 |
| `Esc` | 取消历史搜索 |

### 16.2 高效使用技巧

1. **使用 `/clear` 重置状态** — 当对话变得冗长时，清除并重新开始
2. **使用 `/compact` 节省 Token** — 在长会话中定期压缩历史
3. **使用 `Tab` 排队多步指令** — 不必等待每步完成就能规划下一步
4. **使用 `/diff` 审查修改** — 提交代码前查看所有变更
5. **使用 `codex resume` 继续工作** — 不需要重复上下文
6. **创建 AGENTS.md** — 使用 `/init` 为项目创建持久化指令
7. **使用 `--profile` 切换配置** — 为不同项目准备不同的配置文件

### 16.3 AGENTS.md

使用 `/init` 命令可以在当前目录创建 `AGENTS.md` 文件，用于：

- 记录项目的编码规范
- 定义架构决策和约束
- 提供 Codex 需要了解的背景信息
- 设置特定目录的行为规则

Codex 会自动读取当前目录下的 `AGENTS.md` 文件并将其纳入上下文。

---

## 17. 配置文件

Codex CLI 的配置文件位于 `~/.codex/config.toml`。

### 17.1 配置优先级

配置值的优先级（从高到低）：

1. 命令行参数 `-c key=value`
2. 环境变量
3. 配置文件 `~/.codex/config.toml`
4. 默认值

### 17.2 配置文件示例

```toml
# 默认模型
model = "gpt-5.4"

# 默认审批模式
approval = "on-request"

# 默认沙箱策略
sandbox = "workspace-write"

# TUI 设置
[tui]
alternate_screen = true
theme = "dark"

# 功能开关
[features]
subagents = true
web_search = true

# 配置文件
[profiles.work]
model = "gpt-5.3-codex"
approval = "never"
sandbox = "read-only"

[profiles.personal]
model = "gpt-5.4"
approval = "on-request"
```

### 17.3 使用配置文件

```bash
# 使用特定配置文件
codex -p work

# 命令行覆盖配置值
codex -c model=gpt-5.3-codex -c approval=never
```

---

## 18. 故障排除

### 18.1 常见问题

| 问题 | 解决方案 |
|------|---------|
| 认证失败 | 运行 `codex logout` 后重新登录；检查网络连接 |
| 命令被拒绝 | 检查沙箱策略，使用 `-s workspace-write` 或 `-s danger-full-access` |
| 模型不可用 | 检查订阅计划是否包含 Codex；尝试切换模型 |
| Ollama 连接失败 | 确保 Ollama 服务正在运行；检查端口配置 |
| 会话无法恢复 | 检查 `~/.codex/sessions/` 目录权限 |
| Windows 权限问题 | 使用 PowerShell 运行；检查执行策略 |

### 18.2 日志和反馈

```bash
# 发送反馈给维护者
# 在交互式会话中：
/feedback
```

### 18.3 获取帮助

- **官方文档**：https://developers.openai.com/codex/cli
- **GitHub Issues**：https://github.com/openai/codex/issues
- **更新日志**：https://developers.openai.com/codex/changelog

---

## 附录：命令速查表

### 启动命令

```bash
codex                          # 启动交互式会话
codex "提示词"                # 带初始提示启动
codex -i image.png "提示词"   # 带图像启动
codex -m gpt-5.4             # 指定模型
codex -s read-only           # 只读沙箱模式
codex -a never               # 无需审批模式
codex -C /path/to/dir        # 指定工作目录
codex --oss                  # 使用本地开源模型
codex -p profile-name        # 使用配置配置文件
```

### 恢复命令

```bash
codex resume                 # 选择会话恢复
codex resume --last          # 恢复最近会话
codex resume --all           # 显示所有会话
codex resume <ID>            # 恢复指定会话
```

### 自动化命令

```bash
codex exec -a never "任务"   # 非交互式执行
codex exec resume --last "继续"  # 恢复并继续执行
codex review                 # 代码审查
```

---

> **提示**：本文档基于 OpenAI 官方 Codex CLI 文档编写。由于 Codex 仍在快速迭代中，部分功能可能会有变化，建议定期查看 [官方更新日志](https://developers.openai.com/codex/changelog) 获取最新信息。
