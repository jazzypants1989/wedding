/**
 * Shared state for the admin dashboard
 *
 * DESIGN NOTE: This object is intentionally mutable. Direct property mutation
 * is the expected pattern in this MPA (Multi-Page Application):
 *
 *   state.csrfToken = newToken;
 *   state.currentGuests = newGuestArray;
 *
 * This is acceptable because:
 * 1. Each page load creates a fresh JavaScript context (no state persistence)
 * 2. Only a single module tree imports this state (admin dashboard)
 * 3. No complex state synchronization is needed
 * 4. Simpler than setter functions for this use case
 *
 * The only reason one should consider adding getters/setters or Object.freeze()
 * would be a conversion to a SPA (Single-Page Application) architecture in the future,
 * which is not currently planned.
 */

/** @import * as Types from './types.js' */

/** @type {Types.AdminState} */
export const state = {
  csrfToken: null,
  currentGuests: [],
  currentPage: 0,
  PAGE_SIZE: 25,
  currentPetitions: [],
  currentBlocklist: [],
  currentModeration: [],

  onAuthRequired: () => {},
  getGuestById(id) {
    return this.currentGuests.find((g) => g.id === id) || null
  },
  getBlockedEntryById(id) {
    return this.currentBlocklist.find((e) => e.id === id) || null
  },
  getPetitionById(id) {
    return this.currentPetitions.find((p) => p.id === id) || null
  },
  getModerationById(id) {
    return this.currentModeration.find((m) => m.id === id) || null
  },
}
