/**
 * PR-1: Runtime Error Diagnostics
 *
 * Provides structured error classification, PII scrubbing, and fingerprinting
 * for provider runtime errors. Enables observability and pattern-based alerting
 * without exposing sensitive data.
 */

import { createHash } from 'crypto'
import { writeObservabilityEvent } from '../core/logging'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** High-level error categories for provider failures */
export type ProviderErrorCategory =
  | 'auth_failure'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'network_error'
  | 'timeout'
  | 'cli_not_found'
  | 'cli_crash'
  | 'model_not_found'
  | 'context_window_exceeded'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'

/** Severity of the error for alerting purposes */
export type ProviderErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

/** Structured diagnostic result */
export interface ProviderErrorDiagnostic {
  /** Original error message with PII scrubbed */
  scrubbedMessage: string
  /** Stable fingerprint for deduplication and pattern detection */
  fingerprint: string
  /** Error category */
  category: ProviderErrorCategory
  /** Severity level */
  severity: ProviderErrorSeverity
  /** Whether this error is likely retryable */
  retryable: boolean
  /** Suggested user-facing action */
  userAction: string
  /** Provider that produced the error */
  provider: string
  /** Timestamp of the diagnostic */
  timestamp: number
}

// ---------------------------------------------------------------------------
// PII Scrubbing
// ---------------------------------------------------------------------------

/** Patterns that may contain PII or sensitive data */
const PII_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // API keys, tokens, bearer strings — captures the keyword + value
  { pattern: /(?:api[_-]?key|token|bearer|secret|password|auth)\s*[:=]\s*["']?\S+/gi, replacement: '[REDACTED_CREDENTIAL]' },
  // Bare bearer/JWT tokens after "Bearer " keyword
  { pattern: /Bearer\s+\S+/gi, replacement: 'Bearer [REDACTED_CREDENTIAL]' },
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  // IP addresses
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
  // File paths that might contain usernames
  { pattern: /(?:\/Users\/|\/home\/|C:\\Users\\)\S+/gi, replacement: '[REDACTED_PATH]' },
  // UUIDs (could be session/request IDs)
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, replacement: '[REDACTED_UUID]' },
  // Long hex strings (could be tokens)
  { pattern: /\b[0-9a-f]{32,}\b/gi, replacement: '[REDACTED_HEX]' },
]

/**
 * Scrub PII from an error message.
 * Returns a new string with sensitive data replaced by placeholders.
 */
export function scrubErrorMessage(message: string): string {
  let scrubbed = message
  for (const { pattern, replacement } of PII_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement)
  }
  return scrubbed
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Generate a stable fingerprint for an error, suitable for deduplication.
 * The fingerprint is based on the category + scrubbed message, so similar
 * errors across different instances produce the same fingerprint.
 */
