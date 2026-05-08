---
status: in-progress
priority: P0
last_verified: 2026-05-01
doc_kind: feature
---

# Feature: Workspace Shell（工作区容器）

## Why（为什么做）

Workspace Shell 是所有其他 feature 的容器。它必须先稳定，其他 feature 才能正确落地。包括：三列布局、面板切换、workspace 作用域管理、底部输出面板。

**用户故事**：打开 Bytro，看到左侧 TaskRail、中间 SharedConversation、右侧 WorkspaceArea（代码/终端/预览/记忆），底部有输出面板。所有面板可拖拽调整大小。

## What（功能需求）

| 编号 | 需求 | 说明 |
|------|------|------|
| WS1 | 三列布局 | TaskRail（左）+ SharedConversation（中）+ WorkspaceArea（右），可拖拽 |
| WS2 | WorkspaceArea 面板切换 | Code / Terminal / Preview / Memory 四种面板类型 |
| WS3 | Workspace 作用域 | Workspace 选择器，会话/记忆都属于某个 workspace |
| WS4 | 底部输出面板 | 展示 terminal/build/test/diagnostics 真实输出，可拖拽调整高度 |
| WS5 | 窄屏适配 | 窄屏下 WorkspaceArea 可折叠或切换到单列 |

## How（设计决策）

**面板库**：`react-resizable-panels` v4（注意：API 与 v3 不同，见 CLAUDE.md 版本说明表）。

**Workspace 数据**：workspace 记录在 SQLite，当前选中 workspace 通过 store 持久化，新建会话自动绑定当前 workspace_id。

**BottomOutput 策略**：当前是模拟内容，最终需要接入真实 PTY/build output 服务。Claude CLI 的 manual mode（node-pty）是基础。

## Status（当前状态）

### 已完成
- [x] 三列布局骨架（TaskRail / SharedConversation / WorkspaceArea）
- [x] WorkspaceArea 面板标签栏（Code / Terminal / Preview / Memory tab）
- [x] 文件树、代码查看器、Preview iframe
- [x] Settings 面板
- [x] Workspace 选择器 UI

### ⚠️ 待完成

| ID | 问题 | 说明 |
|----|------|------|
| A-P1-4 | BottomOutput 拖拽手柄不可调整高度 | P1 bug |
| WS-1 | BottomOutput 展示模拟内容 | 需接入真实 terminal/build output |
| WS-2 | Memory Palace 工作区面板未实现 | 等待 Module C |
| WS-3 | 窄屏/桌面响应式未在 Module A/B 后验证 | 需 recheck |
| WS-4 | Home/Cmd+N 创建全局会话（无 workspace_id） | 与 Module A 联动修复 |

## Code（代码位置）

| 组件 | 文件 |
|------|------|
| 主布局 | `src/renderer/src/components/WorkspaceArea/` |
| 底部输出 | `src/renderer/src/components/BottomOutput/` |
| TaskRail | `src/renderer/src/components/TaskRail/` |
| Workspace selector | `src/renderer/src/components/selectors/` |

**相关文档**：
- 设计规格：`docs/design/modules/workspace-shell.md`
- UI 规范：`docs/design/mochi-design-reference.md`
- 技术选型：`docs/architecture/workspace-surfaces-technology.md`
- UI-first plan：`docs/plans/2026-04-30-ui-first-priority-plan.md`
