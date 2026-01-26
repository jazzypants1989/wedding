/** @file Custom error classes */
/** @import * as Types from './types.js' */

export class AppError extends Error {
  /** @param {Types.AppErrorParams} _ */
  constructor(...[message, statusCode = 500, code = "INTERNAL_ERROR"]) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.isOperational = true
  }
}

export class ValidationError extends AppError {
  /** @param {Types.ValidationErrorParams} _ */
  constructor(...[message]) {
    super(message, 400, "VALIDATION_ERROR")
  }
}

export class NotFoundError extends AppError {
  /** @param {Types.NotFoundErrorParams} _ */
  constructor(...[resource = "Resource"]) {
    super(`${resource} not found`, 404, "NOT_FOUND")
  }
}

export class ConflictError extends AppError {
  /** @param {Types.ConflictErrorParams} _ */
  constructor(...[message]) {
    super(message, 409, "CONFLICT")
  }
}

export class AuthenticationError extends AppError {
  /** @param {Types.AuthenticationErrorParams} _ */
  constructor(...[message = "Authentication required"]) {
    super(message, 401, "AUTHENTICATION_ERROR")
  }
}

export class AuthorizationError extends AppError {
  /** @param {Types.AuthorizationErrorParams} _ */
  constructor(...[message = "Access denied"]) {
    super(message, 403, "AUTHORIZATION_ERROR")
  }
}
