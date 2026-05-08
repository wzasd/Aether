# CatWork 记忆系统框架审查 — 架构完整性角度

> 审查人：kimi  
> 日期：2026-05-05  
> 审查对象：`docs/specs/2026-04-29-bytro-memory-system-design.md`、`docs/architecture/memory-system.md` 及其实现代码  
> 结论：**架构设计方向正确，核心分层清晰，但存在 5 处架构完整性风险，需关注。**

---

## 一、架构设计亮点（值得保留）

### 1. 三层存储分离（文件真相源 + SQLite 编译产物 + FTS 索引）
- 文件层（`.bytro/*.md`）作为人可读、可版本控制的真相源
- SQLite 作为运行时 read model / cache
- FTS5 作为编译索引，可重建
- **这是正确的 CQRS -lite 思路**，符合长期可维护性要求

### 2. Candidate → Materialize 的防污染流程
- Agent 不能直接写 Project Memory，必须先提交 candidate
- 用户确认（或高置信规则）后才物化到长期记忆
- **关键安全阀**，防止模型幻觉污染项目知识

### 3. 记忆分层模型（Project / Agent / Conversation）
- Project Memory：跨 agent、跨 session 共享
- Agent Memory：角色偏好，不存项目事实
- Conversation Summary：任务连续性
- **边界划分清晰**，职责单一

### 4. 启动时上下文组装设计
- 明确的注入顺序：Agent Profile → Project Memory → Conversation Summary → Recent Messages → Recall → Code Context
- **不依赖 Claude/Codex resume 作为连续性来源**，这是架构上的独立性保障

---

## 二、架构完整性风险（5 项）

### 🔴 风险 1：Truth Source 与 Read Model 同步机制不完整

**问题描述**：
- `project-memory.md`（文件）是真相源，`project_memory_items`（SQLite）是 read model
- 当前设计有 `source_hash` 字段，但**没有看到自动同步/校验机制**
- 如果用户直接编辑 `.bytro/project-memory.md`，SQLite 中的 read model 会过期
- `memory_fts` 索引依赖 `project_memory_items`，级联失效

**具体代码佐证**：
- `memory-fs.ts` 提供文件读写，但无通知机制
- `memory-index.ts` 的 `createProjectMemoryItem` 直接写 SQLite，不检查文件是否已变更
- `db.ts` 中有 `source_hash` 字段定义，但无重建/校验逻辑

**影响**：
- 用户手动编辑记忆文件后，检索结果与文件内容不一致
- 多进程/多实例场景下数据分歧

**建议**：
1. 启动时增加 `source_hash` 校验：读取文件 → 计算 hash → 与 `source_hash` 比对 → 不一致则 rebuild read model
2. 或采用 watch 模式：用 `fs.watchFile` / `chokidar` 监控 `.bytro/*.md` 变更，自动触发 rebuild
3. 明确文档化：用户直接编辑文件后需要执行「Rebuild Memory Index」操作

---

### 🔴 风险 2：FTS5 查询存在注入风险 + 空查询行为不一致

**问题描述**：
- `memory-injection.ts` 中直接将用户输入前 100 字符传入 FTS5 MATCH：
  ```ts
  .all(queryText, workspaceId, 5)
  ```
- FTS5 的查询语法包含特殊字符（`*`, `"`, `-`, `OR`, `AND` 等）
- 当前代码用 `try/catch` 兜住语法错误，但**静默吞掉错误**，导致记忆检索失败时用户无感知
- `buildFtsQuery` 在 `memory-index.ts` 的 recall 中被使用，但 `memory-injection.ts` 似乎直接用了原始文本

**具体代码佐证**：
```ts
// memory-injection.ts:48-60
let ftsResults = []
try {
  ftsResults = db.prepare(`... WHERE memory_fts MATCH ? ...`).all(queryText, ...)
} catch {
  // FTS5 syntax error — fall back to recent-only
}
```
- 这里 `queryText` 是原始用户消息切片，未经过 `buildFtsQuery` 处理

**影响**：
- 用户消息含特殊字符时，FTS 检索静默失败，只返回 recent items，影响记忆召回质量
- 潜在的 FTS5 语法注入（虽然 FTS5 不是 SQL 注入，但特殊查询语法可能产生意外行为）

**建议**：
1. `memory-injection.ts` 应复用 `buildFtsQuery` 工具函数统一处理查询文本
2. 区分「FTS 语法错误」和「无结果」，至少记录日志
3. 考虑对用户输入做清洗：移除非字母数字字符，或转义 FTS5 特殊字符

---

### 🔴 风险 3：Conversation Summary 生成机制过于简陋

