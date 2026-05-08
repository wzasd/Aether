# Bytro AI Native Development Workspace -- 产品需求文档 (PRD)

> **版本**: 1.0
> **日期**: 2026-04-30
> **状态**: 待评审
> **来源**: Figma 设计分析 + 现有架构文档对齐
> **关联文档**: [P0 设计总览](./2026-04-28-bytro-p0-design.md) | [UI-First Priority Plan](../plans/2026-04-30-ui-first-priority-plan.md) | [UI Guidelines](../design/ui-guidelines.md) | [Architecture Map](../../ARCHITECTURE.md)

---

## 1. 产品概述与愿景

### 1.1 产品定位

Bytro 是一个 **AI Native Development Workspace**（AI 原生开发工作站），通过任务驱动的工作流和多代理交互增强开发者协作。它不是传统 IDE 的插件，也不是通用聊天应用，而是一个以 AI Agent 为核心执行单元的开发环境。

### 1.2 产品愿景

让开发者的日常工作流从"人写代码、AI 辅助"转变为"人定义任务、AI 执行、人审查决策"。Bytro 在一个统一界面中呈现：**任务上下文、Agent 协作过程、代码变更、执行输出**，使开发者始终能回答五个核心问题：

1. 我在做什么项目和任务？
2. Agent 现在在做什么？
3. Agent 改了什么？
4. 什么需要我的决策或审批？
5. 哪些上下文会被保留？

### 1.3 目标用户

| 用户画像 | 特征 | 核心诉求 |
|---------|------|---------|
| 全栈开发者 | 日常使用 IDE + CLI，熟悉 AI 编程工具 | 高效的任务执行与代码变更审查 |
| 技术负责人 | 管理多项目，关注进度与质量 | 任务追踪、多 Agent 协作可见性 |
| AI 应用开发者 | 频繁与 LLM 交互，需要精细控制 | 模型/权限/Agent 配置灵活性 |

### 1.4 竞品参考

| 产品 | 参考维度 |
|------|---------|
| Cursor | AI chat + coding workspace 的交互范式 |
| Linear | 列表密度、状态清晰度、键盘友好工作流 |
| Raycast | 紧凑命令、选择器、清晰的空状态/错误状态 |
| Claude Code CLI | Agent 执行模型、工具调用、权限审批 |

### 1.5 核心差异化

- **任务驱动而非对话驱动**：Task Rail 作为一级导航，对话是任务的执行通道
- **多 Agent 协作可视化**：Agent 状态、思考过程、工具调用、变更产物全部结构化呈现
- **变更优先**：代码变更是工作流的核心产出，而非聊天的附属品
- **上下文持久化**：项目记忆系统让 Agent 具备跨会话的上下文延续能力

---

## 2. 核心用户场景

### 场景 1：创建并执行开发任务

> 作为开发者，我想创建一个新任务（如"添加暗色模式支持"），选择合适的 Agent 和模式，然后观察 Agent 的执行过程，审查其代码变更，最终决定是否采纳。

**流程**：
1. 在 Task Rail 点击 "New Task" 创建任务
2. 在 Shared Conversation 选择 Agent（如 Coder）和模式（如 Build）
3. 输入任务描述并发送
4. 观察 Agent 思考过程（Thinking Block）和工具调用（Tool Call）
5. 在 Workspace 的 Track Changes 面板审查代码变更
6. 点击 "Follow Suggestions" 或手动审查后决定

### 场景 2：多 Agent 协作完成复杂任务

> 作为技术负责人，我想让 Architect 规划方案、Coder 实现代码、Reviewer 审查变更，各 Agent 协同完成一个复杂功能。

**流程**：
1. 创建任务后，通过 "Add Agent" 添加多个 Agent
2. 各 Agent 按角色分工执行（规划、实现、审查）
3. 在 Agent 状态栏实时观察各 Agent 状态（thinking/editing/reviewing）
4. Agent 间的产物汇总在 ChangesMini 卡片中展示
5. 最终变更在 Track Changes 中统一审查

### 场景 3：项目切换与上下文恢复

> 作为开发者，我想在多个项目间快速切换，并且每次切换后 Agent 能自动恢复项目上下文。

**流程**：
1. 通过项目选择器切换到目标项目
2. 系统自动加载该项目的记忆上下文
3. Task Rail 显示该项目的任务列表
4. 继续之前未完成的任务

### 场景 4：审查 Agent 变更并决策

> 作为开发者，我想在 Agent 完成任务后，快速了解它改了哪些文件、增删了多少行代码，并逐文件审查具体变更。

**流程**：
1. Agent 完成后，底部变更汇总栏显示总变更统计
2. 点击 "查看变更" 打开 Track Changes 面板
3. 逐文件查看行级 diff
4. 在 Code Editor 中打开具体文件查看完整上下文

### 场景 5：配置 Agent 和工作环境

> 作为开发者，我想自定义 Agent 的模型、角色描述，以及编辑器的外观和行为设置。

**流程**：
1. 在 Workspace 打开 Settings 面板
2. 在 Agents 配置中启用/禁用 Agent、选择模型
3. 在 Appearance 中调整主题和字体
4. 在 API Keys 中管理密钥

---

## 3. 信息架构与页面结构

### 3.1 整体布局

应用采用 **三栏水平分割布局**，使用 `react-resizable-panels` 实现可拖拽调整：

```
+------------------------------------------------------------------+
|  [macOS 红绿灯]                                                    |
+------------------------------------------------------------------+
|              |                    |                                |
|  Task Rail   | Shared Conversation|         Workspace              |
|   (17%)      |     (26%)          |          (57%)                 |
|              |                    |                                |
|  可折叠      |                    |  标签栏 + 主内容 + 底部面板       |
|              |                    |                                |
+------------------------------------------------------------------+
```

**布局规则**：
- 三栏默认宽度比例：17% : 26% : 57%
- 每栏支持拖拽调整宽度，设置最小宽度防止内容挤压
- Task Rail 可折叠，折叠后在 Shared Conversation 左侧显示展开按钮
- Workspace 内部支持编辑区与底部面板的垂直拖拽调整
- 所有面板尺寸调整状态应持久化到用户偏好

### 3.2 导航层级

```
Application
├── Task Rail（左栏）
│   ├── 标题栏 + 折叠按钮
│   ├── New Task 按钮
│   ├── 筛选标签（All / Active / Pending / Done）
│   └── 任务卡片列表
├── Shared Conversation（中栏）
│   ├── 顶部工具栏
│   │   ├── 项目选择器
│   │   ├── New Task 按钮
│   │   └── Settings 按钮
│   ├── Agent 状态栏
│   ├── 消息列表
│   ├── 底部变更汇总栏
│   └── 输入区域
└── Workspace（右栏）
    ├── 标签栏
    ├── 主内容区（按标签切换）
    └── 底部面板（可切换显示）
```

