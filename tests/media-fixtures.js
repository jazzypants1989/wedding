/** @file In-repo binary fixtures for media tests. Per CLAUDE.md we keep NO
 *  binary files in the repo — every fixture is a Buffer built here with just
 *  enough real structure (magic bytes / atom trees) to exercise the code path.
 *  Poster/mp4-meta GPS fixtures are added alongside their tests. */

/**
 * Minimal JPEG: SOI (FF D8) + APP0 marker (FF E0) + zero filler + EOI (FF D9).
 * @param {number} [n] total byte length (min 6)
 * @returns {Buffer}
 */
export function makeJpeg(n = 64) {
  const buf = Buffer.alloc(Math.max(n, 6), 0)
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xe0
  buf[buf.length - 2] = 0xff; buf[buf.length - 1] = 0xd9
  return buf
}

/**
 * Minimal PNG: the 8-byte signature followed by zero filler.
 * @param {number} [n] total byte length (min 8)
 * @returns {Buffer}
 */
export function makePng(n = 64) {
  const buf = Buffer.alloc(Math.max(n, 8), 0)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf)
  return buf
}

/**
 * Minimal WebP: "RIFF" ....(size).... "WEBP" then zero filler.
 * @param {number} [n] total byte length (min 12)
 * @returns {Buffer}
 */
export function makeWebp(n = 64) {
  const buf = Buffer.alloc(Math.max(n, 12), 0)
  buf.write("RIFF", 0, "latin1")
  buf.write("WEBP", 8, "latin1")
  return buf
}

/**
 * ISO BMFF ftyp box with the given major brand, then zero filler.
 * @param {string} brand 4-char major brand
 * @param {number} [n] total byte length (min 16)
 * @returns {Buffer}
 */
export function makeFtyp(brand, n = 64) {
  const buf = Buffer.alloc(Math.max(n, 16), 0)
  buf.writeUInt32BE(buf.length, 0) // box size (cosmetic — sniff ignores it)
  buf.write("ftyp", 4, "latin1")
  buf.write(brand, 8, "latin1")    // major brand
  buf.write(brand, 12, "latin1")   // first compatible brand
  return buf
}

/** @param {number} [n] @returns {Buffer} */
export function makeMp4(n = 64) {
  return makeFtyp("isom", n)
}

/** @param {number} [n] @returns {Buffer} */
export function makeHeic(n = 64) {
  return makeFtyp("heic", n)
}

/** @param {number} [n] @returns {Buffer} QuickTime .mov (brand "qt  ") */
export function makeMov(n = 64) {
  return makeFtyp("qt  ", n)
}

// --- EXIF / metadata-bearing image builders (for core/image-meta.js) ---

/**
 * A TIFF block as EXIF stores it: header, IFD0 carrying orientation plus
 * pointers to an Exif sub-IFD and a GPS IFD, and the sub-IFDs themselves.
 * Offsets are computed rather than hard-coded so the shape can change.
 * @param {{ orientation?: number, gps?: boolean, capturedAt?: string, littleEndian?: boolean }} [opts]
 * @returns {Buffer}
 */
