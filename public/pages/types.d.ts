// Options for the api() helper function
export interface ApiOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
  signal?: AbortSignal
  csrf?: boolean
  /** Cookie name to read the CSRF token from (default "csrf"; guest pages use "guest_csrf"). */
  csrfCookie?: string
  onUnauthorized?: () => void
}

export function api<T = unknown>(endpoint: string, options?: ApiOptions): Promise<T>

// Pagination info included in list responses
export interface PaginationInfo {
  total: number
  limit: number
  offset: number
}

// Public API responses
export interface LookupResponse {
  found: boolean
  redirectCode?: string
  message?: string
  canPetition?: boolean
}

export interface RSVPSubmitResponse {
  success: boolean
  message: string
}

/** @file countdown.js - Types for countdown timer module */

/**
 * Initialize the countdown timer for the wedding date.
 * Displays days remaining and exact time (d h m s) format.
 * Returns a cleanup function to stop the interval when unmounting.
 * @example
 * // Start countdown on page load
 * const cleanup = initCountdown();
 *
 * // Stop countdown when leaving page
 * cleanup();
 */
export function initCountdown(): () => void

/**
 * Format milliseconds into a human-readable string with days, hours, minutes, seconds.
 * @param ms - Time in milliseconds
 * @returns Formatted string like "1d 01h 01m 01s"
 * @example
 * formatExactTime(90061000) // "1d 01h 01m 01s"
 */
export function formatExactTime(ms: number): string

/**
 * Pad a number with leading zeros to ensure it is always 2 digits.
 * @param num - Number to pad
 * @returns Padded string like "05" or "12"
 * @example
 * pad(5) // "05"
 * pad(12) // "12"
 */
export function pad(num: number): string

/** @file registry.js */
export function initRegistryFrame(): void

/** @file utils.js - Types for type-safe DOM element utilities and general helpers */

/**
 * Assert that an element exists and return it with proper type.
 * Throws if element is null or undefined.
 * @example
 * const el = assertElement(document.querySelector('.foo'), '.foo');
 */
export function assertElement<T extends Element>(
  element: T | null,
  name: string
): T

/**
 * Get element by ID with null assertion.
 * Throws if element not found.
 * @example
 * const el = getElement('my-id'); // HTMLElement
 */
export function getElement(id: string): HTMLElement

/**
 * Get input element by ID with proper type.
 * Throws if element not found or not an input.
 * @example
 * const input = getInputElement('email'); // HTMLInputElement
 * input.value = 'test@example.com';
 */
export function getInputElement(id: string): HTMLInputElement

/**
 * Get textarea element by ID with proper type.
 * Throws if element not found or not a textarea.
 * @example
 * const textarea = getTextAreaElement('message'); // HTMLTextAreaElement
 * textarea.value = 'Hello';
 */
export function getTextAreaElement(id: string): HTMLTextAreaElement

/**
 * Get button element by ID with proper type.
 * Throws if element not found or not a button.
 * @example
 * const btn = getButtonElement('submit'); // HTMLButtonElement
 * btn.disabled = true;
 */
export function getButtonElement(id: string): HTMLButtonElement

/**
 * Get form element by ID with proper type.
 * Throws if element not found or not a form.
 * @example
 * const form = getFormElement('login-form'); // HTMLFormElement
 * form.reset();
 */
export function getFormElement(id: string): HTMLFormElement

/**
 * Get select element by ID with proper type.
 * Throws if element not found or not a select.
 * @example
 * const select = getSelectElement('status'); // HTMLSelectElement
 * select.value = 'active';
 */
export function getSelectElement(id: string): HTMLSelectElement

/**
 * Get table element by ID with proper type.
 * Throws if element not found or not a table.
 * @example
 * const table = getTableElement('guests'); // HTMLTableElement
 */
export function getTableElement(id: string): HTMLTableElement

/**
 * Get iframe element by ID with proper type.
 * Throws if element not found or not an iframe.
 * @example
 * const iframe = getIFrameElement('my-frame'); // HTMLIFrameElement
 * iframe.src = 'https://example.com';
 */
export function getIFrameElement(id: string): HTMLIFrameElement

/**
 * Get dialog element by ID with proper type.
 * Throws if element not found or not a dialog.
 * @example
 * const dialog = getDialogElement('my-modal'); // HTMLDialogElement
 * dialog.showModal();
 */
export function getDialogElement(id: string): HTMLDialogElement

/**
 * Extract error message safely from unknown catch value.
 * Handles Error objects, strings, and unknown types.
 * @example
 * try { ... } catch (err) {
 *   const msg = getErrorMessage(err); // string
 * }
 */
export function getErrorMessage(err: unknown): string

/**
 * Escape HTML special characters to prevent XSS attacks.
 * Converts &, <, >, ", ' to their HTML entity equivalents.
 * @example
 * escapeHtml("<script>alert('xss')</script>")
 * // returns "&lt;script&gt;alert('xss')&lt;/script&gt;"
 * escapeHtml("Hello & goodbye")
 * // returns "Hello &amp; goodbye"
 */
export function escapeHtml(str: string): string

/**
 * Wrapper for pre-escaped HTML content.
 * Created by the html`` tagged template or raw() function.
 */
export class SafeHTML {
  value: string
  constructor(value: string)
  toString(): string
}

/**
 * Auto-escaping HTML tagged template.
 * All interpolated values are escaped unless wrapped in SafeHTML (via raw()).
 * Arrays of SafeHTML are joined automatically.
 * Returns SafeHTML at runtime (coerces to string via toString()),
 * but typed as string so innerHTML assignments type-check directly.
 * @example
 * const row = html`<td>${userName}</td><td>${userEmail}</td>`
 * element.innerHTML = row
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string

/**
 * Mark a string as trusted HTML (no escaping).
 * Only use with HTML you control — never with user input.
 * @example
 * html`<div>${raw('<br>')}</div>`
 */
export function raw(trustedString: string): SafeHTML

/**
 * Join non-empty values with a separator.
 * Filters out null, undefined, booleans, and empty strings.
 * Values are escaped; use SafeHTML separator for trusted HTML like raw("<br>").
 * Returns SafeHTML at runtime, typed as string (same as html``).
 */
export function join(items: unknown[], separator: string | SafeHTML): string

/**
 * Format an ISO date string for human-readable display.
 * Uses US locale with short month, numeric day, and full year.
 * @example
 * formatDate("2026-04-26T11:00:00Z")
 * // returns "Apr 26, 2026"
 */
export function formatDate(isoString: string): string

/** Contact type - email, phone, or unknown for ambiguous input */
export type ContactType = "email" | "phone" | "unknown"

/**
 * Count the number of digit characters (0-9) in a string.
 * Uses character codes for efficient detection without regex.
 * @example
 * countDigits("abc123") // returns 3
 * countDigits("5551234567") // returns 10
 * countDigits("no digits") // returns 0
 */
export function countDigits(str: string): number

/**
 * Detect if input looks like an email or phone number.
 * - Returns 'email' if the string contains '@'
 * - Returns 'phone' if the string has 7 or more digits
 * - Returns 'unknown' for ambiguous input (callers should show a validation error)
 * @example
 * detectContactType("user@example.com") // "email"
 * detectContactType("5551234567") // "phone"
 * detectContactType("john.doe") // "unknown"
 */
export function detectContactType(input: string): ContactType