---

## 4. 各模块详细需求

### 4.1 Task Rail（任务轨道）

#### 4.1.1 功能描述

任务列表管理面板，作为应用的一级导航入口，展示当前项目的所有开发任务。

#### 4.1.2 UI 结构

| 区域 | 元素 | 规格 |
|------|------|------|
| 标题栏 | "Tasks" 文字 | 左侧留白 pl-16（为 macOS 红绿灯区域预留） |
| 标题栏 | 折叠按钮 | 点击收起整个 Task Rail |
| 操作区 | "New Task" 按钮 | 蓝色主按钮，带 Plus 图标 |
| 筛选区 | 筛选标签 | All / Active / Pending / Done，单选切换 |
| 列表区 | 任务卡片列表 | 可滚动，每项显示任务名称、状态标签、时间、agent 数量、changes 数量 |

#### 4.1.3 任务卡片

**显示信息**：
- 任务名称
- 状态标签（带颜色标识）
- 时间（相对时间格式：如 "10:24", "Yesterday"）
- Agent 数量
- Changes 数量

**状态颜色映射**：

| 状态 | 颜色 | Tailwind Token |
|------|------|----------------|
| Idle | 灰色 | zinc-500 |
| Running | 蓝色 | blue-400 |
| Waiting | 黄色 | yellow-400 |
| Error | 红色 | red-400 |
| Done | 绿色 | green-400 |

**选中状态**：左侧蓝色边框 + 深色背景高亮

**Hover 操作按钮**：鼠标悬停时，卡片右侧浮现操作按钮区域：
- 删除按钮（X 图标）：点击后弹出确认对话框，确认后删除任务及其关联数据
- 更多按钮（⋯ 图标）：点击弹出上下文菜单，包含归档、重命名等操作

#### 4.1.4 交互规则

| 交互 | 行为 |
|------|------|
| 点击任务卡片 | 选中该任务，Shared Conversation 切换到对应任务的对话 |
| 点击折叠按钮 | 收起 Task Rail，在中栏左侧显示展开按钮 |
| 点击展开按钮 | 恢复 Task Rail 至上次宽度 |
| 点击筛选标签 | 过滤任务列表，仅显示对应状态的任务 |
| 点击 "New Task" | 创建新任务并自动选中 |
| Hover 任务卡片 | 右侧浮现删除按钮（X）和更多按钮（⋯） |
| 点击删除按钮 | 弹出确认对话框："Delete this task and all its data?"，确认后调用 `task:delete` / `conversation:delete`，级联删除关联的 task_agents、task_events、task_messages、tool_calls、file_changes |
| 点击更多按钮 | 弹出上下文菜单，选项见下表 |

**任务卡片上下文菜单**：

| 菜单项 | 行为 | 快捷键 |
|--------|------|--------|
| Rename | 进入行内编辑模式，修改任务标题 | — |
| Archive | 将任务标记为 `archived`，从默认列表隐藏，可在筛选 "Archived" 中查看 | — |
| Delete | 同删除按钮，弹出确认后删除 | — |

#### 4.1.5 状态要求

| 状态 | 表现 |
|------|------|
| 空列表 | 显示空状态提示："No tasks yet. Create one to get started." |
| 加载中 | 骨架屏或加载指示器 |
| 筛选无结果 | 显示 "No [status] tasks" 提示 |

---

### 4.2 Shared Conversation（共享对话）

#### 4.2.1 功能描述

多 Agent 协作对话面板，是用户与 Agent 交互的核心区域。支持项目切换、Agent 管理、消息交互、变更汇总。

#### 4.2.2 顶部工具栏

| 元素 | 类型 | 行为 |
|------|------|------|
| 项目选择器 | 下拉菜单 | 显示当前项目名称，点击展开项目列表 |
| New Task 按钮 | 图标按钮 | 创建新任务 |
| Settings 按钮 | 图标按钮 | 打开 Settings 面板 |

**项目选择器下拉菜单**：

| 元素 | 说明 |
|------|------|
| 项目列表项 | 项目图标 + 项目名 + 路径 + 最近打开时间 + 选中标记 |
| "Open folder..." 按钮 | 位于列表底部，打开系统文件夹选择器 |

**示例数据**：
- mochi-app: ~/Projects/mochi-app (Now)
- design-system: ~/Projects/design-system (2h ago)
- api-gateway: ~/Work/api-gateway (Yesterday)
- infra-scripts: ~/Work/infra-scripts (3 days ago)

#### 4.2.3 Agent 状态栏

显示当前任务中活跃的 Agent，每个 Agent 以卡片形式呈现。

**Agent 卡片信息**：
- 状态圆点（颜色随状态变化）
- Agent 名称
- Agent 角色

**Agent 状态颜色映射**：

| 状态 | 颜色 | Tailwind Token |
|------|------|----------------|
| idle | 深灰 | zinc-600 |
| thinking | 蓝色 | blue-400 |
| editing | 黄色 | yellow-400 |
| reviewing | 紫色 | purple-400 |
| waiting | 橙色 | orange-400 |

**"Add Agent" 按钮**：虚线边框样式，点击后打开 Agent 选择/创建面板。

**示例数据**：
- Architect -- Planning, idle
- Coder -- Implementation, editing

#### 4.2.4 消息列表

消息列表是 Shared Conversation 的核心内容区域，可滚动，支持多种消息类型的结构化渲染。

##### 4.2.4.1 用户消息

| 属性 | 规格 |
|------|------|
| 对齐 | 右对齐 |
| 样式 | 蓝色气泡 |
| 圆角 | rounded-2xl rounded-br-sm（右下角小圆角） |

##### 4.2.4.2 Agent 消息

Agent 消息由多个结构化块组成：

**发送者信息**：Agent 名称 + 时间戳

**Thinking Block（思考块）**：
- 可折叠
- 紫色主题
- 显示 Agent 的思考过程文本
- 默认折叠，点击展开

**Tool Call Block（工具调用块）**：
- 可折叠卡片
- 工具图标（按类型着色，详见工具类型映射表）
- 工具名称 + 输入摘要（智能解析 JSON，提取关键参数）
- 状态指示：
  - running：旋转动画
  - completed：绿色勾
  - error：红色叉
- 展开后显示：
  - Input：工具输入参数（代码块格式，最多 12 行，可展开全部）
  - Result：工具执行结果（代码块格式，最多 12 行，可展开全部）

