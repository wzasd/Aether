---
status: closed
owner: mochi
last_updated: 2026-05-05
doc_kind: code-review
---

# Keyboard Navigation Phase J Code Review (2nd pass)

Review scope:

- `src/renderer/src/hooks/useKeyboardShortcuts.ts` — 全局键盘快捷键 hook
- `src/renderer/src/components/workspace/TaskRail.tsx` — TaskRail 键盘导航（↑↓/Enter/Delete/F2）
- `src/renderer/src/App.tsx` — Hook 集成

Verification:

- `pnpm run typecheck` passed
- `pnpm run build` passed

## 1st-pass findings — resolution status

| # | Finding | Status |
|---|---------|--------|
| P1 #1 | Cmd+Shift+T 未复用 `toggleBottomPanel` | ✅ Fixed — 改为 `useUIStore.getState().toggleBottomPanel()` |
| P2 #2 | Cmd+W 无确认直接删除会话 | ✅ Fixed — 加了 `window.confirm` 对话框 |
| P2 #3 | Cmd+1~9 依赖全量列表，与 TaskRail filter 不一致 | ✅ Fixed — 读取 `filter` 并做与 TaskRail 相同的过滤逻辑 |
| P3 #4 | `e.key.toLowerCase()` 仅 Cmd+B 使用，风格不一致 | ✅ Fixed — 改为 `e.key === 'b'` |
| P3 #5 | TaskRail `onFocus` 自动设 `focusedIndex=0`，Tab 进入不符合预期 | ✅ Fixed — 改用 `kbd-focus` 自定义事件，只在 Cmd+K 时自动选中 |
| P3 #6 | Cmd+K 与 VS Code chord 前缀冲突预留 | ⬜ Open — 记录性质，无需代码修复 |

**Summary**: 1st pass 5/6 ✅. Remaining: #6 (P3, 记录性质).

## Positive Observations

- Hook 从 App.tsx 内联逻辑抽成独立 `useKeyboardShortcuts`，职责单一，依赖数组正确。
- `isEditableTarget` 守卫正确识别 `INPUT`/`TEXTAREA`/`contentEditable`/`.monaco-editor`，避免编辑器内误触发。
- Escape 分层处理（先 abort stream → 再 blur）逻辑优先级正确。
- TaskRail 键盘导航：`role="listbox"` + `data-task-item` + `scrollIntoView` + `onBlur` 重置，ARIA 语义和交互完备。
- `data-chat-input`、`data-task-list`、`data-task-item` 在生产端和消费端正确配对。
- App.tsx 集成干净，trigger counter 模式与 WorkspaceArea 一致。
- Cmd+Enter 在 input 内也能工作（focus chat input），设计合理。
- Filter 变更和 conversations 数量变更时自动重置 `focusedIndex`，避免 stale index。
- `kbd-focus` 自定义事件方案优雅地解决了 Tab/Cmd+K 行为区分问题。
