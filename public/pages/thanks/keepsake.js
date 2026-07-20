/** @file Keepsake image — renders the thank-you card onto an off-screen canvas
 *  (~1080×1350 portrait) and hands it off as a downloadable / shareable PNG. It
 *  is a static memento (theme tones + greeting + word-wrapped message + one
 *  polaroid photo + the sign-off + a small flourish), so it carries no token and
 *  is safe to offer in the read-only share view too.
 *
 *  Export path: canvas.toBlob → navigator.share({ files }) when the platform can
 *  share files, else an <a download> fallback. No regex, string-method word wrap. */
/** @import * as Types from "./types.js" */

import { resolveCardTheme } from "./card-themes.js"

const KEEPSAKE_W = 1080
const KEEPSAKE_H = 1350
const MARGIN = 96

/** Canvas font stacks — the site's families with plain fallbacks. */
const DISPLAY_FONT = '"DM Serif Display", Georgia, serif'
const BODY_FONT = '"Jost", system-ui, sans-serif'

/** @type {typeof Types.saveKeepsake} */
export async function saveKeepsake(button, data) {
  const label = button.textContent
  button.disabled = true
  button.textContent = "Saving…"
  try {
    const theme = resolveCardTheme(data.themeId)
    // Load the photo first so the layout knows whether to reserve a band for it.
    const photo = await loadFirstPhoto(data.media)
    // Let the web fonts settle so the canvas draws in the real families, not a
    // fallback that reflows the wrap. Best-effort — never blocks on failure.
    if (typeof document !== "undefined" && document.fonts) {
      try {
        await document.fonts.ready
      } catch {
        // Font loading API hiccup — draw with whatever's available.
      }
    }
    const blob = await renderToBlob(data, theme, photo)
    if (blob) await offerBlob(blob)
  } catch (err) {
    console.error("Keepsake render failed:", err)
  } finally {
    button.disabled = false
    button.textContent = label
  }
}

/** Load the first same-origin display photo in the card, or null when there's
 *  none / it fails to load. @param {Types.ThankYouMediaItem[]} media */
function loadFirstPhoto(media) {
  const items = Array.isArray(media) ? media : []
  /** @type {Types.ThankYouMediaItem | null} */
  let target = null
  for (const m of items) {
    if (m && m.kind === "image" && !m.needs_display) {
      target = m
      break
    }
  }
  if (!target) return Promise.resolve(null)
  return loadImage("/media/" + target.file_key + "/display")
}

/** @param {string} url @returns {Promise<HTMLImageElement | null>} */
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = "async"
    // Media is same-origin, so the canvas stays untainted with no crossorigin.
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** @param {Types.KeepsakeData} data @param {Types.CardTheme} theme
 *  @param {HTMLImageElement | null} photo @returns {Promise<Blob | null>} */
function renderToBlob(data, theme, photo) {
  const canvas = document.createElement("canvas")
  canvas.width = KEEPSAKE_W
  canvas.height = KEEPSAKE_H
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)
  drawKeepsake(ctx, data, theme, photo)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png")
  })
}

/** @param {CanvasRenderingContext2D} ctx @param {Types.KeepsakeData} data
 *  @param {Types.CardTheme} theme @param {HTMLImageElement | null} photo */
