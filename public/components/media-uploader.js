/** @file UI-agnostic upload queue engine. Drives the Phase 3 pipeline:
 *  processMediaFile() (client resize/poster) → POST /api/media (open session) →
 *  PUT each variant (raw XHR, progress + retry) → POST finalize. Emits per-item
 *  state so the gallery tray (and Phase 6 admin) can render without knowing any
 *  of this. Transport spec: docs/post-wedding/03-media-pipeline.md §5, 04 §6.
 *  Zero-dep, no regex. */
/** @import * as Types from "./types.js" */

import { processMediaFile } from "./media-processing.js"

const MAX_UPLOAD_CONCURRENCY = 2 // files uploading at once (processing is 1-at-a-time)
const MAX_ATTEMPTS = 4 // per-variant retries on network / 5xx
const BASE_BACKOFF_MS = 500
const CSRF_COOKIE = "guest_csrf"

// Statuses that are permanent for THIS file — never retried, surfaced as-is.
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 507])

/**
 * @typedef {Types.UploadQueueItem & {
 *   file: File,
 *   processed: Types.ProcessedMedia | null,
 *   ready: boolean,
 *   xhrs: Set<XMLHttpRequest>,
 *   bytesTotal: number,
 *   bytesByVariant: Record<string, number>,
 * }} InternalItem
 */

/** Canonical Content-Type per sniffed original format (fallback when File.type is blank). */
/** @type {Record<string, string>} */
const FORMAT_MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
}

