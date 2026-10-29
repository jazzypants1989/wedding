/** @file The journey map — the single source the sidebar, the Home map, every
 *  stepper, the "Everything" index and the route table all read from. A journey
 *  is a feature: its steps ARE its sub-tabs, so there is one structure, not a
 *  wizard bolted on top of a tab bar. */

import {
  db,
  openGroups,
  openAsk,
  waitingAsk,
  openSameMoment,
  faceTotals,
  unwritten,
  drafts,
  sentCards,
  unreadReplies,
} from "./data.js"

/**
 * @typedef {{ left: number, label: string, done: boolean }} Progress
 * @typedef {{ id: string, title: string, path: string, lede: string, how: string[],
 *   progress: () => Progress }} Step
 * @typedef {{ id: string, title: string, nav: string, verb: string, blurb: string, when: "post" | "pre",
 *   recurring?: boolean, minutes: string, steps: Step[], badge?: () => string }} Journey
 */

/** @param {number} n @param {string} noun @param {string} [doneLabel] @returns {Progress} */
function left(n, noun, doneLabel = "Done") {
  return { left: n, label: n === 0 ? doneLabel : `${n} ${noun}`, done: n === 0 }
}

/** @type {Journey[]} */
export const JOURNEYS = [
  {
    id: "review",
    title: "Keep the guestbook tidy",
    nav: "Review posts",
    verb: "Review new posts",
    blurb: "Look over new messages, photos and comments before they appear on the site.",
    when: "post",
    recurring: true,
    minutes: "about 3 min",
    badge: () => (db.pending.length ? String(db.pending.length) : ""),
    steps: [
      {
        id: "new",
        title: "Look at new posts",
        path: "/review/new",
        lede: "Guests have posted since you last looked. Nothing appears on the site until you say so.",
        how: [
          "Approve puts it on the site.",
          "Hide keeps it off the site but saves it.",
          "Reject is for spam — it's deleted after 7 days.",
        ],
        progress: () => left(db.pending.length, "waiting", "All caught up"),
      },
      {
        id: "favorites",
        title: "Pin your favourites",
        path: "/review/favorites",
        lede: "Pinned messages sit at the top of the guestbook in a Favorites strip. Pick the ones you want everyone to read first.",
        how: ["Tap the star to pin or unpin.", "Three to six pins looks best."],
        progress: () => {
          const n = db.approved.filter((/** @type {any} */ a) => a.pinned).length
          return { left: 0, label: `${n} pinned`, done: n > 0 }
        },
      },
      {
        id: "trusted",
        title: "Trust the regulars",
        path: "/review/trusted",
        lede: "Posts from guests you trust go live straight away, so there'll be less to review next time.",
        how: ["Trust people you know.", "You can change your mind at any time."],
        progress: () => {
          const n = db.accounts.filter((/** @type {any} */ a) => a.trusted).length
          return { left: 0, label: `${n} trusted`, done: true }
        },
      },
    ],
  },
  {
    id: "gallery",
    title: "Curate the gallery",
    nav: "Gallery",
    verb: "Curate the gallery",
    blurb: "Put the photographer's best photos up front, in order, and bring in guests' favourites.",
    when: "post",
    minutes: "about 15 min",
    steps: [
      {
        id: "add",
        title: "Add the official photos",
        path: "/gallery/add",
        lede: "These are the photos everyone sees first — usually your photographer's. Guests' own uploads go in their own section.",
        how: ["Drop a folder of photos or videos.", "Big files are fine; they upload in the background."],
        progress: () => ({ left: 0, label: `${db.official.length} photos`, done: db.official.length > 0 }),
      },
      {
        id: "order",
        title: "Put them in order",
        path: "/gallery/order",
        lede: "Tell the story from start to finish. A short caption helps guests who weren't there for that moment.",
        how: ["Use the arrows to move a photo.", "Click a caption to edit it."],
        progress: () => ({ left: 0, label: "In order", done: true }),
      },
      {
        id: "loved",
        title: "Bring in guests' favourites",
        path: "/gallery/loved",
        lede: "These are guests' photos with the most hearts. Add the best ones to the official set.",
        how: ["Most-loved first.", "Adding a photo keeps the guest's name on it."],
        progress: () => {
          const n = db.loved.filter((/** @type {any} */ l) => l.promoted).length
          return { left: 0, label: n ? `${n} added` : "Not yet", done: n > 0 }
        },
      },
    ],
  },
  {
    id: "faces",
    title: "Name the faces",
    nav: "Faces",
    verb: "Name the faces",
    blurb: "Tell the gallery who's who, so guests can find every photo they're in.",
    when: "post",
    minutes: "20–40 min, in as many sittings as you like",
    steps: [
      {
        id: "people",
        title: "Who's in the photos?",
        path: "/faces/people",
        lede: "Start with a list of everyone who might appear. We've filled it in from your guest list — add anyone missing, like kids, partners, or the photographer.",
        how: [
          "Everyone on the list can be picked by name later.",
          "People don't need to be on the guest list.",
        ],
        progress: () => ({ left: 0, label: `${db.people.length} people`, done: db.people.length > 0 }),
      },
      {
        id: "groups",
        title: "Name the big groups",
        path: "/faces/groups",
        lede: "We've sorted the faces into groups that look like the same person. Type a name once and the whole group is named.",
        how: [
          "Start with the biggest group — it names the most photos.",
          "If one face doesn't belong, tap it to leave it out.",
          "Not sure? Skip. The next step catches what's left.",
        ],
        progress: () => left(openGroups().length, "groups left", "All named"),
      },
      {
        id: "ask",
        title: "Answer the hard ones",
        path: "/faces/ask",
        lede: "These faces could be one of a few people. Pick the right name — every answer helps us name more photos on our own.",
        how: [
          "Press 1, 2 or 3 to pick a name.",
          "Skip anything you can't tell. Mark anything that isn't a face.",
        ],
        progress: () => {
          const open = openAsk().length
          const waiting = waitingAsk().length
          if (waiting > 0 && open === 0) return { left: waiting, label: "Name a group first", done: false }
          return left(open, "to answer", "All answered")
        },
      },
      {
        id: "moment",
        title: "Same moment, same person",
        path: "/faces/same-moment",
        lede: "Some photos were taken a second apart. When the first is named, its near-copy almost certainly shows the same person. Check, then accept.",
        how: ["Accept all if they look right.", "\"Not now\" leaves one for later."],
        progress: () => {
          const open = openSameMoment().length
          const later = db.sameMoment.filter(
            (/** @type {any} */ s) => !db.assigned[s.id] && !db.assigned[s.fromFaceId],
          ).length
          if (open === 0 && later > 0) return { left: later, label: "After step 2", done: false }
          return left(open, "to check", "Nothing to check")
        },
      },
      {
        id: "check",
        title: "Check the results",
        path: "/faces/check",
        lede: "Here's everyone you've named. Open a person to see their faces side by side and remove any that aren't them.",
        how: ["Anything removed goes back into the queue.", "History lets you undo a whole session."],
        progress: () => {
          const t = faceTotals()
          return { left: 0, label: `${t.named} named`, done: t.left === 0 }
        },
      },
    ],
  },
  {
    id: "thanks",
    title: "Thank everyone",
    nav: "Thank-yous",
    verb: "Thank everyone",
    blurb: "Log gifts, write a card for each guest, send them, and read the replies.",
    when: "post",
    minutes: "about 5 min per card",
    badge: () => {
      const n = unreadReplies().length
      return n ? `♥ ${n}` : ""
    },
    steps: [
      {
        id: "gifts",
        title: "Log the gifts",
        path: "/thanks/gifts",
        lede: "Write down who gave what, so every card can mention it by name.",
        how: ["One line per gift is enough.", "You can log more at any time."],
        progress: () => ({ left: 0, label: `${db.gifts.length} gifts`, done: db.gifts.length > 0 }),
      },
      {
        id: "write",
        title: "Write the cards",
        path: "/thanks/write",
        lede: "We start every card for you with their name and their gift. Make it yours, add a photo they're in, and save.",
        how: ["Cards save as drafts — nothing is sent yet.", "\"Save and next\" takes you to the next guest."],
        progress: () => left(unwritten().length, "to write", "All written"),
      },
      {
        id: "send",
        title: "Send them",
        path: "/thanks/send",
        lede: "Choose how each card goes out — email, text, or a link you share yourself — check them over, then send them all at once.",
        how: ["We pick email or text from what you have on file.", "You'll see exactly what each guest gets before anything is sent."],
        progress: () => left(drafts().length, "ready to send", "All sent"),
      },
      {
        id: "replies",
        title: "Read their replies",
        path: "/thanks/replies",
        lede: "Guests can answer your card with an emoji and a note. New ones are at the top.",
        how: ["Opening a reply marks it as read."],
        progress: () => {
          const n = unreadReplies().length
          return { left: n, label: n ? `${n} new` : `${sentCards().length} sent`, done: n === 0 }
        },
      },
    ],
  },
  {
    id: "invite",
    title: "Get everyone there",
    nav: "Get everyone there",
    verb: "Invite everyone",
    blurb: "Build the guest list, send invitations, and track who's coming.",
    when: "pre",
    minutes: "ongoing",
    steps: [
      {
        id: "guests",
        title: "Guest list",
        path: "/guests",
        lede: "Everyone you're inviting, one row per invitation.",
        how: ["Import a spreadsheet or add guests one at a time."],
        progress: () => ({ left: 0, label: `${db.guests.length} guests`, done: true }),
      },
      {
        id: "invites",
        title: "Invitations",
        path: "/invites",
        lede: "Send invitations by email or text, or copy them to send yourself.",
        how: ["Each guest gets their own link."],
        progress: () => {
          const n = db.guests.filter((/** @type {any} */ g) => g.status === "pending").length
          return left(n, "not invited", "All invited")
        },
      },
      {
        id: "rsvps",
        title: "RSVPs",
        path: "/rsvps",
        lede: "Who's coming, and how many.",
        how: ["Export to a spreadsheet for the caterer."],
        progress: () => {
          const n = db.guests.filter((/** @type {any} */ g) => g.status !== "responded").length
          return left(n, "awaiting reply", "Everyone replied")
        },
      },
      {
        id: "requests",
        title: "Invitation requests",
        path: "/requests",
        lede: "People who asked for an invitation through the site.",
        how: ["Approve to add them to the guest list, deny to decline."],
        progress: () => left(0, "pending", "None pending"),
      },
    ],
  },
]

