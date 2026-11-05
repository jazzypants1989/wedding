/** @file When Review offers to trust someone (owner decision, Nov 2026): only
 *  once nothing of theirs is waiting, and only if everything they have posted
 *  was approved. A hidden or rejected post means no offer. It is an offer, a
 *  button in the toast or on the author card, never applied by approving.
 *  Pure, no DOM, so it runs in a unit test. */
/** @import * as Types from './types.js' */

/** @type {Types.shouldSuggestTrust} */
export function shouldSuggestTrust(account) {
  if (account.trusted) return false
  const c = account.counts
  return c.pending === 0 && c.hidden === 0 && c.rejected === 0 && c.approved > 0
}