**工具类型映射**：

| 工具名 | 标签 | 颜色 | 色值 |
|--------|------|------|------|
| Bash | Run command | 紫色 | #8B5CF6 |
| Read | Read file | 蓝色 | #3B82F6 |
| Write | Write file | 黄色 | #F59E0B |
| Edit | Edit file | 黄色 | #F59E0B |
| Glob | Find files | 绿色 | #10B981 |
| Grep | Search | 青色 | #06B6D4 |
| WebFetch | Web fetch | 紫色 | #8B5CF6 |
| WebSearch | Web search | 紫色 | #8B5CF6 |
| Delete | Delete file | 红色 | #EF4444 |
| mcp__* | mcp:name | 青色 | #06B6D4 |

**Markdown 内容**：自定义渲染样式，支持代码块、列表、表格等。

**流式输出**：光标动画指示正在生成内容。

**ChangesMini 卡片（产物汇总）**：
- 可折叠
- 显示文件变更列表
- 每个文件：状态标签(M/A/D) + 图标 + 路径 + 增删行数
- "查看变更" 按钮：点击后在 Workspace 打开 Track Changes

**文件变更状态映射**：

| 状态 | 标签 | 文字颜色 | 背景颜色 |
|------|------|---------|---------|
| modified | M | yellow-400 | yellow-950/60 |
| added | A | emerald-400 | emerald-950/60 |
| deleted | D | red-400 | red-950/60 |

**操作栏（hover 显示）**：Copy + Retry

##### 4.2.4.3 Plan 消息

- 蓝色边框卡片
- 显示计划步骤列表
- 步骤状态指示（待执行/执行中/已完成）

#### 4.2.5 底部变更汇总栏

| 元素 | 说明 |
|------|------|
| 变更统计 | 总变更文件数 + 增删行数 |
| "查看变更" 按钮 | 在 Workspace 打开 Track Changes |
| "Follow Suggestions" 按钮 | 蓝色主按钮，采纳 Agent 建议 |
| 文件变更列表 | 可展开，显示文件级变更明细 |

#### 4.2.6 输入区域

| 元素 | 类型 | 规格 |
|------|------|------|
| Agent 选择器 | 下拉菜单 | 选择目标 Agent |
| 工作意图 | 按钮组 | Build / Plan / Review / Ask 四种意图 |
| 权限模式 | 下拉菜单 | Manual / AutoEdit / Plan / FullAuto 四种权限 |
| 文本输入框 | 多行文本 | 3 行默认高度 + 附件按钮 |
| 发送按钮 | 图标按钮 | 蓝色，点击发送消息 |

**工作意图与权限模式是两个正交维度**：

- **工作意图**（Intent）决定 Agent 的行为方向——它"想做什么"
- **权限模式**（Permission）决定 Agent 的操作边界——它"被允许做什么"

两者可自由组合，例如 `Build + Manual` = 执行代码但每步需确认，`Plan + FullAuto` = 仅规划但工具调用全自动。

**工作意图说明**：

| 意图 | 用途 | 对 Agent 行为的影响 |
|------|------|---------------------|
| Build | Agent 执行代码编写和修改 | Agent 可调用 Read/Write/Edit/Bash 等全部工具 |
| Plan | Agent 仅规划方案，不执行修改 | Agent 仅调用 Read/Glob/Grep 等只读工具，输出计划步骤 |
| Review | Agent 审查现有代码或变更 | Agent 仅调用只读工具，输出审查意见 |
| Ask | Agent 回答问题，不执行任何操作 | Agent 不调用工具，仅基于上下文回答 |

**权限模式说明**（与现有 `PermissionMode` 对齐）：

| 权限模式 | CLI 映射 | 用途 |
|---------|---------|------|
| Manual | `--permission-mode default` | 每个工具调用都需要手动确认 |
| AutoEdit | `--permission-mode acceptEdits` | 自动批准文件编辑操作，其他需确认 |
| Plan | `--permission-mode plan` | 需批准计划后自动执行 |
| FullAuto | `--permission-mode bypassPermissions` | 自动批准所有工具调用（⚠️ 高风险） |

**默认组合**：`Plan + Plan`（安全且高效，与现有默认行为一致）

#### 4.2.7 交互规则

| 交互 | 行为 |
|------|------|
| 发送消息 | 将消息追加到消息列表，触发 Agent 响应 |
| 中止生成 | 保留已生成的部分输出 |
| 点击 Tool Call 折叠 | 展开/收起工具调用的 Input 和 Result |
| 点击 Thinking 折叠 | 展开/收起思考过程 |
| 点击 "查看变更" | Workspace 切换到 Track Changes 面板 |
| 点击 Copy | 复制消息内容到剪贴板 |
| 点击 Retry | 重新发送该消息 |
| 滚动到顶部 | 加载更早的消息（分页加载） |

#### 4.2.8 状态要求

| 状态 | 表现 |
|------|------|
| 空对话 | 显示欢迎提示和快速操作建议 |
| 流式生成中 | 光标动画 + Agent 状态为 thinking |
| 工具运行中 | Tool Call 显示旋转动画 + Agent 状态变化 |
| 权限等待 | 显示权限确认提示，暂停执行 |
| 生成中止 | 保留部分输出，显示 "Stopped" 标记 |
| 提供者错误 | 显示错误信息，提供重试选项 |
| 超时 | 显示超时提示 |

---

### 4.3 Workspace（工作区）

#### 4.3.1 功能描述

多面板工作区，支持代码编辑、变更追踪、文档查看、预览和设置。是开发者的主要工作面。

#### 4.3.2 顶部标签栏

| 元素 | 说明 |
|------|------|
| 面板标签 | Code Editor / Track Changes / Documentation / Preview / Settings |
| 标签关闭 | hover 显示 X 按钮，点击关闭标签 |
| "Add" 按钮 | 打开面板选择下拉菜单，可添加新面板标签 |
| Outline 切换 | 切换右侧面板为 Outline 视图 |
| Terminal 切换 | 切换底部面板的显示/隐藏 |

#### 4.3.3 Code Editor（代码编辑器）

**文件标签栏**：
- 多文件标签，可关闭
- 当前选中文件高亮
- 文件修改状态指示

**Follow 栏**：
- 显示相关文件快捷跳转
- 与当前编辑上下文关联

**代码编辑区**：
- 语法高亮（模拟 Monaco 编辑器风格）
- 行号显示
- 代码折叠

**右侧面板（可切换）**：

| 面板 | 内容 |
|------|------|
| Explorer | 文件树：可展开/折叠的文件夹 + 文件，点击文件在编辑器中打开 |
| Outline | 代码符号大纲：函数、类、变量等结构化导航 |

