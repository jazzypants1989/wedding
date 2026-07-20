/** @file Thank-you card page entry point. Parses ?card=TOKEN, fetches the public
 *  card, applies the paper theme + ambient palette, renders the content, and
 *  orchestrates the reveal + reply. A missing/expired/unknown token lands on the
 *  warm fallback instead of an error. */
/** @import * as Types from "./types.js" */

import { initMobileNav } from "../../components/mobile-nav.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { api, getElement, getTypedElement, getCoupleName, shareUrl } from "../utils.js"
import { prefersReducedMotion } from "../../effects/effect-utils.js"
import {
  fireConfetti,
  champagnePop,
  heartBurst,
  miniSparkle,
  sealBreak,
} from "../../components/celebrate.js"
import { applyCardContent, setEnvelopeName, setSealMonogram } from "./card-render.js"
import { applyCardTheme, resolveCardTheme } from "./card-themes.js"
import { startCardEffects } from "./card-effects.js"
import { playReveal } from "./reveal.js"
import { initReply } from "./reply.js"
import { saveKeepsake } from "./keepsake.js"

initMobileNav()
initThemeToggle()

void boot()

async function boot() {
  const loading = getElement("tc-loading")
  const errorEl = getElement("tc-error")

  const params = new URLSearchParams(location.search)
  const token = params.get("card")
  if (!token) {
    showFallback(loading, errorEl)
    return
  }

  try {
    const card = /** @type {Types.PublicCard} */ (
      await api("/api/thank-you/" + encodeURIComponent(token))
    )
    loading.hidden = true
    render(card, token)
  } catch {
    // Expired, unknown, or draft token — all resolve to the same gentle fallback.
    showFallback(loading, errorEl)
  }
}

/** @param {HTMLElement} loading @param {HTMLElement} errorEl */
function showFallback(loading, errorEl) {
  loading.hidden = true
  errorEl.hidden = false
  // The fallback silently replaces the loading node — move focus into it (it's a
  // role="status" live region) so screen-reader + keyboard users hear the change
  // and land on the actionable copy instead of a stray body focus.
  errorEl.focus()
}

/**
 * @param {Types.PublicCard} card @param {string} token
 */
function render(card, token) {
  const scene = getElement("tc-scene")
  const cardEl = getElement("tc-card")
  const envelope = getTypedElement("tc-envelope", HTMLButtonElement)
  const replyEl = getElement("tc-reply")

  // Paper theme (inline --tc-* vars) + ambient particle palette (effect theme).
  applyCardTheme(document.documentElement, card.theme)
  document.documentElement.dataset.effectTheme = card.theme
  // The card accent single-sources the theme-matched one-shot burst colour.
  const accent = resolveCardTheme(card.theme).accent

  // Content + sign-off flourish ("— <couple>", revealed after the message
  // cascade). card-render owns the sign-off so the composer preview shares it.
  const coupleName = getCoupleName()

  applyCardContent(cardEl, {
    recipientName: card.recipient_name,
    message: card.message,
    media: card.media,
    coupleName,
  })

  // Personalize the sealed envelope front: the recipient's first name in the
  // script hand, and the couple's monogram stamped into the wax (falls back to
  // 💌 when initials can't be derived).
  setEnvelopeName(envelope, card.recipient_name)
  const sealEl = envelope.querySelector(".tc-seal")
  if (sealEl instanceof HTMLElement) setSealMonogram(sealEl, coupleName)

  scene.hidden = false

  const reduced = prefersReducedMotion()
  const cfg = card.effects_config || {}
  const revealMoment = typeof cfg.reveal === "string" ? cfg.reveal : null
  const effectsList = Array.isArray(cfg.effects) ? cfg.effects : []

  // Read-only share view: a forwardee opened a share link. The reveal + effects
  // still play in full, but there's no reply UI, no open beacon, and no re-share.
  // `canReply` absent (older backend) → treat as the primary, reply-capable view.
  const canReply = card.canReply !== false

  // The latest reply, kept across a replay so re-opening shows the Sent state
  // (not a fresh form). Seeded from the card's reply at load, updated on send.
  let currentReply = card.reply

  const controller = playReveal(scene, {
    envelopeEl: envelope,
    reduced,
    // Beacon fires on the real open — only for the reply-capable primary view
    // (share tokens 404 the beacon endpoint anyway).
    onOpen: canReply ? () => onEnvelopeOpen(token) : undefined,
    onReveal: (origin) => fireRevealMoment(revealMoment, origin, accent),
    onOpened: () => cardEl.focus(),
    onAmbient: () => startCardEffects(effectsList),
    onReply: canReply
      ? () =>
          initReply(replyEl, {
            token,
            reply: currentReply,
            onSent: (reply) => {
              currentReply = reply
            },
          })
      : undefined,
  })

  // Skip and Replay both hide the button that was just activated (display:none at
  // their respective stages), which would dump focus to <body>. Hop focus onto
  // the card — the same landing spot onOpened uses — so keyboard/SR users keep a
  // place to stand. #tc-card carries tabindex="-1"; programmatic focus follows
  // the browser's :focus-visible heuristic, so pointer users get no ring flash.
  getTypedElement("tc-skip", HTMLButtonElement).addEventListener("click", () => {
    controller.skip()
    cardEl.focus()
  })
  getTypedElement("tc-replay", HTMLButtonElement).addEventListener("click", () => {
    controller.replay()
    cardEl.focus()
  })

  const shareBtn = getTypedElement("tc-share", HTMLButtonElement)
  if (canReply) {
    // Share the read-only link (shareToken), never the reply-capable one in the
    // address bar. Absent shareToken (backend not landed) → share the URL as-is.
    const shareTarget =
      typeof card.shareToken === "string" && card.shareToken
        ? location.origin + "/thanks?card=" + encodeURIComponent(card.shareToken)
        : location.href
    shareBtn.addEventListener("click", () => void shareCard(shareBtn, shareTarget))
  } else {
    // A forwardee shouldn't re-share the link they were handed.
    shareBtn.hidden = true
  }

  // Keepsake: a canvas-rendered memento offered in BOTH the primary and the
  // read-only share view (it carries no token, so a forwardee may keep it too).
  const keepsakeBtn = getTypedElement("tc-keepsake", HTMLButtonElement)
  keepsakeBtn.addEventListener("click", () =>
    void saveKeepsake(keepsakeBtn, {
      themeId: card.theme,
      recipientName: card.recipient_name,
      message: card.message,
      coupleName,
      media: card.media,
    }),
  )

  // Fast path: a returning visitor (viewed_at set) skips the sealed-envelope gate
  // and lands on the fully-revealed card; the "Replay ↻" control replays the full
  // reveal. A #tc-reply deep-link auto-opens too (even first visit) and drops the
  // guest on the reply form. First-ever open with no deep-link keeps the sealed
  // experience.
  const wantsReply = location.hash === "#tc-reply"
  if (card.viewed_at || wantsReply) {
    // Count the open as the normal path would, minus the tap. Share tokens skip
    // this (canReply === false), matching the beacon-gating above.
    if (canReply) onEnvelopeOpen(token)
    controller.skip()
    if (wantsReply && canReply) focusReply(replyEl)
    else cardEl.focus()
  }
}