export function makeExifTiff(opts = {}) {
  const orientation = opts.orientation ?? 1
  const gps = opts.gps ?? false
  const capturedAt = opts.capturedAt ?? null
  const le = opts.littleEndian ?? false

  const w16 = (/** @type {number} */ n) => {
    const b = Buffer.alloc(2)
    if (le) b.writeUInt16LE(n, 0)
    else b.writeUInt16BE(n, 0)
    return b
  }
  const w32 = (/** @type {number} */ n) => {
    const b = Buffer.alloc(4)
    if (le) b.writeUInt32LE(n, 0)
    else b.writeUInt32BE(n, 0)
    return b
  }
  /** Entry: tag(2) type(2) count(4) value(4, left-justified when it fits). */
  const entry = (
    /** @type {number} */ tag,
    /** @type {number} */ type,
    /** @type {number} */ count,
    /** @type {Buffer} */ value,
  ) => {
    const v = Buffer.alloc(4)
    value.copy(v, 0)
    return Buffer.concat([w16(tag), w16(type), w32(count), v])
  }

  const HEADER_BYTES = 8
  const dateValue = capturedAt ? Buffer.from(capturedAt + "\0", "latin1") : null

  // Lay the blocks out end to end, then fill in the pointers.
  const ifd0Count = 1 + (capturedAt ? 1 : 0) + (gps ? 1 : 0)
  const ifd0At = HEADER_BYTES
  const ifd0Bytes = 2 + ifd0Count * 12 + 4
  const exifIfdAt = ifd0At + ifd0Bytes
  const exifIfdBytes = capturedAt ? 2 + 12 + 4 : 0
  const gpsIfdAt = exifIfdAt + exifIfdBytes
  const gpsIfdBytes = gps ? 2 + 12 + 4 : 0
  const dateAt = gpsIfdAt + gpsIfdBytes

  /** @type {Buffer[]} */
  const ifd0Entries = [entry(0x0112, 3, 1, w16(orientation))] // Orientation, SHORT
  if (capturedAt) ifd0Entries.push(entry(0x8769, 4, 1, w32(exifIfdAt))) // Exif IFD pointer
  if (gps) ifd0Entries.push(entry(0x8825, 4, 1, w32(gpsIfdAt))) // GPS IFD pointer

  const parts = [
    Buffer.from(le ? "II" : "MM", "latin1"),
    w16(42),
    w32(ifd0At),
    w16(ifd0Count),
    ...ifd0Entries,
    w32(0), // no IFD1
  ]
  if (capturedAt && dateValue) {
    parts.push(w16(1), entry(0x9003, 2, dateValue.length, w32(dateAt)), w32(0))
  }
  if (gps) {
    // GPSLatitudeRef, ASCII "N\0" — inline, since 2 bytes fit the value field.
    parts.push(w16(1), entry(0x0001, 2, 2, Buffer.from("N\0", "latin1")), w32(0))
  }
  if (dateValue) parts.push(dateValue)
  return Buffer.concat(parts)
}

/**
 * A JPEG marker segment: FF <marker> <length(2), counting itself> <payload>.
 * @param {number} marker @param {Buffer} payload @returns {Buffer}
 */
function jpegSegment(marker, payload) {
  const header = Buffer.alloc(4)
  header[0] = 0xff
  header[1] = marker
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

/**
 * A structurally-valid JPEG carrying every segment kind the metadata filter has
 * an opinion about: JFIF (keep), EXIF (drop), ICC (keep), an MPF-style APP2
 * (drop), IPTC (drop) and a comment (drop). Not decodable — there are no
 * Huffman tables and the scan data is filler — but every offset is real.
 * @param {{ width?: number, height?: number, exif?: Buffer | null, icc?: boolean, iptc?: boolean, comment?: boolean, mpf?: boolean }} [opts]
 * @returns {Buffer}
 */
export function makeJpegWithMetadata(opts = {}) {
  const width = opts.width ?? 1200
  const height = opts.height ?? 800
  /** @type {Buffer[]} */
  const parts = [Buffer.from([0xff, 0xd8])] // SOI

  // APP0 / JFIF: version(2) units(1) xDensity(2) yDensity(2) thumb(2)
  parts.push(
    jpegSegment(0xe0, Buffer.concat([
      Buffer.from("JFIF\0", "latin1"),
      Buffer.from([0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    ])),
  )
  if (opts.exif) {
    parts.push(jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), opts.exif])))
  }
  if (opts.icc !== false) {
    // ICC_PROFILE\0 seq(1) count(1) then profile bytes.
    parts.push(
      jpegSegment(0xe2, Buffer.concat([
        Buffer.from("ICC_PROFILE\0", "latin1"),
        Buffer.from([0x01, 0x01]),
        Buffer.alloc(64, 0x7f),
      ])),
    )
  }
  if (opts.mpf) {
    parts.push(jpegSegment(0xe2, Buffer.concat([Buffer.from("MPF\0", "latin1"), Buffer.alloc(32, 0x11)])))
  }
  if (opts.iptc !== false) {
    parts.push(
      jpegSegment(0xed, Buffer.concat([
        Buffer.from("Photoshop 3.0\0", "latin1"),
        Buffer.alloc(32, 0x22),
      ])),
    )
  }
  if (opts.comment !== false) {
    parts.push(jpegSegment(0xfe, Buffer.from("created by a camera", "latin1")))
  }

  // SOF0: precision(1) height(2) width(2) components(1) then 3 bytes each.
  const sof = Buffer.alloc(6 + 9)
  sof[0] = 8
  sof.writeUInt16BE(height, 1)
  sof.writeUInt16BE(width, 3)
  sof[5] = 3
  for (let i = 0; i < 3; i++) {
    sof[6 + i * 3] = i + 1
    sof[7 + i * 3] = 0x11
    sof[8 + i * 3] = i === 0 ? 0 : 1
  }
  parts.push(jpegSegment(0xc0, sof))

  // SOS: components(1) then 2 bytes each, then Ss/Se/AhAl.
  const sos = Buffer.alloc(1 + 6 + 3)
  sos[0] = 3
  for (let i = 0; i < 3; i++) {
    sos[1 + i * 2] = i + 1
    sos[2 + i * 2] = 0x00
  }
  parts.push(jpegSegment(0xda, sos))
  parts.push(Buffer.alloc(48, 0x5a)) // stand-in for entropy-coded scan data
  parts.push(Buffer.from([0xff, 0xd9])) // EOI
  return Buffer.concat(parts)
}