#### 4.3.4 Track Changes（变更追踪）

**文件级视图**：
- 文件名 + 增删行数统计
- 点击展开行级 diff

**行级 Diff**：
- 删除行：红色背景
- 新增行：绿色背景
- 上下文行：默认背景

#### 4.3.5 Documentation（文档查看）

- Markdown 渲染（CLAUDE.md 等项目文档）
- 支持标题导航
- 代码块语法高亮

#### 4.3.6 Preview（预览）

- 浏览器模拟：地址栏 + 预览区域
- 支持输入 URL 导航
- 刷新按钮

#### 4.3.7 Settings（设置）

**左侧导航**：

| 导航项 | 说明 |
|--------|------|
| General | 通用设置 |
| Appearance | 外观设置 |
| Agents | Agent 配置 |
| API Keys | 密钥管理 |
| Network | 网络设置 |
| Git | Git 配置 |
| Data & Storage | 数据与存储 |
| Notifications | 通知设置 |

**右侧设置表单**：

| 分类 | 配置项 | 类型 |
|------|--------|------|
| General | Auto-save | 开关 |
| General | Tab size | 数字选择 |
| General | Format on save | 开关 |
| General | Telemetry | 开关 |
| General | Language | 下拉选择 |
| Appearance | Theme | 主题选择（Light/Dark/System） |
| Appearance | Font family | 下拉选择 |
| Appearance | Font size | 数字选择 |
| Appearance | Minimap | 开关 |
| Agents | Agent 列表 | 名称 + 描述 + 模型 + 开关 |
| API Keys | 密钥列表 | 名称 + 掩码密钥 + 编辑按钮 |

**Agents 配置示例**：
- Planner: Decomposes tasks, claude-opus-4, on
- Coder: Writes & refactors code, claude-sonnet-4, on
- Reviewer: Reviews diffs, claude-haiku-3, off

#### 4.3.8 底部面板

**标签**：Terminal / Build / Test / Diagnostics

| 标签 | 内容 |
|------|------|
| Terminal | 命令行输出（xterm.js 渲染） |
| Build | 构建状态与日志 |
| Test | 测试结果与覆盖率 |
| Diagnostics | 诊断信息（错误、警告） |

#### 4.3.9 交互规则

| 交互 | 行为 |
|------|------|
| 点击面板标签 | 切换主内容区显示对应面板 |
| 关闭标签 | 移除面板标签，切换到相邻标签 |
| 点击 "Add" | 打开面板选择下拉，添加新标签 |
| 拖拽分割线 | 垂直调整编辑区与底部面板的比例 |
| 点击 Explorer 文件 | 在 Code Editor 中打开该文件 |
| 切换 Outline/Explorer | 右侧面板内容切换 |
| 切换 Terminal | 底部面板显示/隐藏 |

#### 4.3.10 状态要求

| 状态 | 表现 |
|------|------|
| 无打开文件 | 显示欢迎页或最近文件列表 |
| 文件加载中 | 加载指示器 |
| 文件加载失败 | 错误提示 + 重试按钮 |
| 无变更 | Track Changes 显示 "No changes" |
| 无文档 | Documentation 显示空状态 |
| 构建中 | Build 面板显示进度 |
| 测试失败 | Test 面板高亮失败项 |

---

## 5. 数据模型定义

### 5.1 Project（项目）

```typescript
interface Project {
  id: string
  name: string
  path: string               // 项目根目录绝对路径
  lastOpenedAt: string       // ISO 8601 时间戳
  isActive: boolean          // 是否为当前活跃项目
}
```

### 5.2 Task（任务）

```typescript
interface Task {
  id: string
  projectId: string
  title: string
  status: TaskStatus
  agentCount: number            // 当前关联 Agent 数
  changeCount: number           // 当前关联文件变更数
  createdAt: string          // ISO 8601
  updatedAt: string          // ISO 8601
}

type TaskStatus = 'Idle' | 'Running' | 'Waiting' | 'Error' | 'Done'
```

**状态流转**：

```
Idle ──→ Running ──→ Done
  │          │
  │          ├──→ Waiting ──→ Running
  │          │
  │          └──→ Error ──→ Running (重试)
  │
  └──→ (手动取消) ──→ Idle
```

> TaskStatus 使用 PascalCase，表示任务生命周期；AgentStatus 使用 lowercase，表示 Agent 运行时状态，二者不要混用。

**Task 与 Conversation 的关系**：`1:N`

一个 Task 可包含多个 Conversation，每个 Agent 拥有独立的 Conversation。在 Shared Conversation 面板中，多个 Conversation 的消息按时间线合并展示，通过 `Message.agentId` 区分来源。

```
Task ──1:N──→ Conversation ──1:N──→ Message
                  ↑                      ↑
            每个 Agent 一个         通过 agentId 区分发送者
```

### 5.3 Agent 三层模型

Agent 系统采用三层模型，与架构文档 `docs/architecture/ai-native-workspace.md` 对齐：

```
AgentProfile (持久化配置) ──1:N──→ TaskAgent (运行时关联) ──1:1──→ ProviderSession (CLI/API 交互)
     Settings 中管理                    Task 创建时派生                    实际 AI Provider 连接
```

#### 5.3.1 AgentProfile（Agent 配置）

用户在 Settings 中管理的持久化角色定义。

```typescript
interface AgentProfile {
  id: string
  name: string                          // 如 "Architect", "Coder", "Reviewer"
  role: string                          // 如 "Planning", "Implementation", "Review"
  model: string                         // 如 "claude-opus-4", "claude-sonnet-4"
  description: string                   // 角色描述
  systemPrompt?: string                 // 自定义 system prompt
  isEnabled: boolean                    // 是否启用
  projectId?: string                    // 项目级 Agent（null 为全局）
  createdAt: string
  updatedAt: string
}
```

#### 5.3.2 TaskAgent（运行时关联）

Task 创建时从 AgentProfile 派生的运行时实例，关联到具体的 Task。

```typescript
interface TaskAgent {
  id: string
  taskId: string                        // 关联的任务
  agentProfileId: string                // 派生自的 AgentProfile
  providerSessionId?: string            // CLI session ID（用于 --resume）
  role: string                          // 继承自 Profile，运行时可覆盖
  status: AgentStatus
  model: string                         // 继承自 Profile，运行时可覆盖
  createdAt: string
  updatedAt: string
}

type AgentStatus = 'idle' | 'thinking' | 'editing' | 'reviewing' | 'waiting'
```

#### 5.3.3 ProviderSession（Provider 交互）

