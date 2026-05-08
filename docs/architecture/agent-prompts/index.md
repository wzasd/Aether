---
status: active
owner: bytro
last_verified: 2026-05-08
doc_kind: index
---

# Agent Prompts — 设计文档索引

本目录包含 bytro-app 各 Agent 角色的 prompt 设计文档。这些是**设计参考文档**——描述每个 Agent 应该具备的能力边界、工作方法论和协作规则。

运行时 prompt 位于 `src/main/ai/preset-seed-data.ts`（`PRESET_PROFILE_SEEDS[].systemPrompt`），由 `agent-runtime.ts` 在 Agent 启动时注入。

## Prompt 文件

| 文件 | Agent | 角色 | 定位 |
|------|-------|------|------|
| `planner.md` | Planner | 架构规划师 | 需求分析 → 方案设计 → 任务拆分 → ADR 决策 |
| `coder.md` | Coder | 主实现者 | 接收 Plan → TDD 实现 → 自测 → 委托审查 |
| `reviewer.md` | Reviewer | 代码审查员 | 安全审查 → 代码质量 → 性能评估 → 架构一致性 |
| `ui-designer.md` | UI Designer | UI 实现专家 | 精确复刻设计 → 全状态覆盖 → 可访问性保障 |
| `prd-writer.md` | PRD Writer | 需求文档师 | 需求发现 → 结构化 PRD → 用户故事 → 验收标准 |
| `tester.md` | Tester | 测试工程师 | 测试策略 → AAA 用例 → 边界覆盖 → 覆盖率 ≥80% |
| `devops.md` | DevOps | 部署运维工程师 | CI/CD → 环境管理 → 发布回滚 → 监控告警 |
| `security-engineer.md` | Security Engineer | 安全工程师 | 威胁建模 → 安全审查 → 漏洞检测 → 安全加固 |

## 统一结构（6 模块）

每个 prompt 文件遵循统一结构：

1. **角色定位**（~200 字）— 我是谁、我的专长、核心价值
2. **核心职责**（~300 字）— 3-5 个职责领域，每个带具体说明
3. **工作方法论**（~400 字）— 我怎么工作、遵循什么流程、检查清单
4. **协作规则**（~300 字）— Open Floor 和 Orchestrated 模式下的行为差异
5. **输出格式**（~300 字）— 回复结构、标签、类型定义
6. **硬约束**（~200 字）— 绝对不能做的事、必须遵守的纪律

**总字数目标：1,700-2,000 字**

## 运行时注入机制

```
固定模板（prompt 文件中的内容）
    +
动态上下文（agent-runtime.ts 自动注入）：
  - 当前协作模式（open_floor / orchestrated）
  - 在线同事列表
  - Memory Palace 相关记忆
  - ContinuityCapsule 决策摘要
    =
完整的 system prompt（Agent 启动时一次性注入）
```

## Agent ↔ Prompt 映射

| Agent | prompt 文件 | seed data ID | team member |
|-------|------------|-------------|-------------|
| Planner | `planner.md` | 待补充 | ✅ |
| Claude (Coder) | `coder.md` | `claude-primary` | ✅ |
| Codex (Reviewer) | `reviewer.md` | `codex-reviewer` | ✅ |
| OpenCode (UI) | `ui-designer.md` | `opencode-ui` | ✅ |
| PRD Writer | `prd-writer.md` | 待补充 | — |
| Architect | 待创建 | 待补充 | ✅ |
| Tester | `tester.md` | 待补充 | — |
| DevOps | `devops.md` | 待补充 | — |
| Security Engineer | `security-engineer.md` | 待补充 | —

> **注意**：`DEV_TEAM_MEMBERS` 已注册 `planner` 和 `architect`，但 `PRESET_PROFILE_SEEDS` 缺少对应的 profile 记录和 systemPrompt。P1 扩展角色（tester/devops/security-engineer）设计文档已就绪，运行时模板待 @Cindy 完成。

## 相关文档

- `src/main/ai/preset-seed-data.ts` — 运行时 seed data（含 systemPrompt）
- `src/main/ai/agent-runtime.ts` — Agent 启动时的 prompt 注入逻辑
- `docs/architecture/bytro-refactoring-plan.md` — 重构路线图
- `docs/architecture/decisions/session-layer-adrs.md` — ADR 决策
