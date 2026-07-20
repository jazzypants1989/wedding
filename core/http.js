/** @file HTTP request/response utilities */
/** @import * as Types from './types.js' */

import { gzipSync } from "node:zlib"
import { REQUEST_LIMITS } from "../types.js"
import { ValidationError, PayloadTooLargeError } from "./validation.js"

const GZIP_THRESHOLD = 1024

/** @type {Types.addSecurityHeaders} */
export function addSecurityHeaders(headers) {
  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
  }
  // Keep secret-bearing URLs (e.g. thank-you card tokens travel in the path)
  // out of cross-origin Referer headers, while still sending the bare origin
  // to same-origin/other requests so normal navigation analytics keep working.
  headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
  return headers
}

/** @type {Types.parseBody} */
export function parseBody(req, maxSize = REQUEST_LIMITS.MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let totalSize = 0
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        req.destroy()
        reject(new ValidationError("Request body timeout"))
      }
    }, REQUEST_LIMITS.REQUEST_TIMEOUT_MS)

    req.on("data", (chunk) => {
      totalSize += chunk.length
      if (totalSize > maxSize) {
        settled = true
        clearTimeout(timer)
        req.destroy()
        reject(new PayloadTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const body = Buffer.concat(chunks).toString()
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        reject(new ValidationError("Invalid JSON body"))
      }
    })
    req.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** @type {Types.sendJson} */
export function sendJson(res, statusCode, data, extraHeaders = {}) {
  if (res.headersSent) {
    console.error("sendJson: response already sent, skipping duplicate send")
    return
  }
  const body = JSON.stringify(data)
  const bodyLen = Buffer.byteLength(body)
  /** @type {Types.ResponseHeaders} */
  const headers = {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  }

  addSecurityHeaders(headers)

  const acceptEncoding = res.req?.headers?.["accept-encoding"] || ""
  if (
    bodyLen > GZIP_THRESHOLD &&
    typeof acceptEncoding === "string" &&
    acceptEncoding.includes("gzip")
  ) {
    const compressed = gzipSync(Buffer.from(body))
    headers["Content-Encoding"] = "gzip"
    headers["Content-Length"] = compressed.length
    headers["Vary"] = "Accept-Encoding"
    res.writeHead(statusCode, headers)
    res.end(compressed)
  } else {
    headers["Content-Length"] = bodyLen
    res.writeHead(statusCode, headers)
    res.end(body)
  }
}

/** @type {Types.sendError} */
export function sendError(res, statusCode, message, code = null) {
  /** @type {Types.ErrorBody} */
  const body = { error: message }
  if (code) {
    body.code = code
  }
  sendJson(res, statusCode, body)
}

/** @type {Types.sanitize} */
export function sanitize(str, maxLen = 500) {
  if (typeof str !== "string") return null
  const trimmed = str.trim().slice(0, maxLen)
  if (!trimmed) return null
  let result = ""
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i)
    if (code >= 0x20 || code === 0x0a || code === 0x0d || code === 0x09) {
      result += trimmed[i]
    }
  }
  return result || null
}

/** @type {Types.isValidEmail} */
export function isValidEmail(email) {
  if (!email) return true // Empty is valid (email is optional)
  if (email.length > 254) return false

  const atIndex = email.indexOf("@")
  if (atIndex === -1) return false
  if (email.indexOf("@", atIndex + 1) !== -1) return false // Multiple @

  const localPart = email.slice(0, atIndex)
  const domainPart = email.slice(atIndex + 1)

  if (!localPart || localPart.length > 64) return false
  if (!domainPart || domainPart.length > 253) return false

  // Reject invalid characters in local part
  for (let i = 0; i < localPart.length; i++) {
    const c = localPart[i]
    if (c === " " || c === "\t" || c === "\n" || c === "\r") return false
    if (c === "<" || c === ">" || c === ":" || c === ";") return false
    if (c === "[" || c === "]" || c === "\\" || c === ",") return false
    if (c === '"' || c === "(" || c === ")") return false
  }

  // Reject leading/trailing dots and consecutive dots in local part
  if (localPart.startsWith(".") || localPart.endsWith(".")) return false
  if (localPart.includes("..")) return false

  // Domain: reject leading/trailing dots and consecutive dots
  if (domainPart.startsWith(".") || domainPart.endsWith(".")) return false
  if (domainPart.includes("..")) return false

  // Validate each domain label
  let labelStart = 0
  while (labelStart < domainPart.length) {
    let labelEnd = domainPart.indexOf(".", labelStart)
    if (labelEnd === -1) labelEnd = domainPart.length
    const label = domainPart.slice(labelStart, labelEnd)
    if (!label || label.length > 63) return false
    if (label.startsWith("-") || label.endsWith("-")) return false

    // Domain labels: only alphanumeric and hyphens
    for (let i = 0; i < label.length; i++) {
      const c = label.charCodeAt(i)
      const isAlpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
      const isDigit = c >= 48 && c <= 57
      const isHyphen = c === 45
      if (!isAlpha && !isDigit && !isHyphen) return false
    }

    labelStart = labelEnd + 1
  }

  // Must have at least one dot in domain (TLD check)
  const lastDotIndex = domainPart.lastIndexOf(".")
  if (lastDotIndex === -1) return false
  const tld = domainPart.slice(lastDotIndex + 1)
  if (tld.length < 2) return false

  return true
}

/** @type {Types.checkRateLimit} */
export function checkRateLimit(res, limiter, key) {
  const result = limiter.check(key)
  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000)
    sendJson(
      res,
      429,
      {
        error: "Too many requests. Please try again later.",
        retryAfter,
      },
      { "Retry-After": String(retryAfter) },
    )
    return true
  }
  return false
}

/** @type {Types.sendCsv} */
export function sendCsv(res, filename, content) {
  if (res.headersSent) {
    console.error("sendCsv: response already sent, skipping duplicate send")
    return
  }
  /** @type {Types.ResponseHeaders} */
  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": Buffer.byteLength(content),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, must-revalidate",
  }

  addSecurityHeaders(headers)

  res.writeHead(200, headers)
  res.end(content)
}
