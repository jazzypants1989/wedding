/** @file Magic-byte content sniffing for uploaded media. Zero-dep, no regex —
 *  Buffer index reads + latin1 tag compares on the first bytes of a file. The
 *  file's real type is derived here; the client-supplied filename/extension is
 *  never trusted. See docs/post-wedding/03-media-pipeline.md §4. */
/** @import * as Types from './types.js' */

// ISO Base Media file boxes carry a 4-char major brand at offset 8 (after the
// 4-byte box size and the "ftyp" tag at offset 4). Lists verified against the
// MP4RA registry: dead brands (`heif`, `mp4v`) are omitted; `hevx` and the
// `3gpN` camcorder brands (often carried by `.mp4` files) are included.
const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1",
])
const MP4_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ",
  "3gp4", "3gp5", "3gp6",
])
const MOV_BRANDS = new Set(["qt  "]) // QuickTime major brand: two trailing spaces

/** @type {Types.sniffMagic} */
export function sniffMagic(buf) {
  // Need at least 12 bytes to read a brand at offset 8-12.
  if (buf.length < 12) return ""

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg"

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "png"

  // WEBP: "RIFF" at 0 and "WEBP" at 8
  if (
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) return "webp"

  // ISO BMFF: "ftyp" at 4, then classify by the major brand at 8. ftyp-first
  // holds for every real phone-camera file; exotic/legacy layouts are rejected.
  if (buf.toString("latin1", 4, 8) === "ftyp") {
    const brand = buf.toString("latin1", 8, 12)
    // A `mif1`-major AVIF passes the HEIC gate — harmless: it stores with a
    // .heic ext and only the client-generated display variant is ever public.
    if (HEIC_BRANDS.has(brand)) return "heic"
    if (MP4_BRANDS.has(brand)) return "mp4"
    if (MOV_BRANDS.has(brand)) return "mov"
  }

  return ""
}

// Storage extension derives from the sniff result, never the client filename.
/** @type {Record<string, string>} */
const EXT_BY_SNIFF = {
  jpeg: "jpg", png: "png", webp: "webp", heic: "heic", mp4: "mp4", mov: "mov",
}

/** @type {Types.extForSniff} */
export function extForSniff(sniffed) {
  return EXT_BY_SNIFF[sniffed] ?? ""
}

// A declared Content-Type header must agree with the sniffed bytes (415
// otherwise). image/heif is an alias for the heic sniff; video/quicktime is a
// .mov container. Multiple Content-Types may map to one sniff result.
/** @type {Record<string, Types.SniffedType>} */
const SNIFF_BY_CONTENT_TYPE = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
}

/** @type {Types.contentTypeAgrees} */
export function contentTypeAgrees(contentType, sniffed) {
  if (!contentType) return false
  // Strip any "; charset=" / parameters and normalize case.
  const base = contentType.split(";")[0].trim().toLowerCase()
  return SNIFF_BY_CONTENT_TYPE[base] === sniffed
}