/**
 * Land the guest on the reply form: scroll it into view and focus the first
 * control (the note textarea when the form is showing, else the reply's first
 * button). Runs after controller.skip() has mounted the reply UI.
 * @param {HTMLElement} replyEl
 */
function focusReply(replyEl) {
  replyEl.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  })
  const textarea = replyEl.querySelector("#tc-reply-text")
  if (textarea instanceof HTMLElement) {
    textarea.focus()
    return
  }
  const firstBtn = replyEl.querySelector("button")
  if (firstBtn instanceof HTMLElement) firstBtn.focus()
}

/**
 * The real envelope-open beat: a soft haptic tick + the fire-and-forget view
 * beacon. Never blocks the reveal; a 404 (unknown/rotated token) is swallowed.
 * @param {string} token
 */
function onEnvelopeOpen(token) {
  navigator.vibrate?.(10)
  try {
    void fetch("/api/thank-you/" + encodeURIComponent(token) + "/opened", {
      method: "POST",
      keepalive: true,
    }).catch((err) => console.debug("open beacon failed", err))
  } catch (err) {
    console.debug("open beacon failed", err)
  }
}

/**
 * Keepsake share: hand the (read-only) card link to the native share sheet, else
 * copy it. `url` is the share-token link when the backend supplied one.
 * @param {HTMLButtonElement} btn @param {string} url
 */
async function shareCard(btn, url) {
  const prev = btn.textContent
  const result = await shareUrl(url)
  if (result === "shared") return
  btn.textContent = result === "copied" ? "Link copied!" : "Press ⌘/Ctrl+C"
  setTimeout(() => {
    btn.textContent = prev
  }, 1600)
}

/**
 * Fire the authored reveal one-shot at the opening beat, plus a sparkle at the
 * seal — in the card's own accent colour. `reveal: "none"` is the quiet option:
 * no burst, no sparkle. Every one-shot self-gates under reduced motion, so this
 * is only ever called on the full-motion path anyway.
 * @param {string | null} moment @param {HTMLElement} origin @param {string} accent
 */
function fireRevealMoment(moment, origin, accent) {
  // The wax physically breaks on every full-motion open (the CSS crack draws at
  // the same beat) — fired before the celebration flavour, independent of it, so
  // even the quiet "none" reveal still shatters its seal. Self-gates on reduced
  // motion, where onReveal never runs anyway (the seal just fades).
  sealBreak(origin, accent)
  if (moment === "none") return
  miniSparkle(origin)
  if (moment === "champagne") champagnePop(origin, accent)
  else if (moment === "hearts") heartBurst(origin, accent)
  else fireConfetti(accent)
}
