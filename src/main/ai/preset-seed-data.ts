// Pure data constants — no DB imports. Used by both db.ts migrations and
// team-config.ts to avoid circular dependency (db.ts ↔ team-config.ts).
// Extracted per P1 #1 review recommendation.
//
// System prompts are loaded from src/main/ai/prompts/agent-roles/ (canonical source,
// mirroring Slock's platform-level prompt template separation). The PROMPT_REGISTRY
// maps preset profile IDs to their prompt templates. To add a new agent role:
//   1. Create src/main/ai/prompts/agent-roles/<role>.ts
//   2. Register it in agent-roles/index.ts PROMPT_REGISTRY
//   3. Add the profile entry to PRESET_PROFILE_SEEDS below

import type { TeamMember, AgentSpacePolicy } from "./team-config"
import { PROMPT_REGISTRY } from "./prompts/agent-roles"
import { PRESET_PROFILE_IDS } from "../../utils/preset-profile-ids"

export const DEV_TEAM_ID = "dev-team"
export const DEV_TEAM_NAME = "Dev Team"
export const DEV_TEAM_DESCRIPTION = "Planner 规划 → Architect 架构 → Claude 实现 → Codex 审查 → OpenCode UI"

export const DEV_TEAM_MEMBERS: TeamMember[] = [
  { profileId: PRESET_PROFILE_IDS.CLAUDE_PRIMARY },
  { profileId: PRESET_PROFILE_IDS.CODEX_REVIEWER },
  { profileId: PRESET_PROFILE_IDS.OPENCODE_UI },
  { profileId: PRESET_PROFILE_IDS.PLANNER },
  { profileId: PRESET_PROFILE_IDS.ARCHITECT }
]

export const DEV_TEAM_POLICIES: AgentSpacePolicy = {
  allowAgentMention: true,
  allowParallelThinking: true,
  allowCapabilityRouting: true,
  allowAgentToDelegate: true,
  maxParallelAgents: 5,
  writeMode: "single-writer"
}

export interface PresetProfileSeed {
  id: string
  name: string
  role: string
  model: string
  preferredProvider: string
  capabilities: string[]
  whenToUse: string
  outputContract: string
  systemPrompt: string
}

export const PRESET_PROFILE_SEEDS: PresetProfileSeed[] = [
  {
    id: PRESET_PROFILE_IDS.CLAUDE_PRIMARY,
    name: "Claude",
    role: "implementation",
    model: "claude-opus-4-7",
    preferredProvider: "claude-cli",
    capabilities: ["architecture","implementation","planning","delegation"],
    whenToUse: "所有任务的起点。负责理解需求、制定方案、实现代码、协调团队。",
    outputContract: "[TASK SUMMARY] 包含完成项、变更文件、遗留问题。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.CLAUDE_PRIMARY],
  },
  {
    id: PRESET_PROFILE_IDS.CODEX_REVIEWER,
    name: "Codex",
    role: "review",
    model: "o3",
    preferredProvider: "codex-cli",
    capabilities: ["code-review","security-audit","quality-gate"],
    whenToUse: "当有代码变更需要质量和安全把关时。由 Claude 主动委托触发。",
    outputContract: "[REVIEW SUMMARY] + APPROVED / NEEDS_CHANGES 结论。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.CODEX_REVIEWER],
  },
  {
    id: PRESET_PROFILE_IDS.OPENCODE_UI,
    name: "OpenCode",
    role: "ui",
    model: "opencode/gpt-5-nano",
    preferredProvider: "opencode-cli",
    capabilities: ["ui-implementation","css","responsive-design","interaction"],
    whenToUse: "当需要处理组件样式、布局、响应式设计、交互动画时。由 Claude 主动委托触发。",
    outputContract: "[UI IMPLEMENTATION] 包含修改文件、改动摘要、完整可替换的组件代码。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.OPENCODE_UI],
  },
  {
    id: PRESET_PROFILE_IDS.PLANNER,
    name: "Planner",
    role: "planning",
    model: "claude-sonnet-4-6",
    preferredProvider: "claude-acp",
    capabilities: ["planning","decomposition","risk-analysis","task-design"],
    whenToUse: "当收到复杂需求需要拆解为可执行的子任务、需要评估风险和依赖关系时。通常由 Claude 在实现前主动委托。",
    outputContract: "[PLAN] 包含任务分解树、每个子任务的输入/输出、依赖关系图、风险标注、建议执行顺序。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.PLANNER],
  },
  {
    id: PRESET_PROFILE_IDS.ARCHITECT,
    name: "Architect",
    role: "planning",
    model: "claude-sonnet-4-6",
    preferredProvider: "claude-acp",
    capabilities: ["architecture","system-design","adr","technical-strategy"],
    whenToUse: "当需要技术方案设计、架构决策（ADR）、技术选型评估、跨模块接口设计时。通常由 Planner 拆解后、Claude 实现前委托。",
    outputContract: "[ARCHITECTURE] 包含方案概述、关键决策及理由（ADR）、技术选型对比、接口契约、风险与约束。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.ARCHITECT],
  },
  {
    id: PRESET_PROFILE_IDS.TESTER,
    name: "Tester",
    role: "qa",
    model: "claude-sonnet-4-6",
    preferredProvider: "claude-acp",
    capabilities: ["testing","unit-test","integration-test","e2e","coverage","bug-report"],
    whenToUse: "当代码变更需要测试验证、发现边界 Bug、评估测试覆盖率时。由 Claude 在实现后主动委托。",
    outputContract: "[TEST REPORT] 包含 PASS/FAIL 结论、覆盖率、失败详情（含级别和复现步骤）。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.TESTER],
  },
  {
    id: PRESET_PROFILE_IDS.DEVOPS,
    name: "DevOps",
    role: "devops",
    model: "claude-sonnet-4-6",
    preferredProvider: "claude-acp",
    capabilities: ["cicd","docker","deployment","github-actions","infrastructure","monitoring"],
    whenToUse: "当需要配置 CI/CD 流水线、容器化部署、环境管理、基础设施自动化时。由 Claude 在发布前主动委托。",
    outputContract: "[DEVOPS REPORT] 包含操作描述、环境、结果、变更文件、影响范围、回滚方案。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.DEVOPS],
  },
  {
    id: PRESET_PROFILE_IDS.SECURITY_ENGINEER,
    name: "Security",
    role: "security",
    model: "claude-sonnet-4-6",
    preferredProvider: "claude-acp",
    capabilities: ["security-audit","vulnerability-scan","owasp","secret-management","threat-modeling"],
    whenToUse: "当需要代码安全审计、漏洞扫描、密钥管理检查、安全架构评审时。由 Claude 在涉及敏感操作时主动委托。",
    outputContract: "[SECURITY AUDIT] 包含审查范围、结论（PASS/WARNING/BLOCK）、问题清单（含级别）、修复建议。",
    systemPrompt: PROMPT_REGISTRY[PRESET_PROFILE_IDS.SECURITY_ENGINEER],
  },
]
