/** @file Home (the journey map), a journey's overview, its completion screen,
 *  the plain "Everything" index, and not-found. */

import { html, raw, plural } from "./html.js"
import { db, faceTotals, unreadReplies, drafts, unwritten, openGroups, sentCards } from "./data.js"
import { JOURNEYS, SITE_TOOLS, journeyById, orderedJourneys, journeyProgress } from "./journeys.js"
import { L } from "./shell.js"

/** The one thing most worth doing right now, in plain words. */
function nextUp() {
  if (db.mode === "pre") {
    return {
      kicker: "Next up",
      text: "3 guests haven't been invited yet",
      sub: "Send their invitations so they can RSVP.",
      cta: "Send invitations",
      to: "/invites",
    }
  }
  if (db.pending.length) {
    return {
      kicker: "Waiting for you",
      text: `${plural(db.pending.length, "new post")} from guests`,
      sub: "Nothing appears on the site until you've looked. About 3 minutes.",
      cta: "Review them now",
      to: "/review/new",
    }
  }
  const replies = unreadReplies().length
  if (replies) {
    return {
      kicker: "Something lovely",
      text: `${plural(replies, "guest")} replied to your thank-you card`,
      sub: "Have a read.",
      cta: "Read replies",
      to: "/thanks/replies",
    }
  }
  const groups = openGroups().length
  if (groups) {
    return {
      kicker: "Next up",
      text: `${plural(groups, "group")} of faces to name`,
      sub: "Each one names a whole stack of photos at once.",
      cta: "Name the faces",
      to: resumePath(/** @type {any} */ (journeyById("faces"))),
    }
  }
  if (unwritten().length || drafts().length) {
    return {
      kicker: "Next up",
      text: `${plural(unwritten().length + drafts().length, "thank-you card")} still to go`,
      sub: "Pick up where you left off.",
      cta: "Thank everyone",
      to: resumePath(/** @type {any} */ (journeyById("thanks"))),
    }
  }
  return { kicker: "All done", text: "Nothing needs you right now", sub: "Enjoy it.", cta: "Look at the gallery", to: "/gallery" }
}

/** Where "Continue" goes: the last step you were on, else the first unfinished.
 *  @param {any} j */
export function resumePath(j) {
  const remembered = db.resume[j.id]
  if (remembered) return remembered
  const pr = journeyProgress(j)
  return pr.next ? pr.next.path : j.steps[0].path
}

/** @param {any} j @param {number} n */
function journeyCard(j, n) {
  const pr = journeyProgress(j)
  const pct = Math.round(pr.pct * 100)
  const started = pr.pct > 0 || db.resume[j.id]
  const atStep = j.steps.findIndex((/** @type {any} */ s) => resumePath(j).startsWith(s.path))
  const cur = j.steps[atStep === -1 ? 0 : atStep]
  const cta = pr.complete
    ? html`<a class="btn secondary" href="${L("/" + j.id)}">Done ✓ · Look again</a>`
    : html`<a class="btn primary" href="${L(resumePath(j))}">${started ? "Continue" : "Start"}
        <span class="cta-sub">· Step ${(atStep === -1 ? 0 : atStep) + 1}: ${cur.title}</span> →</a>`
  const badge = j.badge ? j.badge() : ""
  return html`<li class="jcard ${pr.complete ? "complete" : ""}">
    <div class="jc-num" aria-hidden="true">${pr.complete ? raw("&#10003;") : n}</div>
    <div class="jc-main">
      <h2><a href="${L("/" + j.id)}">${j.title}</a> ${badge ? html`<span class="badge">${badge}</span>` : ""}
        ${j.recurring ? html`<span class="chip">ongoing</span>` : ""}</h2>
      <p>${j.blurb}</p>
      <div class="jc-progress"><span class="bar"><i style="width:${pct}%"></i></span>
        <span class="jc-pl">${progressLine(j)}</span></div>
      <ol class="jc-steps" aria-label="Steps">${j.steps.map(
        (/** @type {any} */ s, /** @type {number} */ i) => html`<li class="${pr.states[i].done ? "done" : ""}">
          <a href="${L(s.path)}">${s.title}</a></li>`,
      )}</ol>
      <div class="jc-cta">${cta}<span class="fine">${j.minutes}</span></div>
    </div>
  </li>`
}

