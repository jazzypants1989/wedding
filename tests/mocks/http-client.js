/**
 * @file Shared mock HTTP client for service tests
 */
/** @import { CreateMockHttpClientFn, MockHttpCall, MockResponse, MockRequest, MockRequestFn } from './types.js' */

import { EventEmitter } from "node:events"

/** @type {CreateMockHttpClientFn} */
export function createMockHttpClient(responseConfig = {}) {
  /** @type {MockHttpCall[]} */
  const calls = []

  /** @type {MockRequestFn} */
  function request(options, callback) {
    calls.push({ options })

    /** @type {MockResponse} */
    const mockRes = Object.assign(new EventEmitter(), {
      statusCode: responseConfig.statusCode || 200,
      destroy: () => {},
    })

    /** @type {MockRequest} */
    const mockReq = Object.assign(new EventEmitter(), {
      write: (/** @type {string} */ data) => {
        calls[calls.length - 1].data = data
      },
      end: () => {
        setImmediate(() => {
          callback(mockRes)

          if (responseConfig.error) {
            mockReq.emit("error", new Error(responseConfig.error))
          } else if (responseConfig.timeout) {
            mockReq.emit("timeout")
          } else if (responseConfig.largeResponse) {
            // Send chunks that exceed 64KB
            const chunk = "x".repeat(32 * 1024)
            mockRes.emit("data", chunk)
            mockRes.emit("data", chunk)
            mockRes.emit("data", chunk) // 96KB total, exceeds 64KB limit
          } else {
            const responseBody =
              responseConfig.body || JSON.stringify({ id: "test-id" })
            mockRes.emit("data", responseBody)
            mockRes.emit("end")
          }
        })
      },
      destroy: () => {},
    })

    return mockReq
  }

  return { request, calls }
}
