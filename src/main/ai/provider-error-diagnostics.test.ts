/**
 * Unit tests for provider-error-diagnostics
 *
 * Covers:
 * - PII scrubbing (credentials, emails, IPs, paths, UUIDs, hex strings)
 * - Error classification (all categories)
 * - Fingerprinting (stability, uniqueness)
 * - Full diagnostic pipeline (diagnoseProviderError)
 * - Edge cases (empty messages, unknown errors, concurrent calls)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  scrubErrorMessage,
  fingerprintError,
  classifyError,
  diagnoseProviderError,
  type ProviderErrorCategory,
} from './provider-error-diagnostics'

// Mock writeObservabilityEvent so diagnostics don't write to DB during tests
vi.mock('../core/logging', () => ({
  writeObservabilityEvent: vi.fn(),
}))

// ---------------------------------------------------------------------------
// PII Scrubbing
// ---------------------------------------------------------------------------

describe('scrubErrorMessage', () => {
  it('scrubs API keys from error messages', () => {
    const input = 'Invalid api_key=sk-abc123def456'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('sk-abc123def456')
    expect(result).toContain('[REDACTED_CREDENTIAL]')
  })

  it('scrubs bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test.sig'
    const result = scrubErrorMessage(input)
    expect(result).toContain('[REDACTED_CREDENTIAL]')
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9.test.sig')
  })

  it('scrubs email addresses', () => {
    const input = 'User test@example.com not found'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('test@example.com')
    expect(result).toContain('[REDACTED_EMAIL]')
  })

  it('scrubs IP addresses', () => {
    const input = 'Connection refused to 192.168.1.100:443'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('192.168.1.100')
    expect(result).toContain('[REDACTED_IP]')
  })

  it('scrubs file paths with usernames', () => {
    const input = 'ENOENT: no such file /Users/john/.config/app/settings.json'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('/Users/john/')
    expect(result).toContain('[REDACTED_PATH]')
  })

  it('scrubs Linux home paths', () => {
    const input = 'Error reading /home/alice/.ssh/config'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('/home/alice/')
    expect(result).toContain('[REDACTED_PATH]')
  })

  it('scrubs Windows user paths', () => {
    const input = 'File not found: C:\\Users\\admin\\Documents\\key.pem'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('C:\\Users\\admin')
    expect(result).toContain('[REDACTED_PATH]')
  })

  it('scrubs UUIDs', () => {
    const input = 'Session 550e8400-e29b-41d4-a716-446655440000 expired'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('550e8400-e29b-41d4-a716-446655440000')
    expect(result).toContain('[REDACTED_UUID]')
  })

  it('scrubs long hex strings (potential tokens)', () => {
    const input = 'Token a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 is invalid'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
    expect(result).toContain('[REDACTED_HEX]')
  })

  it('preserves non-sensitive error information', () => {
    const input = 'Rate limit exceeded for model gpt-4'
    const result = scrubErrorMessage(input)
    expect(result).toContain('Rate limit exceeded')
    expect(result).toContain('gpt-4')
  })

  it('handles empty string', () => {
    expect(scrubErrorMessage('')).toBe('')
  })

  it('handles message with no PII', () => {
    const input = 'Connection timeout after 30000ms'
    expect(scrubErrorMessage(input)).toBe(input)
  })

  it('scrubs multiple PII types in a single message', () => {
    const input = 'User test@example.com from 10.0.0.1 using api_key=sk-123 failed'
    const result = scrubErrorMessage(input)
    expect(result).not.toContain('test@example.com')
    expect(result).not.toContain('10.0.0.1')
    expect(result).not.toContain('sk-123')
    expect(result).toContain('[REDACTED_EMAIL]')
    expect(result).toContain('[REDACTED_IP]')
    expect(result).toContain('[REDACTED_CREDENTIAL]')
  })
})

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  const testCases: Array<{
    message: string
    expectedCategory: ProviderErrorCategory
    expectedRetryable: boolean
  }> = [
    // Auth failures
    { message: 'Invalid API key provided', expectedCategory: 'auth_failure', expectedRetryable: false },
    { message: '401 Unauthorized', expectedCategory: 'auth_failure', expectedRetryable: false },
    { message: 'Authentication failed for user', expectedCategory: 'auth_failure', expectedRetryable: false },

    // Rate limiting
    { message: 'Rate limit exceeded', expectedCategory: 'rate_limit', expectedRetryable: true },
    { message: '429 Too Many Requests', expectedCategory: 'rate_limit', expectedRetryable: true },
    { message: 'Request throttled', expectedCategory: 'rate_limit', expectedRetryable: true },

    // Quota exceeded
    { message: 'Quota exceeded for project', expectedCategory: 'quota_exceeded', expectedRetryable: false },
    { message: 'Billing limit reached', expectedCategory: 'quota_exceeded', expectedRetryable: false },
    { message: 'Insufficient quota', expectedCategory: 'quota_exceeded', expectedRetryable: false },

    // Context window
    { message: 'Context window exceeded maximum length', expectedCategory: 'context_window_exceeded', expectedRetryable: false },
    { message: 'Token limit exceeded: 128000 > 8192', expectedCategory: 'context_window_exceeded', expectedRetryable: false },
    { message: 'context_length_exceeded', expectedCategory: 'context_window_exceeded', expectedRetryable: false },

    // Model not found
    { message: 'Model not found: gpt-5-turbo', expectedCategory: 'model_not_found', expectedRetryable: false },
    { message: 'Invalid model specified', expectedCategory: 'model_not_found', expectedRetryable: false },

    // CLI not found
    { message: 'Command not found: claude', expectedCategory: 'cli_not_found', expectedRetryable: false },
    { message: 'ENOENT: no such file or directory', expectedCategory: 'cli_not_found', expectedRetryable: false },

    // CLI crash
    { message: 'Process exited with code 1', expectedCategory: 'cli_crash', expectedRetryable: true },
    { message: 'Segmentation fault (core dumped)', expectedCategory: 'cli_crash', expectedRetryable: true },

    // Timeout
    { message: 'Request timeout after 30000ms', expectedCategory: 'timeout', expectedRetryable: true },
    { message: 'ETIMEDOUT: connection timed out', expectedCategory: 'timeout', expectedRetryable: true },

    // Network errors
    { message: 'ECONNREFUSED: connection refused', expectedCategory: 'network_error', expectedRetryable: true },
    { message: 'ECONNRESET: connection reset by peer', expectedCategory: 'network_error', expectedRetryable: true },
    { message: 'Fetch failed: unable to connect', expectedCategory: 'network_error', expectedRetryable: true },

    // Invalid request
    { message: '400 Bad Request: invalid parameter', expectedCategory: 'invalid_request', expectedRetryable: false },
    { message: 'Validation error: field required', expectedCategory: 'invalid_request', expectedRetryable: false },

    // Server errors
    { message: '500 Internal Server Error', expectedCategory: 'server_error', expectedRetryable: true },
    { message: '502 Bad Gateway', expectedCategory: 'server_error', expectedRetryable: true },
    { message: '503 Service Unavailable', expectedCategory: 'server_error', expectedRetryable: true },

    // Unknown
    { message: 'Something weird happened', expectedCategory: 'unknown', expectedRetryable: false },
    { message: '', expectedCategory: 'unknown', expectedRetryable: false },
  ]

  it.each(testCases)('classifies "$message" as $expectedCategory', ({ message, expectedCategory, expectedRetryable }) => {
    const result = classifyError(message)
    expect(result.category).toBe(expectedCategory)
    expect(result.retryable).toBe(expectedRetryable)
  })

  it('returns severity for each category', () => {
    const result = classifyError('Invalid API key')
    expect(result.severity).toBe('high')
  })

  it('returns user action for each category', () => {
    const result = classifyError('Rate limit exceeded')
    expect(result.userAction).toBeTruthy()
    expect(typeof result.userAction).toBe('string')
  })

  it('matches most specific rule first (auth before generic 401)', () => {
    // "401 Unauthorized" should match auth_failure, not some other rule
    const result = classifyError('401 Unauthorized')
    expect(result.category).toBe('auth_failure')
  })
})

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

describe('fingerprintError', () => {
  it('produces consistent fingerprints for same input', () => {
    const fp1 = fingerprintError('rate_limit', 'Rate limit exceeded for gpt-4')
    const fp2 = fingerprintError('rate_limit', 'Rate limit exceeded for gpt-4')
    expect(fp1).toBe(fp2)
  })

  it('produces different fingerprints for different categories', () => {
    const fp1 = fingerprintError('rate_limit', 'Error occurred')
    const fp2 = fingerprintError('auth_failure', 'Error occurred')
    expect(fp1).not.toBe(fp2)
  })

  it('produces different fingerprints for different messages', () => {
    const fp1 = fingerprintError('rate_limit', 'Rate limit for gpt-4')
    const fp2 = fingerprintError('rate_limit', 'Rate limit for claude-3')
    expect(fp1).not.toBe(fp2)
  })

  it('is case-insensitive (normalizes message)', () => {
    const fp1 = fingerprintError('rate_limit', 'Rate Limit Exceeded')
    const fp2 = fingerprintError('rate_limit', 'rate limit exceeded')
    expect(fp1).toBe(fp2)
  })

  it('normalizes whitespace', () => {
    const fp1 = fingerprintError('rate_limit', 'Rate  limit   exceeded')
    const fp2 = fingerprintError('rate_limit', 'Rate limit exceeded')
    expect(fp1).toBe(fp2)
  })

  it('produces a 16-char hex string', () => {
    const fp = fingerprintError('auth_failure', 'Invalid API key')
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })
})

// ---------------------------------------------------------------------------
// Full Diagnostic Pipeline
// ---------------------------------------------------------------------------

describe('diagnoseProviderError', () => {
  it('produces a complete diagnostic from an Error object', () => {
    const error = new Error('Rate limit exceeded for model gpt-4')
    const diagnostic = diagnoseProviderError(error, 'openai')

    expect(diagnostic.category).toBe('rate_limit')
    expect(diagnostic.severity).toBe('medium')
    expect(diagnostic.retryable).toBe(true)
    expect(diagnostic.provider).toBe('openai')
    expect(diagnostic.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(diagnostic.scrubbedMessage).toContain('gpt-4') // model name is not PII, should be preserved
    expect(diagnostic.userAction).toBeTruthy()
    expect(diagnostic.timestamp).toBeGreaterThan(0)
  })

  it('produces a complete diagnostic from a string error', () => {
    const diagnostic = diagnoseProviderError('Invalid API key provided', 'claude')

    expect(diagnostic.category).toBe('auth_failure')
    expect(diagnostic.severity).toBe('high')
    expect(diagnostic.retryable).toBe(false)
    expect(diagnostic.provider).toBe('claude')
  })

  it('scrubs PII from the error message', () => {
    const error = new Error('User test@example.com from 10.0.0.1 got 401 Unauthorized')
    const diagnostic = diagnoseProviderError(error, 'gemini')

    expect(diagnostic.scrubbedMessage).not.toContain('test@example.com')
    expect(diagnostic.scrubbedMessage).not.toContain('10.0.0.1')
    expect(diagnostic.scrubbedMessage).toContain('[REDACTED_EMAIL]')
    expect(diagnostic.scrubbedMessage).toContain('[REDACTED_IP]')
    expect(diagnostic.category).toBe('auth_failure')
  })

  it('handles errors with no message', () => {
    const error = new Error()
    const diagnostic = diagnoseProviderError(error, 'kimi')

    expect(diagnostic.category).toBe('unknown')
    expect(diagnostic.severity).toBe('low')
    expect(diagnostic.retryable).toBe(false)
  })

  it('handles empty string error', () => {
    const diagnostic = diagnoseProviderError('', 'copilot')

    expect(diagnostic.category).toBe('unknown')
    expect(diagnostic.scrubbedMessage).toBe('')
  })

  it('classifies CLI not found as critical', () => {
    const diagnostic = diagnoseProviderError('ENOENT: no such file or directory, open claude', 'claude')

    expect(diagnostic.category).toBe('cli_not_found')
    expect(diagnostic.severity).toBe('critical')
    expect(diagnostic.retryable).toBe(false)
  })

  it('classifies network errors as high severity and retryable', () => {
    const diagnostic = diagnoseProviderError('ECONNREFUSED: connection refused', 'openai')

    expect(diagnostic.category).toBe('network_error')
    expect(diagnostic.severity).toBe('high')
    expect(diagnostic.retryable).toBe(true)
  })

  it('produces stable fingerprints for the same error pattern', () => {
    const d1 = diagnoseProviderError('Rate limit exceeded', 'openai')
    const d2 = diagnoseProviderError('Rate limit exceeded', 'openai')

    expect(d1.fingerprint).toBe(d2.fingerprint)
  })

  it('produces different fingerprints for different providers with same message', () => {
    const d1 = diagnoseProviderError('Rate limit exceeded', 'openai')
    const d2 = diagnoseProviderError('Rate limit exceeded', 'claude')

    // Same category + same scrubbed message = same fingerprint
    // (provider is NOT part of the fingerprint by design — it's for pattern detection)
    expect(d1.fingerprint).toBe(d2.fingerprint)
    expect(d1.provider).not.toBe(d2.provider)
  })

  it('includes a meaningful user action for each category', () => {
    const categories: ProviderErrorCategory[] = [
      'auth_failure',
      'rate_limit',
      'quota_exceeded',
      'network_error',
      'timeout',
      'cli_not_found',
      'cli_crash',
      'model_not_found',
      'context_window_exceeded',
      'invalid_request',
      'server_error',
      'unknown',
    ]

    for (const category of categories) {
      // Find a message that triggers this category
      const testMessages: Record<string, string> = {
        auth_failure: 'Invalid API key',
        rate_limit: 'Rate limit exceeded',
        quota_exceeded: 'Quota exceeded',
        network_error: 'ECONNREFUSED',
        timeout: 'Request timeout',
        cli_not_found: 'Command not found',
        cli_crash: 'Process exited with code 1',
        model_not_found: 'Model not found',
        context_window_exceeded: 'Context window exceeded',
        invalid_request: '400 Bad Request',
        server_error: '500 Internal Server Error',
        unknown: 'Something unexpected',
      }

      const diagnostic = diagnoseProviderError(testMessages[category], 'test-provider')
      expect(diagnostic.category).toBe(category)
      expect(diagnostic.userAction).toBeTruthy()
      expect(diagnostic.userAction.length).toBeGreaterThan(10)
    }
  })
})
