/** @file Retry utilities for external service calls */
/** @import * as Types from './types.js' */

/** @type {Types.isRetryableError} */
export function isRetryableError(errorMessage) {
  const message = (errorMessage || "").toLowerCase()

  // Retry network and timeout errors
  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("socket hang up")
  ) {
    return true
  }

  // Don't retry auth failures
  if (
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("invalid api key")
  ) {
    return false
  }

  // Don't retry validation errors
  if (message.includes("invalid") || message.includes("missing required")) {
    return false
  }

  // Default to retry for unknown errors
  return true
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
      const delay = baseDelayMs * Math.pow(2, attempt) // Exponential: 1s, 2s, 4s
      await sleep(delay)
    }
  }

  // All retries exhausted
  return (
    lastResult || { success: false, error: "Operation failed after retries" }
  )
}
