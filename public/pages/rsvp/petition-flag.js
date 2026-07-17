/** @file Client-side "you have a petition pending" flag, shared by the lookup,
 * petition, and RSVP forms. Stored in localStorage with a timestamp so a stale
 * flag can't outlive a reasonable review window, and reconciled against server
 * truth (petition status returned by /api/lookup) on the next visit. */

/** localStorage key — single source of truth for the three forms that touch it. */
const KEY = "petitionPending"

/** Backstop: a flag never reconciled by a lookup self-expires after this. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

/** Mark that this browser submitted a petition (records the time for expiry). */
export function setPetitionPending() {
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    // localStorage unavailable (private mode) — the note is a nicety.
  }
}

/** Clear the flag (petition resolved, or reconciled as not-pending). */
export function clearPetitionPending() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // localStorage unavailable — nothing to clear.
  }
}

/**
 * Whether this browser has an unresolved petition worth noting. A genuine
 * timestamp older than the review window self-expires; a legacy "1" value (set
 * before timestamps) is treated as pending and left for a lookup to reconcile.
 * @returns {boolean}
 */
export function isPetitionPending() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const at = Number(raw)
    // Real timestamps are ~1.7e12+; anything smaller isn't one (legacy "1").
    if (at > 1e12 && Date.now() - at > MAX_AGE_MS) {
      clearPetitionPending()
      return false
    }
    return true
  } catch {
    return false
  }
}