实际的 AI Provider 连接，由 AgentRuntime 管理。不持久化到 DB，仅运行时存在。

```typescript
interface ProviderSession {
  id: string                            // 对应 task_agents.provider_session_id
  taskAgentId: string
  providerType: string                  // "claude-cli" | "openai" | ...
  externalSessionId?: string            // CLI session ID
  status: 'active' | 'stopped' | 'error'
}
```

**生命周期**：
1. 用户在 Settings 中配置 AgentProfile（角色、模型、prompt）
2. 创建 Task 后，通过 "Add Agent" 从 Profile 派生 TaskAgent
3. AgentRuntime 为 TaskAgent 创建 ProviderSession（启动 CLI/API 连接）
4. Task 结束后 TaskAgent 状态归 idle，ProviderSession 断开
5. AgentProfile 持久保留，下次创建 Task 可复用

### 5.5 Message（消息）

采用架构文档的 `task_messages` 新表模型，替代现有 `messages` 表。

```typescript
interface TaskMessage {
  id: string
  taskId: string
  agentId?: string             // 发送者 TaskAgent ID（assistant 消息必填）
  type: MessageType            // 消息类型（比现有 role 字段更灵活）
  content: string
  metadataJson: string         // JSON：承载 thinking/toolCalls/usage/planSteps 等结构化数据
  createdAt: string
}

type MessageType = 'user' | 'agent' | 'plan' | 'system' | 'change'
```

**与现有 messages 表的关系**：
- 现有 `messages` 表保留为兼容层，旧对话仍通过 `conversation` + `messages` 读取
- 新代码统一使用 `task_messages`，通过 `taskId` 而非 `conversationId` 绑定
- `metadataJson` 替代现有的 `thinking`、`tool_calls`、`usage` 独立字段，支持灵活扩展

**agentId 路由规则**：
- `type === 'user'`：agentId 为空（用户消息不属于任何 Agent）
- `type === 'agent'`：agentId 必填，标识由哪个 TaskAgent 生成
- `type === 'plan'`：agentId 必填，标识生成计划的 TaskAgent
- `type === 'system'`：agentId 为空（系统消息如"已停止生成"）
- `type === 'change'`：agentId 可选（变更汇总可能由系统自动生成）
- 在 Shared Conversation 面板中，按 `createdAt` 时间线合并多个 TaskAgent 的消息，通过 `agentId` 渲染 Agent 名称和状态圆点

### 5.6 ToolCallRecord（工具调用记录）

```typescript
interface ToolCallRecord {
  id: string
  toolName: string
  toolInput: string           // JSON 字符串
  status: 'running' | 'completed' | 'error'
  result?: string
  startedAt?: string
  completedAt?: string
}
```

### 5.7 FileChange（文件变更）

```typescript
interface FileChange {
  id: string
  taskId: string
  filePath: string
  status: FileChangeStatus
  additions: number           // 新增行数
  deletions: number           // 删除行数
  diff?: string               // 行级 diff 内容
}

type FileChangeStatus = 'modified' | 'added' | 'deleted'
```

### 5.8 Conversation（对话）

```typescript
interface Conversation {
  id: string
  projectId: string
  taskId: string               // 关联的任务 ID
  agentSessionId?: string      // 关联的 AgentSession ID（每个 Agent 独立对话）
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}
```

### 5.9 UsageInfo（用量信息）

```typescript
interface UsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}
```

### 5.10 UserPreferences（用户偏好）

```typescript
interface UserPreferences {
  // General
  autoSave: boolean
  tabSize: number
  formatOnSave: boolean
  telemetry: boolean
  language: string

  // Appearance
  theme: 'light' | 'dark' | 'system'
  fontFamily: string
  fontSize: number
  minimap: boolean

  // Layout
  taskRailWidth: number       // 百分比
  conversationWidth: number
  workspaceWidth: number
  taskRailCollapsed: boolean
  bottomPanelHeight: number
  activeWorkspaceTab: string
  openWorkspaceTabs: string[]
}
```

### 5.11 实体关系

```
Project 1──N Task 1──N TaskAgent ──1:1──→ ProviderSession (运行时)
Task 1──N TaskMessage (通过 taskId 绑定)
Task 1──N FileChange
Task 1──N ToolCall (独立表)
Task 1──N TaskEvent (事件流)
Task 1──N Approval (变更审批)
Task 1──N TerminalSession
AgentProfile 1──N TaskAgent (派生关系)
TaskMessage ──→ TaskAgent (通过 agentId 关联发送者)
ToolCall ──→ TaskAgent (通过 agentId 关联执行者)
FileChange ──→ TaskAgent (通过 agentId 关联修改者)
```

---

## 6. 非功能性需求

### 6.1 性能

| 指标 | 要求 |
|------|------|
| 首屏加载时间 | < 2s（冷启动） |
| 消息列表渲染 | 1000 条消息内无卡顿，虚拟滚动 |
| 流式输出延迟 | 首字显示延迟 < 200ms |
| 文件树加载 | 10000 文件项目 < 1s |
| 面板切换 | 切换动画 < 100ms |
| 内存占用 | 空闲状态 < 300MB |

### 6.2 可靠性

| 指标 | 要求 |
|------|------|
| 消息持久化 | 所有消息实时持久化到 SQLite，崩溃后可恢复 |
| 部分输出保留 | 中止生成时保留已生成的部分内容 |
| 状态一致性 | Agent 状态与实际执行状态一致，无幽灵状态 |
| 错误恢复 | 提供者错误后可重试，不丢失上下文 |

### 6.3 安全性

| 指标 | 要求 |
|------|------|
| API Key 存储 | 密钥使用系统 Keychain 存储，界面掩码显示 |
| IPC 安全 | Preload 层严格限制暴露的 API，不暴露 fs/electron 直接访问 |
| 权限控制 | Agent 工具调用受权限模式约束，危险操作需审批 |
| 数据隔离 | 项目间数据严格隔离，不可跨项目访问 |

### 6.4 可访问性

| 指标 | 要求 |
|------|------|
| 键盘导航 | 所有核心操作支持键盘快捷键 |
| 焦点管理 | 面板切换后焦点正确转移 |
| 对比度 | 文本对比度满足 WCAG AA 标准 |
| 屏幕阅读器 | 关键元素提供 ARIA 标签 |

### 6.5 兼容性

| 指标 | 要求 |
|------|------|
| 操作系统 | macOS 12+（P0），后续支持 Windows/Linux |
| 屏幕尺寸 | 最小支持 1280x720，推荐 1440x900+ |
| 深色/浅色模式 | P0 优先深色模式，浅色模式作为 P1 |

