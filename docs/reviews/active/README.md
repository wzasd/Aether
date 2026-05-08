---
status: active
owner: mochi
last_updated: 2026-05-07
doc_kind: review-index
---

# Active Reviews

## Open Findings Summary

| Priority | Open | Fixed | Total |
|----------|------|-------|-------|
| P0 | 0 | 5 | 5 |
| P1 | 17 | 20 | 37 |
| P2 | 18 | 26 | 44 |
| P3 | 10 | 11 | 21 |

## Review Documents

### [2026-05-07-a2a-gap-fill-review.md](./2026-05-07-a2a-gap-fill-review.md) ✅ CLOSED
A2A Gap Fill 代码审查。Created 2026-05-07, closed 2026-05-07。

**1 轮 review，5 个 finding，全部已修复**。

**本轮已复核修复**:
- P1：Reflow aggregation 全子任务完成后不会创建反馈任务
- P1：Reflow timeout 只改状态，没有 partial feedback delivery
- P1：Zombie defense 标记失败但不释放正在 await 的 runtime/queue
- P2：ACP `switchModel()` 覆盖 task/team runtime model override
- P2：Continuity capsule parent link 使用 profile id 而不是 parent task id

### [2026-05-07-agent-a2a-output-scan-review.md](./2026-05-07-agent-a2a-output-scan-review.md) ✅ CLOSED
Agent A2A Output Scanning 代码审查。Created 2026-05-07, closed 2026-05-07。

**1 轮 review，3 个 finding，全部已修复**。

**本轮已复核修复**:
- P1：parallel root run 下 agent-scan handoff 可能留在 serial queue 不执行
- P2：`requireReviewOnCodeChange` policy 现为 no-op
- P3：`A2ATask.source` 未持久化/恢复

### [2026-05-06-acp-backends-acceptance-review.md](./2026-05-06-acp-backends-acceptance-review.md)
ACP Backends 验收代码审查。Created 2026-05-06。

**2 轮 review，5 个 finding，4 fixed，1 Open**。

**仍开放**:
- P1：npx launch 缺少 `--yes`，未缓存 ACP package 时可能阻塞安装确认

**本轮已复核修复**:
- P1：npx ACP backends 在 UI 中被标记为未安装并禁用
- P1：ACP API keys 存储 key 与启动读取 key 不一致
- P1：ACP fs callbacks 允许不受限制的 absolute path read/write
- P2：ACP launch 忽略 Settings 中配置的 provider `binaryPath`

### [2026-05-06-soft-delete-ttl-review.md](./2026-05-06-soft-delete-ttl-review.md)
Soft Delete TTL 代码审查。Created 2026-05-06。

**1 轮 review，3 个 finding，3 Open**。

**仍开放**:
- P1：Search 仍会返回 soft-deleted conversations
- P1：Direct `/chat/:id` load 仍可打开 soft-deleted conversation
- P2：TaskRail/Cmd+W 等删除确认未展示 30 天保留语义

### [2026-05-06-draft-task-flow-review.md](./2026-05-06-draft-task-flow-review.md)
Draft Task Flow 代码审查。Created 2026-05-06。

**2 轮 review，4 个 finding，2 fixed，2 Open**。

**仍开放**:
- P1：StrictMode cleanup 可能立即删除新建 draft task
- P1：`updateCurrentConversation` hook 放在 early returns 后，违反 Hooks 顺序

**本轮已复核修复**:
- P1：Dev Team 选择未同步到 Zustand，首条消息可能走 stale solo state
- P2：first-send promote 与 auto-title 存竞态，TaskRail 可能显示旧标题

### [2026-05-05-phases-M-T1-T4-S-review.md](./2026-05-05-phases-M-T1-T4-S-review.md)
Phases M, T1-T4, S / DevTeam 代码审查。Updated 2026-05-05。

**5 轮 review，21 个 finding，3 fixed，18 Open**。

**仍开放**:
- P1：DB migration 动态 `require()` 存循环依赖风险
- P1：`rowToProfile` 重复定义
- P1：`executePipelineStep` 冗余 DB 查询
- P1：团队任务不会自动进入 DevTeam orchestrator
- P1：`on-code-change` reviewer 触发有竞态
- P2：`NewTaskDialog` 硬编码 teamId
- P2：FTS 查询特殊字符异常
- P2：DevTeam preset 判断不完整
- P2：`decisions`/`blockers` 始终为空
- P2：两侧 memory injection 逻辑不一致
- P2：首个 task `done` 会提前解锁输入
- P2：`feedbackTo` 只显示不回传
- P2：空 assistant 历史会丢掉 memory/progress context
- P1：团队任务仍会在无 active profile 时走 default chat path
- P1：`on-code-change` reviewer 触发竞态仍未消除
- P2：单个 task `done` 仍会释放整个 composer
- P2：feedback follow-up 仍依赖 renderer 异步持久化的最新 assistant 消息
- P3：`buildContextPacket` 修复缺少回归测试

**本轮已复核修复**:
- P1：team primary lookup stale profile state
- P1：orchestrator 完成后 composer 可能永久锁住
- P2：main-process file-change flag 漏掉 normalized/delete 工具名

### [2026-05-05-keyboard-nav-phase-j-review.md](./2026-05-05-keyboard-nav-phase-j-review.md) ✅ CLOSED
Keyboard Navigation Phase J 代码审查（2nd pass）。Created 2026-05-05, closed 2026-05-05。

**2 轮 review，6 个 finding，5 fixed，1 记录性质 Open**。

- 1st pass: 5/6 ✅ (P1×1, P2×2, P3×2)，1 Open (P3×1, 记录性质)

