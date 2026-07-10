/** @file Single source of truth for user-facing wedding copy + timeline mode.
 *
 *  Everything wedding-specific — couple names, date, location, registry, nav,
 *  and the pre-/post-wedding copy variants — lives here so the site can be
 *  re-skinned by editing one file (the seed of the reusable-product direction
 *  in DEFERRED §14). The server templates the static HTML from these values
 *  (`core/static.js`) and exposes the client-needed scalars via `/api/config`.
 *
 *  Zero runtime deps, no regex. Browser code never imports this (repo-root, not
 *  under public/) — it receives values via server templating + /api/config.
 */
/** @import * as Types from './types.js' */

/** @type {Types.SiteContent} */
export const CONTENT = Object.freeze({
  couple: {
    display: "Jordana & Jesse", // canonical "First & First" — h1s, titles
    first: "Jordana and Jesse", // prose / email sign-offs ("Love, ...")
    monogram: "J&J", // mobile logo
    fullNames: Object.freeze(["Jordana North", "Jesse Pence"]), // meta + registry slug
  },
  // ISO with ceremony start time + PDT offset. Drives the countdown AND the
  // timeline mode; the human "April 26, 2026" is derived (formatWeddingDate).
  weddingDate: "2026-04-26T11:00:00-07:00",
  location: "Portland, OR",
  registry: {
    url: "https://www.honeyfund.com/site/north-pence-04-26-2026",
    label: "Open registry in a new window",
  },
  // null → fall back to SERVER.contactEmail (env), matching the gallery
  // report-photo address today (public/pages/gallery/lightbox.js).
  contactEmail: null,
  // Nav links are home-relative; renderNav (core/static.js) prefixes anchors
  // with "/" off the home page and marks the current page active.
  nav: {
    pre: Object.freeze([
      { href: "#", label: "Home" },
      { href: "#schedule", label: "Schedule" },
      { href: "#dress-code", label: "Dress Code" },
      { href: "#registry", label: "Registry" },
      { href: "/guestbook", label: "Guestbook" },
      { href: "/gallery", label: "Gallery" },
      { href: "/rsvp", label: "RSVP" },
    ]),
    post: Object.freeze([
      { href: "#", label: "Home" },
      { href: "#registry", label: "Registry" },
      { href: "/guestbook", label: "Guestbook" },
      { href: "/gallery", label: "Gallery" },
    ]),
  },
  footer: { githubUrl: "https://github.com/jazzypants1989/wedding" }, // null → hide link
  // Tense-sensitive landing copy, selected by timeline mode. May contain trusted
  // inline HTML (e.g. <em>); injected raw by the templater, never escaped.
  copy: {
    pre: {
      welcomeHeading: "Welcome",
      welcomeIntro:
        "Please join us for our (low-key and low-stress) wedding celebration! " +
        "We want to keep it simple and focus on enjoying time with our loved ones and not getting too hung up on the " +
        "details (our apologies in advance for any hiccups that may occur). Shameless karaoke singing (with or without " +
        "skill) is encouraged, but not required. <em>No one will be pressured into singing if they don't want to</em>. " +
        "If any guests have any accessibility or accommodation needs, please let us know and we will do our best to " +
        "accommodate you.",
    },
    post: {
      welcomeHeading: "Thank You",
      welcomeIntro:
        "Thank you for celebrating with us! We kept it low-key and low-stress and focused on time with our loved " +
        "ones — karaoke and all. It meant the world to have you there. Relive the day in the gallery below and leave " +
        "us a note in the guestbook. 💗",
    },
  },
})

/** @type {Types.formatWeddingDate} */
export function formatWeddingDate(iso = CONTENT.weddingDate) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  })
}

/** @type {Types.formatWeddingDateShort} */
export function formatWeddingDateShort(iso = CONTENT.weddingDate) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Los_Angeles",
  })
}

/** @type {Types.getTimelineMode} */
export function getTimelineMode(now = Date.now(), weddingDate = CONTENT.weddingDate) {
  const override = process.env.SITE_MODE
  if (override === "pre" || override === "post") return override
  return now < Date.parse(weddingDate) ? "pre" : "post"
}
