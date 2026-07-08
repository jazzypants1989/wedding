/** @file Reaction database operations (polymorphic: guestbook entries + media) */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"

/** @type {Types.getReactionCounts} */
export function getReactionCounts(targetType, targetId) {
  /** @type {{ emoji: string, c: number }[]} */
  const rows = sql`SELECT emoji, COUNT(*) AS c FROM reactions
    WHERE target_type = ${targetType} AND target_id = ${targetId}
    GROUP BY emoji`.all()
  /** @type {Record<string, number>} */
  const counts = {}
  for (const row of rows) counts[row.emoji] = row.c
  return counts
}

/** @type {Types.toggleReaction} */
export function toggleReaction({ accountId, targetType, targetId, emoji }) {
  // Atomic, idempotent, no transaction: try to insert; if the UNIQUE row already
  // existed (no rows changed) the reaction was on, so remove it. `active` is the
  // caller's new state for this emoji. See 00-overview decision log.
  const inserted = sql`INSERT INTO reactions (account_id, target_type, target_id, emoji)
    VALUES (${accountId}, ${targetType}, ${targetId}, ${emoji})
    ON CONFLICT(account_id, target_type, target_id, emoji) DO NOTHING`.run()
  const active = inserted.changes > 0
  if (!active) {
    sql`DELETE FROM reactions
      WHERE account_id = ${accountId} AND target_type = ${targetType}
        AND target_id = ${targetId} AND emoji = ${emoji}`.run()
  }
  return { active, counts: getReactionCounts(targetType, targetId) }
}

/** @type {Types.getReactionSummary} */
export function getReactionSummary(targetType, ids, callerId = null) {
  // Feed enrichment: per-target emoji counts + the caller's own reactions, for a
  // page of ids. sql.list() throws on an empty array, so the caller must guard —
  // but guard here too so this is safe to call unconditionally.
  if (ids.length === 0) return new Map()

  /** @type {{ target_id: number, emoji: string, c: number }[]} */
  const totals = sql`SELECT target_id, emoji, COUNT(*) AS c FROM reactions
    WHERE target_type = ${targetType} AND target_id IN ${sql.list(ids)}
    GROUP BY target_id, emoji`.all()

  /** @type {{ target_id: number, emoji: string }[]} */
  const mineRows =
    callerId !== null
      ? sql`SELECT target_id, emoji FROM reactions
          WHERE target_type = ${targetType} AND account_id = ${callerId}
            AND target_id IN ${sql.list(ids)}`.all()
      : []

  /** @type {Map<number, Record<string, { count: number, mine: boolean }>>} */
  const summary = new Map()
  for (const row of totals) {
    let target = summary.get(row.target_id)
    if (!target) {
      target = {}
      summary.set(row.target_id, target)
    }
    target[row.emoji] = { count: row.c, mine: false }
  }
  for (const row of mineRows) {
    const target = summary.get(row.target_id)
    if (target && target[row.emoji]) target[row.emoji].mine = true
  }
  return summary
}
