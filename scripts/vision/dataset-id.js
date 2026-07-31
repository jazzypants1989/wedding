/** @file The stable identity of a detection set, shared by the two sides of
 *  the labels join. `relabel-data.js` stamps it into every label-data.js it
 *  writes (and `label.html` carries it into labels.json); `session1-report.js`
 *  recomputes it from faces.jsonl and refuses a labels file whose id does not
 *  match. It lives in its own module because those two scripts import each
 *  other's neighbours — `relabel-data.js` already imports from
 *  `session1-report.js`, so the report importing the digest back from
 *  `relabel-data.js` would be a cycle.
 *
 *  No regex: string building only.
 */
/** @import * as Types from './types.js' */

import { createHash } from "node:crypto"

/** Length of `datasetId`, in lowercase hex characters. */
export const DATASET_ID_CHARS = 16

/**
 * Two decimal places, matching `round(value, 2)` in session1.js — which is what
 * wrote the boxes in faces.jsonl in the first place. Applied again here so the
 * digest does not depend on the writer having rounded, and so a box that somehow
 * arrives unrounded hashes the same as its written form.
 * @param {number} value @returns {number}
 */
function round2(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/**
 * A stable identity for the detection set: sha256 over the newline-joined
 * `<id>:<photoId>:<x>,<y>,<w>,<h>` of every face, boxes at two decimal places,
 * truncated to 16 hex characters.
 *
 * The point is that it changes when the DATA changes. The v1 fingerprint was
 * derived from the face count, which meant two entirely different runs that
 * happened to find the same number of faces produced the same value — so a
 * labels.json could be read against the wrong run and every id would join to
 * somebody else's face without a single warning. 64 bits is far more than
 * enough to fail loudly instead.
 * @type {Types.computeDatasetId}
 */
export function computeDatasetId(faces) {
  /** @type {string[]} */
  const lines = []
  for (const face of faces) {
    const b = face.box
    lines.push(
      `${face.id}:${face.photoId}:` +
        `${round2(b.x)},${round2(b.y)},${round2(b.w)},${round2(b.h)}`,
    )
  }
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex").slice(0, DATASET_ID_CHARS)
}
