/** @file Centralized validation utilities */
/** @import * as Types from './types.js' */

import {
  LIMITS,
  GUEST_STATUS_VALUES,
  COMMUNICATION_TYPE_VALUES,
  COMMUNICATION_TYPE,
} from "../types.js"
import { isValidEmail, sanitize } from "./http.js"
import { normalizePhone } from "../db/utils.js"
import { isGuestStatus, isCommunicationType } from "../types.js"
import * as twilioService from "../services/twilio.js"
import * as emailService from "../services/email.js"

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

export class PayloadTooLargeError extends AppError {
  /** @param {Types.PayloadTooLargeErrorParams} _ */
  constructor(...[message = "Payload too large"]) {
    super(message, 413, "PAYLOAD_TOO_LARGE")
  }
}

export class RateLimitError extends AppError {
  /** @param {Types.RateLimitErrorParams} _ */
  constructor(...[message = "Too many requests. Please try again later."]) {
    super(message, 429, "RATE_LIMIT_EXCEEDED")
  }
}

/** @type {Types.validatePartySize} */
export function validatePartySize(value) {
  const size = parseInt(String(value), 10)
  if (
    isNaN(size) ||
    size < LIMITS.PARTY_SIZE_MIN ||
    size > LIMITS.PARTY_SIZE_MAX
  ) {
    return {
      valid: false,
      error: `Party size must be between ${LIMITS.PARTY_SIZE_MIN} and ${LIMITS.PARTY_SIZE_MAX}`,
    }
  }
  return { valid: true, value: size }
}

/** @type {Types.validateEmail} */
export function validateEmail(value, { required = false } = {}) {
  const email =
    typeof value === "string" ? sanitize(value, LIMITS.EMAIL_MAX_LENGTH) : null
  if (!email) {
    return required
      ? { valid: false, error: "Email is required" }
      : { valid: true, value: null }
  }
  if (!isValidEmail(email)) {
    return { valid: false, error: "Invalid email format" }
  }
  return { valid: true, value: email }
}

/** @type {Types.validatePhone} */
export function validatePhone(value, { required = false } = {}) {
  if (!value || (typeof value === "string" && !value.trim())) {
    return required
      ? { valid: false, error: "Phone is required" }
      : { valid: true, value: null }
  }
  const normalized = typeof value === "string" ? normalizePhone(value) : null
  if (!normalized) {
    return { valid: false, error: "Invalid phone number format" }
  }
  return { valid: true, value: normalized }
}

/** @type {Types.validateGuestStatus} */
export function validateGuestStatus(value) {
  if (!isGuestStatus(value)) {
    return {
      valid: false,
      error: `Invalid status. Must be: ${GUEST_STATUS_VALUES.join(", ")}`,
    }
  }
  return { valid: true, value }
}

/** @type {Types.validateCommunicationType} */
export function validateCommunicationType(value) {
  if (!isCommunicationType(value)) {
    return {
      valid: false,
      error: `type must be "${COMMUNICATION_TYPE_VALUES.join('" or "')}"`,
    }
  }
  return { valid: true, value }
}

/** @type {Types.validateRequiredString} */
export function validateRequiredString(value, fieldName, maxLength) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return { valid: false, error: `${fieldName} is required` }
  }
  const sanitized = sanitize(value, maxLength)
  if (!sanitized) {
    return { valid: false, error: `${fieldName} is required` }
  }
  return { valid: true, value: sanitized }
}

/** @type {Types.validateOptionalString} */
export function validateOptionalString(value, maxLength) {
  const sanitized =
    typeof value === "string" ? sanitize(value, maxLength) : null
  return { valid: true, value: sanitized }
}

/** @type {Types.validateId} */
export function validateId(value, fieldName = "ID") {
  const id = parseInt(String(value), 10)
  if (isNaN(id) || id < 1) {
    return { valid: false, error: `Invalid ${fieldName}` }
  }
  return { valid: true, value: id }
}

/** @type {Types.validateIdArray} */
export function validateIdArray(value, fieldName = "IDs", maxLength = 50) {
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false, error: `${fieldName} array required` }
  }
  if (value.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} array exceeds maximum of ${maxLength} items`,
    }
  }
  const ids = []
  for (const item of value) {
    const result = validateId(item)
    if (!result.valid) {
      return { valid: false, error: `Invalid ID in ${fieldName} array` }
    }
    ids.push(result.value)
  }
  return { valid: true, value: ids }
}

/** @type {Types.validateInviteCode} */
export function validateInviteCode(value) {
  if (!value || typeof value !== "string") {
    return { valid: false, error: "Invalid invite code" }
  }
  const trimmed = value.trim()
  if (trimmed.length !== 8) {
    return { valid: false, error: "Invalid invite code" }
  }
  // Check alphanumeric without regex
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i)
    const isDigit = c >= 48 && c <= 57 // 0-9
    const isUpper = c >= 65 && c <= 90 // A-Z
    const isLower = c >= 97 && c <= 122 // a-z
    if (!isDigit && !isUpper && !isLower) {
      return { valid: false, error: "Invalid invite code" }
    }
  }
  return { valid: true, value: trimmed }
}

/** @type {Types.validateServiceConfigured} */
export function validateServiceConfigured(type) {
  if (type === COMMUNICATION_TYPE.SMS) {
    if (!twilioService.isConfigured()) {
      return {
        valid: false,
        error:
          "Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
      }
    }
  }
  if (type === COMMUNICATION_TYPE.EMAIL) {
    if (!emailService.isConfigured()) {
      return {
        valid: false,
        error:
          "Resend email is not configured. Set RESEND_API_KEY and FROM_EMAIL.",
      }
    }
  }
  return { valid: true }
}
