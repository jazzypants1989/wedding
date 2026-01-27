import type {
  RSVPWithGuest,
  Stats,
  Guest,
  Petition,
  BlocklistEntry,
} from "../../types.js"

// Options for the api() helper function
export interface ApiOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

// Generic API error response
export interface ApiError {
  error: string
}

// Pagination info included in list responses
export interface PaginationInfo {
  total: number
  limit: number
  offset: number
}

// Admin API responses
export interface StatsResponse {
  stats: Stats
}

export interface GuestsResponse {
  guests: Guest[]
  pagination: PaginationInfo
}

export interface GuestResponse {
  guest: Guest
}

export interface RSVPsResponse {
  rsvps: RSVPWithGuest[]
}

export interface PetitionsResponse {
  petitions: Petition[]
}

export interface BlocklistResponse {
  blocklist: BlocklistEntry[]
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

export interface FetchResult<T = unknown> {
  ok: boolean
  status: number
  data: T
}

export interface AdminState {
  csrfToken: string | null
  currentGuests: Guest[]
  currentPage: number
  PAGE_SIZE: number
  currentPetitions: Petition[]
  currentBlocklist: BlocklistEntry[]
  onAuthRequired: () => void
  getGuestById: (id: number) => Guest | null
  getBlockedEntryById: (id: number) => BlocklistEntry | null
  getPetitionById: (id: number) => Petition | null
}

/** @file mobile-nav.js - Types for mobile navigation module */

/**
 * Toggle function to open/close the mobile nav.
 * @example
 * toggle(); // Opens if closed, closes if open
 */
export function toggle(): void

/**
 * Close function to explicitly close the mobile nav.
 * @example
 * close(); // Closes if open, no-op if already closed
 */
export function close(): void

/**
 * Initialize mobile navigation with hamburger menu.
 * Sets up event listeners for toggle, close, and accessibility.
 * @example
 * initMobileNav();
 */
export function initMobileNav(): void

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
 * Format an ISO date string for human-readable display.
 * Uses US locale with short month, numeric day, and full year.
 * @example
 * formatDate("2026-04-26T11:00:00Z")
 * // returns "Apr 26, 2026"
 */
export function formatDate(isoString: string): string

/** Contact type - email or phone */
export type ContactType = "email" | "phone"

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
 * - Defaults to 'email' for ambiguous input (backend validates further)
 * @example
 * detectContactType("user@example.com") // "email"
 * detectContactType("5551234567") // "phone"
 * detectContactType("john.doe") // "email" (default)
 */
export function detectContactType(input: string): ContactType
