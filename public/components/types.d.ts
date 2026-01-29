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