const PNG_SIGNATURE_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * A PNG chunk: length(4) type(4) data crc(4). The CRC is filler — nothing in
 * image-meta.js validates it, and computing one would need a table this file
 * has no other use for.
 * @param {string} type @param {Buffer} data @returns {Buffer}
 */
function pngChunk(type, data) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, "latin1")
  return Buffer.concat([header, data, Buffer.alloc(4, 0)])
}

/**
 * A PNG with IHDR, an ICC profile, and the metadata chunks the filter drops.
 * @param {{ width?: number, height?: number, exif?: Buffer | null, text?: boolean, icc?: boolean }} [opts]
 * @returns {Buffer}
 */
export function makePngWithMetadata(opts = {}) {
  const width = opts.width ?? 1200
  const height = opts.height ?? 800
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha

  /** @type {Buffer[]} */
  const parts = [Buffer.from(PNG_SIGNATURE_BYTES), pngChunk("IHDR", ihdr)]
  if (opts.icc !== false) parts.push(pngChunk("iCCP", Buffer.concat([Buffer.from("ICC\0\0", "latin1"), Buffer.alloc(32, 0x7f)])))
  if (opts.exif) parts.push(pngChunk("eXIf", opts.exif))
  if (opts.text !== false) {
    parts.push(pngChunk("tEXt", Buffer.from("Software\0a camera", "latin1")))
    parts.push(pngChunk("tIME", Buffer.alloc(7, 1)))
  }
  parts.push(pngChunk("IDAT", Buffer.alloc(32, 0x33)))
  parts.push(pngChunk("IEND", Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/**
 * A RIFF chunk: fourcc(4) size(4, LE) payload, padded to an even length.
 * @param {string} fourcc @param {Buffer} data @returns {Buffer}
 */
function riffChunk(fourcc, data) {
  const header = Buffer.alloc(8)
  header.write(fourcc, 0, "latin1")
  header.writeUInt32LE(data.length, 4)
  const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)
  return Buffer.concat([header, data, pad])
}

/**
 * An extended (VP8X) WebP with a canvas size, ICC, EXIF and XMP. The VP8X
 * feature flags advertise exactly the chunks present, so a strip that fails to
 * clear them is detectable.
 * @param {{ width?: number, height?: number, exif?: Buffer | null, xmp?: boolean, icc?: boolean }} [opts]
 * @returns {Buffer}
 */
export function makeWebpWithMetadata(opts = {}) {
  const width = opts.width ?? 1200
  const height = opts.height ?? 800
  const hasExif = Boolean(opts.exif)
  const hasXmp = opts.xmp !== false
  const hasIcc = opts.icc !== false

  const vp8x = Buffer.alloc(10)
  vp8x[0] = (hasIcc ? 0x20 : 0) | (hasExif ? 0x08 : 0) | (hasXmp ? 0x04 : 0)
  vp8x.writeUIntLE(width - 1, 4, 3)
  vp8x.writeUIntLE(height - 1, 7, 3)

  /** @type {Buffer[]} */
  const chunks = [riffChunk("VP8X", vp8x)]
  if (hasIcc) chunks.push(riffChunk("ICCP", Buffer.alloc(32, 0x7f)))
  chunks.push(riffChunk("VP8 ", Buffer.alloc(40, 0x44)))
  if (opts.exif) chunks.push(riffChunk("EXIF", opts.exif))
  if (hasXmp) chunks.push(riffChunk("XMP ", Buffer.from("<x:xmpmeta/>", "latin1")))

  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write("RIFF", 0, "latin1")
  header.writeUInt32LE(4 + body.length, 4)
  header.write("WEBP", 8, "latin1")
  return Buffer.concat([header, body])
}

// --- MP4 atom-tree builders (for the GPS-blanking tests) ---

/** @param {number} n @returns {Buffer} */
function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n, 0)
  return b
}

/** @param {number} n @returns {Buffer} */
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

