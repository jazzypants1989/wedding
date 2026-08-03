/** @file Declarative route registration and dispatch */
/** @import * as Types from './types.js' */

import { sendJson } from "./http.js"
import { withErrorHandling, withAdmin, withAccount, withAccountOrAdmin } from "./auth.js"
import * as health from "../api/health.js"
import * as config from "../api/config.js"
import * as rsvp from "../api/rsvp.js"
import * as lookup from "../api/lookup.js"
import * as thankYou from "../api/thank-you.js"
import * as sessions from "../api/admin/sessions.js"
import {
  stats,
  list,
  invitableIds,
  create,
  update,
  remove,
  restore,
} from "../api/guests/data.js"
import { exportCSV } from "../api/guests/export.js"
import { importCSV } from "../api/guests/import.js"
import * as rsvps from "../api/admin/rsvps.js"
import * as invites from "../api/admin/invites.js"
import * as petitions from "../api/admin/petitions.js"
import * as adminThankYou from "../api/admin/thank-you.js"
import * as blocklist from "../api/admin/blocklist.js"
import * as manualSms from "../api/admin/manual-sms.js"
import * as account from "../api/account.js"
import * as guestbook from "../api/guestbook.js"
import * as media from "../api/media.js"
import * as comments from "../api/comments.js"
import * as reactions from "../api/reactions.js"
import * as moderation from "../api/admin/moderation.js"
import * as adminGuestbook from "../api/admin/guestbook.js"
import * as adminAccounts from "../api/admin/accounts.js"
import * as adminMedia from "../api/admin/media.js"
import * as adminFaces from "../api/admin/faces.js"
import * as adminPeople from "../api/admin/people.js"
import * as siteContent from "../api/admin/site-content.js"
import * as effectConfig from "../api/admin/effect-config.js"
import * as setup from "../api/setup.js"
import * as studio from "../api/studio.js"

/** @type {Types.Route[]} */
const routes = []

/** @type {Types.parseRoutePattern} */
function parseRoutePattern(pattern) {
  /** @type {string[]} */
  const keys = []
  const segments = pattern
    .split("/")
    .filter((s) => s !== "")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const paramName = segment.slice(1)
        keys.push(paramName)
        return { value: paramName, isParam: true }
      }
      return { value: segment, isParam: false }
    })
  return { segments, keys }
}

/** @type {Types.matchRoute} */
function matchRoute(urlPath, segments) {
  const urlSegments = urlPath.split("/").filter((s) => s !== "")

  if (urlSegments.length !== segments.length) {
    return null
  }

  const paramValues = []

  for (let i = 0; i < segments.length; i++) {
    const routeSegment = segments[i]
    const urlSegment = urlSegments[i]

    if (routeSegment.isParam) {
      paramValues.push(urlSegment)
    } else if (routeSegment.value !== urlSegment) {
      return null
    }
  }

  return paramValues
}

/** @type {Types.routeImpl} */
export function route(method, pattern, handler, options = {}) {
  const { segments, keys } = parseRoutePattern(pattern)
  let wrappedHandler
  if (options.admin) {
    wrappedHandler = withAdmin(/** @type {Types.AdminHandler} */ (handler))
  } else if (options.account) {
    wrappedHandler = withAccount(/** @type {Types.AccountHandler} */ (handler))
  } else if (options.accountOrAdmin) {
    wrappedHandler = withAccountOrAdmin(/** @type {Types.AccountOrAdminHandler} */ (handler))
  } else if (options.errorHandling) {
    wrappedHandler = withErrorHandling(/** @type {Types.RouteHandler} */ (handler))
  } else {
    wrappedHandler = handler
  }
  routes.push({ method, segments, keys, handler: /** @type {Types.RouteHandler} */ (wrappedHandler) })
}

/** @type {Types.clearRoutes} */
export function clearRoutes() {
  routes.length = 0
}

