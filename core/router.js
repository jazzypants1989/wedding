/** @file Declarative route registration and dispatch */
/** @import * as Types from './types.js' */

import { sendJson } from "./http.js"
import { withErrorHandling, withAdmin, withAccount } from "./auth.js"
import * as health from "../api/health.js"
import * as config from "../api/config.js"
import * as rsvp from "../api/rsvp.js"
import * as lookup from "../api/lookup.js"
import * as sessions from "../api/admin/sessions.js"
import {
  stats,
  list,
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
import * as blocklist from "../api/admin/blocklist.js"
import * as manualSms from "../api/admin/manual-sms.js"
import * as account from "../api/account.js"
import * as guestbook from "../api/guestbook.js"
import * as moderation from "../api/admin/moderation.js"

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
route("GET", "/api/rsvp/:code", rsvp.get, { errorHandling: true })
route("POST", "/api/rsvp/:code", rsvp.post, { errorHandling: true })
route("POST", "/api/lookup", lookup.lookup, { errorHandling: true })
route("POST", "/api/petition", lookup.petition, { errorHandling: true })

// Guest account routes (public: register is an invite-code oracle guarded by its
// own rate limiter; logout/me are cheap and never 401)
route("POST", "/api/account/register", account.register, { errorHandling: true })
route("POST", "/api/account/logout", account.logout, { errorHandling: true })
route("GET", "/api/account/me", account.me, { errorHandling: true })

// Public guestbook routes. GET is public (with getOptionalAccount inside for
// own-pending interleave); POST/DELETE require a guest account.
route("GET", "/api/guestbook", guestbook.list, { errorHandling: true })
route("POST", "/api/guestbook", guestbook.create, { account: true })
route("DELETE", "/api/guestbook/:id", guestbook.remove, { account: true })

// Admin auth routes (error handling only, no session required)
route("POST", "/api/admin/login", sessions.login, { errorHandling: true })
route("POST", "/api/admin/logout", sessions.logout, { errorHandling: true })

// Admin guest routes — handlers receive AuthenticatedRouteInfo via withAdmin wrapping
route("GET", "/api/admin/stats", stats, { admin: true })
route("GET", "/api/admin/guests", list, { admin: true })
route("GET", "/api/admin/guests/export", exportCSV, { admin: true })
route("POST", "/api/admin/guests", create, { admin: true })
route("POST", "/api/admin/guests/import", importCSV, { admin: true })
route("PUT", "/api/admin/guests/:id", update, { admin: true })
route("DELETE", "/api/admin/guests/:id", remove, { admin: true })
route("POST", "/api/admin/guests/:id/restore", restore, { admin: true })

// Admin RSVP routes
route("GET", "/api/admin/rsvps", rsvps.list, { admin: true })
route("GET", "/api/admin/rsvps/export", rsvps.exportCSV, { admin: true })

// Admin invite routes
route("GET", "/api/admin/invite/config", invites.config, { admin: true })
route("POST", "/api/admin/invite/preview", invites.preview, { admin: true })
route("POST", "/api/admin/invite/send", invites.send, { admin: true })

// Admin petition routes
route("GET", "/api/admin/petitions", petitions.list, { admin: true })
route("POST", "/api/admin/petitions/:id/approve", petitions.approve, { admin: true })
route("POST", "/api/admin/petitions/:id/deny", petitions.deny, { admin: true })

// Admin moderation routes (guestbook-only in Phase 2; :type is validated against
// a fixed allowlist in the handler — never interpolated into SQL)
route("GET", "/api/admin/moderation/queue", moderation.queue, { admin: true })
route("GET", "/api/admin/moderation/counts", moderation.counts, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/approve", moderation.approve, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/reject", moderation.reject, { admin: true })
route("POST", "/api/admin/moderation/:type/:id/hide", moderation.hide, { admin: true })

// Admin blocklist routes
route("GET", "/api/admin/blocklist", blocklist.list, { admin: true })
route("POST", "/api/admin/blocklist", blocklist.create, { admin: true })
route("DELETE", "/api/admin/blocklist/:id", blocklist.remove, { admin: true })

// Admin manual SMS routes
route("GET", "/api/admin/manual-sms/guests", manualSms.getEligibleGuests, { admin: true })
route("POST", "/api/admin/manual-sms/mark-sent", manualSms.markSent, { admin: true })
route("POST", "/api/admin/manual-sms/mark-sent-batch", manualSms.markSentBatch, { admin: true })