/** @type {Types.createUploadQueue} */
export function createUploadQueue(callbacks = {}, options = {}) {
  // Admin uploads must present the admin `csrf` cookie (not `guest_csrf`) so the
  // withAccountOrAdmin routes resolve as admin, and pass section:'official' at
  // session create (reconciliation 5 + 7). Both default to the guest path.
  const csrfCookie = options.csrfCookie || CSRF_COOKIE
  const section = options.section
  /** @type {InternalItem[]} */
  const items = []
  let processing = false
  let activeUploads = 0
  let firstSuccessFired = false
  let uid = 0

  /** @param {InternalItem} item */
  function emit(item) {
    if (callbacks.onChange) callbacks.onChange(item)
  }

  /** @param {InternalItem} item @param {Partial<InternalItem>} patch */
  function update(item, patch) {
    Object.assign(item, patch)
    emit(item)
  }

  // The scheduler: at most one item processing, up to N uploading. Called after
  // every state transition; idempotent.
  function pump() {
    if (!processing) {
      const next = items.find((i) => i.state === "queued")
      if (next) {
        processing = true
        runProcessing(next).finally(() => {
          processing = false
          pump()
        })
      }
    }
    while (activeUploads < MAX_UPLOAD_CONCURRENCY) {
      const next = items.find((i) => i.ready && i.state === "processing")
      if (!next) break
      activeUploads += 1
      update(next, { state: "uploading" })
      runUpload(next).finally(() => {
        activeUploads -= 1
        pump()
      })
    }
  }

  /** @param {InternalItem} item */
  async function runProcessing(item) {
    if (item.state !== "queued") return
    update(item, { state: "processing" })
    try {
      // Client-side magic-byte pre-check: a mid-stream server 415 arrives as a
      // socket reset (looks retryable), so reject unsupported files here instead
      // of burning MAX_ATTEMPTS full-size uploads (03 §5).
      const kind = await sniffKind(item.file)
      if (kind === "unknown") {
        return fail(item, "Not a supported format", false)
      }
      item.kind = kind

      const processed = await processMediaFile(item.file)
      item.processed = processed
      item.kind = processed.kind
      item.width = processed.width
      item.height = processed.height
      item.durationS = processed.durationS ?? null
      item.displayMissing = processed.displayMissing === true

      // Tray preview from the derived thumb (image) or poster (video).
      const previewBlob = processed.thumbBlob || processed.posterBlob
      if (previewBlob) {
        item.previewUrl = URL.createObjectURL(previewBlob)
      }
      item.ready = true
      emit(item) // still "processing"; pump() promotes it to "uploading"
    } catch (err) {
      // Processing errors (video too long/large, HEIC undecodable on this device)
      // are about the file itself — not retryable.
      fail(item, processingMessage(err), false)
    }
  }

  /** @param {InternalItem} item */
  async function runUpload(item) {
    const processed = item.processed
    if (!processed) return fail(item, "Upload failed — check connection", true)
    try {
      // 1. Open the session.
      const created = await postJson(
        "/api/media",
        section
          ? { kind: item.kind, originalBytes: item.file.size, section }
          : { kind: item.kind, originalBytes: item.file.size },
        csrfCookie,
      )
      item.serverId = created.id
      item.fileKey = created.fileKey

      // 2. Plan variants: small ones (byte-weighted for progress) upload in
      //    parallel, then the large original last (the retryable tail).
      const small = []
      if (item.kind === "video") {
        if (processed.posterBlob) small.push({ name: "poster", blob: processed.posterBlob })
      } else if (!item.displayMissing) {
        if (processed.thumbBlob) small.push({ name: "thumb", blob: processed.thumbBlob })
        if (processed.displayBlob) small.push({ name: "display", blob: processed.displayBlob })
      }
      const originalType = item.file.type || FORMAT_MIME[await sniffFormat(item.file)] || ""

      item.bytesTotal =
        item.file.size + small.reduce((sum, v) => sum + v.blob.size, 0)
      item.bytesByVariant = {}

      const id = /** @type {number} */ (item.serverId)
      await Promise.all(
        small.map((v) => uploadVariant(item, id, v.name, v.blob, v.blob.type)),
      )
      await uploadVariant(item, id, "original", item.file, originalType)

      // 3. Finalize.
      const finalized = await postJson(
        `/api/media/${id}/finalize`,
        {
          width: item.width,
          height: item.height,
          durationS: item.durationS ?? undefined,
          displayMissing: item.displayMissing || undefined,
        },
        csrfCookie,
      )
      item.status = finalized.status
      update(item, {
        state: finalized.status === "approved" ? "done" : "pending",
        progress: 1,
      })
      if (!firstSuccessFired) {
        firstSuccessFired = true
        if (callbacks.onFirstSuccess) callbacks.onFirstSuccess()
      }
    } catch (err) {
      if (item.state === "canceled") return // remove() already handled it
      const status = err instanceof UploadError ? err.status : 0
      fail(item, uploadMessage(err), !isTerminal(status))
    }
  }

  /**
   * Upload one variant with byte-progress + retry. 403 (rotated CSRF on a stale
   * tab) triggers one immediate retry with a freshly-read cookie before counting
   * an attempt; network / 5xx / 429 back off exponentially up to MAX_ATTEMPTS.
   * @param {InternalItem} item @param {number} id @param {string} variant
   * @param {Blob} blob @param {string} contentType
   */
  async function uploadVariant(item, id, variant, blob, contentType) {
    let attempt = 0
    for (;;) {
      try {
        await putBlob(
          item,
          `/api/media/${id}/${variant}`,
          blob,
          contentType,
          (loaded) => {
            item.bytesByVariant[variant] = loaded
            recomputeProgress(item)
          },
          csrfCookie,
        )
        item.bytesByVariant[variant] = blob.size
        recomputeProgress(item)
        return
      } catch (err) {
        if (err instanceof UploadError && err.status === 403 && !err.csrfRetried) {
          // One free retry: the 403 response refreshed guest_csrf.
          err.csrfRetried = true
          continue
        }
        const status = err instanceof UploadError ? err.status : 0
        attempt += 1
        if (isTerminal(status) || attempt >= MAX_ATTEMPTS) throw err
        await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
  }

  /** @param {InternalItem} item */
  function recomputeProgress(item) {
    if (!item.bytesTotal) return
    let loaded = 0
    for (const v in item.bytesByVariant) loaded += item.bytesByVariant[v]
    update(item, { progress: Math.min(1, loaded / item.bytesTotal) })
  }

  /** @param {InternalItem} item @param {string} message @param {boolean} retryable */
  function fail(item, message, retryable) {
    update(item, { state: "failed", error: message, retryable })
  }

  // ---- public API ----

  return {
    /** @param {FileList | File[]} files */
    add(files) {
      for (const file of Array.from(files)) {
        uid += 1
        /** @type {InternalItem} */
        const item = {
          id: "u" + uid,
          name: file.name || "file",
          kind: "unknown",
          state: "queued",
          progress: 0,
          error: null,
          retryable: false,
          previewUrl: null,
          serverId: null,
          fileKey: null,
          width: 0,
          height: 0,
          durationS: null,
          displayMissing: false,
          status: null,
          file,
          processed: null,
          ready: false,
          xhrs: new Set(),
          bytesTotal: 0,
          bytesByVariant: {},
        }
        items.push(item)
        emit(item)
      }
      pump()
    },

    /** @param {string} id */
    retry(id) {
      const item = items.find((i) => i.id === id)
      if (!item || item.state !== "failed") return
      update(item, {
        state: "queued",
        error: null,
        retryable: false,
        progress: 0,
        ready: false,
        serverId: null,
        fileKey: null,
      })
      pump()
    },

    /** @param {string} id */
    remove(id) {
      const idx = items.findIndex((i) => i.id === id)
      if (idx === -1) return
      const item = items[idx]
      item.state = "canceled"
      for (const xhr of item.xhrs) xhr.abort()
      item.xhrs.clear()
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      items.splice(idx, 1)
    },

    cancelAll() {
      for (const item of items.slice()) this.remove(item.id)
    },

    getItems() {
      return items
    },

    activeCount() {
      return items.filter(
        (i) => i.state === "queued" || i.state === "processing" || i.state === "uploading",
      ).length
    },
  }
}

// ---- transport primitives -------------------------------------------------

/** A failed HTTP exchange carrying the status so callers can decide retryability. */
class UploadError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.name = "UploadError"
    this.status = status
    /** @type {boolean} */
    this.csrfRetried = false
  }
}