/** @type {Types.dispatch} */
export async function dispatch(req, res) {
  const urlPath = (req.url ?? "/").split("?")[0]
  let pathMatched = false
  const allowedMethods = []

  for (const r of routes) {
    const paramValues = matchRoute(urlPath, r.segments)
    if (paramValues !== null) {
      pathMatched = true
      if (r.method === req.method) {
        /** @type {Record<string, string>} */
        const params = {}
        r.keys.forEach((key, i) => {
          params[key] = paramValues[i]
        })
        await r.handler(req, res, { params })
        return true
      } else {
        allowedMethods.push(r.method)
      }
    }
  }

  if (pathMatched) {
    sendJson(
      res,
      405,
      { error: "Method not allowed" },
      {
        "Allow": allowedMethods.join(", "),
      },
    )
    return true
  }

  return false // No route matched at all - caller sends 404
}

route("GET", "/api/health", health.get)
route("GET", "/api/config", config.get)

// First-run setup (token-gated, not admin-gated — there is no admin yet). Both
// no-op once an admin hash exists (isSetupComplete).
route("GET", "/api/setup", setup.status, { errorHandling: true })
route("POST", "/api/setup", setup.submit, { errorHandling: true })
route("GET", "/api/rsvp/:code", rsvp.get, { errorHandling: true })
route("POST", "/api/rsvp/:code", rsvp.post, { errorHandling: true })
route("POST", "/api/lookup", lookup.lookup, { errorHandling: true })
route("POST", "/api/petition", lookup.petition, { errorHandling: true })

// Public digital thank-you cards (Phase 3). Token is the auth for get/reply —
// no account required. Literal `mine` MUST precede the `:token` param route
// so it isn't captured as a token value.
route("GET", "/api/thank-you/mine", thankYou.mine, { errorHandling: true })
route("GET", "/api/thank-you/:token", thankYou.get, { errorHandling: true })
route("POST", "/api/thank-you/:token/opened", thankYou.opened, { errorHandling: true })
route("POST", "/api/thank-you/:token/reply", thankYou.reply, { errorHandling: true })

// Guest account routes (public: register is an invite-code oracle guarded by its
// own rate limiter; logout/me are cheap and never 401)
route("POST", "/api/account/register", account.register, { errorHandling: true })
route("POST", "/api/account/logout", account.logout, { errorHandling: true })
route("GET", "/api/account/me", account.me, { errorHandling: true })
// Magic-link recovery (public, rate-limited; POST is an always-200 non-oracle,
// GET redeems the one-time token and redirects into /guestbook).
route("POST", "/api/account/recover", account.recover, { errorHandling: true })
route("GET", "/api/account/recover/:token", account.recoverConsume, { errorHandling: true })

// Public guestbook routes. GET is public (with getOptionalAccount inside for
// own-pending interleave); POST/DELETE require a guest account.
route("GET", "/api/guestbook", guestbook.list, { errorHandling: true })
route("GET", "/api/guestbook/:id", guestbook.getOne, { errorHandling: true })
route("POST", "/api/guestbook", guestbook.create, { account: true })
route("DELETE", "/api/guestbook/:id", guestbook.remove, { account: true })

// Public gallery read routes. GET is public (getOptionalAccount inside for the
// own-pending interleave / single-item visibility gate).
route("GET", "/api/media", media.list, { errorHandling: true })
route("GET", "/api/media/:id", media.getOne, { errorHandling: true })

// Media upload-session routes. withAccountOrAdmin accepts a guest OR an admin
// principal (Phase 6's admin upload reuses these exact routes via adminFetch).
route("POST", "/api/media", media.createSession, { accountOrAdmin: true })
route("PUT", "/api/media/:id/:variant", media.putVariant, { accountOrAdmin: true })
route("POST", "/api/media/:id/finalize", media.finalize, { accountOrAdmin: true })
route("PATCH", "/api/media/:id/caption", media.setCaption, { accountOrAdmin: true })
route("DELETE", "/api/media/:id", media.remove, { accountOrAdmin: true })

// Polymorphic comments. GET is public (getOptionalAccount inside for the
// own-pending interleave); POST requires a guest account. The literal 4th
// segment `comments` distinguishes these from PUT :variant / POST finalize.
route("GET", "/api/guestbook/:id/comments", comments.listGuestbook, { errorHandling: true })
// POST accepts a guest (hybrid moderation) OR an admin (the couple's auto-approved
// "host" reply, stored account_id NULL) via withAccountOrAdmin.
route("POST", "/api/guestbook/:id/comments", comments.createGuestbook, { accountOrAdmin: true })
route("GET", "/api/media/:id/comments", comments.listMedia, { errorHandling: true })
route("POST", "/api/media/:id/comments", comments.createMedia, { accountOrAdmin: true })
route("DELETE", "/api/comments/:id", comments.remove, { account: true })

