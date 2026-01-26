/** @file HTTP request/response utilities */
/** @import * as Types from './types.js' */

const MAX_BODY_SIZE = 1 * 1024 * 1024

/** @type {Types.parseBody} */
export function parseBody(req, maxSize = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let totalSize = 0

    req.on("data", (chunk) => {
      totalSize += chunk.length
      if (totalSize > maxSize) {
        req.destroy()
        reject(new Error("Payload too large"))
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString()
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        reject(new Error("Invalid JSON"))
      }
    })
    req.on("error", reject)
  })
}

/** @type {Types.sendJson} */
export function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data)
  /** @type {Types.ResponseHeaders} */
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  }

  // HSTS in production
  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
  }

  res.writeHead(statusCode, headers)
  res.end(body)
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
  return str.trim().slice(0, maxLen) || null
}

/** @type {Types.isValidEmail} */
export function isValidEmail(email) {
  if (!email) return true // Empty is valid (email is optional)
  if (email.length > 254) return false

  for (let i = 0; i < email.length; i++) {
    const c = email[i]
    if (c === " " || c === "\t" || c === "\n" || c === "\r") return false
  }

  const atIndex = email.indexOf("@")
  if (atIndex === -1) return false
  if (email.indexOf("@", atIndex + 1) !== -1) return false // Multiple @

  const localPart = email.slice(0, atIndex)
  const domainPart = email.slice(atIndex + 1)

  if (!localPart || !domainPart) return false
  if (domainPart.startsWith(".") || domainPart.endsWith(".")) return false

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
      { "Retry-After": String(retryAfter) }
    )
    return true
  }
  return false
}

/** @type {Types.sendCsv} */
export function sendCsv(res, filename, content) {
  /** @type {Types.ResponseHeaders} */
  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": Buffer.byteLength(content),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, must-revalidate",
  }

  if (process.env.NODE_ENV === "production") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
  }

  res.writeHead(200, headers)
  res.end(content)
}