export function fingerprintError(category: ProviderErrorCategory, scrubbedMessage: string): string {
  const normalizedMessage = scrubbedMessage
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  const hash = createHash('sha256')
  hash.update(`${category}:${normalizedMessage}`)
  return hash.digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

/** Pattern-based classification rules, ordered by specificity (most specific first) */
const CLASSIFICATION_RULES: ReadonlyArray<{
  pattern: RegExp
  category: ProviderErrorCategory
  severity: ProviderErrorSeverity
  retryable: boolean
  userAction: string
}> = [
  // Auth failures
  {
    pattern: /(?:invalid\s+api\s+key|unauthorized|authentication\s+failed|401|api\s+key\s+(?:is\s+)?invalid|not\s+authenticated)/i,
    category: 'auth_failure',
    severity: 'high',
    retryable: false,
    userAction: 'Check your API key configuration in settings.',
  },
  // Rate limiting
  {
    pattern: /(?:rate\s+limit|too\s+many\s+requests|429|request\s+throttl)/i,
    category: 'rate_limit',
    severity: 'medium',
    retryable: true,
    userAction: 'Wait a moment and try again. Consider reducing request frequency.',
  },
  // Quota exceeded
  {
    pattern: /(?:quota\s+exceeded|billing\s+limit|usage\s+limit|insufficient\s+quota|plan\s+limit)/i,
    category: 'quota_exceeded',
    severity: 'high',
    retryable: false,
    userAction: 'Your API quota has been exceeded. Check your billing dashboard or upgrade your plan.',
  },
  // Context window
  {
    pattern: /(?:context\s+(?:window|length)|maximum\s+context|token\s+limit\s+exceeded|prompt\s+is\s+too\s+long|context_length_exceeded)/i,
    category: 'context_window_exceeded',
    severity: 'medium',
    retryable: false,
    userAction: 'The conversation is too long. Start a new session or reduce the context.',
  },
  // Model not found
  {
    pattern: /(?:model\s+not\s+found|model\s+does\s+not\s+exist|invalid\s+model|model\s+unavailable)/i,
    category: 'model_not_found',
    severity: 'high',
    retryable: false,
    userAction: 'The selected model is not available. Choose a different model in settings.',
  },
  // CLI not found
  {
    pattern: /(?:command\s+not\s+found|cli\s+not\s+found|executable\s+not\s+found|no\s+such\s+file|ENOENT)/i,
    category: 'cli_not_found',
    severity: 'critical',
    retryable: false,
    userAction: 'The CLI tool is not installed or not in PATH. Install it and restart the app.',
  },
  // CLI crash
  {
    pattern: /(?:segmentation\s+fault|SIGSEGV|SIGABRT|core\s+dump|process\s+exited\s+with\s+(?:code\s+)?1|exit\s+code\s+1|cli\s+crash)/i,
    category: 'cli_crash',
    severity: 'critical',
    retryable: true,
    userAction: 'The CLI tool crashed unexpectedly. Try restarting the session.',
  },
  // Timeout
  {
    pattern: /(?:timeout|timed?\s+out|ETIMEDOUT|deadline\s+exceeded|request\s+timeout)/i,
    category: 'timeout',
    severity: 'medium',
    retryable: true,
    userAction: 'The request timed out. Check your network connection and try again.',
  },
  // Network errors
  {
    pattern: /(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|network\s+error|fetch\s+failed|connection\s+(?:refused|reset|failed)|unable\s+to\s+connect)/i,
    category: 'network_error',
    severity: 'high',
    retryable: true,
    userAction: 'Network connection failed. Check your internet connection and try again.',
  },
  // Invalid request
  {
    pattern: /(?:invalid\s+request|bad\s+request|400|malformed|validation\s+error|parameter\s+invalid)/i,
    category: 'invalid_request',
    severity: 'medium',
    retryable: false,
    userAction: 'The request was invalid. Check your input and try again.',
  },
  // Server errors
  {
    pattern: /(?:internal\s+server\s+error|500|502|503|504|server\s+error|service\s+unavailable|bad\s+gateway|gateway\s+timeout)/i,
    category: 'server_error',
    severity: 'high',
    retryable: true,
    userAction: 'The provider server is experiencing issues. Try again in a few minutes.',
  },
]

/**
 * Classify an error message into a structured category.
 * Returns the first matching rule, or 'unknown' if no rule matches.
 */
export function classifyError(errorMessage: string): {
  category: ProviderErrorCategory
  severity: ProviderErrorSeverity
  retryable: boolean
  userAction: string
} {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(errorMessage)) {
      return {
        category: rule.category,
        severity: rule.severity,
        retryable: rule.retryable,
        userAction: rule.userAction,
      }
    }
  }

  return {
    category: 'unknown',
    severity: 'low',
    retryable: false,
    userAction: 'An unexpected error occurred. Check the logs for details.',
  }
}

// ---------------------------------------------------------------------------
// Main Diagnostic Entry Point
// ---------------------------------------------------------------------------

/**
 * Produce a full diagnostic for a provider error.
 *
 * This is the main entry point: given a raw error and provider name,
 * it scrubs PII, classifies the error, generates a fingerprint,
 * and returns a structured diagnostic suitable for logging and observability.
 */
export function diagnoseProviderError(
  error: Error | string,
  provider: string
): ProviderErrorDiagnostic {
  const rawMessage = typeof error === 'string' ? error : (error.message ?? String(error))
  const scrubbedMessage = scrubErrorMessage(rawMessage)
  const classification = classifyError(rawMessage)
  const fingerprint = fingerprintError(classification.category, scrubbedMessage)

  const diagnostic: ProviderErrorDiagnostic = {
    scrubbedMessage,
    fingerprint,
    category: classification.category,
    severity: classification.severity,
    retryable: classification.retryable,
    userAction: classification.userAction,
    provider,
    timestamp: Date.now(),
  }

  writeObservabilityEvent('provider:error', {
    runtimeKey: provider,
    category: diagnostic.category,
    severity: diagnostic.severity,
    fingerprint: diagnostic.fingerprint,
    retryable: diagnostic.retryable,
    scrubbedMessage: diagnostic.scrubbedMessage,
    source: 'diagnostics',
  })

  return diagnostic
}
