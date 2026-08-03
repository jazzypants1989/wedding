/**
 * @file Ingest provenance (schema.js `add_vision_provenance`).
 *
 * `media_faces.model_version` names the DESCRIPTOR SPACE a face was embedded
 * into — embedder, output width, normalisation, mirror — and nothing else. It
 * says nothing about which detector drew the box, which engine build ran,
 * under which thresholds, or against which route profile. Without that, a face
 * left over from a superseded run is indistinguishable from a current one, and
 * "re-run only what is stale" is not a query anyone can write. One row here per
 * run makes it one.
 *
 * Every function is a PLAIN statement with no transaction of its own:
 * db/utils.js's `withTransaction` is a bare BEGIN IMMEDIATE with no savepoints
 * and does not nest, and callers are already inside one.
 */
/** @import * as Types from './types.js' */

import { sql } from "./sql.js"

/** @type {Types.createIngest} */
export function createIngest({
  datasetId,
  modelVersion,
  detectorSha256,
  embedderSha256,
  engineSha256,
  mirrorApplied,
  normalisation,
  routeProfile,
  config,
}) {
  const result = sql`INSERT INTO vision_ingests (
      dataset_id, model_version, detector_sha256, embedder_sha256, engine_sha256,
      mirror_applied, normalisation, route_profile, config_json
    ) VALUES (
      ${datasetId}, ${modelVersion}, ${detectorSha256}, ${embedderSha256}, ${engineSha256},
      ${mirrorApplied ? 1 : 0}, ${normalisation}, ${routeProfile}, ${JSON.stringify(config)}
    )`.run()
  return /** @type {import('../types.js').VisionIngest} */ (
    getIngestById(Number(result.lastInsertRowid))
  )
}

/** @type {Types.getIngestById} */
export function getIngestById(id) {
  return sql`SELECT * FROM vision_ingests WHERE id = ${id}`.get()
}

/** @type {Types.ingestsForModelVersion} */
export function ingestsForModelVersion(modelVersion) {
  return sql`SELECT * FROM vision_ingests
    WHERE model_version = ${modelVersion}
    ORDER BY id`.all()
}

/**
 * The check plan §9a demands, and the reason it is a hard error rather than a
 * naming convention: `model_version` is what every distance computation
 * partitions on, so the same string over two different descriptor spaces mixes
 * them inside one comparison. That does not look like a bug — it looks like a
 * recogniser that got slightly worse — so nothing downstream would ever catch
 * it. Refuse at the only moment it is cheap to refuse.
 *
 * Compares against EVERY earlier row rather than the newest, so a triple that
 * drifted and drifted back is still caught.
 * @type {Types.assertModelVersionInvariant}
 */
export function assertModelVersionInvariant(
  modelVersion,
  { embedderSha256, normalisation, mirrorApplied },
) {
  const mirror = mirrorApplied ? 1 : 0
  /** @type {{ id: number, embedder_sha256: string, normalisation: string, mirror_applied: number } | undefined} */
  const clash = sql`SELECT id, embedder_sha256, normalisation, mirror_applied
    FROM vision_ingests
    WHERE model_version = ${modelVersion}
      AND (embedder_sha256 != ${embedderSha256}
           OR normalisation != ${normalisation}
           OR mirror_applied != ${mirror})
    ORDER BY id
    LIMIT 1`.get()

  if (!clash) return

  // The differing field is named, but the embedder hashes are NOT printed in
  // full — the message goes to a CLI and a log, and a 64-char hash pair in an
  // error line is noise that hides the one word that matters.
  const differs = []
  if (clash.embedder_sha256 !== embedderSha256) differs.push("embedder_sha256")
  if (clash.normalisation !== normalisation) differs.push("normalisation")
  if (clash.mirror_applied !== mirror) differs.push("mirror_applied")

  throw new Error(
    `model_version "${modelVersion}" is already recorded by ingest ${clash.id} ` +
      `with a different ${differs.join(" and ")}. A model_version names one ` +
      `descriptor space; reusing it for another silently mixes the two in every ` +
      `distance comparison. Choose a new model_version.`,
  )
}
