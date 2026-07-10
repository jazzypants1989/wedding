/** @file Client-side media processing: resize/encode images and extract a video
 *  poster frame in the browser before upload. Zero-dep, no regex. Consumed by
 *  Phase 4's uploader via the processMediaFile() contract. Originals are never
 *  re-encoded here (EXIF is stripped server-side / by the canvas re-encode of
 *  the derived variants). See docs/post-wedding/03-media-pipeline.md §5. */

const MAX_VIDEO_BYTES = 100 * 1024 * 1024 // 100 MB
const MAX_VIDEO_DURATION_S = 60
const POSTER_MAX_EDGE = 2000

// Default image variants for gallery (guest/official) uploads: the ≤2000px
// display + ≤400px thumb. Content-section uploads pass their own responsive
// ladder instead (see types.js CONTENT_IMAGE_LADDER + site-content.js).
/** @type {import('./types.js').ImageVariantSpec[]} */
const DEFAULT_IMAGE_VARIANTS = [
  { name: "display", maxEdge: 2000, quality: 0.82 },
  { name: "thumb", maxEdge: 400, quality: 0.7 },
]

/**
 * Process one image or video file into upload-ready derived variants. `imageVariants`
 * overrides which sizes are produced for images (defaults to display+thumb).
 * @param {File} file
 * @param {import('./types.js').ImageVariantSpec[]} [imageVariants]
 * @returns {Promise<import('./types.js').ProcessedMedia>}
 */
export async function processMediaFile(file, imageVariants) {
  const type = file.type || ""
  if (type.startsWith("video/")) return processVideo(file)
  return processImage(file, imageVariants)
}

// --- Images ---

/**
 * @param {File} file
 * @param {import('./types.js').ImageVariantSpec[]} [variantSpecs]
 * @returns {Promise<import('./types.js').ProcessedMedia>}
 */
async function processImage(file, variantSpecs) {
  const specs = variantSpecs && variantSpecs.length ? variantSpecs : DEFAULT_IMAGE_VARIANTS
  let bitmap
  try {
    // imageOrientation:"from-image" bakes EXIF orientation into the pixels so
    // the re-encoded (EXIF-stripped) variants aren't sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    // Desktop Chrome cannot decode HEIC. Resolve original-only: the server sets
    // needs_display=1 and the gallery shows a placeholder. Rare in practice —
    // iOS's Photos picker hands the page a JPEG for HEIC (raw HEIC only arrives
    // via the Files app) and Safari 17+ decodes HEIC in-page — so this mostly
    // serves Android-HEIC and Files-app uploads viewed on Chrome. All derived
    // variants share this one decode, so none are produced. Don't "optimize" away.
    return { kind: "image", displayMissing: true, width: 0, height: 0 }
  }

  const width = bitmap.width
  const height = bitmap.height
  /** @type {import('./types.js').ProcessedVariant[]} */
  const variants = []
  /** @type {Blob | undefined} */
  let previewBlob
  let previewEdge = Infinity
  for (const spec of specs) {
    const blob = await encodePreferWebp(
      scaledCanvas(bitmap, width, height, spec.maxEdge),
      spec.quality,
    )
    if (!blob) continue
    variants.push({ name: spec.name, blob })
    // Tray preview uses the smallest produced variant.
    if (spec.maxEdge < previewEdge) {
      previewEdge = spec.maxEdge
      previewBlob = blob
    }
  }
  if (bitmap.close) bitmap.close()
  return { kind: "image", variants, previewBlob, width, height }
}

/**
 * Draw a source onto a canvas scaled to fit within maxEdge (never upscales).
 * @param {CanvasImageSource} source
 * @param {number} srcW @param {number} srcH @param {number} maxEdge
 * @returns {HTMLCanvasElement}
 */
