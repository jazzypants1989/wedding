/** @file thanks-preview/main.js — Types for the admin composer's live-preview
 *  iframe. The page renders purely from postMessage; these mirror the parent →
 *  child message contract (see public/pages/admin/thank-you.js). */

import type { ThankYouMediaItem, CardEffectEntry } from "../thanks/types.js"

/** parent → child: render this composed card. `message` is already {name}-
 *  substituted by the parent; `reveal` is carried for completeness but the
 *  composition preview shows the card fully revealed (no one-shot). */
export interface CardPreviewPayload {
  themeId: string
  recipientName: string
  message: string
  reveal: string
  effects: CardEffectEntry[]
  mediaItems: ThankYouMediaItem[]
  /** The couple's sign-off name. Optional: the composer's sender may not carry it
   *  yet, in which case the preview hides the sign-off line. */
  coupleName?: string
}

/** parent → child message. */
export interface CardPreviewMessage {
  type: "card:preview"
  payload: CardPreviewPayload
}

/** child → parent handshake, posted once the page is ready to receive pushes. */
export interface CardPreviewReadyMessage {
  type: "card:preview-ready"
}

/** parent → child: reset the preview to sealed and run the full reveal
 *  choreography once with the given one-shot ("none" → no burst). E1. */
export interface CardPlayRevealMessage {
  type: "card:play-reveal"
  reveal: string
}