**仍开放**:
- P3：Cmd+K 与 VS Code chord 前缀冲突预留（记录性质，无需代码修复）

### [2026-05-05-token-cost-phase-i-review.md](./2026-05-05-token-cost-phase-i-review.md) ✅ CLOSED
Token/Cost Tracking Phase I 代码审查（2nd pass）。Created 2026-05-05, closed 2026-05-05。

**2 轮 review，15 个 finding，13 fixed，2 Won't Fix**。

- 1st pass: 10/12 ✅ (P1×3, P2×5, P3×2)，2 Won't Fix (P3×2)
- 2nd pass: 3/3 ✅ (P2×1, P3×2)

### [2026-05-04-mcp-client-phase-h-review.md](./2026-05-04-mcp-client-phase-h-review.md) ✅ CLOSED
MCP Client Phase H 代码审查（4th pass）。Created 2026-05-04, closed 2026-05-04。

**4 轮 review，37 个 finding，全部已修复**。

- 1st pass: 10/10 ✅ (P0×1, P1×3, P2×4, P3×2)
- 2nd pass: 14/15 ✅ (P1×3, P2×8, P3×3)
- 3rd pass: 10/12 ✅ (P1×2, P2×7, P3×3)
- 4th pass: 3/3 ✅ (P2×1, P3×2)

### [2026-05-03-file-browser-phase-d-review.md](./2026-05-03-file-browser-phase-d-review.md)
File Browser Phase D 代码审查。Created 2026-05-03。

**仍开放**:
- P1：`file:rename` 使用 `safePath(newPath)`，正常重命名到新路径会失败
- P1：`safeParentPath` 未验证 real parent 仍在 project root 内，symlink parent 可导致写出 workspace
- P2：root-level CRUD 后 `refreshDir('')` 不会更新 `fileTree`
- P2：目录 rename/delete 未同步处理其下已打开文件 tab

### [2026-05-03-multi-model-phase-2-3-review.md](./2026-05-03-multi-model-phase-2-3-review.md)
Multi-Model Phase 2+3 代码审查。Created 2026-05-03。

**仍开放**:
- P1：Codex / Kimi / Gemini parser 未完整满足 `complete` + `done` turn contract
- P2：conversation resume session id 未按 provider 维度隔离
- P2：Agent profile editor 仍是 Claude-only，未暴露 `preferredProvider` 与 provider-scoped model 列表

### [2026-05-03-provider-phase-1-review.md](./2026-05-03-provider-phase-1-review.md)
Provider Phase 1 代码审查。Updated 2026-05-03。

**已修复项**:
- ModelSelector/sessionConfigStore 改为完整 provider model id，通过 provider meta 模型校验
- ProviderConfig 配置已持久化，并影响 detect/spawn 的 binary/env
- AgentProfile `preferredProvider` 已接入 schema / IPC / runtime profile 数据层

**后续观察**:
- `enabled` 已持久化，但尚未用于硬性阻止 provider startSession 或过滤 availability

### [design-spec-gap-analysis.md](./design-spec-gap-analysis.md)
代码与设计规范的对比审计。Re-verified 2026-05-02。

**已修复项**:
- MemoryContent.tsx（已实现）
- Trigger Counter Pattern（已实现）
- TaskRail Memory Palace 迷你区（已实现）
- WorkspaceArea Panel 体系（已实现）
- TOOL_META 统一到共享模块
- 底部面板统一到 WorkspaceShell
- SharedConversation 死代码清理
- `.dark` 语义变量对齐 zinc 色阶

**仍开放**:
- 字体设置（Inter + JetBrains Mono）
- 颜色系统代码层面统一（zinc → 语义 token）
- 排版对齐（text-xs → text-[12px]）
- type:'plan' / type:'change' 消息卡片
- macOS Traffic Lights IPC 绑定

### [2026-05-02-frontend-interaction-review.md](./2026-05-02-frontend-interaction-review.md)
前端交互审查。Updated 2026-05-02。

**已修复项 (P0/P1)**:
- SharedConversation 死代码清理
- 双底部面板消除
- TOOL_META 统一到 `utils/toolMeta.ts`
- 主题系统 `.dark` 对齐
- 双模式切换器/双输入框消除
- App.tsx loadConversations 去重
- Paperclip 按钮 disabled 状态

**仍开放 (P2/P3)**:
- 颜色系统代码层面不统一
- 排版精度
- macOS Traffic Lights IPC
- type:'plan'/'change' 消息卡片
- 字体设置

## Closed Findings (2026-05-02 Fix Pass)

| # | Priority | Finding | Fix |
|---|----------|---------|-----|
| 1 | P0 | SharedConversation ~580行死代码 | 移除内部组件/输入框/模式切换器 |
| 2 | P0 | 双底部面板 | 移除 WorkspaceArea 内部面板 |
| 3 | P0 | TOOL_META 重复定义 | 提取到 `utils/toolMeta.ts` |
| 4 | P0 | 主题系统 `.dark` 值不一致 | 对齐 zinc 色阶 |
| 5 | P1 | 双模式切换器 | 随 SharedConversation 清理移除 |
| 6 | P1 | 双输入框 | 随 SharedConversation 清理移除 |
| 7 | P1 | App.tsx 双重 loadConversations | 移除冗余调用 |
| 8 | P1 | titlebar-drag z-index | 检查确认无 bug |
| 9 | P1 | Panel Picker Portal z-index | 检查确认无 bug |
| 10 | P2 | Paperclip 按钮无功能 | disabled + tooltip |