// Reactions: a single toggle endpoint (target in the body). Account required.
route("POST", "/api/reactions/toggle", reactions.toggle, { account: true })

// Admin auth routes (error handling only, no session required)
route("POST", "/api/admin/login", sessions.login, { errorHandling: true })
route("POST", "/api/admin/logout", sessions.logout, { errorHandling: true })

// Admin guest routes — handlers receive AuthenticatedRouteInfo via withAdmin wrapping
route("GET", "/api/admin/stats", stats, { admin: true })
route("GET", "/api/admin/guests", list, { admin: true })
route("GET", "/api/admin/guests/export", exportCSV, { admin: true })
// Full invitable-guest id set for the current filter/search (drives "Send Invites"
// so it targets every not-yet-responded guest, not just the visible page).
route("GET", "/api/admin/guests/invitable-ids", invitableIds, { admin: true })
route("POST", "/api/admin/guests", create, { admin: true })
route("POST", "/api/admin/guests/import", importCSV, { admin: true })
route("PUT", "/api/admin/guests/:id", update, { admin: true })
route("DELETE", "/api/admin/guests/:id", remove, { admin: true })
route("POST", "/api/admin/guests/:id/restore", restore, { admin: true })
// Guest "story" sidecar for the thank-you composer + guest detail panel
// (implemented in api/admin/thank-you.js — it already aggregates gifts/cards).
route("GET", "/api/admin/guests/:id/story", adminThankYou.guestStory, { admin: true })

// Admin RSVP routes
route("GET", "/api/admin/rsvps", rsvps.list, { admin: true })
route("GET", "/api/admin/rsvps/export", rsvps.exportCSV, { admin: true })

// Admin invite routes
route("GET", "/api/admin/invite/config", invites.config, { admin: true })
route("POST", "/api/admin/invite/preview", invites.preview, { admin: true })
route("POST", "/api/admin/invite/send", invites.send, { admin: true })

// Admin petition routes
route("GET", "/api/admin/petitions", petitions.list, { admin: true })
route("GET", "/api/admin/petitions/counts", petitions.counts, { admin: true })
route("POST", "/api/admin/petitions/:id/approve", petitions.approve, { admin: true })
route("POST", "/api/admin/petitions/:id/deny", petitions.deny, { admin: true })

// Admin gift log routes (Phase 5). The literal `:id/physical-card` suffix
// disambiguates from the bare `/:id` PUT/DELETE.
route("GET", "/api/admin/gifts", adminThankYou.listGifts, { admin: true })
route("POST", "/api/admin/gifts", adminThankYou.createGift, { admin: true })
route("PUT", "/api/admin/gifts/:id", adminThankYou.updateGift, { admin: true })
route("DELETE", "/api/admin/gifts/:id", adminThankYou.deleteGift, { admin: true })
route("POST", "/api/admin/gifts/:id/physical-card", adminThankYou.togglePhysicalCard, { admin: true })

