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

/** @file theme-toggle.js - Types for theme toggle module */

/**
 * Initialize theme toggle buttons.
 * Sets up click handlers and initial state.
 */
export function initThemeToggle(): void

/**
 * Toggle between light and dark theme.
 * Updates data-theme attribute, localStorage, and toggle button state.
 */
export function toggleTheme(): void

/** @file celebrate.js - Types for shared celebration + button-state helpers */

/** Toggle a button's disabled state + `.btn-loading` spinner class. */
export function setButtonLoading(btn: HTMLButtonElement, isLoading: boolean): void

/** Burst confetti from the top of the viewport. No-ops under reduced motion. */
export function fireConfetti(): void

/** Small sparkle burst centred on `element`. No-ops under reduced motion. */
export function miniSparkle(element: HTMLElement): void

/** @file relative-time.js - Types for relative time formatting */

/** Format an ISO timestamp as e.g. "3 days ago" via Intl.RelativeTimeFormat. */
export function formatRelative(iso: string): string

/** Rewrite every <time datetime> under root to its relative text + absolute title. */
export function upgradeTimes(root?: ParentNode): void

/** @file guest-session.js - Types for guest session state + write-gating */

/** Public account projection returned by /api/account/me and register. */
export interface GuestAccount {
  id: number
  name: string
  relation: string | null
  trusted: 0 | 1
}

export interface GuestSessionState {
  account: GuestAccount | null
}

export interface MeResponse {
  account: GuestAccount | null
}

export const session: GuestSessionState

/** Fetch /api/account/me and cache the account in `session`. */
export function loadSession(): Promise<GuestAccount | null>

/** Run `action` if signed in; else stash it and open the auth sheet (replays on success). */
export function requireAccount(action: () => void): void

/** Replay and clear the stashed action after a successful sign-in. */
export function replayPendingAction(): void

/** Set the current account (called by the auth sheet after register). */
export function setAccount(account: GuestAccount | null): void

/** @file auth-sheet.js - Types for the shared auth sheet */

export interface RegisterResponse {
  success: boolean
  account: GuestAccount
  returning: boolean
}

/** Inject the auth-sheet dialog + wire its listeners (idempotent). */
export function initAuthSheet(): void

/** Open the auth sheet, remembering `trigger` for focus return + success sparkle. */
export function openAuthSheet(trigger?: HTMLElement | null): void