### 6.6 可扩展性

| 指标 | 要求 |
|------|------|
| AI Provider | 架构预留 Provider 接口，支持后续接入 OpenAI/DeepSeek 等 |
| MCP 工具 | 支持 MCP 协议工具的动态注册和调用 |
| 面板系统 | Workspace 面板可动态注册新类型 |

---

## 7. 实施优先级建议

### 7.1 P0 -- 设计对齐的单 Agent 工作区

> 目标：让首屏呈现为可用的日常编码工作区，而非通用聊天界面。

| 编号 | 工作项 | 说明 | 验收标准 |
|------|--------|------|---------|
| P0.1 | Workspace Shell 对齐 | 三栏布局实现，Task Rail + Shared Conversation + Workspace 四个稳定面板 | 桌面宽度下三栏正确显示，可拖拽调整，Task Rail 可折叠 |
| P0.2 | Task Rail MVP | 任务列表、状态筛选、New Task、选中高亮 | 创建/选中/筛选任务正常工作，空状态/加载状态正确 |
| P0.3 | Agent 执行循环 | Composer + Agent 选择 + 模式选择 + 流式响应 + 中止 | 发送消息、流式接收、Thinking/ToolCall 显示、中止保留部分输出 |
| P0.4 | Agent 活动栈 | Agent 状态栏、Thinking Block、Tool Call Block、ChangesMini | Agent 状态实时更新，工具调用可折叠展开，状态指示正确 |
| P0.5 | 代码面 MVP | 文件树 + 只读代码查看 + 语法高亮 | 能浏览项目文件、查看文件内容，空/错误/加载状态正确 |
| P0.6 | 变更可见性 MVP | 变更汇总栏 + Track Changes 面板 + 行级 Diff | Agent 变更后显示文件列表和增删统计，可查看行级 diff |
| P0.7 | 项目切换 | 项目选择器 + 项目列表 + Open folder | 切换项目后 Task Rail 和上下文正确更新 |
| P0.8 | 底部面板 MVP | Terminal/Build/Test/Diagnostics 标签 + 基础输出 | 底部面板可切换显示，Terminal 输出命令日志 |

### 7.2 P1 -- 开发者控制环

> 目标：深化各面板功能，使开发者能完整地审查、编辑和管控 Agent 行为。

| 编号 | 工作项 | 说明 | 验收标准 |
|------|--------|------|---------|
| P1.1 | 完整文件浏览器 | 懒加载文件树、忽略目录、选中文件预览 | 大型项目文件树流畅加载 |
| P1.2 | Monaco 编辑器 | 打开文件、语法高亮、编辑/保存、脏状态、只读回退 | 可编辑文件并保存，脏状态正确提示 |
| P1.3 | Diff 视图增强 | 并排或内联 Diff、大文件可读性 | 大文件 diff 性能可接受 |
| P1.4 | xterm 终端 | PTY 输出渲染、调整大小、输入、状态、中止 | 终端交互流畅，支持常用命令 |
| P1.5 | 权限审批 MVP | 权限提示、风险文件变更、破坏性操作审查 | 统一的审批界面，操作可追溯 |
| P1.6 | Git 面板 MVP | Stage、Commit、分支状态、变更文件历史 | 基本 Git 操作可用 |
| P1.7 | Settings 完整实现 | 全部设置分类和配置项 | 所有设置项可修改并持久化 |
| P1.8 | Preview 面板 | 浏览器模拟、地址栏、刷新 | 本地开发服务器预览可用 |
| P1.9 | Documentation 面板 | Markdown 渲染、标题导航 | 项目文档可浏览 |

### 7.3 P2 -- 多 Agent 协作

> 目标：在单 Agent 工作区和变更管控环可用后，引入多 Agent 协作能力。

| 编号 | 工作项 | 说明 | 验收标准 |
|------|--------|------|---------|
| P2.1 | 多 Provider 适配 | Codex/Gemini/Kimi 等模型的检测、配置、启用/禁用 | 新模型可动态接入 |
| P2.2 | 任务分解 | 用户可编辑 Agent 生成的子任务后再执行 | 子任务可编辑、排序、指定 Agent |
| P2.3 | 并行执行 | 多 Agent 会话并行运行，清晰的归属和资源限制 | 多 Agent 同时工作不冲突 |
| P2.4 | 共享黑板 | Agent 可发布中间结果、消费相关上下文 | Agent 间信息共享可见可控 |
| P2.5 | 冲突检测 | 多 Agent 编辑同一文件时检测并路由到用户审查 | 文件冲突及时提醒 |

### 7.4 P3 -- 治理与规模化

> 目标：在工作区证明可用后，引入治理和规模化能力。

| 编号 | 工作项 | 说明 |
|------|--------|------|
| P3.1 | 信任评分 | Agent 行为历史影响默认审批级别 |
| P3.2 | 审计报告 | 用户可导出清晰的操作/变更报告 |
| P3.3 | MCP/A2A 集成 | 外部工具可通过协议接口调用 Bytro 能力 |
| P3.4 | 远程审批 | 移动端或团队审批流程 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| Task Rail | 左栏任务轨道，展示项目任务列表 |
| Shared Conversation | 中栏共享对话，多 Agent 协作对话面板 |
| Workspace | 右栏工作区，多面板开发环境 |
| Agent | AI 代理，具备特定角色和能力的执行单元 |
| Tool Call | Agent 对工具的调用，如读写文件、执行命令等 |
| Thinking Block | Agent 的思考过程展示块 |
| ChangesMini | 消息中的产物汇总卡片，展示文件变更列表 |
| Track Changes | Workspace 中的变更追踪面板，展示行级 Diff |
| MCP | Model Context Protocol，模型上下文协议 |
| Provider | AI 模型提供者，如 Claude、OpenAI 等 |

## 附录 B：快捷键规划

| 快捷键 | 功能 | 备注 |
|--------|------|------|
| Cmd+N | 新建任务 | 替代现有"新建对话"，对话随任务自动创建 |
| Cmd+Shift+N | 新建对话（备用） | 在当前任务下新建 Agent 对话 |
| Cmd+P | 快速打开文件 | — |
| Cmd+Shift+P | 命令面板 | — |
| Cmd+B | 切换 Task Rail | 与 VS Code 侧边栏切换一致 |
| Cmd+J | 切换底部面板 | — |
| Cmd+Enter | 发送消息 | — |
| Escape | 停止生成 / 关闭弹窗 | — |
| Cmd+/ | 切换注释 | — |
| Cmd+S | 保存文件 | — |
| Cmd+, | 打开 Settings | 与 macOS 系统偏好一致 |

