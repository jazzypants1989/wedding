# Admin — the Workspace shell: contract for panel builders

The admin is the "Workspace" design (`prototypes/admin-workspace/`, IA.md). The
shell, design system, router and Home are built; panels are migrated one slice at
a time. **Fidelity to the prototype is the bar.** Open the prototype view next to
yours (`http://localhost:4700/admin-workspace/…`) and match it.

## Files

| File | What | Owner |
|---|---|---|
| `admin.css` | tokens, base elements, shell, shared primitives, Home | shell (don't add to it) |
| `admin-review.css` / `admin-thanks.css` / `admin-faces.css` / `admin-panels.css` | one per slice, loaded after `admin.css` | that slice |
| `routes.js` | NAV (sidebar items), NAV_GROUPS, BOTTOM_NAV, ROUTES — pure, unit-tested | shared: add rows, don't reorder |
| `router.js` | navigation, history, guard, dialog routes, sidebar/bottom bar/More, crumbs, keys | shell |
| `icons.js` | `icon(name)` — the prototype's stroke icons | shell (add names freely) |
| `utils.js` | `api`, `openModal`/`closeModal`, toasts (`showSuccess`/`showError`/`showUndo`) | shell |

Scope every panel rule under its panel (`#tab-moderation .row { … }`), so slices
never collide. Prototype-only pieces for your slice are listed in the header of
your CSS file — port them from `prototypes/admin-workspace/app.css` value for value.

## Design tokens and primitives

Tokens (all `light-dark()`; never hard-code a colour that must work in both
themes): `--ws-bg --ws-panel --ws-side --ws-ink --ws-muted --ws-line --ws-accent
--ws-accent-ink --ws-accent-soft --ws-sel --ws-hover --ws-ok --ws-danger
--ws-title` (display headings), `--ws-primary --ws-primary-ink` (`.btn-primary`
only: the brand coral, so a primary never reads as the danger red),
`--side-w --list-w --bar-h`. The site tokens
(`--color-text`, `--color-card-bg`, `--color-primary`…) are remapped onto these.

Type: body Jost 15px/1.45; `h1` DM Serif 1.6rem in `--ws-title`; `h2`/`h3` Jost
500 1.05rem ink. Helpers: `.muted .small .fine .eyebrow`, `<kbd>` (hidden on touch).

Primitives (prototype class names — copy the prototype's markup):

- **Buttons** `.btn` (neutral) `.btn-primary` `.btn-danger` (confirms only)
  `.btn-danger-soft` `.btn-ghost` `.btn-sm` `.btn-lg` `.btn-block` `.icon-btn`
  `.linklike` `.btn-row`. `<kbd>` inside a `.btn` is the key hint.
- **Split view** — the panel root:
  ```html
  <div id="tab-x" class="tab-content panel-fill">  <!-- panel-fill: no page padding, full height -->
    <div class="split has-sel">                    <!-- has-sel: phones show the detail -->
      <section class="pane pane-list" aria-label="…">
        <header class="pane-head"><h1>…</h1><nav class="seg">…</nav><div class="chips">…</div></header>
        <ul class="rows"><li><a class="row" href="/admin/x/12" data-select aria-current="true">
          <span class="thumb|avatar">…</span>
          <span class="row-main"><span class="row-top"><strong>Name</strong><span class="row-time">2h</span></span>
          <span class="row-sub">second line</span></span></a></li></ul>
        <footer class="pane-foot"><kbd>j</kbd> <kbd>k</kbd> move</footer>
      </section>
      <section class="pane pane-detail" aria-label="Selected item">
        <a class="m-back" href="/admin/x" data-up>‹ X</a>
        <article class="detail"><header class="detail-head"><span class="eyebrow">…</span></header>…</article>
        <div class="actionbar"><button class="btn btn-primary btn-lg">Approve <kbd>a</kbd></button>…</div>
      </section>
    </div>
  </div>
  ```
  Also: `.row.is-unread`, `.row-wrap > .tick + .row` (bulk tick), `.rows-heading`,
  `.list-empty`, `.bulkbar`, `.detail-empty`, `.person-head`, `.facts`,
  `.stepper-mini`, `.cta-strip`, `.done-state > .done-icon` (queue empty → next step).
  A split with an `id` can take a resizable divider: add
  `<div class="split-handle" role="separator" aria-orientation="vertical" tabindex="0"
  aria-controls="<list id>" aria-label="List width"></div>` as its last child
  (split-resize.js: drag, ← →, double-click resets; remembered per split).
- **Single-column page** `.single(.single-wide) > .single-head`.
- **Controls** `.seg` (links, `[aria-current="page"]`, `.seg-n` count), `.chips >
  .chip[aria-current="true"]`.
- **Status** `.count` / `.count-heart`, `.pill.st-draft|st-sent|st-opened|st-replied|st-none`,
  `.tag`, `.status-note(.is-error)`, `.dirty-note`.
- **Forms** `.form` (grid of `label > input`), `.form-row`. Bare inputs, selects and
  textareas are styled everywhere; checkboxes take the accent.
- **Dialogs** any `<dialog>`; `.modal-header h2` + `.modal-close` + `.modal-actions`
  (or the prototype's `.dlg-head`/`.dlg-x`/`.dlg-actions`). `.confirm` for a
  question. On phones every dialog except `.confirm`/`.relogin` is a bottom sheet.
- **Toasts** `showSuccess(msg)`, `showError(msg)`, `showUndo(msg, fn)` — `z` runs the undo.

CSP: no `style="…"` in any template (a unit test scans for it) — use classes, or
CSSOM (`el.style.x = …`), or `<progress>` for bars. Build markup with the `html`
helper. It escapes every value, **attributes included**: write
`aria-current="${on ? "true" : "false"}"`, never `${on ? 'aria-current="true"' : ""}`.

`#view` is the only scrolling element (the shell is fixed): never `window.scrollTo`.
With `panel-fill`, the view stops scrolling and your panes do.

## Routes

`routes.js` → `ROUTES`. A route: `{ path, tab, nav, title, sub?, sel?, dialog?, parent?, redirect? }`.

- `path` is relative to `/admin` and may have `:params` (`"review/:id"`,
  `"faces/groups/:face"`, `"thank-yous/cards/:id/edit"` already exist). An exact
  match wins; otherwise the longest literal prefix keeps a deeper path in its section.
- `tab` is your panel (`#tab-<tab>`); `nav` the sidebar item it lights (a `NAV` key).
- `sel: "id"` marks the selection param: clicking a `data-select` link while a
  selection shows is replace-navigation (Back leaves the list, not the 30 posts).
- `dialog: "<dialog id>"` + `parent: "<route path>"` makes a **dialog route**: the
  router draws the parent panel, mounts you (`ctx.route.dialog` is set), opens the
  dialog. Closing it (✕, Cancel, Esc, backdrop) goes `up()` to the parent; Back
  closes it; leaving the route closes it. Don't call `openModal` for it yourself.
- `redirect: "other/path"` is an alias (always replaced).
- Add a sidebar item in `NAV` + `NAV_GROUPS`. Its `badge` id is created for you;
  set it with `setNavBadge(key, n)` (bare numbers; More's dot follows).

## Module contract

```js
import { registerPanel, navigate, up, setCrumbs, addGuard, setNavBadge } from "./router.js"

registerPanel("moderation", {
  // Every arrival at one of this panel's routes — first entry AND every
  // param/query change. ctx: { route, params, query, path, prev, samePanel, replace }
  mount(params, query, ctx) { … select params.id, render … ; setCrumbs([{ label: "Hannah Weiss · Photo" }]) },
  unmount() { … },                              // leaving for another panel
  keys(e, ctx) { if (e.key === "a") { approve(); return true } return false }, // not while typing / a dialog is open
  help: { title: "Review posts", keys: [["a", "Approve"], ["j k", "Next / previous"]] }, // shown in the ? sheet
})
```

Call `registerPanel` from your module's own `init*()` (main.js already calls
it), so slices don't all edit main.js. A registered panel is never sent to
main.js's `loadLegacyPanel`; an unregistered one still gets its old `load*()` on
first show. (Every panel is registered now; a sub-view is `ctx.route.sub`.)

Navigation:

- `<a href="/admin/…">` is all you need — clicks are intercepted (push).
  `data-select` → replace when a selection is showing; `data-replace` → always
  replace (filter chips); `data-up` → `up(href)` (back chevrons, Close).
- `navigate(path, { replace: true })` — advance-after-act: approve, then replace
  to the next item. Redirects (auto-select the first item on wide screens) are
  replaces too.
- `up(fallback)` — `history.back()` when the previous entry is `fallback`, else
  replace to it. Use it for every Close / ‹ back.
- `setCrumbs([{ label, href? }])` replaces the crumbs after the section and the
  document title. Reset on every arrival, so call it from `mount`.
- `currentPlace()` returns the current ctx.

Leave guard (IA §6, §13.3):

```js
const remove = addGuard({
  what: "this thank-you card",           // "Your changes to … haven't been saved."
  dirty: () => composer.dirty,
  save: async () => { … return true },   // optional: adds "Save and leave"; false keeps you there
  path: "/admin/thank-yous/cards/17/edit", // guards while the URL is under this prefix
  // or tab: "thankyous"                  // guards while the panel shows
})
// call remove() in unmount (or when the edit is done)
```

It covers sidebar clicks, links, chords, Back/Forward (vetoed and rewound without
losing the forward stack) and reloads (`beforeunload` stays the module's job).
Site content already offers Save and leave; the card composer's guard is
two-way until the thanks slice passes its `save`.

Section memory is automatic: the sidebar returns to the last path in a section
(from elsewhere), or to its root (from inside it). Home's "Pick up where you left
off" is the last place outside Home.

Shell keys: `g` + `h r f y g c m u s` jump, `?` the sheet, `z` undo, `Esc` (phones)
from an item back to its list. Your `keys` run after these.