function drawKeepsake(ctx, data, theme, photo) {
  const W = KEEPSAKE_W
  const H = KEEPSAKE_H
  const M = MARGIN

  // Paper ground + a thin accent frame (offset .5px for a crisp 1px-aligned line).
  ctx.fillStyle = theme.paper
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 3
  ctx.strokeRect(40.5, 40.5, W - 80, H - 80)

  ctx.textAlign = "left"
  ctx.textBaseline = "top"

  // Greeting.
  const name = (data.recipientName && data.recipientName.trim()) || "friend"
  ctx.fillStyle = theme.ink
  ctx.font = "italic 54px " + DISPLAY_FONT
  ctx.fillText("Dear " + name + ",", M, 150)

  // Message block — word-wrapped, clamped so the photo + sign-off always fit.
  const reservedBottom = 300
  const photoBoxH = photo ? 518 : 0
  const photoGap = photo ? 44 : 0
  const messageTop = 250
  const lineHeight = 48
  const messageAreaBottom = H - reservedBottom - photoBoxH - photoGap
  const maxLines = Math.max(1, Math.floor((messageAreaBottom - messageTop) / lineHeight))

  ctx.font = "30px " + BODY_FONT
  ctx.fillStyle = theme.ink
  const lines = clampLines(wrapLines(ctx, data.message || "", W - 2 * M), maxLines)
  let y = messageTop
  for (const line of lines) {
    ctx.fillText(line, M, y)
    y += lineHeight
  }

  // One polaroid photo, anchored just above the reserved bottom band.
  if (photo) {
    const cx = W / 2
    const cy = messageAreaBottom + photoGap + photoBoxH / 2
    drawPolaroid(ctx, photo, cx, cy)
  }

  // Sign-off, bottom-right like a signature.
  const couple = data.coupleName && data.coupleName.trim()
  if (couple) {
    ctx.textAlign = "right"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = theme.accent
    ctx.font = "italic 40px " + DISPLAY_FONT
    ctx.fillText("— " + couple, W - M, H - 200)
  }

  // Footer flourish: a short accent rule split by a filled dot.
  drawFlourish(ctx, W / 2, H - 130, theme.accent)

  ctx.textAlign = "left"
  ctx.textBaseline = "top"
}

/** Wrap `text` to lines no wider than `maxWidth`. String methods only.
 *  @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} maxWidth
 *  @returns {string[]} */
function wrapLines(ctx, text, maxWidth) {
  const words = (text || "").split(" ").filter((w) => w.length > 0)
  /** @type {string[]} */
  const lines = []
  let line = ""
  for (const word of words) {
    const test = line ? line + " " + word : word
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Cap the line count, tucking an ellipsis onto the last kept line.
 *  @param {string[]} lines @param {number} maxLines @returns {string[]} */
function clampLines(lines, maxLines) {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = kept[maxLines - 1] + "…"
  return kept
}

/** Draw a slightly-tilted white polaroid with the photo cover-cropped inside.
 *  @param {CanvasRenderingContext2D} ctx @param {HTMLImageElement} img
 *  @param {number} cx @param {number} cy */
function drawPolaroid(ctx, img, cx, cy) {
  const boxW = 480
  const pad = 22
  const strip = 60
  const innerW = boxW - 2 * pad
  const innerH = innerW
  const boxH = pad + innerH + strip

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-3 * Math.PI) / 180)

  ctx.shadowColor = "rgba(0, 0, 0, 0.22)"
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 10
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH)
  ctx.shadowColor = "transparent"
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  // Cover-crop the source so the square window is fully filled, centered.
  const dx = -boxW / 2 + pad
  const dy = -boxH / 2 + pad
  const scale = Math.max(innerW / img.width, innerH / img.height)
  const sw = innerW / scale
  const sh = innerH / scale
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, innerW, innerH)

  ctx.restore()
}

/** @param {CanvasRenderingContext2D} ctx @param {number} cx @param {number} cy
 *  @param {string} accent */
function drawFlourish(ctx, cx, cy, accent) {
  ctx.save()
  ctx.strokeStyle = accent
  ctx.fillStyle = accent
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - 90, cy)
  ctx.lineTo(cx - 16, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + 16, cy)
  ctx.lineTo(cx + 90, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Offer the PNG: the native share sheet with the file when supported, else a
 *  plain download. A cancelled share is respected (no forced download).
 *  @param {Blob} blob */
async function offerBlob(blob) {
  const file = new File([blob], "thank-you-card.png", { type: "image/png" })
  if ("canShare" in navigator && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "A thank-you card" })
      return
    } catch (err) {
      // User dismissed the share sheet — don't fall through to a download.
      if (err instanceof DOMException && err.name === "AbortError") return
      // Any other share failure → fall back to the download path below.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "thank-you-card.png"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
