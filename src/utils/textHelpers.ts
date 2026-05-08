/**
 * 文本处理工具函数集合
 */

/**
 * 截断字符串并在末尾添加省略号
 * @param str 原始字符串
 * @param maxLength 最大长度
 * @returns 截断后的字符串
 */
export function truncate(str: string, maxLength: number): string {
  if (maxLength <= 0) {
    throw new Error('maxLength must be positive')
  }
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * 将字符串转换为 URL 友好的 slug
 * @param str 原始字符串
 * @returns slug 字符串
 */
export function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * 统计字符频率
 * @param str 输入字符串
 * @returns 字符到出现次数的映射
 */
export function charFrequency(str: string): Map<string, number> {
  const freq = new Map<string, number>()
  for (const char of str) {
    const count = freq.get(char) || 0
    freq.set(char, count + 1)
  }
  return freq
}

/**
 * 首字母大写
 * @param str 输入字符串
 * @returns 首字母大写的字符串
 */
export function capitalize(str: string): string {
  if (str.length === 0) return str
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * 生成指定长度的随机字符串
 * @param length 长度
 * @param charset 可选字符集，默认字母数字
 * @returns 随机字符串
 */
export function randomString(length: number, charset?: string): string {
  const chars = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
