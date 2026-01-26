/**
 * @file Unit test utilities
 */
/** @import { CreateMockFn, MockFn, MockRequestFn, MockResponseFn, AssertValidationFn } from './unit-helpers.js' */

/** @type {CreateMockFn} */
export function createMock(returnValue) {
  /** @type {unknown[][]} */
  const calls = []

  /** @type {MockFn} */
  const fn = Object.assign(
    function mock(/** @type {unknown[]} */ ...args) {
      calls.push(args)
      return typeof returnValue === 'function' ? returnValue(...args) : returnValue
    },
    {
      calls,
      reset: () => calls.length = 0
    }
  )
  return fn
}

/** @type {MockRequestFn} */
export function mockRequest({
  method = 'GET',
  url = '/',
  headers = {},
  body = null,
  socket = { remoteAddress: '127.0.0.1' }
} = {}) {
  return {
    method, url, headers, body, socket,
    on: (event, handler) => {
      if (event === 'data' && body) handler(Buffer.from(JSON.stringify(body)))
      if (event === 'end') handler()
    }
  }
}

/** @type {MockResponseFn} */
export function mockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    ended: false,
    writeHead(status, headers = {}) {
      this.statusCode = status
      Object.assign(this.headers, headers)
      return this
    },
    setHeader(name, value) {
      this.headers[name] = value
      return this
    },
    end(body) {
      this.body = body
      this.ended = true
      return this
    },
    getBody() {
      const contentType = this.headers['Content-Type']
      if (this.body && typeof contentType === 'string' && contentType.includes('application/json')) {
        return JSON.parse(this.body)
      }
      return this.body
    }
  }
}

/** @type {AssertValidationFn} */
export function assertValidation(result, expectedValid, expectedValue, expectedErrorSubstring) {
  if (expectedValid) {
    if (!result.valid) {
      throw new Error(`Expected valid result but got error: ${result.error}`)
    }
    if (expectedValue !== undefined && result.value !== expectedValue) {
      throw new Error(`Expected value "${expectedValue}" but got "${result.value}"`)
    }
  } else {
    if (result.valid) {
      throw new Error(`Expected invalid result but got valid with value: ${result.value}`)
    }
    if (expectedErrorSubstring && !result.error?.includes(expectedErrorSubstring)) {
      throw new Error(`Expected error containing "${expectedErrorSubstring}" but got: ${result.error}`)
    }
  }
}
