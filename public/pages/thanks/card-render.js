/** @file Pure card render module — populates a card's DOM from card data with no
 *  fetching, no animation, no theme side effects. Kept standalone so the future
 *  thanks-preview page (admin live preview) can import the exact same rendering.
 *
 *  The message is split into per-word spans (String.split on spaces — no regex)
 *  so thanks.css can cascade them in on the `message` reveal stage. Photos become
 *  polaroids with a fanned --rot so the stack reads as a hand-laid pile. */
/** @import * as Types from "./types.js" */

/** Degrees of fan between adjacent polaroids in the stack. */
const FAN_SPREAD = 6

/** @type {typeof Types.firstNameOf} */
export function firstNameOf(name) {
  if (!name) return ""
  const trimmed = name.trim()
  if (!trimmed) return ""
  // First whitespace-delimited token (no regex — indexOf on the first space).
  const sp = trimmed.indexOf(" ")
  return sp === -1 ? trimmed : trimmed.slice(0, sp)
}

/** @type {typeof Types.coupleInitials} */
export function coupleInitials(coupleName) {
  if (!coupleName) return null
  const name = coupleName.trim()
  if (!name) return null
  // Locate the "&" or a standalone " and " joining the two names. No regex: an
  // explicit ampersand wins, else the lowercased needle " and " (padded with
  // spaces so "Amanda"/"Roland" etc. can't false-match an internal "and").
  let sep = -1
  let sepLen = 0
  const amp = name.indexOf("&")
  if (amp !== -1) {
    sep = amp
    sepLen = 1
  } else {
    const andIdx = name.toLowerCase().indexOf(" and ")
    if (andIdx !== -1) {
      sep = andIdx
      sepLen = 5
    }
  }
  if (sep === -1) return null
  const left = name.slice(0, sep).trim()
  const right = name.slice(sep + sepLen).trim()
  if (!left || !right) return null
  const a = left[0]
  const b = right[0]
  if (!a || !b) return null
  return a.toUpperCase() + "&" + b.toUpperCase()
}

/** @type {typeof Types.setEnvelopeName} */
export function setEnvelopeName(envelopeEl, recipientName) {
  const el = envelopeEl.querySelector(".tc-envelope-name")
  if (!(el instanceof HTMLElement)) return
  const first = firstNameOf(recipientName)
  el.textContent = first
  // Feed the length to CSS so the script hand scales down for long names (with
  // an ellipsis as the ultimate fallback). Hide the line entirely when empty.
  el.style.setProperty("--tc-name-len", String(first.length || 1))
  el.hidden = first.length === 0
}

/** @type {typeof Types.setSealMonogram} */
export function setSealMonogram(sealEl, coupleName) {
  const initials = coupleInitials(coupleName)
  if (initials) {
    sealEl.textContent = initials
    sealEl.classList.add("tc-seal-monogram")
  } else {
    // Underivable (e.g. a single name, or the "the hosts" default) — keep the
    // generic love-letter glyph and its plain treatment.
    sealEl.textContent = "💌"
    sealEl.classList.remove("tc-seal-monogram")
  }
}

/**
 * Build one polaroid figure for a media item. Images use the `display` variant;
 * videos render in place as a real <video controls> with a poster; images that
 * never got a display variant (needs_display) show a neutral placeholder tile.
 * @param {Types.ThankYouMediaItem} item
 * @param {number} idx @param {number} total
 * @returns {HTMLElement}
 */
