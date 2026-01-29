/** @file Shared HTTP request helper for external service calls */
/** @import * as Types from './types.js' */

const MAX_RESPONSE_SIZE = 64 * 1024 // 64KB

/** @type {Types.makeServiceRequest} */
export function makeServiceRequest(httpClient, options, postData) {
  return new Promise((resolve) => {
    const req = httpClient.request(options, (res) => {
      let data = ""
      let exceeded = false
      res.on("data", (/** @type {string} */ chunk) => {
        if (exceeded) return
        data += chunk
        if (data.length > MAX_RESPONSE_SIZE) {
          exceeded = true
          res.destroy()
          resolve({ success: false, error: "Response too large" })
        }
      })
      res.on("end", () => {
        if (exceeded) return
        try {
          const json = JSON.parse(data)
          const statusCode = res.statusCode ?? 0
          if (statusCode >= 200 && statusCode < 300) {
            resolve({ success: true, data: json })
          } else {
            resolve({
              success: false,
              error:
                json.message ||
                json.error?.message ||
                json.error_message ||
                `HTTP ${statusCode}`,
            })
          }
        } catch (e) {
          resolve({
            success: false,
            error: `Parse error: ${
              e instanceof Error ? e.message : String(e)
            }`,
          })
        }
      })
    })

    req.on("timeout", () => {
      req.destroy()
      resolve({ success: false, error: "Request timed out" })
    })

    req.on("error", (/** @type {Error} */ e) => {
      resolve({ success: false, error: e.message })
    })

    req.write(postData)
    req.end()
  })
}
