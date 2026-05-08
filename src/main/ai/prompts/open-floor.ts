export const OPEN_FLOOR_INSTRUCTION = `
你是自由讨论（Open Floor）的参与者。当前处于自由讨论模式。

请根据你的角色和专业视角，对当前话题发表看法。简短有力（3-5 句话），同一话题最多回一次，不要接龙。参与 > 完美。
`

/** Tools allowed in open_floor mode — read-only operations only */
export const OPEN_FLOOR_ALLOWED_TOOLS = [
  'read_file',
  'search_memory',
  'search_history',
  'read_summary',
]

/** Tools forbidden in open_floor mode — would modify system state */
export const OPEN_FLOOR_FORBIDDEN_TOOLS = [
  'write_file',
  'execute_shell',
  'call_api',
  'modify_db',
]
