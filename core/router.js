/** @file Declarative route registration and dispatch */
/** @import * as Types from './types.js' */

import { sendJson } from "./http.js"
import * as health from "../api/health.js"
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

/** @type {Types.Route[]} */
const routes = []

/** @type {Types.ParseRoutePattern} */
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

/** @type {Types.MatchRoute} */
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

/** @type {Types.route} */
export function route(method, pattern, handler) {
  const { segments, keys } = parseRoutePattern(pattern)
  routes.push({ method, segments, keys, handler })
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
route("GET", "/api/rsvp/:code", rsvp.get)
route("POST", "/api/rsvp/:code", rsvp.post)
route("POST", "/api/lookup", lookup.lookup)
route("POST", "/api/petition", lookup.petition)

// Admin auth routes
route("POST", "/api/admin/login", sessions.login)
route("POST", "/api/admin/logout", sessions.logout)

// Admin guest routes
route("GET", "/api/admin/stats", stats)
route("GET", "/api/admin/guests", list)
route("GET", "/api/admin/guests/export", exportCSV)
route("POST", "/api/admin/guests", create)
route("POST", "/api/admin/guests/import", importCSV)
route("PUT", "/api/admin/guests/:id", update)
route("DELETE", "/api/admin/guests/:id", remove)
route("POST", "/api/admin/guests/:id/restore", restore)

// Admin RSVP routes
route("GET", "/api/admin/rsvps", rsvps.list)
route("GET", "/api/admin/rsvps/export", rsvps.exportCSV)

// Admin invite routes
route("GET", "/api/admin/invite/config", invites.config)
route("POST", "/api/admin/invite/preview", invites.preview)
route("POST", "/api/admin/invite/send", invites.send)

// Admin petition routes
route("GET", "/api/admin/petitions", petitions.list)
route("POST", "/api/admin/petitions/:id/approve", petitions.approve)
route("POST", "/api/admin/petitions/:id/deny", petitions.deny)

// Admin blocklist routes
route("GET", "/api/admin/blocklist", blocklist.list)
route("POST", "/api/admin/blocklist", blocklist.create)
route("DELETE", "/api/admin/blocklist/:id", blocklist.remove)

// Admin manual SMS routes
route("GET", "/api/admin/manual-sms/guests", manualSms.getEligibleGuests)
route("POST", "/api/admin/manual-sms/mark-sent", manualSms.markSent)
route("POST", "/api/admin/manual-sms/mark-sent-batch", manualSms.markSentBatch)
