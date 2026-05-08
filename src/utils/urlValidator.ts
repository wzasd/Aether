/**
 * URL 安全验证工具
 * 用于验证和清理用户输入的 URL，防止开放重定向和协议注入攻击
 */

export interface UrlValidationResult {
  isValid: boolean;
  sanitizedUrl?: string;
  error?: string;
}

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const ALLOWED_DOMAINS: string[] = [];

/**
 * 验证 URL 是否安全
 */
export function validateUrl(
  input: unknown,
  options: { allowRelative?: boolean; allowedDomains?: string[] } = {}
): UrlValidationResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { isValid: false, error: 'URL must be a non-empty string' };
  }

  const trimmed = input.trim();

  // 相对路径检查
  if (options.allowRelative && trimmed.startsWith('/')) {
    if (/^[\/][^\\]*$/.test(trimmed)) {
      return { isValid: true, sanitizedUrl: trimmed };
    }
    return { isValid: false, error: 'Invalid relative path format' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }

  // 协议白名单检查
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      isValid: false,
      error: `Protocol "${parsed.protocol}" is not allowed`,
    };
  }

  // 域名白名单检查（如果配置了）
  const domains = options.allowedDomains ?? ALLOWED_DOMAINS;
  if (domains.length > 0) {
    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = domains.some(
      (d) => hostname === d.toLowerCase() || hostname.endsWith(`.${d.toLowerCase()}`)
    );
    if (!isAllowed) {
      return { isValid: false, error: 'Domain not in allowlist' };
    }
  }

  // 清理：移除用户认证信息
  parsed.username = '';
  parsed.password = '';

  // 清理：移除危险字符
  const sanitized = parsed.toString().replace(/[\x00-\x1F\x7F]/g, '');

  return { isValid: true, sanitizedUrl: sanitized };
}

/**
 * 快速检查 URL 是否有效且安全
 */
export function isSafeUrl(input: unknown): boolean {
  return validateUrl(input).isValid;
}