/** @param {any} j */
function progressLine(j) {
  if (j.id === "faces") {
    const t = faceTotals()
    return `${t.named} of ${t.total - t.setAside} faces named`
  }
  if (j.id === "thanks") return `${sentCards().length} of ${db.gifts.length} guests thanked`
  if (j.id === "review") return db.pending.length ? `${db.pending.length} waiting` : "All caught up"
  if (j.id === "gallery") return `${db.official.length} official photos`
  return ""
}

/** @returns {import("./shell.js").Screen} */
export function homeScreen() {
  const nu = nextUp()
  const { now, later } = orderedJourneys()
  const body = html`
    <section class="hero">
      <p class="eyebrow">${db.mode === "post" ? "Six months married" : "181 days to go"}</p>
      <h1 tabindex="-1" id="page-h">Hello, Jordana &amp; Jesse</h1>
      <div class="nextup">
        <p class="nu-k">${nu.kicker}</p>
        <p class="nu-t">${nu.text}</p>
        <p class="nu-s">${nu.sub}</p>
        <a class="btn primary big" href="${L(nu.to)}">${nu.cta} →</a>
      </div>
    </section>
    <section aria-labelledby="map-h">
      <h2 class="section-h" id="map-h">${db.mode === "post" ? "After the wedding" : "Before the wedding"}
        <span class="fine">— in the order we'd do them</span></h2>
      <ol class="jmap">${now.map((j, i) => journeyCard(j, i + 1))}</ol>
    </section>
    <section aria-labelledby="later-h" class="later">
      <h2 class="section-h" id="later-h">${db.mode === "post" ? "Before the wedding" : "After the wedding"}
        <span class="fine">${db.mode === "post" ? "— finished, still here if you need it" : "— for later"}</span></h2>
      <ul class="tiles">${later.flatMap((j) =>
        j.steps.map(
          (s) => html`<li><a class="tile" href="${L(s.path)}"><strong>${s.title}</strong><span>${s.progress().label}</span></a></li>`,
        ),
      )}${SITE_TOOLS.map(
        (t) => html`<li><a class="tile" href="${L(t.path)}"><strong>${t.title}</strong><span>Your site</span></a></li>`,
      )}</ul>
    </section>`
  return { title: "Home", heading: "", bare: true, body }
}

/** A journey's own landing page: the path, with "Continue" up top.
 *  @param {string} id @returns {import("./shell.js").Screen} */
export function journeyScreen(id) {
  const j = /** @type {any} */ (journeyById(id))
  const pr = journeyProgress(j)
  const pct = Math.round(pr.pct * 100)
  const resume = resumePath(j)
  const resumeAt = Math.max(0, j.steps.findIndex((/** @type {any} */ s) => resume.startsWith(s.path)))
  const body = html`
    <section class="jover">
      <p class="eyebrow">${j.steps.length} steps · ${j.minutes}</p>
      <h1 tabindex="-1" id="page-h">${j.title}</h1>
      <p class="lede">${j.blurb}</p>
      <div class="jc-progress big"><span class="bar"><i style="width:${pct}%"></i></span>
        <span class="jc-pl">${progressLine(j) || `${pr.doneCount} of ${j.steps.length} steps done`}</span></div>
      <a class="btn primary big" href="${L(resume)}">${pr.pct > 0 || db.resume[j.id] ? "Continue where you left off" : "Start"}
        · Step ${resumeAt + 1}: ${j.steps[resumeAt].title} →</a>
      ${resumeAt > 0 && !(pr.pct > 0 || db.resume[j.id])
        ? html`<p class="fine">Step 1 is already done for you — ${pr.states[0].label.toLowerCase()}.</p>`
        : ""}
    </section>
    <ol class="path">${j.steps.map(
      (/** @type {any} */ s, /** @type {number} */ i) => html`<li class="${pr.states[i].done ? "done" : ""} ${resume.startsWith(s.path) ? "here" : ""}">
        <span class="pn" aria-hidden="true">${pr.states[i].done ? raw("&#10003;") : i + 1}</span>
        <div><h2><a href="${L(s.path)}">${s.title}</a> <span class="sc">${pr.states[i].label}</span>
          ${resume.startsWith(s.path) ? html`<span class="chip">you were here</span>` : ""}</h2>
          <p>${s.lede}</p></div>
      </li>`,
    )}</ol>`
  return { journey: id, title: j.title, heading: "", bare: true, body }
}