function scaledCanvas(source, srcW, srcH, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (ctx) ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

/**
 * Encode a canvas, preferring WebP (smaller) with a JPEG fallback. The server
 * accepts both for display/thumb.
 * @param {HTMLCanvasElement} canvas @param {number} quality
 * @returns {Promise<Blob | undefined>}
 */
async function encodePreferWebp(canvas, quality) {
  const webp = await canvasToBlob(canvas, "image/webp", quality)
  // Browsers that don't support webp encode fall back to png silently — detect
  // via the returned type and use an explicit jpeg instead.
  if (webp && webp.type === "image/webp") return webp
  return canvasToBlob(canvas, "image/jpeg", quality)
}

/**
 * @param {HTMLCanvasElement} canvas @param {string} type @param {number} quality
 * @returns {Promise<Blob | undefined>}
 */
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || undefined), type, quality)
  })
}

// --- Videos ---

/**
 * @param {File} file
 * @returns {Promise<import('./types.js').ProcessedMedia>}
 */
async function processVideo(file) {
  // No client transcode — enforce the caps up front with a clear message.
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("Videos must be under 100 MB.")
  }
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement("video")
    video.preload = "metadata" // MANDATORY for blob: URLs or metadata never loads
    video.muted = true
    video.playsInline = true
    video.src = url
    await once(video, "loadedmetadata")

    const durationS = video.duration
    if (!isFinite(durationS) || durationS <= 0) {
      throw new Error("Couldn't read that video — try a different file.")
    }
    if (durationS > MAX_VIDEO_DURATION_S) {
      throw new Error("Videos must be 60 seconds or shorter.")
    }
    const width = video.videoWidth
    const height = video.videoHeight
    const posterBlob = await extractPoster(video, durationS, width, height)
    return { kind: "video", posterBlob, width, height, durationS }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Grab a representative frame. iOS-verified: `seeked` fires before the frame is
 * paintable, so we settle a couple of rAFs and verify the canvas isn't blank,
 * retrying once with a longer settle.
 * @param {HTMLVideoElement} video @param {number} durationS
 * @param {number} width @param {number} height
 * @returns {Promise<Blob | undefined>}
 */
async function extractPoster(video, durationS, width, height) {
  const t = Math.min(0.5, durationS / 2)
  let blob = await grabFrame(video, t, width, height, false)
  if (!blob) blob = await grabFrame(video, t, width, height, true)
  return blob
}

/**
 * @param {HTMLVideoElement} video @param {number} t
 * @param {number} width @param {number} height @param {boolean} extraSettle
 * @returns {Promise<Blob | undefined>}
 */
async function grabFrame(video, t, width, height, extraSettle) {
  video.currentTime = t
  await once(video, "seeked")
  await rafDelay(extraSettle ? 4 : 2)
  const canvas = scaledCanvas(video, width, height, POSTER_MAX_EDGE)
  const ctx = canvas.getContext("2d")
  if (ctx && isCanvasBlank(ctx, canvas.width, canvas.height)) return undefined
  return canvasToBlob(canvas, "image/jpeg", 0.8)
}

/**
 * Sample a few points; a poster is "blank" when every sample is essentially
 * black (iOS occasionally paints a black frame right after seeked).
 * @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h
 * @returns {boolean}
 */
function isCanvasBlank(ctx, w, h) {
  const points = [
    [w >> 1, h >> 1],
    [w >> 2, h >> 2],
    [(w * 3) >> 2, h >> 2],
    [w >> 2, (h * 3) >> 2],
    [(w * 3) >> 2, (h * 3) >> 2],
  ]
  let maxChannel = 0
  for (const [x, y] of points) {
    const d = ctx.getImageData(Math.min(x, w - 1), Math.min(y, h - 1), 1, 1).data
    maxChannel = Math.max(maxChannel, d[0], d[1], d[2])
  }
  return maxChannel < 8
}

// --- Small DOM helpers ---

/**
 * Resolve on the given media event, reject on "error".
 * @param {HTMLMediaElement} el @param {string} event
 * @returns {Promise<void>}
 */
function once(el, event) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error("Media element error"))
    }
    const cleanup = () => {
      el.removeEventListener(event, onOk)
      el.removeEventListener("error", onErr)
    }
    el.addEventListener(event, onOk, { once: true })
    el.addEventListener("error", onErr, { once: true })
  })
}

/**
 * Await `n` animation frames (~16ms each).
 * @param {number} n @returns {Promise<void>}
 */
function rafDelay(n) {
  return new Promise((resolve) => {
    let remaining = n
    const step = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}