// Admin digital thank-you card routes (Phase 5/6): CRUD (draft-only edits) +
// delivery (config/preview/send mirror admin/invite) + counts (tab badge) +
// reply-seen (unread badge ack). CRITICAL: literal segments (`config`,
// `preview`, `send`, `counts`) MUST precede the `:id` param routes below so
// they aren't captured as an id value.
route("GET", "/api/admin/thank-you/config", adminThankYou.sendConfig, { admin: true })
route("POST", "/api/admin/thank-you/config", adminThankYou.setConfig, { admin: true })
route("POST", "/api/admin/thank-you/preview", adminThankYou.sendPreview, { admin: true })
route("POST", "/api/admin/thank-you/send", adminThankYou.send, { admin: true })
route("GET", "/api/admin/thank-you/counts", adminThankYou.counts, { admin: true })
// Cross-card replies feed (Inbox + Mailbox). Literal segment, so it must sit
// ahead of the `/:id` routes below or "replies" would be captured as an id.
route("GET", "/api/admin/thank-you/replies", adminThankYou.recentReplies, { admin: true })
// CSV export (sunset archive parity with `npm run export`). Two literal segments
// (`export/…`) keep these clear of the single-segment `/:id` routes below.
route("GET", "/api/admin/thank-you/export/gifts.csv", adminThankYou.exportGiftsCSV, { admin: true })
route("GET", "/api/admin/thank-you/export/cards.csv", adminThankYou.exportCardsCSV, { admin: true })
// Clear-reply lever. The literal `cards` segment keeps this distinct from the
// bare `/:id/*` card routes below; history rows are retained (surface-only wipe).
route("POST", "/api/admin/thank-you/cards/:id/clear-reply", adminThankYou.clearReply, { admin: true })
route("GET", "/api/admin/thank-you", adminThankYou.listCards, { admin: true })
route("POST", "/api/admin/thank-you", adminThankYou.createCard, { admin: true })
route("GET", "/api/admin/thank-you/:id", adminThankYou.getCard, { admin: true })
route("PUT", "/api/admin/thank-you/:id", adminThankYou.updateCard, { admin: true })
route("DELETE", "/api/admin/thank-you/:id", adminThankYou.deleteCard, { admin: true })
route("POST", "/api/admin/thank-you/:id/mark-sent", adminThankYou.markSentManual, { admin: true })
route("POST", "/api/admin/thank-you/:id/resend", adminThankYou.resendCard, { admin: true })
route("POST", "/api/admin/thank-you/:id/reply-seen", adminThankYou.markReplySeen, { admin: true })

// Admin moderation routes (guestbook-only in Phase 2; :type is validated against
// a fixed allowlist in the handler — never interpolated into SQL)
route("GET", "/api/admin/moderation/queue", moderation.queue, { admin: true })
route("GET", "/api/admin/moderation/counts", moderation.counts, { admin: true })
route("POST", "/api/admin/moderation/bulk", moderation.bulk, { admin: true })
route("POST", "/api/admin/moderation/approve-all", moderation.approveAllPending, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/approve", moderation.approve, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/reject", moderation.reject, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/hide", moderation.hide, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/undo", moderation.undo, { admin: true })

// Admin guestbook "Favorites" pin toggle (Wow pack). Distinct from the off-limits
// moderation queue — the couple pins approved notes for the public Favorites strip.
route("POST", "/api/admin/guestbook/:id/pin", adminGuestbook.pin, { admin: true })
route("POST", "/api/admin/guestbook/:id/unpin", adminGuestbook.unpin, { admin: true })

// Admin account-management routes (Phase 6)
route("GET", "/api/admin/accounts", adminAccounts.list, { admin: true })
route("POST", "/api/admin/accounts/:id/trust", adminAccounts.trust, { admin: true })
route("POST", "/api/admin/accounts/:id/untrust", adminAccounts.untrust, { admin: true })
route("DELETE", "/api/admin/accounts/:id", adminAccounts.remove, { admin: true })

// Admin curated-gallery routes (Phase 6). The literal `reorder` segment and the
// `:id/promote` shape disambiguate from the bare `/:id` PATCH/DELETE.
// Literal segment — must precede the `/:id/*` media routes so it isn't captured.
route("GET", "/api/admin/media/guest-loved", adminMedia.guestLoved, { admin: true })
route("POST", "/api/admin/media/reorder", adminMedia.reorder, { admin: true })
route("POST", "/api/admin/media/:id/promote", adminMedia.promote, { admin: true })
route("GET", "/api/admin/media/:id/references", adminMedia.references, { admin: true })
route("PATCH", "/api/admin/media/:id", adminMedia.caption, { admin: true })
route("DELETE", "/api/admin/media/:id", adminMedia.remove, { admin: true })