function buildPolaroid(item, idx, total) {
  const fig = document.createElement("figure")
  fig.className = "tc-polaroid"
  // Fan around the stack's center; a little jitter keeps it from looking mechanical.
  const base = total > 1 ? (idx - (total - 1) / 2) * FAN_SPREAD : 0
  const jitter = (Math.random() - 0.5) * 3
  fig.style.setProperty("--rot", base + jitter + "deg")
  fig.style.setProperty("--i", String(idx))

  /** @type {HTMLElement} */
  let media
  if (item.kind === "video") {
    const video = document.createElement("video")
    video.className = "tc-polaroid-media"
    video.controls = true
    video.preload = "none"
    video.playsInline = true
    video.poster = "/media/" + item.file_key + "/poster"
    const source = document.createElement("source")
    source.src = "/media/" + item.file_key + "/video"
    video.appendChild(source)
    media = video
  } else if (item.needs_display) {
    // A photo the client couldn't derive a display variant for (e.g. desktop
    // HEIC) — the display/thumb files legitimately don't exist. Show a tile.
    const ph = document.createElement("div")
    ph.className = "tc-polaroid-media tc-polaroid-placeholder"
    ph.setAttribute("role", "img")
    ph.setAttribute("aria-label", "Photo")
    media = ph
  } else {
    const img = document.createElement("img")
    img.className = "tc-polaroid-media"
    img.src = "/media/" + item.file_key + "/display"
    img.alt = ""
    img.loading = "lazy"
    img.decoding = "async"
    media = img
  }
  fig.appendChild(media)

  // The classic white caption strip beneath the photo (decorative; no caption
  // text is exposed on the public card surface).
  const strip = document.createElement("figcaption")
  strip.className = "tc-polaroid-caption"
  strip.setAttribute("aria-hidden", "true")
  fig.appendChild(strip)

  return fig
}

/** @type {typeof Types.applyCardContent} */
export function applyCardContent(rootEl, content) {
  const recipient = rootEl.querySelector("#tc-recipient")
  if (recipient) recipient.textContent = content.recipientName || "friend"

  const messageEl = rootEl.querySelector("#tc-message")
  if (messageEl) {
    messageEl.textContent = ""
    // Split on spaces (no regex); drop the empties that runs of spaces make.
    const words = content.message
      ? content.message.split(" ").filter((w) => w.length > 0)
      : []
    // Cap the whole cascade at ~1.5s regardless of length: a 330-word message
    // would otherwise trail out for 18s and defeat Skip. Pre-multiply the delay
    // per span so CSS just reads a ready value.
    const stepMs = words.length > 0 ? Math.min(55, 1500 / words.length) : 55
    words.forEach((word, index) => {
      const span = document.createElement("span")
      span.className = "tc-word"
      span.style.setProperty("--tc-word-delay", Math.round(index * stepMs) + "ms")
      // Word-settle: a hair of random rotation (~±0.5°) so the ink looks laid by
      // hand as each word eases down onto the paper. Neutralized under reduced
      // motion (the CSS zeroes the transform there).
      const rot = (Math.random() - 0.5).toFixed(2)
      span.style.setProperty("--tc-word-rot", rot + "deg")
      span.textContent = word
      messageEl.appendChild(span)
      // A real whitespace node between words so line-wrapping stays natural.
      messageEl.appendChild(document.createTextNode(" "))
    })
  }

  // Sign-off flourish ("— <couple>"). Optional: when no name is supplied (e.g.
  // the composer preview, whose postMessage sender may not carry one yet) hide
  // the line so a message ending "…gratitude," doesn't preview a dangling comma.
  const signoff = rootEl.querySelector("#tc-signoff")
  const signoffText = rootEl.querySelector("#tc-signoff-text")
  if (signoff instanceof HTMLElement && signoffText instanceof HTMLElement) {
    const couple = content.coupleName
    if (couple) {
      signoffText.textContent = "— " + couple
      signoff.hidden = false
    } else {
      signoffText.textContent = ""
      signoff.hidden = true
    }
  }

  const photosEl = rootEl.querySelector("#tc-photos")
  if (photosEl instanceof HTMLElement) {
    photosEl.textContent = ""
    const media = content.media || []
    photosEl.hidden = media.length === 0
    media.forEach((item, idx) => {
      photosEl.appendChild(buildPolaroid(item, idx, media.length))
    })
  }
}
