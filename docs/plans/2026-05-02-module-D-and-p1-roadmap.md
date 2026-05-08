---
status: active
owner: bytro
last_verified: 2026-05-02
doc_kind: plan
scope: module-D + P1 items
---

# 路线图：Module D（Agent Profiles）+ P1 核心功能

## 当前基线（2026-05-02）

| 模块 | 状态 |
|------|------|
| Module A 任务即会话 | ✅ 完成，P1 全部修复 |
| Module B 文件变更追踪 | ✅ 完成，B1–B5 全部实现 |
| Module C Memory Palace | ✅ Phase 1–5 完成；Phase 6 测试 + C8 tags UI 待做 |
| Module D 多 Agent | ✅ D1–D6 完成 |
| P1 xterm 终端 | ✅ 完成 |
| P1 Monaco 编辑器 | ✅ 完成 |

typecheck: ✅ 通过 | tests: ✅ 69 个全绿（5 files） | SCHEMA_VERSION: 8

---

## 推荐执行顺序

```
Phase C6  ──→  Module D  ──→  P1 Terminal  ──→  P1 Monaco  ──→  P2 Multi-Agent
（关闭 C）    （Agent 配置）   （xterm PTY）    （代码编辑）   （并行执行）
  2-3天          1周             3-4天           1周           待设计
```

---

## Phase C6：关闭 Module C（优先，2–3 天）

### 目标

关闭 Module C 的验收门，让 Phase 1–5 的实现有测试覆盖。

### C8：Tags 编辑 UI（随 Phase 6 捆绑）

**文件**：`src/renderer/src/components/workspace/MemoryContent.tsx`

编辑模式下在 category select 下方加 tags 输入行（逗号分隔，回车添加，× 删除）。
draft 中 `tags` 字段已有，save 时透传即可。

### Phase 6 测试覆盖表

| 测试目标 | 类型 | 文件位置 |
|---------|------|---------|
| `memory-palace:list/create/update/delete` IPC | 单测 | `src/main/ipc/memory-palace.test.ts` |
| schema v6 ALTER TABLE 不破坏现有 project_memory_items | 集成 | `src/main/core/db.test.ts` |
| `memoryPalaceStore.loadItems / createItem / updateItem / deleteItem` | 单测 | `src/renderer/src/stores/memoryPalaceStore.test.ts` |
| workspace 切换时 store 自动 reload | 单测 | 同上 |
| `buildMemoryContext` 能读到 Memory Palace 条目 | 集成 | `src/renderer/src/stores/chatStore.test.ts` |
| 内联 Markdown 渲染各格式 | 单测 | `src/renderer/src/utils/markdown.test.ts`（提取工具函数） |

### 完成标准

- [x] pnpm test 覆盖率包含上表所有目标
- [x] tags 编辑 UI 在 MemoryContent 可用
- [x] `docs/features/memory-palace.md` 更新为 ✅ 完成

---

## Module D：Agent Profiles（1 周）

### 需求背景

当前 Settings → Agents 面板是纯展示 UI，不影响运行时。
用户无法指定用 Planner/Coder/Reviewer 哪个角色，所有对话固定用 sessionConfigStore.model。

Module D 目标：
- D1：Agent Profile 配置生效——Settings 中配置的 name/role/model/systemPrompt 真正影响运行时
- D2：角色→Provider 映射——Planner→Opus 4.7、Coder→Sonnet 4.6、Reviewer→Haiku 4.5
- D3：Composer 中的 agent selector 可切换当前发送使用哪个 profile

### 架构决策

**不引入 Task/TaskAgent 抽象层**（留给 P2）。

当前模型：`conversations 1:N messages`，session = 1 AI 进程。  
Module D 继续用这个模型。AgentProfile 只影响"下一次 startSession 用哪个 model/systemPrompt"，不改变 session 路由。

True 多 Agent 并行执行（P2）等 Module D 稳定后再做。

---

### D1 DB Schema v7/v8

**文件**：`src/main/core/db.ts`，SCHEMA_VERSION 6 → 8

v7 迁移：将旧 memory-cache `agent_profiles` 表重命名为 `agent_profile_cache`，新建 `agent_profile_configs` 表。

```sql
-- agent_profile_configs：用户可配置的 Agent 角色模板
CREATE TABLE IF NOT EXISTS agent_profile_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL = 全局
  name TEXT NOT NULL,                    -- 如 "Planner"、"Coder"、"Reviewer"
  role TEXT NOT NULL DEFAULT 'coder',    -- 角色标签，UI 展示用
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  description TEXT,
  system_prompt TEXT,                    -- 注入 sendMessage prefix（可选）
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_agent_profile_configs_ws ON agent_profile_configs(workspace_id);

-- conversations 扩展：记录本次对话用了哪个 profile（可回溯）
ALTER TABLE conversations ADD COLUMN agent_profile_id TEXT REFERENCES agent_profile_configs(id) ON DELETE SET NULL;
```

