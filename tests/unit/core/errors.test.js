/**
 * Unit tests for custom error classes
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  AuthenticationError,
  AuthorizationError,
} from "../../../core/errors.js"

describe("AppError", () => {
  it("creates error with message, statusCode, and code", () => {
    const err = new AppError("something broke", 503, "SERVICE_UNAVAILABLE")
    assert.strictEqual(err.message, "something broke")
    assert.strictEqual(err.statusCode, 503)
    assert.strictEqual(err.code, "SERVICE_UNAVAILABLE")
  })

  it("sets isOperational to true", () => {
    const err = new AppError("test")
    assert.strictEqual(err.isOperational, true)
  })

  it("extends Error", () => {
    const err = new AppError("test")
    assert.ok(err instanceof Error)
    assert.ok(err instanceof AppError)
  })

  it("defaults statusCode to 500", () => {
    const err = new AppError("test")
    assert.strictEqual(err.statusCode, 500)
  })

  it("defaults code to INTERNAL_ERROR", () => {
    const err = new AppError("test")
    assert.strictEqual(err.code, "INTERNAL_ERROR")
  })

  it("has a stack trace", () => {
    const err = new AppError("test")
    assert.ok(err.stack)
    assert.ok(err.stack.includes("test"))
  })
})

describe("ValidationError", () => {
  it("creates with statusCode 400", () => {
    const err = new ValidationError("invalid input")
    assert.strictEqual(err.statusCode, 400)
  })

  it("creates with code VALIDATION_ERROR", () => {
    const err = new ValidationError("invalid input")
    assert.strictEqual(err.code, "VALIDATION_ERROR")
  })

  it("extends AppError and Error", () => {
    const err = new ValidationError("test")
    assert.ok(err instanceof AppError)
    assert.ok(err instanceof Error)
  })

  it("sets message correctly", () => {
    const err = new ValidationError("Name is required")
    assert.strictEqual(err.message, "Name is required")
  })

  it("sets isOperational to true", () => {
    const err = new ValidationError("test")
    assert.strictEqual(err.isOperational, true)
  })
})

describe("NotFoundError", () => {
  it("creates with statusCode 404", () => {
    const err = new NotFoundError("Guest")
    assert.strictEqual(err.statusCode, 404)
  })

  it("creates with code NOT_FOUND", () => {
    const err = new NotFoundError("Guest")
    assert.strictEqual(err.code, "NOT_FOUND")
  })

  it("creates message with resource name", () => {
    const err = new NotFoundError("Guest")
    assert.strictEqual(err.message, "Guest not found")
  })

  it("defaults resource to Resource", () => {
    const err = new NotFoundError()
    assert.strictEqual(err.message, "Resource not found")
  })

  it("extends AppError and Error", () => {
    const err = new NotFoundError()
    assert.ok(err instanceof AppError)
    assert.ok(err instanceof Error)
  })
})

describe("ConflictError", () => {
  it("creates with statusCode 409", () => {
    const err = new ConflictError("already exists")
    assert.strictEqual(err.statusCode, 409)
  })

  it("creates with code CONFLICT", () => {
    const err = new ConflictError("already exists")
    assert.strictEqual(err.code, "CONFLICT")
  })

  it("extends AppError and Error", () => {
    const err = new ConflictError("test")
    assert.ok(err instanceof AppError)
    assert.ok(err instanceof Error)
  })

  it("sets message correctly", () => {
    const err = new ConflictError("Duplicate entry")
    assert.strictEqual(err.message, "Duplicate entry")
  })
})

describe("AuthenticationError", () => {
  it("creates with statusCode 401", () => {
    const err = new AuthenticationError()
    assert.strictEqual(err.statusCode, 401)
  })

  it("creates with code AUTHENTICATION_ERROR", () => {
    const err = new AuthenticationError()
    assert.strictEqual(err.code, "AUTHENTICATION_ERROR")
  })

  it("defaults message to Authentication required", () => {
    const err = new AuthenticationError()
    assert.strictEqual(err.message, "Authentication required")
  })

  it("accepts custom message", () => {
    const err = new AuthenticationError("Session expired")
    assert.strictEqual(err.message, "Session expired")
  })

  it("extends AppError and Error", () => {
    const err = new AuthenticationError()
    assert.ok(err instanceof AppError)
    assert.ok(err instanceof Error)
  })
})

describe("AuthorizationError", () => {
  it("creates with statusCode 403", () => {
    const err = new AuthorizationError()
    assert.strictEqual(err.statusCode, 403)
  })

  it("creates with code AUTHORIZATION_ERROR", () => {
    const err = new AuthorizationError()
    assert.strictEqual(err.code, "AUTHORIZATION_ERROR")
  })

  it("defaults message to Access denied", () => {
    const err = new AuthorizationError()
    assert.strictEqual(err.message, "Access denied")
  })

  it("accepts custom message", () => {
    const err = new AuthorizationError("Insufficient permissions")
    assert.strictEqual(err.message, "Insufficient permissions")
  })

  it("extends AppError and Error", () => {
    const err = new AuthorizationError()
    assert.ok(err instanceof AppError)
    assert.ok(err instanceof Error)
  })
})