## 附录 C：与现有架构的对齐说明

本 PRD 与现有项目文档的对齐关系：

| 本文档章节 | 对应现有文档 | 对齐说明 |
|-----------|-------------|---------|
| 4.2 Agent 消息类型 | [types.ts](../../src/main/ai/types.ts) | ToolCallRecord、Message、AIEvent 类型已定义，本 PRD 在此基础上扩展 UI 展示需求 |
| 4.1 Task 状态 | [P0 设计总览](./2026-04-28-bytro-p0-design.md) | P0 聚焦单 Agent，本 PRD 预留多 Agent 扩展 |
| 6.6 可扩展性 | [ARCHITECTURE.md](../../ARCHITECTURE.md) | AIProvider 抽象层已建立，本 PRD 的多 Provider 需求基于此 |
| 7.1 P0 优先级 | [UI-First Priority Plan](../plans/2026-04-30-ui-first-priority-plan.md) | 本 PRD 的 P0 与 UI-First Plan 的 P0 工作流一致 |
| 4.2.4 消息渲染 | [UI Guidelines](../design/ui-guidelines.md) | 消息 UI 规则遵循 UI Guidelines 的设计原则 |
| 5. 数据模型 | [data-model.md](../../../docs/data-model.md) | 本 PRD 定义前端展示模型，与后端数据模型对齐 |
| 6. 技术选型 | [workspace-surfaces-technology.md](../../../docs/architecture/workspace-surfaces-technology.md) | Code Editor / Terminal / Preview 的 P0→P1 两阶段技术方案 |
| 7. 系统架构 | [ai-native-workspace.md](../../../docs/architecture/ai-native-workspace.md) | IPC 命名空间、运行时组件、事件合约、数据模型完整定义 |

---

## 附录 D：现有代码与设计目标差距分析

> **分析日期**: 2026-04-30
> **当前版本**: v0.1.0
> **总体完成度**: 约 15%

### D.1 差距总览

当前 Bytro 本质上仍是一个 **通用 AI 聊天应用**（Sidebar + ChatPage 两栏布局），与 PRD 定义的 **AI Native Development Workspace**（三栏可调整布局 + 底部面板）存在根本性架构差距。

| 模块 | 已实现 | 部分实现 | 缺失/不匹配 | 完成度 |
|------|--------|---------|-------------|--------|
| 布局架构 | 0 | 1 | 4 | ~10% |
| Task Rail | 0 | 1 | 5 | ~5% |
| Shared Conversation - 工具栏 | 0 | 1 | 2 | ~15% |
| Shared Conversation - Agent 状态栏 | 0 | 1 | 2 | ~20% |
| Shared Conversation - 消息类型 | 4 | 1 | 3 | ~55% |
| Shared Conversation - 变更汇总 | 0 | 0 | 4 | 0% |
| Shared Conversation - 输入区域 | 1 | 1 | 2 | ~30% |
| Workspace | 0 | 0 | 11 | 0% |
| 数据模型 | 2 | 2 | 4 | ~25% |

### D.2 关键缺失项

**完全缺失（14 项）**：
- 整个 Workspace 栏（标签栏、Code Editor、Track Changes、Documentation、Preview、Settings）
- Task 数据模型和 tasks 数据库表
- FileChange 数据模型和 file_changes 数据库表
- Agent 选择器
- Plan 消息类型
- ChangesMini 卡片
- 底部变更汇总栏
- 底部面板（Terminal/Build/Test/Diagnostics）
- 项目选择器（在 Shared Conversation 顶部）
- react-resizable-panels 依赖

**概念不匹配（3 项）**：
- 权限模式与工作意图未区分（已在 4.2.6 修正为两个正交维度）
- Conversation 直接充当 Task 角色，缺少 Task 抽象层（已在 5.2 修正为 1:N 关系）
- Workspace（当前=项目）vs Project（PRD 定义）

### D.3 可复用资产

| 资产 | 文件 | 复用方式 |
|------|------|---------|
| AI 事件处理引擎 | chatStore.ts | 核心流式逻辑完整，作为 Shared Conversation 底层引擎 |
| 消息渲染组件 | MessageItem.tsx, ToolCall.tsx, ThinkingBlock.tsx | 迁移到 Shared Conversation 消息列表 |
| Markdown 渲染 | MarkdownContent.tsx | 复用于 Documentation 面板和消息内容 |
| 工具元数据 | types.ts TOOL_META | 完整的工具标签/颜色映射 |
| 记忆系统 | memoryStore.ts + DB 表 | 完整的记忆候选/项目记忆/会话摘要功能 |
| 数据库基础设施 | db.ts | SQLite + WAL + FTS5，扩展新表即可 |
| IPC 通信层 | src/main/ipc/ | chat/conversation/memory/workspace 通道已建立 |
| 对话搜索 | ConversationSearch.tsx | FTS5 全文搜索已实现 |

### D.4 实施路线图

基于差距分析和 P0 优先级，建议按以下顺序推进：

**阶段 1：布局重构（P0.1）**
1. 安装 react-resizable-panels
2. 将 App.tsx 从 Sidebar + ChatPage 两栏重构为 Task Rail + Shared Conversation + Workspace 三栏
3. 实现面板宽度持久化
4. 实现 Task Rail 可折叠/展开

**阶段 2：Task 数据模型 + Task Rail（P0.2）**
1. 在 db.ts 新增 tasks 表
2. 创建 taskStore
3. 实现 Task Rail 组件（任务卡片、状态筛选、New Task）
4. 将 Conversation 与 Task 关联

**阶段 3：Workspace Shell + 代码面 MVP（P0.5）**
1. 实现 Workspace 标签栏框架
2. 实现文件树（Explorer）
3. 实现只读代码查看器（语法高亮）
4. 实现底部面板框架

**阶段 4：Agent 执行循环对齐（P0.3 + P0.4）**
1. 将 PermissionModeSelector 重构为工作意图 + 权限模式双维度选择
2. 新增 Agent 选择器
3. 新增项目选择器（移至 Shared Conversation 顶部）
4. Agent 状态栏增强（角色显示、状态颜色映射）
5. Thinking Block 紫色主题
6. 新增 Plan 消息类型

**阶段 5：变更可见性（P0.6）**
1. 在 db.ts 新增 file_changes 表
2. 实现 ChangesMini 卡片组件
3. 实现底部变更汇总栏
4. 实现 Track Changes 面板 + 行级 Diff

**阶段 6：项目切换 + 底部面板（P0.7 + P0.8）**
1. 项目选择器完整实现
2. Terminal/Build/Test/Diagnostics 标签和基础输出

---

