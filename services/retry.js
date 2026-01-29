/** @file Retry utilities for external service calls */
/** @import * as Types from './types.js' */

/** @type {Types.isRetryableError} */
export function isRetryableError(errorMessage) {
  const message = (errorMessage || "").toLowerCase()

  // Retry network and timeout errors
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("epipe") ||
    message.includes("ehostunreach")
  ) {
    return true
  }

  // Retry server errors and rate limits
  if (
    message.includes("http 429") ||
    message.includes("http 500") ||
    message.includes("http 502") ||
    message.includes("http 503") ||
    message.includes("http 504")
  ) {
    return true
  }

  // Default: do NOT retry unknown errors
  return false
}

/** @type {Types.sleep} */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @type {Types.withRetry} */
export async function withRetry(
  fn,
  { maxRetries = 3, baseDelayMs = 1000 } = {},
) {
  let lastResult

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    lastResult = await fn()

    // Success - return immediately
    if (lastResult.success) {
      return lastResult
    }

    // Don't retry if error is not retryable
    if (!isRetryableError(lastResult.error)) {
      return lastResult
    }

    // Don't delay after the last attempt
    if (attempt < maxRetries - 1) {
      const maxDelay = baseDelayMs * Math.pow(2, attempt) // Exponential: 1s, 2s, 4s
      const delay = Math.floor(Math.random() * maxDelay) // Full jitter
      await sleep(delay)
    }
  }

  // All retries exhausted
  return (
    lastResult || { success: false, error: "Operation failed after retries" }
  )
}
