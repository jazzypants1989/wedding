# Session 1: how devloop behaved

**Started 2026-08-06.** This is the note `SESSION-PLAN.md` §1 asks session 1 to
produce, and it is session 2's input. It records **how the tool behaved**, not
what it found about the app — the app issues live in `.claude/issues-faces/`.

Kept append-only during the session. Each entry says what happened and how
confident the diagnosis is, because at least one of these is a read of the code
rather than an observation of it.

---

## D-1 — `runner.run()` SIGKILLed an unrelated server on :3000

**Confidence: verified mechanism, inferred trigger.** The mechanism is read
straight from the code and from devloop's own docs; that *this* run was the one
that fired is inferred from timing and from what was running.

**What happened.** The wedding smoke server was started on :3000 as the base of
the review chain. It came up, answered `/api/health` with a 200, and was killed
about four minutes later with **SIGKILL** (exit 137). It logged a normal
startup and no shutdown — the graceful `SIGTERM` path never ran.

**Not memory.** The obvious suspect was jetsam on a MacBook Air. Ruled out:
system-wide free memory was 76% at the time, swap was under half used, and
`log show --predicate 'eventMessage CONTAINS "jetsam"'` over the window returned
nothing.

**The actual mechanism.** `modules/runner/src/runner.js:219`, the first
statement of `run()`:

```js
cleanupPorts([port, cdpPort]);
```

`port` defaults to `3000` (`runner.js:43`). `cleanupPorts` →
`killProcessOnPort` defaults to `force: true` and kills **the first PID `lsof`
reports on that port, with no check of what the process is.** So any devloop
run that does not override `port` force-kills whatever a developer happens to
have on :3000.

**Why this run.** A parallel session in `~/repos/make-a` was executing
`scripts/bin/parser-survey.js`, which fans out `node --test` across every
module — `modules/runner/tests/` among them — during exactly that window.

**It is already known, and already written down.**
`modules/runner/PROCESS-LIFECYCLE.md` §9 describes this defect precisely, names
`PU-11` as the underlying no-check-before-kill behaviour, and predicts the
sibling case: `cdpPort` defaults to **9222**, so the same line SIGKILLs a
developer's own Chrome debugging session. Its recommended fix is to drop the
pre-emptive kill once ports are ephemeral, and to verify the process before
killing until then.

**So the finding is not the defect — it is that a documented defect with a
known fix was left live long enough to take out a bystander in another
repository.** That is a prioritisation signal for session 2, and it is the
argument for doing the "verify before killing" stopgap now rather than waiting
on the ephemeral-ports work.

**Blast radius here, checked rather than assumed.** The capture Chrome runs CDP
on **9600**, not 9222, so it was never at risk. :3002 and :4600 are not in any
default kill list. Only the :3000 hop was exposed.

**Worked around, not fixed.** The smoke server now runs on **:3010**
(`PORT=3010 node server.js`) with the proxy pointed at it
(`--upstream 127.0.0.1:3010`). The proxy stays on :3002 and the capture session
on :4600, so the capture session did not need restarting. Nothing in devloop
was changed.

**One loose end for session 2 to decide:** whether `findAvailablePort`'s
`startPort = 3000` default (`ports.js:160`) deserves the same scrutiny. It only
*selects* a free port rather than killing anything, so it is not this bug — but
it is the same hardcoded 3000 assumption, and if the ephemeral-ports fix lands
it should probably go too.

---

## D-2 — the browser cache defeats the anonymisation guarantee

**Confidence: verified.** Observed, then confirmed from both directions — the
code has no leaking branch, and clearing the cache fixed it.

**What happened.** Hours after the chain was brought up, the owner opened the
Faces tab and reported that most faces were **not anonymised** — real
photographs on screen. An empty-cache-and-hard-reload fixed it completely.

**So the proxy was not leaking, and this was checked rather than assumed.**
Two independent confirmations:

- **By code.** `servePlaceholder` in `placeholder-proxy.mjs` always synthesizes
  a PNG for any path under `/media/`. The only non-PNG exit is the
  `status >= 400` branch, which returns `text/plain`. There is no path through
  it that returns upstream image bytes. The proxy's matcher (`/media/`) is also
  an exact mirror of `server.js:46`, which is the only file server for the
  uploads tree — so nothing serving a photograph can miss it.
- **By measurement.** `tmp/leak-check.mjs` (kept — it is the re-verification
  tool this apparatus was missing) walks every variant of every live media row
  through **both** hops and classifies each response by **magic bytes only**,
  never decoding and never touching pixels. Result: every 2xx on both `:3002`
  and `:4600` was a synthesized PNG. Zero real bytes.

**Why it happened anyway.** Chrome runs on a **persistent profile** — deliberate,
so the admin login survives across capture sessions. That profile carries a
persistent **HTTP cache**, and a cache that already holds real photographs will
replay them no matter what the proxy does now.

**This contradicts `SCREENSHOT-PROXY.md`'s central claim**, which says the
guarantee is *structural, not procedural*:

> none of them can capture a photograph, because the browser never received one

That holds for the **network**. It does not hold for a **profile that already
received one** on some earlier run. The doc should be amended: the guarantee is
structural *given a cold cache*, and the cold cache is currently procedural —
it depends on a human remembering to hard-reload.

**Note the near-miss.** Placeholder responses carry `cache-control: no-store`,
so placeholders never poison the cache; only *real* responses persist. Which
means the failure is silent and one-directional — the apparatus looks like it is
working right up until it is showing you photographs, and nothing in it can tell
you which you are looking at.

**The fix belongs in devloop, and is small.** The capture CDP session should
issue `Network.setCacheDisabled(true)` on the proxied target, which makes the
cold cache structural for every session without giving up the persistent
profile or the login. Failing that, launching with `--disk-cache-size=0`, or
having the capture proxy send `Clear-Site-Data: "cache"` on first navigation.
**Session 2 item.** Until it lands, the procedural rule is: **empty cache and
hard reload before trusting a single frame of the Faces tab.**

### Addendum, 2026-08-14 — the stopgap that does not depend on remembering

The capture CLI has no cache flag, but it does have `--profile=DIR`. Pointing it
at a **fresh profile under `tmp/`** gives a cache with nothing in it to replay,
which restores the structural guarantee for the price of one admin login:

```bash
node ~/.claude/skills/cli.js capture http://localhost:3002 \
  --store=.claude/issues-faces --profile=tmp/capture-chrome-profile
```

This is what the 2026-08-14 chain was started with. It is a worse trade than
`Network.setCacheDisabled(true)` — it throws away the login the persistent
profile exists to keep — so it does not replace the session 2 item. It is only
the version of the rule that a tired human cannot forget to follow.

**Note for session 2:** a `--profile` pointed inside a repo also means the
profile directory is a thing someone has to clean up. `tmp/` is gitignored here,
so it is scratch by construction, but the same command in a repo without that
convention would leave a Chrome profile in the working tree.

---

## D-3 — the chain came up clean on the second attempt

**Confidence: verified.** Observed this session, end to end.

Session 1 was abandoned twice before anything was filed (the ledger records two
`session.started` / `session.ended` pairs with no issues between them). The
third bring-up, 2026-08-14, needed no debugging: the smoke database and its
uploads tree survived intact, and the ports came up in order.

Two things were checked rather than assumed, both of which would have been silent
failures:

- **The quarantined directories in the Aug 9 server log are not damage.**
  The media integrity sweep quarantines upload directories with no live media
  row. Every live row still has its file on disk, verified by
  walking `file_key` against the sharded tree. The quarantined set is leftover
  from earlier imports. Worth knowing because the log looks alarming and the
  default `MEDIA_QUARANTINE_TTL_DAYS` is 7, so a reader could reasonably conclude
  the smoke gallery was about to be purged.
- **`tmp/leak-check.mjs` was re-run before browsing**, per D-2, and reported only
  synthesized PNGs across both hops, with zero real bytes. This is now the thing
  that should run at every bring-up, not just after a suspected leak — it takes
  under a minute and it is the only check that distinguishes a working apparatus
  from one that is showing you photographs.

**One drift worth recording.** `SCREENSHOT-PROXY.md` documents the chain as
`4600 → 3002 → 3000`; D-1 moved the base hop to **:3010**, so the real chain is
`4600 → 3002 → 3010` and the proxy needs `--upstream 127.0.0.1:3010`. The doc
lives outside this repository and was not edited.

## Carried for later — raised by the owner, 2026-10-28

Noted while starting session 3; none of these is worked yet.

- **D-4 — devloop needs a way to merge stores.** Session 1 filed into
  `.claude/issues-faces/` per SESSION-PLAN.md, and the owner went looking for
  the issues in `.claude/issues/` and thought they were lost. Both stores number
  from `iss_0001`, so merging today means hand-editing two ledgers and renaming
  screenshots. Wanted: an `issues merge --from=DIR` that renumbers, moves
  screenshots/replays, and keeps the approval state. Also: `list` could mention
  sibling stores, so a store that is not the default is not invisible.
- **D-5 — the plan's reason for separate stores did not land.** SESSION-PLAN.md
  says the two stores are kept apart for "headspace, not volume". The owner did
  not know what that meant. If a separation is worth keeping, the plan should
  say what it protects in concrete terms.
- **App — admin sessions kept logging out during the session-1 walk-through.**
  On the `:3002` proxy hop while working the Faces tab. Not diagnosed. Things
  to check first: the 30-minute idle timeout against how long a face review
  takes, CSRF rotation on the hourly boundary, and whether the proxy hop drops
  or rewrites `Set-Cookie`.
- **App — guest monogram avatars are always the same blue.** Reported by a
  session-3 design agent, not yet confirmed here: the per-guest hue is set
  with an inline `style=` attribute, and the strict CSP blocks it. Same family
  as the T18 inline-style issue.
