/** @file ISO base media file format (MP4/QuickTime) box-header primitives.
 *  Extracted from mp4-meta.js so the GPS blanker (core/mp4-meta.js) and the
 *  duration/dimension probe (core/mp4-probe.js) share one parser rather than
 *  keeping two copies in step. Zero-dep, no regex — Buffer index reads and
 *  latin1 type compares only. */
/** @import * as Types from './types.js' */

/** @type {Types.readBox} */
export function readBox(buf, offset, end) {
  if (offset + 8 > end) return null
  let size = buf.readUInt32BE(offset)
  const type = buf.toString("latin1", offset + 4, offset + 8)
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > end) return null
    const hi = buf.readUInt32BE(offset + 8)
    const lo = buf.readUInt32BE(offset + 12)
    size = hi * 2 ** 32 + lo
    headerSize = 16
  } else if (size === 0) {
    size = end - offset
  }
  const boxEnd = offset + size
  if (size < headerSize || boxEnd > end || boxEnd <= offset) return null
  return { start: offset, type, headerSize, contentStart: offset + headerSize, boxEnd }
}

/** @type {Types.childBoxes} */
export function childBoxes(buf, start, end) {
  /** @type {Types.Mp4Box[]} */
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    const box = readBox(buf, offset, end)
    if (!box) break
    boxes.push(box)
    offset = box.boxEnd
  }
  return boxes
}

/** @type {Types.findChildBox} */
export function findChildBox(buf, parent, type) {
  for (const child of childBoxes(buf, parent.contentStart, parent.boxEnd)) {
    if (child.type === type) return child
  }
  return null
}

/** @type {Types.readTopLevelHeader} */
export async function readTopLevelHeader(fh, offset, fileSize) {
  if (offset + 8 > fileSize) return null
  const header = Buffer.alloc(16)
  const { bytesRead } = await fh.read(header, 0, 16, offset)
  if (bytesRead < 8) return null
  let size = header.readUInt32BE(0)
  const type = header.toString("latin1", 4, 8)
  let headerSize = 8
  if (size === 1) {
    if (bytesRead < 16 || offset + 16 > fileSize) return null
    size = header.readUInt32BE(8) * 2 ** 32 + header.readUInt32BE(12)
    headerSize = 16
  } else if (size === 0) {
    size = fileSize - offset
  }
  const boxEnd = offset + size
  if (size < headerSize || boxEnd > fileSize || boxEnd <= offset) return null
  return { type, boxEnd }
}

/** @type {Types.findTopLevelBox} */
export async function findTopLevelBox(fh, fileSize, type) {
  let offset = 0
  while (offset + 8 <= fileSize) {
    const box = await readTopLevelHeader(fh, offset, fileSize)
    if (!box) break // malformed → stop cleanly rather than throw
    if (box.type === type) return { start: offset, end: box.boxEnd }
    offset = box.boxEnd
  }
  return null
}