/**
 * Build an ISO box: [size(4)][type(4)][payload]. `type` may be a 4-char string
 * or a 4-byte Buffer (for the ©xyz atom / numeric ilst indices).
 * @param {string | Buffer} type
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function box(type, payload) {
  const typeBuf = Buffer.isBuffer(type) ? type : Buffer.from(type, "latin1")
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + payload.length, 0)
  typeBuf.copy(header, 4)
  return Buffer.concat([header, payload])
}

/**
 * A minimal MP4 whose moov carries a movie header and one or two traks, for the
 * duration/dimension probe. `rotation` writes the tkhd transform matrix a
 * camera uses for a quarter turn, so the probe has to swap width and height.
 * @param {{ durationSeconds?: number, timescale?: number, width?: number, height?: number, rotation?: 0 | 90 | 270, version?: 0 | 1, audioTrakFirst?: boolean, videoHandler?: boolean, unknownDuration?: boolean }} [opts]
 * @returns {Buffer}
 */
export function makeMp4WithMetadata(opts = {}) {
  const timescale = opts.timescale ?? 1000
  const durationSeconds = opts.durationSeconds ?? 15.651
  const width = opts.width ?? 1920
  const height = opts.height ?? 1080
  const rotation = opts.rotation ?? 0
  const version = opts.version ?? 0

  // mvhd: version/flags(4) creation modification timescale duration ...
  /** @type {Buffer} */
  let mvhdPayload
  if (version === 1) {
    const p = Buffer.alloc(4 + 8 + 8 + 4 + 8 + 80)
    p[0] = 1
    p.writeUInt32BE(timescale, 4 + 16)
    const duration = Math.round(durationSeconds * timescale)
    p.writeUInt32BE(Math.floor(duration / 2 ** 32), 4 + 20)
    p.writeUInt32BE(duration >>> 0, 4 + 24)
    mvhdPayload = p
  } else {
    const p = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 80)
    p.writeUInt32BE(timescale, 4 + 8)
    p.writeUInt32BE(
      opts.unknownDuration ? 0xffffffff : Math.round(durationSeconds * timescale),
      4 + 12,
    )
    mvhdPayload = p
  }
  const mvhd = box("mvhd", mvhdPayload)

  /**
   * tkhd: version/flags(4) creation(4) modification(4) trackId(4) reserved(4)
   * duration(4) reserved(8) layer(2) altGroup(2) volume(2) reserved(2)
   * matrix(36) width(4) height(4) — the last three are what the probe reads.
   * @param {number} w @param {number} h @param {number} rot
   */
  const makeTkhd = (w, h, rot) => {
    const p = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36 + 4 + 4)
    const matrixAt = p.length - 44
    const ONE = 0x00010000
    if (rot === 90) {
      p.writeInt32BE(0, matrixAt) // a
      p.writeInt32BE(ONE, matrixAt + 4) // b
      p.writeInt32BE(-ONE, matrixAt + 12) // c
      p.writeInt32BE(0, matrixAt + 16) // d
    } else if (rot === 270) {
      p.writeInt32BE(0, matrixAt)
      p.writeInt32BE(-ONE, matrixAt + 4)
      p.writeInt32BE(ONE, matrixAt + 12)
      p.writeInt32BE(0, matrixAt + 16)
    } else {
      p.writeInt32BE(ONE, matrixAt)
      p.writeInt32BE(0, matrixAt + 4)
      p.writeInt32BE(0, matrixAt + 12)
      p.writeInt32BE(ONE, matrixAt + 16)
    }
    p.writeUInt32BE(0x40000000, matrixAt + 32) // w, fixed 2.30
    p.writeUInt32BE(w * 65536, p.length - 8)
    p.writeUInt32BE(h * 65536, p.length - 4)
    return box("tkhd", p)
  }

  /** @param {string} handler */
  const makeMdia = (handler) =>
    box("mdia", box("hdlr", Buffer.concat([
      Buffer.alloc(8), // version/flags(4) + pre_defined(4)
      Buffer.from(handler, "latin1"),
      Buffer.alloc(12),
    ])))

  const videoTrak = box("trak", Buffer.concat([
    makeTkhd(width, height, rotation),
    ...(opts.videoHandler === false ? [] : [makeMdia("vide")]),
  ]))
  // A soundtrack: real dimensions of zero, so a probe that grabs the first trak
  // it sees gets nothing usable.
  const audioTrak = box("trak", Buffer.concat([makeTkhd(0, 0, 0), makeMdia("soun")]))

  const traks = opts.audioTrakFirst ? [audioTrak, videoTrak] : [videoTrak, audioTrak]
  const moov = box("moov", Buffer.concat([mvhd, ...traks]))
  // mdat before moov, the way a streaming muxer writes it — the probe has to
  // skip it by header rather than scanning bytes.
  const mdat = box("mdat", Buffer.alloc(256, 0x77))
  return Buffer.concat([makeFtyp("isom", 16), mdat, moov])
}

