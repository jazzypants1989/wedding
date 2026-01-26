/** @file API helper for making authenticated requests */
/** @import * as Types from './types.js' */

import { state } from "./state.js"

const DEFAULT_TIMEOUT = 30000

/** @type {Types.api} */
export async function api(endpoint, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  }

  if (state.csrfToken && options.method && options.method !== "GET") {
    headers["X-CSRF-Token"] = state.csrfToken
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout || DEFAULT_TIMEOUT,
  )

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers,
      signal: controller.signal,
    })

    let data
    try {
      data = await res.json()
    } catch (parseError) {
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`)
      }
      data = {}
    }

    if (!res.ok) {
      if (res.status === 401) {
        state.onAuthRequired()
      }
      throw new Error(data.error || `Request failed with status ${res.status}`)
    }

    return data
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.")
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
