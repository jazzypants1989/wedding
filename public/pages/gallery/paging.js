/** @file Gallery paging rules. Pure: no DOM, no fetch, so they can be unit-tested.
 *
 *  Every gallery section is a keyset feed. Guest pages newest-first and hands
 *  back an id cursor that goes out as `before=`; a curated section (official,
 *  honeymoon) pages in the couple's order and hands back an opaque position that
 *  goes out as `after=`. Either way the cursor is echoed, never read.
 *
 *  The "all" view is one list — official, then honeymoon, then guest — so a
 *  later section is only part of it once every section before it has been
 *  loaded to the end. Otherwise the lightbox would step from the last loaded
 *  official photo straight into the guest wall, past every official photo not
 *  fetched yet. */
/** @import * as Types from "./types.js" */

/** @type {Types.mediaPagePath} */
export function mediaPagePath(section, limit, cursor) {
  const base = `/api/media?section=${section}&limit=${limit}`
  if (cursor === null) return base
  const param = section === "guest" ? "before" : "after"
  return `${base}&${param}=${encodeURIComponent(String(cursor))}`
}

/** @type {Types.freshItems} */
export function freshItems(loaded, page) {
  // A page can repeat an item already on screen: a deep-linked photo is placed
  // before its page arrives, and a reorder between two page loads can carry a
  // photo from one page onto the next. Each id renders once.
  const seen = new Set(loaded.map((item) => item.id))
  const out = []
  for (const item of page) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** @type {Types.reachableSections} */
export function reachableSections(order, hasMore) {
  /** @type {Types.MediaSection[]} */
  const out = []
  for (const section of order) {
    out.push(section)
    if (hasMore(section)) break
  }
  return out
}