/**
 * A minimal but structurally-valid MP4 carrying the SAME ISO6709 coordinate in
 * BOTH Apple GPS carriers: legacy moov/udta/©xyz and modern moov/meta
 * (mdta keys/ilst). `isoMeta` toggles the ISO fullbox (version/flags) vs
 * QuickTime-style meta layout.
 * @param {{ coord?: string, isoMeta?: boolean }} [opts]
 * @returns {{ buffer: Buffer, coord: string }}
 */
export function makeMp4WithGps(opts = {}) {
  const coord = opts.coord ?? "+12.3456-098.7654/"
  const isoMeta = opts.isoMeta !== false // default ISO fullbox layout
  const coordBuf = Buffer.from(coord, "latin1")

  // moov/udta/©xyz : [strLen(2)][lang(2)][string]
  const xyzType = Buffer.from([0xa9, 0x78, 0x79, 0x7a])
  const xyz = box(xyzType, Buffer.concat([u16(coordBuf.length), u16(0x55c4), coordBuf]))
  const udta = box("udta", xyz)

  // moov/meta : hdlr(mdta) + keys + ilst
  const hdlr = box("hdlr", Buffer.concat([
    Buffer.alloc(8), // version/flags(4) + pre_defined(4)
    Buffer.from("mdta", "latin1"), // handler_type
    Buffer.alloc(12), // reserved
  ]))
  const keyEntry = box("mdta", Buffer.from("com.apple.quicktime.location.ISO6709", "latin1"))
  const keys = box("keys", Buffer.concat([Buffer.alloc(4), u32(1), keyEntry])) // version/flags + count=1
  const dataBox = box("data", Buffer.concat([Buffer.alloc(8), coordBuf])) // type-indicator(4)+locale(4)+value
  const item = box(u32(1), dataBox) // atom type = key index 1 (big-endian)
  const ilst = box("ilst", item)
  const metaPayload = isoMeta
    ? Buffer.concat([Buffer.alloc(4), hdlr, keys, ilst]) // ISO fullbox: version/flags first
    : Buffer.concat([hdlr, keys, ilst]) // QuickTime-style: children immediately
  const meta = box("meta", metaPayload)

  const moov = box("moov", Buffer.concat([udta, meta]))
  const buffer = Buffer.concat([makeFtyp("isom", 16), moov])
  return { buffer, coord }
}

/** Signed 16.16 fixed-point, the way 3GPP `loci` stores a coordinate.
 *  @param {number} deg @returns {Buffer} */
function fixed1616(deg) {
  const b = Buffer.alloc(4)
  b.writeInt32BE(Math.round(deg * 65536), 0)
  return b
}

/**
 * A minimal MP4 carrying GPS in the 3GPP `loci` box (moov/udta/loci) — the
 * carrier ffmpeg writes for `-metadata location=`, and the one neither Apple
 * carrier covers. Byte layout copied from real `ffmpeg -metadata location=`
 * output: [version/flags(4)][language(2)][name…\0][role(1)][lon(4)][lat(4)]
 * [alt(4)][astronomical_body…\0][notes…\0], coordinates as signed 16.16.
 * @param {{ longitude?: number, latitude?: number, name?: string }} [opts]
 * @returns {{ buffer: Buffer, longitude: number, latitude: number, name: string }}
 */
export function makeMp4WithLoci(opts = {}) {
  const longitude = opts.longitude ?? -98.7654
  const latitude = opts.latitude ?? 12.3456
  const name = opts.name ?? "Rose Garden"

  const loci = box(
    "loci",
    Buffer.concat([
      Buffer.alloc(4), // version + flags
      u16(0x15c7), // language
      Buffer.from(name + "\0", "latin1"),
      Buffer.from([0]), // role: shooting location
      fixed1616(longitude),
      fixed1616(latitude),
      fixed1616(0), // altitude
      Buffer.from("earth\0", "latin1"),
      Buffer.from("\0", "latin1"), // additional_notes
    ]),
  )
  const moov = box("moov", box("udta", loci))
  return { buffer: Buffer.concat([makeFtyp("isom", 16), moov]), longitude, latitude, name }
}