// Admin face-assignment routes (docs/post-wedding/SPEC-vision-lab.md §10/§15).
// Literal segments (`overview`, `queue`, `assign`, `unassign`, `not-a-face`)
// keep these clear of any future `/:id` face route.
route("GET", "/api/admin/faces/overview", adminFaces.overview, { admin: true })
route("GET", "/api/admin/faces/queue", adminFaces.queue, { admin: true })
route("POST", "/api/admin/faces/assign", adminFaces.assign, { admin: true })
// Separate from `assign` on purpose, not a convenience alias: this is the one
// path allowed to name a face the quality routing set aside, and it is a
// distinct route so that exemption is visible here rather than hidden behind a
// flag on the bulk shape. See api/admin/faces.js's assignOne.
route("POST", "/api/admin/faces/assign-one", adminFaces.assignOne, { admin: true })
route("POST", "/api/admin/faces/unassign", adminFaces.unassign, { admin: true })
route("POST", "/api/admin/faces/not-a-face", adminFaces.notAFace, { admin: true })
route("GET", "/api/admin/faces/propagations", adminFaces.propagations, { admin: true })
route("POST", "/api/admin/faces/propagate", adminFaces.propagate, { admin: true })
// The list of PHOTOGRAPHS holding a set-aside face — the entry point to the
// route above it. Every other list here is a list of faces and all of them
// filter `set_aside` out, so a photograph whose faces are all set aside reached
// none of them and `assign-one` could not be got at for its faces.
route("GET", "/api/admin/faces/set-aside", adminFaces.setAside, { admin: true })
// The undo. Every mutation above returns a `batchId`, and until these two the
// only way to spend one was to import `revokeBatch` into a test process — a
// revocable ledger with no route to revoke it. `batches` is the history the UI
// picks from; `revoke` flags one and re-projects the faces it touched, leaving
// any later manual correction on those faces exactly where it was.
route("GET", "/api/admin/faces/batches", adminFaces.batches, { admin: true })
route("POST", "/api/admin/faces/revoke", adminFaces.revoke, { admin: true })
// Per-photo face view, alongside the curated-gallery /api/admin/media/:id/* routes.
route("GET", "/api/admin/media/:id/faces", adminFaces.forMedia, { admin: true })

// Admin people routes — the photographed cast face tagging assigns to
// (a person is who a face belongs to; a guest is an invitation). `merge` is
// literal and registered before `/:id` for clarity, though the router would
// match either way.
route("GET", "/api/admin/people", adminPeople.listPeople, { admin: true })
route("POST", "/api/admin/people", adminPeople.create, { admin: true })
route("POST", "/api/admin/people/merge", adminPeople.merge, { admin: true })
route("PATCH", "/api/admin/people/:id", adminPeople.update, { admin: true })
route("DELETE", "/api/admin/people/:id", adminPeople.remove, { admin: true })

// Admin blocklist routes
route("GET", "/api/admin/blocklist", blocklist.list, { admin: true })
route("POST", "/api/admin/blocklist", blocklist.create, { admin: true })
route("DELETE", "/api/admin/blocklist/:id", blocklist.remove, { admin: true })

// Admin site-content editor (runtime override of content.js defaults)
route("GET", "/api/admin/site-content", siteContent.get, { admin: true })
route("PUT", "/api/admin/site-content", siteContent.update, { admin: true })
route("DELETE", "/api/admin/site-content", siteContent.reset, { admin: true })

// Admin effect-config editor (site-wide runtime override of effect defaults)
route("GET", "/api/admin/effect-config", effectConfig.get, { admin: true })
route("PUT", "/api/admin/effect-config", effectConfig.update, { admin: true })
route("DELETE", "/api/admin/effect-config", effectConfig.reset, { admin: true })

// Dev-only Sound lab decision store (thank-you card reveal audio verdict). Gated
// EXACTLY like the /studio page: api/studio.js 404s these when NODE_ENV ===
// "production", mirroring core/static.js DEV_ONLY_PAGES.
route("GET", "/api/studio/sound-decision", studio.get, { errorHandling: true })
route("POST", "/api/studio/sound-decision", studio.save, { errorHandling: true })

// Admin manual SMS routes
route("GET", "/api/admin/manual-sms/guests", manualSms.getEligibleGuests, { admin: true })
route("POST", "/api/admin/manual-sms/mark-sent", manualSms.markSent, { admin: true })
route("POST", "/api/admin/manual-sms/mark-sent-batch", manualSms.markSentBatch, { admin: true })