/** Things that are tools, not journeys: no beginning and end. */
export const SITE_TOOLS = [
  { id: "site", title: "Words & pictures", path: "/site" },
  { id: "effects", title: "Look & effects", path: "/site/effects" },
]

/** @param {string} id */
export const journeyById = (id) => JOURNEYS.find((j) => j.id === id)

/** Journeys in the order this mode wants them. */
export function orderedJourneys() {
  const post = JOURNEYS.filter((j) => j.when === "post")
  const pre = JOURNEYS.filter((j) => j.when === "pre")
  return db.mode === "post" ? { now: post, later: pre } : { now: pre, later: post }
}

/** Overall progress for a journey: share of steps done + the first unfinished step.
 *  @param {Journey} j */
export function journeyProgress(j) {
  const states = j.steps.map((s) => s.progress())
  const doneCount = states.filter((s) => s.done).length
  let firstOpen = j.steps.findIndex((s, i) => !states[i].done && states[i].left > 0)
  if (firstOpen === -1) firstOpen = j.steps.findIndex((s, i) => !states[i].done)
  const next = firstOpen === -1 ? null : j.steps[firstOpen]
  let pct = doneCount / j.steps.length
  if (j.id === "faces") {
    const t = faceTotals()
    pct = (t.named + t.notFace) / Math.max(1, t.total - t.setAside)
  }
  if (j.id === "thanks") {
    pct = sentCards().length / Math.max(1, db.gifts.length)
  }
  if (j.id === "review") pct = db.pending.length === 0 ? 1 : 0
  return { states, doneCount, next, pct, complete: next === null }
}
