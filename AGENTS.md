# AGENTS.md

Generic entrypoint for all coding agents. Claude Code agents should also read `CLAUDE.md`.

---

## 每次任务开始（必须按顺序）

1. **读 `docs/PROGRESS.md`** — 了解当前项目状态、正在做什么、有哪些 P1 问题
2. **读对应 feature 文档** `docs/features/<feature>.md` — 了解需求、设计决策、当前状态
3. **读 `docs/reviews/active/README.md`** — 确认当前仍 open 的 review findings，不要重复修已完成项
4. **读相关架构文档** — 了解技术约束（见下方快速索引）

不要跳过第 1 步。多个 agent 协作时，`PROGRESS.md` 是首要入口；active review index 和 feature 文档是当前状态的补充真相源。

---

## 快速索引（按任务类型）

| 任务类型 | 先读 | 再读 |
|---------|------|------|
| Task Execution / TaskRail / 会话状态 | `docs/features/task-execution.md` | `docs/architecture/ai-provider.md` |
| File Tracking / DiffPanel / changeStore | `docs/features/file-tracking.md` | `docs/architecture/runtime.md` |
| Memory Palace / 记忆条目 | `docs/features/memory-palace.md` | `docs/architecture/memory-system.md` |
| Workspace 布局 / 面板 / BottomOutput | `docs/features/workspace-shell.md` | `docs/architecture/workspace-surfaces-technology.md` |
| Multi-Agent | `docs/features/multi-agent.md` | — |
| Runtime / build / Electron / IPC | `docs/architecture/runtime.md` | — |
| AI Provider / Claude CLI / streaming | `docs/architecture/ai-provider.md` | — |
| Memory / recall / .bytro files | `docs/architecture/memory-system.md` | — |
| UI / 视觉规范 | `docs/design/mochi-design-reference.md` | `docs/design/ui-guidelines.md` |
| Review / 收口 / 状态规整 | `docs/reviews/active/README.md` | `docs/reviews/active/plan-completion-review.md` |

---

## 当前硬规则

- **HashRouter**：Electron file loading 下不要换成 `BrowserRouter`，除非先实现自定义协议 fallback。
- **Preload API 要窄**：renderer 只能通过 `window.api.<namespace>` 调用明确 API，不暴露泛 IPC。
- **IPC 必须校验 payload**：main process handler 要做运行时校验，尤其是文件路径、URL、状态机、SQL 参数。
- **不要拼 renderer-controlled SQL 字段名**；如必须动态字段，先用 allowlist。
- **DB / native CJS 边界**：`better-sqlite3` 只通过现有 DB boundary 加载；不要给 `package.json` 加 `"type": "module"`。
- **Memory 真相源**：项目记忆以 `.bytro/*` durable files 为真相源，SQLite 是 read model / index，renderer 不直接写 read model。
- **AI session id 不持久化为业务身份**：session id 只用于运行时路由和 resume，不当作 durable memory key。
- **外部 URL 必须 allowlist**：Preview / openExternal 只允许明确协议和来源。

---

## 任务完成后（必须执行）

1. **更新 `docs/PROGRESS.md`**：
   - 修复了 P1 问题 → 从"当前 P1 问题"表中移除
   - 完成了功能 → 在"已完成"列表加一行
   - Feature 状态变化 → 更新状态总览表
   - 更新 `last_verified` 日期
2. **更新对应 feature 文档** `docs/features/<feature>.md`：
   - Status 章节中勾选已完成项
   - 如有新的设计决策，写进 How 章节并说明原因
3. **如果处理了 review finding 或计划状态**，同步更新：
   - `docs/reviews/active/README.md`
   - 对应 review 文档
   - `docs/reviews/active/plan-completion-review.md`
   - 对应 `docs/plans/*.md`（仅当计划状态变化）
4. **运行验证**：
   ```bash
   pnpm run typecheck
   pnpm build       # 代码/IPC/DB/preload/构建配置变更时
   pnpm test        # 测试相关或行为风险变更时
   ```

文档-only 改动通常不需要跑 build/test；但如果文档声称代码已修复，先 review 代码并至少跑 `pnpm run typecheck`。

---

## 多 Agent 协作约定

- **不要并行写同一个 feature 文档**。如果两个 agent 同时工作，各自负责不同 feature。
- **发现新问题**时，加入对应 feature 文档的 Status → 待实现/P1 问题，并更新 PROGRESS.md。
- **review finding 不要口头关闭**。必须先复审代码，再把状态写回 review 文档和 active review index。
- **设计决策变更**时（不是 bug fix），写进 feature 文档的 How 章节，说明旧方案是什么、为什么改。
- **blocked 时**，在 feature 文档末尾加一行"BLOCKED: <原因>"，不要静默失败。