/** @param {string} id @returns {import("./shell.js").Screen} */
export function doneScreen(id) {
  const j = /** @type {any} */ (journeyById(id))
  const pr = journeyProgress(j)
  const post = JOURNEYS.filter((x) => x.when === "post")
  const at = post.findIndex((x) => x.id === id)
  const following = post.slice(at + 1).concat(post.slice(0, at)).find((x) => !journeyProgress(x).complete)
  let summary = ""
  if (id === "faces") {
    const t = faceTotals()
    summary = t.left === 0 ? `Every face worth naming is named — ${t.named} in all.${t.setAside ? ` ${t.setAside} too small or blurry are set aside.` : ""}` : `${t.named} of ${t.total - t.setAside} faces named. The rest will wait for you.`
  } else if (id === "thanks") summary = `${sentCards().length} of ${db.gifts.length} guests thanked.`
  else if (id === "review") summary = db.pending.length ? `${db.pending.length} posts still waiting.` : "Nothing waiting. New posts will show up on Home."
  else summary = "The gallery is ready for guests."
  const body = html`<section class="done-hero ${pr.complete ? "complete" : ""}">
      <div class="burst" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => html`<i style="--i:${i}"></i>`)}</div>
      <div class="big-check" aria-hidden="true">✓</div>
      <h1 tabindex="-1" id="page-h">${pr.complete ? "That's everything" : "Nice work"} </h1>
      <p class="lede">${summary}</p>
      <div class="done-ctas">
        ${following
          ? html`<a class="btn primary big" href="${L(resumePath(following))}">Next: ${following.title} →</a>`
          : ""}
        <a class="btn secondary" href="${L("/")}">Back to Home</a>
        <a class="btn ghost" href="${L("/" + id)}">See this journey</a>
      </div>
    </section>`
  return { journey: id, title: j.title + " · done", heading: "", bare: true, body }
}

/** @returns {import("./shell.js").Screen} */
export function allScreen() {
  const body = html`<p class="lede">Every part of the admin, in one list. Each is also in the sidebar.</p>
    <div class="all-grid">
      ${JOURNEYS.map(
        (j) => html`<section class="card"><h2><a href="${L("/" + j.id)}">${j.title}</a></h2><ul>
          ${j.steps.map((s) => html`<li><a href="${L(s.path)}">${s.title}</a> <span class="sc">${s.progress().label}</span></li>`)}
        </ul></section>`,
      )}
      <section class="card"><h2>Your site</h2><ul>
        ${SITE_TOOLS.map((t) => html`<li><a href="${L(t.path)}">${t.title}</a></li>`)}
        <li><a href="${L("/requests/blocked")}">Blocked senders</a></li>
      </ul></section>
    </div>`
  return { tool: "all", title: "Everything", body }
}

/** @param {string} path @returns {import("./shell.js").Screen} */
export function notFoundScreen(path) {
  return {
    title: "Not found",
    body: html`<p class="lede">There's no page at <code>${path}</code>. It may have moved.</p>
      <a class="btn primary" href="${L("/")}">Go to Home</a>`,
  }
}
