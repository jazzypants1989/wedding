/**
 * @file Unit tests for declarative router
 */
/** @import { RouteHandler } from '../../../core/types.js' */

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert"
import { route, dispatch, clearRoutes } from "../../../core/router.js"
import { mockRequest, mockResponse } from "../../unit-helpers.js"

// Save and restore routes around each test
beforeEach(() => {
  clearRoutes()
})

describe("route and dispatch", () => {
  it("matches a simple GET route", async () => {
    let called = false
    route("GET", "/api/health", /** @type {RouteHandler} */ ((req, res) => {
      called = true
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok" }))
    }))

    const req = mockRequest({ method: "GET", url: "/api/health" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, true)
    assert.strictEqual(called, true)
    assert.strictEqual(res.statusCode, 200)
  })

  it("matches a POST route", async () => {
    let called = false
    route("POST", "/api/submit", /** @type {RouteHandler} */ ((req, res) => {
      called = true
      res.writeHead(201)
      res.end()
    }))

    const req = mockRequest({ method: "POST", url: "/api/submit" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, true)
    assert.strictEqual(called, true)
  })

  it("extracts route parameters", async () => {
    /** @type {Record<string, string>} */
    let capturedParams = {}
    route("GET", "/api/rsvp/:code", /** @type {RouteHandler} */ ((req, res, ctx) => {
      capturedParams = ctx.params
      res.writeHead(200)
      res.end()
    }))

    const req = mockRequest({ method: "GET", url: "/api/rsvp/ABC12345" })
    const res = mockResponse()
    await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(capturedParams.code, "ABC12345")
  })

  it("extracts multiple route parameters", async () => {
    /** @type {Record<string, string>} */
    let capturedParams = {}
    route("PUT", "/api/users/:userId/posts/:postId", /** @type {RouteHandler} */ ((req, res, ctx) => {
      capturedParams = ctx.params
      res.writeHead(200)
      res.end()
    }))

    const req = mockRequest({
      method: "PUT",
      url: "/api/users/42/posts/99",
    })
    const res = mockResponse()
    await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(capturedParams.userId, "42")
    assert.strictEqual(capturedParams.postId, "99")
  })

  it("returns false when no route matches", async () => {
    route("GET", "/api/health", /** @type {RouteHandler} */ ((req, res) => {
      res.writeHead(200)
      res.end()
    }))

    const req = mockRequest({ method: "GET", url: "/api/nonexistent" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, false)
  })

  it("returns 405 when path matches but method does not", async () => {
    route("GET", "/api/data", /** @type {RouteHandler} */ ((req, res) => {
      res.writeHead(200)
      res.end()
    }))
    route("POST", "/api/data", /** @type {RouteHandler} */ ((req, res) => {
      res.writeHead(201)
      res.end()
    }))

    const req = mockRequest({ method: "DELETE", url: "/api/data" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, true)
    assert.strictEqual(res.statusCode, 405)
    const body = /** @type {{ error: string }} */ (res.getBody())
    assert.strictEqual(body.error, "Method not allowed")
    // Check Allow header contains both methods
    const allow = String(res.headers["Allow"])
    assert.ok(allow.includes("GET"))
    assert.ok(allow.includes("POST"))
  })

  it("strips query string before matching", async () => {
    let called = false
    route("GET", "/api/search", /** @type {RouteHandler} */ ((req, res) => {
      called = true
      res.writeHead(200)
      res.end()
    }))

    const req = mockRequest({ method: "GET", url: "/api/search?q=test&page=1" })
    const res = mockResponse()
    await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(called, true)
  })

  it("does not match routes with extra segments", async () => {
    route("GET", "/api/health", /** @type {RouteHandler} */ ((req, res) => {
      res.writeHead(200)
      res.end()
    }))

    const req = mockRequest({ method: "GET", url: "/api/health/extra" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, false)
  })

  it("does not match routes with fewer segments", async () => {
    route("GET", "/api/admin/guests", /** @type {RouteHandler} */ ((req, res) => {
      res.writeHead(200)
      res.end()
    }))

    const req = mockRequest({ method: "GET", url: "/api/admin" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, false)
  })

  it("handles root path", async () => {
    const req = mockRequest({ method: "GET", url: "/" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, false) // No routes registered for /
  })
})

describe("clearRoutes", () => {
  it("removes all registered routes", async () => {
    route("GET", "/api/test", /** @type {RouteHandler} */ ((req, res) => {
      res.writeHead(200)
      res.end()
    }))

    clearRoutes()

    const req = mockRequest({ method: "GET", url: "/api/test" })
    const res = mockResponse()
    const matched = await dispatch(/** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ (req)), /** @type {import('node:http').ServerResponse} */ (/** @type {unknown} */ (res)))

    assert.strictEqual(matched, false)
  })
})
