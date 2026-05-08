export function buildFtsQuery(query: string, maxTokens = 8): string {
  const tokens = query
    .match(/[A-Za-z0-9_\-\u4e00-\u9fff]+/g)
    ?.map((token) => token.trim())
    .filter(Boolean)
    .slice(0, maxTokens) || []

  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ')
}