**问题描述**：
- 设计文档中 summary 是结构化对象（`completedItems`, `pendingItems`, `risks`, `nextSteps` 等）
- 但实现计划（Task 7）中的自动生成逻辑只是简单拼接最近 10 条消息的前 200 字符：
  ```ts
  const summaryText = recentMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role}: ${(m.content || '').slice(0, 200)}`)
    .join('\n')
  ```
- 这不是「摘要」，而是「截断的原始消息拼接」
- 无法提取 `pendingItems`、`risks`、`nextSteps` 等结构化字段
- 没有利用 LLM 生成摘要的能力

**影响**：
- Conversation Summary 无法有效支撑「任务连续性」目标
- 上下文压缩后恢复时，summary 信息量不足，agent 难以续作
- 与设计方案中的结构化定义严重脱节

**建议**：
1. P0 阶段至少定义一个「轻量摘要」规范：基于消息角色、工具调用结果、文件变更等元数据生成半结构化摘要
2. 明确 Summary 生成是「异步后台任务」还是「同步阻塞操作」——当前设计未说明
3. 如果 P0 不实现 LLM 摘要，应在文档中标注为「已知缺口，P1 补足」

---

### 🟡 风险 4：Agent Profile 存在双重来源冲突

**问题描述**：
- `agent_profiles` / `agent_profile_cache` 表存储 agent memory 的 read model
- `agent_profile_configs` 表存储用户可配置的 agent 配置（含 `system_prompt`）
- 两个表都有 `workspace_id + agent_id` 维度，但**没有明确的优先级规则**
- `memory-injection.ts` 只查询 `project_memory_items`，不注入 agent profile
- 启动时上下文组装（设计文档第六节）提到要注入 Agent Profile，但实现中似乎未完全落地

**具体代码佐证**：
- `db.ts` 中有 `agent_profile_cache` 和 `agent_profile_configs` 两个表
- `memory-index.ts` 只有 `upsertAgentProfile` / `getAgentProfile` 操作 cache 表
- `ipc/memory.ts` 只有 `memory:upsertAgentProfile` / `memory:getAgentProfile` 暴露 cache 表
- `agent_profile_configs` 的读写由 `ipc/agent.ts` 管理，与 memory 系统平行

**影响**：
- 用户配置的系统提示词（agent_profile_configs.system_prompt）和 agent 记忆（agent_profile_cache.content）可能在注入时冲突
- Agent 启动时不知道该用哪个 source 的 profile

**建议**：
1. 明确 Agent Profile 的合并策略：user config（agent_profile_configs）优先级高于 agent memory（agent_profile_cache）
2. 或统一为一个概念：agent_profile_configs 作为「配置」，agent_profile_cache 作为「运行时记忆缓存」，注入时合并
3. 在注入逻辑中显式处理两个表的读取和合并

---

### 🟡 风险 5：Memory Candidate 的 Confidence 和 Auto-Approval 规则未量化

**问题描述**：
- 设计文档规定：`explicit` 用户指令 → 自动 approved；`inferred` 模型推断 → needs_review
- 但 `memory-extractor.ts` 中所有提取的 candidate 都是 `confidence: 'low'`：
  ```ts
  results.push({ kind, title, content: normalized, confidence: 'low' })
  ```
- `build/debug 已验证事实` 可高置信自动确认的规则没有实现
- `confidence` 字段只有 `'low'`，没有 `'medium'` / `'high'` 的判定逻辑

**影响**：
- Candidate 审核队列会堆积大量 low confidence 项目，增加用户审核负担
- 无法实现「高置信自动确认」的优化路径

**建议**：
1. 为 extractor 增加 confidence 分级逻辑：
   - 用户明确说「记住」→ `high` → auto-approve
   - 多次出现相同 pattern → `medium`
   - 单次 regex 匹配 → `low`
2. 在 `memory-index.ts` 中增加 auto-approval 规则：confidence === 'high' 且 kind 为特定类型时自动 materialize
3. 或至少预留接口，P1 实现 ML-based confidence scoring

---

## 三、架构演进建议

### 短期（P0 补完）
1. **增加 source_hash 校验逻辑**：启动时校验 `.bytro/project-memory.md` 的 hash，不一致则 rebuild
2. **统一 FTS 查询处理**：`memory-injection.ts` 复用 `buildFtsQuery`
3. **明确 Summary 实现等级**：当前「消息拼接」作为 P0.5 临时方案，文档中标注缺口

### 中期（P1）
1. **Agent Profile 统一**：合并 agent_profile_cache 和 agent_profile_configs 的读取逻辑
2. **Confidence 分级 + Auto-approval**：实现基于规则的自动确认
3. **Summary 真正 LLM 化**：调用轻量模型生成结构化摘要

### 长期（P2）
1. **Embedding + Semantic Recall**：当前 FTS 只支持词汇匹配，语义召回需 embedding
2. **Cross-project Global Memory**：当前 `workspace_id` 隔离，全局记忆需新表设计
3. **Memory Compaction**：`summary_segments` append-only ledger 的压缩策略

---

## 四、总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 分层设计 | ✅ 优秀 | 文件/SQLite/FTS 三层分离正确 |
| 数据一致性 | ⚠️ 风险 | Truth source ↔ read model 同步机制缺失 |
| 安全性 | ⚠️ 风险 | FTS 查询处理不一致，有静默失败 |
| 可扩展性 | ✅ 良好 | 预留 embedding、cross-project 接口 |
| 实现完整性 | ⚠️ 风险 | Summary 生成、Agent Profile 合并未完全落地 |
| 防污染机制 | ✅ 优秀 | Candidate → Materialize 流程完整 |

**总体判断**：架构设计方向正确，核心分层和防污染机制是坚实的。但需要在 **truth source 同步、FTS 查询安全、summary 生成质量、agent profile 合并** 四个点上补足，否则随着数据量增长会出现「记忆不一致」或「召回质量下降」的系统性问题。