## 附录 E：IPC 通道规划

> 与 `docs/architecture/ai-native-workspace.md` IPC Namespaces 对齐。
> 现有 Preload 暴露 9 个命名空间：system / workspace / conversation / usage / todo / message / chat / dialog / memory。
> 以下为新增命名空间（覆盖所有 Figma Surface 的 IPC 通道）。

### E.1 新增命名空间

| 命名空间 | 方法 | 事件 | 说明 |
|---------|------|------|------|
| `project` | `list`, `openFolder`, `setActive`, `getRecent` | `project:updated` | 项目管理（替代现有 workspace 的项目选择功能） |
| `task` | `create`, `list`, `select`, `updateStatus`, `cancel` | `task:created`, `task:updated` | 任务生命周期 |
| `agent` | `listProfiles`, `start`, `stop`, `sendPrompt`, `setEnabled` | `agent:event`, `agent:status` | Agent 模板 + 运行时（三层模型） |
| `conversation` | `listMessages`, `appendUserMessage`, `retryMessage` | `conversation:message`, `conversation:updated` | 任务级共享对话 |
| `tool` | `listCalls`, `getCall` | `tool:started`, `tool:updated`, `tool:completed` | 工具调用记录 |
| `change` | `listForTask`, `getDiff`, `approve`, `reject` | `change:file`, `change:summary` | 文件变更 + 审批 |
| `workspace` | `listFiles`, `readFile`, `openTab`, `closeTab` | `workspace:fileChanged`, `workspace:tabsUpdated` | 文件树 + 面板状态 |
| `terminal` | `createSession`, `write`, `stop`, `listChunks` | `terminal:data`, `terminal:status` | 终端/构建/测试/诊断输出 |
| `settings` | `get`, `set`, `listProviders`, `setApiKey` | `settings:updated` | 用户偏好 + API 密钥（密钥通过 OS keychain 存储） |
| `preview` | `createSession`, `loadURL`, `goBack`, `goForward`, `reload`, `stop`, `setBounds`, `destroySession` | `preview:status` | 本地预览会话 |

### E.2 现有命名空间迁移

| 现有命名空间 | 处理方式 |
|------------|---------|
| `workspace` | 扩展：新增 `listFiles`, `readFile`, `openTab`, `closeTab`, `updateLastOpened`, `listRecent` |
| `conversation` | 扩展：新增 `listMessages`（按任务筛选）、`appendUserMessage`（含 agentId + intent + permission） |
| `message` | 保留为兼容层，新代码使用 `conversation.listMessages` |
| `chat` | 保留为兼容层，新代码使用 `agent.sendPrompt` |
| `memory` | 保留，附加 `project_id` 和可选 `task_id` 用于记忆召回 |
| `system` / `usage` / `todo` / `dialog` | 保留不变 |

---

## 附录 F：DB 迁移策略

> 与 `docs/architecture/ai-native-workspace.md` Data Model Additions 对齐。
> 当前 `SCHEMA_VERSION = 3`，使用 `applyMigrations()` 递增迁移。

### F.1 迁移版本规划

| 版本 | 变更内容 | 阶段 |
|------|---------|------|
| v3 | 新增 `projects`、`tasks`、`task_agents`、`task_messages`、`task_events`、`tool_calls`、`workspace_tabs`、`panel_state` 表；`conversations` 新增 `task_id` 列 | 阶段 2 |
| v4 | 新增 `file_changes`、`approvals`、`terminal_sessions`、`terminal_chunks`、`diagnostics`、`preview_sessions` 表；`workspaces` 新增 `last_opened_at` 列 | 阶段 5-6 |

### F.2 v3 迁移详情

```sql
-- 新增 projects 表（替代 workspaces 的项目选择功能）
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Idle',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 新增 tasks 表
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Idle',
  mode TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- 新增 task_agents 表（运行时关联：Task → AgentProfile → ProviderSession）
CREATE TABLE IF NOT EXISTS task_agents (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_profile_id TEXT NOT NULL,
  provider_session_id TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_agents_task ON task_agents(task_id);

-- 新增 task_messages 表（替代现有 messages 表的新消息模型）
CREATE TABLE IF NOT EXISTS task_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT,
  type TEXT NOT NULL,
  content TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_messages_task ON task_messages(task_id);

-- 新增 task_events 表（任务级事件流）
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);

-- 新增 tool_calls 表（独立工具调用记录）
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  message_id TEXT,
  agent_id TEXT,
  tool_name TEXT NOT NULL,
  input_json TEXT,
  result_text TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);

-- 新增 workspace_tabs 表（面板状态持久化）
CREATE TABLE IF NOT EXISTS workspace_tabs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  panel_type TEXT NOT NULL,
  title TEXT NOT NULL,
  resource_ref TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 新增 panel_state 表（面板布局 JSON）
CREATE TABLE IF NOT EXISTS panel_state (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- conversations 扩展（兼容层）
ALTER TABLE conversations ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conv_task ON conversations(task_id);
```

### F.3 v4 迁移详情

```sql
-- 新增 file_changes 表
CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  diff_text TEXT,
  approval_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_changes_task ON file_changes(task_id);

-- 新增 approvals 表（变更审批）
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT,
  file_change_id TEXT,
  operation TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- 新增 terminal_sessions + terminal_chunks 表
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  command TEXT,
  cwd TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS terminal_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  stream TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 新增 diagnostics 表
CREATE TABLE IF NOT EXISTS diagnostics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  path TEXT,
  line INTEGER,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 新增 preview_sessions 表
CREATE TABLE IF NOT EXISTS preview_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  url TEXT,
  status TEXT NOT NULL,
  command TEXT,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- workspaces 扩展
ALTER TABLE workspaces ADD COLUMN last_opened_at INTEGER;
```

### F.4 数据迁移注意事项

- `projects` 表为全新创建，可从现有 `workspaces` 表迁移数据（id, name, repo_path → path）
- `tasks` 表为全新创建，现有 `conversations` 可自动创建关联 Task（title 从 conversation.title 派生）
- `task_messages` 为全新表，现有 `messages` 表保留为兼容层，旧对话仍通过 `conversation` + `messages` 读取
- `task_agents` 为全新表，现有 `agent_profiles`（记忆系统缓存）不直接迁移，需用户在 Settings 中重新配置
- `tool_calls` 为全新独立表，现有 `messages.tool_calls`（JSON 字段）保留为兼容层
- 现有 `conversations` 无 `task_id`，迁移后为 NULL，表示"未关联任务的旧对话"
- `workspaces.last_opened_at` 迁移后为 NULL，首次打开时由 `workspace.updateLastOpened` 写入
