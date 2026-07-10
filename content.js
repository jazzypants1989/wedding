/** @file Single source of truth for user-facing wedding copy + timeline mode.
 *
 *  Everything wedding-specific — couple names, date, location, registry, nav,
 *  and the pre-/post-wedding copy variants — lives here so the site can be
 *  re-skinned by editing one file (the seed of the reusable-product roadmap
 *  in TODO.md). The server templates the static HTML from these values
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
  // Landing-page Schedule. Server-rendered into repeating .schedule-item blocks
  // (renderSchedule in core/static.js); every field is escaped. Optional lines
  // are null (not omitted) so a validated override is always complete.
  schedule: {
    title: "Schedule",
    items: Object.freeze([
      Object.freeze({
        time: "11:15 - 11:30 AM",
        title: "Ceremony at Peninsula Park",
        officiant: "Officiated by the miraculous Mack Lee (they/them)",
        venue: null,
        address: "700 N Rosa Parks Way, Portland, OR 97217",
        details: Object.freeze([
          "We will have a brief standing ceremony in the gazebo by the rose garden in Peninsula Park. " +
            "We will have a few chairs available for guests who are uncomfortable standing for that length of time.",
        ]),
        note:
          "Public parking is available around the perimeter of the park and in surrounding neighborhood streets. " +
          "Please plan to arrive by 11 as parking can take some extra time. The gazebo is covered, but maybe bring " +
          "an umbrella since it may be rainy on the walk to/from parking areas.",
      }),
      Object.freeze({
        time: "11:30 AM - 12:00 PM",
        title: "Photos & Mingling",
        officiant: null,
        venue: null,
        address: null,
        details: Object.freeze(["Meandering to the reception"]),
        note: null,
      }),
      Object.freeze({
        time: "12:00 - 3:30 PM",
        title: "Karaoke Reception",
        officiant: "Hosted by the wonderful Ms. Gender (she/he/they)",
        venue: "Mississippi Pizza & Atlantis Lounge",
        address: "3552 N Mississippi Ave, Portland, OR 97227",
        details: Object.freeze([
          "A pizza lunch will be served (gluten-free and vegan options available upon request). " +
            "The bar has a selection of both alcoholic and non-alcoholic beverages. We will be providing " +
            "two drink tickets to each guest, then it is a cash bar after that.",
          "Karaoke will kick off ASAP upon arriving. Intermittent toasts are welcome throughout the reception.",
        ]),
        note:
          "Public parking in this area can be limited. We recommend looking for parking in the " +
          "neighborhood streets behind Mississippi.",
      }),
    ]),
  },
  // Dress code. `images` are origin-agnostic descriptors: defaults reference the
  // static /images assets with their hand-authored srcset; an admin upload swaps
  // in /media/{file_key}/… URLs. Rendered by renderDressCodeImages (all escaped).
  dressCode: {
    title: "Dress Code",
    body: "Wearing pink is encouraged, but not required :)",
    images: Object.freeze([
      Object.freeze({
        src: "/images/we-wear-pink.webp",
        srcset: "/images/we-wear-pink-400w.webp 400w, /images/we-wear-pink.webp 800w",
        sizes: "(min-width: 400px) 400px, 100vw",
        alt: "Karen from Mean Girls with text: At Jesse and Jordana's Wedding we wear pink",
        caption: null,
        width: 800,
        height: 460,
      }),
      Object.freeze({
        src: "/images/patrick-star.webp",
        srcset: "/images/patrick-star-400w.webp 400w, /images/patrick-star-600w.webp 600w, /images/patrick-star.webp 736w",
        sizes: "(min-width: 400px) 400px, 100vw",
        alt: "Patrick Star from SpongeBob in a pink cowboy outfit singing karaoke",
        caption: "One example of an acceptable outfit",
        width: 736,
        height: 988,
      }),
    ]),
  },
  registry: {
    title: "Registry/Gifts",
    body:
      "Gifts are not expected. If you would like to gift funds to us for our Big Sur honeymoon, " +
      "you are welcome to, but your presence at our wedding is most definitely gift enough. 💗",
    frameNote:
      "We didn't want to deal with payment processing, so we're using Honeyfund for the honeymoon registry. The " +
      "HoneyFund website will load in a frame below, but you can click on the link if that's too cramped.",
    url: "https://www.honeyfund.com/site/north-pence-04-26-2026",
    label: "Open registry in a new window",
  },
  // Post-wedding retrospective block (CSS-gated to post mode). Buttons stay in
  // the HTML; only the heading + intro line are content.
  memories: {
    title: "Memories",
    body: "The big day has come and gone — relive it with us!",
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
  // githubUrl: null → hide link. eventHeading titles the footer date block.
  footer: { githubUrl: "https://github.com/jazzypants1989/wedding", eventHeading: "Wedding Day" },
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
