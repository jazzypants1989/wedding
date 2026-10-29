/** @file Home — "what's next", in the order the work naturally runs. Not a
 *  dashboard of numbers: each card is a step with one obvious button. */

import { href, esc, wide } from "../ui.js"
import {
  store, pendingReview, groupsLeft, askLeft, propsLeft, leftoversLeft, drafts, unreadReplies, giftsUnthanked,
} from "../data.js"
import { icon } from "../art.js"
import { moreMarkup } from "../app.js"

/** @param {{ n: number, step: number, title: string, done: string, todo: string, to: string, cta: string, icon: any, progress?: [number, number] }} s */
function stepCard(s) {
  const done = s.n === 0
  const pct = s.progress ? Math.round((s.progress[0] / Math.max(1, s.progress[1])) * 100) : done ? 100 : 0
  return `<li class="step-card ${done ? "is-done" : ""}">
    <div class="step-num" aria-hidden="true">${done ? icon("check") : s.step}</div>
    <div class="step-body">
      <h2>${esc(s.title)}</h2>
      <p>${done ? esc(s.done) : esc(s.todo)}</p>
      ${s.progress ? `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(s.title)} progress"><span style="width:${pct}%"></span></div>` : ""}
    </div>
    <a class="btn ${done ? "" : "btn-primary"}" href="${href(s.to)}">${esc(done ? "Look again" : s.cta)}</a>
  </li>`
}

function homeView() {
  const post = store.mode === "post"
  const rev = pendingReview().length
  const groups = groupsLeft().length
  const ask = askLeft().length
  const facesLeft = groups + ask + propsLeft().length + leftoversLeft().length
  const facesTotal = store.groups.length + store.ask.length + store.propagations.length + store.leftovers.length
  const unthanked = giftsUnthanked().length
  const dr = drafts().length
  const sent = store.cards.filter((c) => c.status !== "draft").length
  const replies = unreadReplies().length
  const last = localStorage.getItem("ws-last")

  const steps = post
    ? [
        stepCard({ step: 1, n: rev, title: "Review new posts", icon: "review", to: "/review", cta: `Review ${rev} posts`,
          todo: `${rev} photos, messages and comments are waiting before guests can see them.`, done: "Nothing waiting. New posts land here." }),
        stepCard({ step: 2, n: facesLeft, title: "Name the faces", icon: "faces", to: "/faces", cta: groups ? `Name ${groups} groups` : "Continue",
          todo: `${groups} groups of look-alike faces, then ${ask} quick questions.`, done: "Everyone in the photos has a name.",
          progress: [facesTotal - facesLeft, facesTotal] }),
        stepCard({ step: 3, n: unthanked + dr, title: "Thank everyone", icon: "cards", to: dr ? "/cards/send" : "/gifts", cta: dr ? `Send ${dr} drafted cards` : `Write ${unthanked} cards`,
          todo: `${unthanked} gifts without a card yet, ${dr} cards drafted and ready to send.`, done: "Every gift has been thanked.",
          progress: [sent, store.gifts.length] }),
      ]
    : [
        stepCard({ step: 1, n: 1, title: "Answer invitation requests", icon: "requests", to: "/requests", cta: "Review 1 request",
          todo: "Someone asked to be added to the guest list.", done: "" }),
        stepCard({ step: 2, n: 3, title: "Chase RSVPs", icon: "guests", to: "/guests?rsvp=awaiting", cta: "See who hasn't replied",
          todo: "3 parties haven't replied yet.", done: "" }),
        stepCard({ step: 3, n: 1, title: "Check the site", icon: "content", to: "/site/content", cta: "Edit site content",
          todo: "Times, travel, dress code — what guests read.", done: "" }),
      ]

  return `<div class="home">
    <header class="home-head">
      <h1>${post ? "Good morning, newlyweds" : "Good morning"}</h1>
      <p class="muted">${post ? "Three things, in order. Each one walks you through itself." : "The run-up to the wedding."}</p>
    </header>
    ${last && last !== "/" ? `<a class="resume" href="${href(last)}">${icon("back")}<span>Pick up where you left off</span><code>${esc(last)}</code></a>` : ""}
    <ol class="steps">${steps.join("")}</ol>
    ${post && replies ? `<a class="home-replies" href="${href("/replies")}">${icon("replies")} <span><strong>${replies} new ${replies === 1 ? "reply" : "replies"}</strong> to your cards</span></a>` : ""}
  </div>`
}

/** @type {any[]} */
export const homeRoutes = [
  {
    pattern: "/",
    section: "home",
    title: () => "Home",
    crumbs: () => [{ label: "Home" }],
    render: homeView,
  },
  {
    pattern: "/more",
    section: "more",
    title: () => "Everything",
    crumbs: () => [{ label: "Everything" }],
    render: () =>
      wide()
        ? { redirect: "/" }
        : `<div class="more"><h1 class="sr-only">Everything</h1>${moreMarkup()}
        <section class="more-group"><h2>Settings</h2>
          <button class="more-item" data-action="theme">${icon("moon")}<span>Light / dark</span></button>
          <button class="more-item" data-action="mode">${icon("key")}<span>Switch before / after order</span></button>
        </section></div>`,
  },
]