/** @param {number} status @returns {boolean} */
function isTerminal(status) {
  return TERMINAL_STATUSES.has(status)
}

/** Read a cookie value by name (fresh each call so rotated CSRF is picked up). */
/** @param {string} name @returns {string} */
function readCookie(name) {
  const pairs = document.cookie.split("; ")
  for (const pair of pairs) {
    const eq = pair.indexOf("=")
    if (eq !== -1 && pair.slice(0, eq) === name) return pair.slice(eq + 1)
  }
  return ""
}

/**
 * POST JSON via XHR (uniform status handling with the blob PUTs). Rejects with
 * an UploadError on any non-2xx or network failure.
 * @param {string} url @param {Record<string, unknown>} payload
 * @param {string} [csrfCookie]
 * @returns {Promise<any>}
 */
function postJson(url, payload, csrfCookie = CSRF_COOKIE) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("X-CSRF-Token", readCookie(csrfCookie))
    xhr.onload = () => {
      const body = parseJson(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) resolve(body)
      else reject(new UploadError(xhr.status, body.error || "Request failed"))
    }
    xhr.onerror = () => reject(new UploadError(0, "Network error"))
    xhr.ontimeout = () => reject(new UploadError(0, "Network error"))
    xhr.send(JSON.stringify(payload))
  })
}

/**
 * PUT a raw blob body with upload progress. Tracks the XHR on the item so
 * remove()/cancelAll() can abort it.
 * @param {InternalItem} item @param {string} url @param {Blob} blob
 * @param {string} contentType @param {(loaded: number) => void} onProgress
 * @param {string} [csrfCookie]
 * @returns {Promise<void>}
 */
function putBlob(item, url, blob, contentType, onProgress, csrfCookie = CSRF_COOKIE) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    item.xhrs.add(xhr)
    xhr.open("PUT", url)
    if (contentType) xhr.setRequestHeader("Content-Type", contentType)
    xhr.setRequestHeader("X-CSRF-Token", readCookie(csrfCookie))
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded)
    }
    xhr.onload = () => {
      item.xhrs.delete(xhr)
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        const body = parseJson(xhr.responseText)
        reject(new UploadError(xhr.status, body.error || "Upload failed"))
      }
    }
    xhr.onerror = () => {
      item.xhrs.delete(xhr)
      reject(new UploadError(0, "Network error"))
    }
    xhr.onabort = () => {
      item.xhrs.delete(xhr)
      reject(new UploadError(0, "Canceled"))
    }
    xhr.send(blob)
  })
}

/** @param {string} text @returns {any} */
function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

/** @param {number} ms @returns {Promise<void>} */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---- client-side sniff (pre-check) ----------------------------------------

/**
 * Classify a file by magic bytes as image/video/unknown. Authoritative sniffing
 * happens server-side (core/sniff.js); this only avoids doomed retry loops.
 * @param {File} file @returns {Promise<"image" | "video" | "unknown">}
 */
async function sniffKind(file) {
  const format = await sniffFormat(file)
  if (format === "jpeg" || format === "png" || format === "webp" || format === "heic") {
    return "image"
  }
  if (format === "mp4" || format === "mov") return "video"
  return "unknown"
}

const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1",
])

/**
 * Return the sniffed original format, or "" if unrecognized.
 * @param {File} file @returns {Promise<string>}
 */
async function sniffFormat(file) {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (buf.length < 12) return ""
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg"
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "png"
  }
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "webp"
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4)
    if (HEIC_BRANDS.has(brand)) return "heic"
    if (brand === "qt  ") return "mov"
    return "mp4" // isom/mp4x/3gpN and friends — server does the exact allowlist
  }
  return ""
}

/** @param {Uint8Array} buf @param {number} off @param {number} len @returns {string} */
function ascii(buf, off, len) {
  let s = ""
  for (let i = 0; i < len; i++) s += String.fromCharCode(buf[off + i])
  return s
}

// ---- error copy -----------------------------------------------------------

/** @param {unknown} err @returns {string} */
function processingMessage(err) {
  return err instanceof Error && err.message
    ? err.message
    : "This file type isn't supported on your device — try uploading from Photos as JPEG"
}

/** @param {unknown} err @returns {string} */
function uploadMessage(err) {
  if (err instanceof UploadError) {
    if (err.status === 413) return "File too large"
    if (err.status === 415) return "Not a supported format"
    if (err.status === 507) return "Storage is full — please try later"
    if (err.status === 401) return "Please sign in again to upload"
  }
  return "Upload failed — check connection"
}