v8 迁移：为 `memory_fts` 补充 `AFTER UPDATE` 触发器，修复 Memory Palace 编辑后 FTS 搜索结果过时的问题。

```sql
CREATE TRIGGER IF NOT EXISTS proj_mem_au AFTER UPDATE ON project_memory_items BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, content, kind) VALUES ('delete', old.rowid, old.title, old.content, old.kind);
  INSERT INTO memory_fts(rowid, title, content, kind) VALUES (new.rowid, new.title, new.content, new.kind);
END;
```

**默认 seed**（v7 迁移时插入，仅当 `agent_profile_configs` 为空）：

| name | role | model | is_enabled |
|------|------|-------|------------|
| Planner | planning | claude-opus-4-7 | 1 |
| Coder | implementation | claude-sonnet-4-6 | 1 |
| Reviewer | review | claude-haiku-4-5-20251001 | 0 |

---

### D2 IPC 层

**文件**：`src/main/ipc/agent.ts`（新建）

```ts
// agent:listProfiles(workspaceId?) → AgentProfile[]
//   workspaceId 为 null 时返回全局 profiles
// agent:createProfile(data) → AgentProfile
// agent:updateProfile(id, patch) → AgentProfile
// agent:deleteProfile(id) → void
// agent:seedDefaults() → AgentProfile[]  // 仅当全局无 profiles 时插入默认
```

注册入口：`src/main/ipc/index.ts`，与现有 handler 并列。

**Preload 扩展** (`src/preload/index.ts`)：

```ts
agent: {
  listProfiles: (workspaceId?: string) => ipcRenderer.invoke('agent:listProfiles', workspaceId),
  createProfile: (data) => ipcRenderer.invoke('agent:createProfile', data),
  updateProfile: (id, patch) => ipcRenderer.invoke('agent:updateProfile', id, patch),
  deleteProfile: (id) => ipcRenderer.invoke('agent:deleteProfile', id),
  seedDefaults: () => ipcRenderer.invoke('agent:seedDefaults'),
}
```

**global.d.ts 新增**：

```ts
interface AgentProfile {
  id: string
  workspaceId: string | null
  name: string
  role: string
  model: string
  description: string | null
  systemPrompt: string | null
  isEnabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}
```

---

### D3 Store 层

**文件**：`src/renderer/src/stores/agentProfileStore.ts`（新建）

```ts
interface AgentProfileState {
  profiles: AgentProfile[]
  activeProfileId: string | null  // null = 不使用 profile，用 sessionConfigStore.model

  loadProfiles: (workspaceId?: string) => Promise<void>
  createProfile: (data) => Promise<AgentProfile>
  updateProfile: (id, patch) => Promise<AgentProfile>
  deleteProfile: (id) => Promise<void>
  setActiveProfile: (id: string | null) => void
}
```

`loadProfiles` 在 `AppContent` 的 `useEffect` 里调用一次（与 `loadWorkspaces` 并行）。

---

### D4 chatStore 集成

**文件**：`src/renderer/src/stores/chatStore.ts`

`sendMessage` 里读取 activeProfile，影响 startSession：

```ts
const agentStore = useAgentProfileStore.getState()
const activeProfile = agentStore.profiles.find(p => p.id === agentStore.activeProfileId)

const model = activeProfile?.model ?? config.model
const systemPromptPrefix = activeProfile?.systemPrompt ?? ''
```

`startSession` 传入正确的 model，`sendMessage` 在 content 前拼接 systemPromptPrefix（如有）。

`createConversation` 时把 `agent_profile_id` 写入 DB（透过 IPC conversation.create）。

---

### D5 UI 层

#### D5.1 Settings → Agents 面板

**文件**：`src/renderer/src/components/workspace/SettingsPanel.tsx`

- 从 `agentProfileStore` 读取 profiles 列表
- 每条 profile 显示：name / role / model / description / enabled toggle / edit / delete
- "Add Agent" 按钮 → 内联表单新建 profile
- 编辑模式：name input + role input + model select + description textarea + systemPrompt textarea + enabled toggle

Model 选项（hardcode 列表）：
- claude-opus-4-7
- claude-sonnet-4-6
- claude-haiku-4-5-20251001

#### D5.2 Composer Agent Selector

**文件**：`src/renderer/src/components/chat/ChatInput.tsx`

在输入区上方或左侧加一个小型 agent selector：

```
[Coder ▼] [ Build ] [Manual ▼] [                      ] [↑]
```

- 显示当前 activeProfile.name（或 "Default"）
- 点击展开 enabled profiles 列表
- 选中后更新 agentProfileStore.activeProfileId
- 若 profiles 为空/未加载则不显示

