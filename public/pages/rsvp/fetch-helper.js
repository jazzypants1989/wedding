/** @file Fetch helper for public forms with timeout support */
/** @import * as Types from './types.js' */

const DEFAULT_TIMEOUT = 30000

/** @type {Types.fetchWithTimeout} */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Request timed out. Please check your connection and try again.",
      )
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/** @type {Types.apiRequest} */
export async function apiRequest(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  })

  let data
  try {
    data = await response.json()
  } catch {
    data = {}
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}

/** @type {Types.getErrorMessage} */
export function getErrorMessage(error) {
  if (error instanceof Error) {
    if (error.message.indexOf("timed out") !== -1) {
      return error.message
    }
    return "Unable to connect. Please check your internet connection."
  }

  const apiError = /** @type {Types.ApiErrorResponse} */ (error)
  if (apiError && apiError.error) {
    return apiError.error
  }

  return "Something went wrong. Please try again."
}