---

### D6 测试覆盖

| 测试目标 | 类型 |
|---------|------|
| `agent:listProfiles/create/update/delete` IPC | 单测 |
| schema v7 迁移（seed 默认 profiles）| 集成 |
| `agentProfileStore` CRUD + setActiveProfile | 单测 |
| chatStore sendMessage 使用 activeProfile.model | 单测 |

---

### Module D 完成标准

- [x] typecheck 通过
- [x] test 全绿（72 个，6 files）
- [x] Settings → Agents 面板可 CRUD profiles，重启保留
- [x] Composer 显示 agent selector，切换后 startSession 使用对应 model
- [x] 默认 Planner/Coder/Reviewer profiles 在首次启动时自动 seed

---

## P1 Terminal：xterm.js 集成（3–4 天）

### 需求

BottomOutput 当前只展示流式输出日志。开发者需要真正能输入的终端（运行 npm run dev、git 操作等）。

node-pty 已是依赖（手动模式用它）。

### 架构

**DB**：不需要新表。终端输出不持久化（会话级），只保持 PTY 进程与前端的双向连接。

**IPC namespace**：`terminal:*`

```ts
// terminal:create(workspaceId, cwd?) → { sessionId }
// terminal:write(sessionId, data)    → void
// terminal:resize(sessionId, cols, rows) → void
// terminal:kill(sessionId)           → void
// terminal:onData(callback)          ← IPC event channel
// terminal:onExit(callback)          ← IPC event channel
```

**前端**：`xterm` + `@xterm/addon-fit`（已在业界验证的 Electron + xterm 组合）

**文件**：
- `src/main/ipc/terminal.ts`（新建）
- `src/renderer/src/components/workspace/TerminalPanel.tsx`（新建）
- `src/renderer/src/components/workspace/BottomOutput.tsx` 加 Terminal tab

**设计要点**：
- Terminal 以 workspace 为单位创建，切换 workspace 时 kill 旧 PTY、创建新 PTY
- cwd 默认为 workspace.repo_path
- resize 事件由 xterm onResize 触发，通过 IPC 同步给 PTY
- BottomOutput 底部 Tab 加 `Terminal` 项，与现有 BottomOutput 并列

---

## P1 Monaco 编辑器（1 周）

### 需求

当前 CodePanel 是只读语法高亮（Prism/自定义）。开发者需要在工具中直接编辑文件。

### 架构

**依赖**：`@monaco-editor/react`（轻量封装，Electron 兼容）

**文件**：
- `src/renderer/src/components/workspace/CodePanel.tsx`（替换内部渲染逻辑）
- `src/main/ipc/file.ts`（已有 read，新增 `file:write`）
- `src/preload/index.ts`（新增 `file.write`）

**设计要点**：
- Monaco 只用于当前打开的文件，不做 multi-tab 管理（那是后续 P1.2 完整版）
- 脏状态：Monaco 内容与磁盘内容 diff，title 显示 `●`
- Cmd+S 保存：调用 `file:write`
- 只读模式：如果文件超大（>500KB）降级为只读

**IPC 新增**：

```ts
// file:write(workspaceId, filePath, content) → { success: boolean }
```

---

## P2 Multi-Agent 执行（待 Module D 稳定后设计）

预计范围：
- 多个 AgentProfile 在同一 conversation 里并行运行
- 消息按 agent_profile_id 区分显示（头像/名称）
- Agent 间通过共享 Memory Palace 传递产物
- 冲突检测：多 agent 写同一文件 → 弹出审批

**不在本文档范围，等 Module D 完成后出独立设计文档。**

---

## 关键约束汇总

1. **不引入 BrowserRouter**，继续用 HashRouter
2. **IPC 只暴露窄接口**，每个 namespace 只暴露本模块需要的方法
3. **SCHEMA_VERSION 递增**，v7 做 Agent Profiles 相关迁移，v8 补 Memory FTS update trigger
4. **不改现有 conversations/messages 模式**，向后兼容（agent_profile_id 列 nullable）
5. **测试先行（TDD）**：每个 Phase 的 IPC handler 先写测试再实现
6. **xterm + node-pty 运行在 main process**，终端 PTY 不能跨进程
7. **Monaco 按需加载**（dynamic import），避免影响首屏渲染

---

## 文档更新约定

完成每个 Phase 后需更新：
1. `docs/PROGRESS.md` — 状态总览 + 已完成列表
2. `docs/features/<feature>.md` — Status 章节
3. 本文档 — 对应 Phase 的完成标准打钩
4. `docs/reviews/active/README.md` — active review 索引
5. `docs/reviews/active/plan-completion-review.md` — 完成审查文档
6. 相关的 active review 文档 — 标记 finding 为已解决
7. 相关的 plan 文档 — 同步实际实现状态
