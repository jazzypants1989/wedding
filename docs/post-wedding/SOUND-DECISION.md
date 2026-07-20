# Thank-you card reveal — sound decision (implement from cold)

This document is a **self-contained brief** for a future agent implementing (or
retiring) sound on the `/thanks` card reveal. It assumes zero conversation
history. Read it top to bottom before touching code.

## What this is

The `/thanks` card reveal (envelope tap → paper opens → words cascade →
celebration) currently makes **no sound**. Whether it should — and exactly which
sound plays on each of the four beats — is **Jordana's call**. She auditions the
options in the dev-only **Sound lab** at `/studio` (right-hand panel) and records
her verdict via the **Decision** section there.

Her saved verdict lives in **`docs/post-wedding/sound-decision.json`** (same
directory as this file), written by the dev-only endpoint
`POST /api/studio/sound-decision` (handler: `api/studio.js`). **If that file does
not exist, no decision has been made yet — do not implement anything.**

### `sound-decision.json` schema (field by field)

```jsonc
{
  "version": 1,                       // schema version (integer)
  "savedAt": "2026-07-20T18:30:00.000Z", // ISO-8601, set server-side on save
  "decidedBy": "Jordana",             // optional free text; "" if left blank
  "notes": "…",                       // Jordana's notes for you; "" if blank; ≤2000 chars
  "masterLevel": 0.4,                 // number 0–1: the master gain she auditioned at
  "choices": {                        // EXACTLY these four beat ids, each one of:
    "envelope-tap":  "synth:envelope-tap",   //   "synth:<beat>"  → the beat's synth cue
    "envelope-open": "sample:open-paper",    //   "sample:<id>"   → a CC0 sample (see inventory)
    "word-cascade":  "none",                 //   "none"          → silent on this beat
    "celebration":   "sample:celebrate-cork"
  },
  "synthParams": {                    // per-beat snapshot of the synth sliders, so a
    "envelope-tap":  { "level": 0.45, "tone": 2200, "body": 205 },  // chosen synth cue
    "envelope-open": { "level": 0.32, "density": 12, "brightness": 0.5 }, // reproduces exactly
    "word-cascade":  { "root": 392, "decay": 2.0, "warmth": 0.5 },
    "celebration":   { "level": 0.55, "pop": 320, "fizz": 0.6 }
  }
}
```

Notes on the fields:

- **`choices`** is the decision. Each value is a strict, server-whitelisted
  string. `"synth:<beat>"` always uses the beat's own synth cue id (they are the
  same string). `"sample:<file-id>"` references a file id from the inventory below
  and is validated to belong to that beat. `"none"` means play nothing on that
  beat.
- **`synthParams`** only matters for beats whose choice is `"synth:…"`. It is the
  exact slider state to construct the synth voice with (see the cue builders'
  param keys below). For `"sample:…"` / `"none"` beats it is ignored.
- `GET /api/studio/sound-decision` returns this object, or `{ "exists": false }`
  when nothing has been saved. The endpoint is dev-only (404 in production,
  mirroring the `/studio` page gate in `core/static.js` `DEV_ONLY_PAGES`).

### If all four `choices` are `"none"`

Then **the correct implementation is to delete the sound experiment entirely** —
Jordana ruled the cards silent. Do NOT create `card-sound.js`. Instead run the
cleanup checklist at the bottom (remove the samples, the Sound lab module, the
dev endpoint, and these docs). Ship nothing to guests.

## Asset inventory

### CC0 samples — `public/sounds/card/*.m4a`

Real recordings, **CC0 (public domain), safe to keep in the repo**. Full
provenance + processing notes are in **`public/sounds/card/SOURCES.md`** (each
BigSoundBank source page was individually verified CC0). File id → path → beat:

| Sample file id    | File                                    | Beat            |
| ----------------- | --------------------------------------- | --------------- |
| `tap-wood`        | `public/sounds/card/tap-wood.m4a`       | `envelope-tap`  |
| `open-paper`      | `public/sounds/card/open-paper.m4a`     | `envelope-open` |
| `cascade-chimes`  | `public/sounds/card/cascade-chimes.m4a` | `word-cascade`  |
| `cascade-bells`   | `public/sounds/card/cascade-bells.m4a`  | `word-cascade`  |
| `celebrate-cork`  | `public/sounds/card/celebrate-cork.m4a` | `celebration`   |
| `celebrate-fizz`  | `public/sounds/card/celebrate-fizz.m4a` | `celebration`   |

All are m4a/AAC (plays in Safari/Chrome/Firefox; no fallback shipped). Decode
with `AudioContext.decodeAudioData` (it ignores the response Content-Type).

### Synth voices — liftable from `public/pages/studio/sound-lab.js`

Every synth sound is generated live via WebAudio (no asset files). The functions
are **pure and dependency-free** (each takes `(ctx, bus, params, when)` — no
globals, no DOM) precisely so they lift cleanly into the thanks page. Lift these
by name:

- **Four cue builders** (one per beat), keyed by choice:
  - `playEnvelopeTap`  (beat `envelope-tap`; params `level`, `tone`, `body`)
  - `playEnvelopeOpen` (beat `envelope-open`; params `level`, `density`, `brightness`)
  - `playWordCascade`  (beat `word-cascade`; params `root`, `decay`, `warmth`)
  - `playCelebration`  (beat `celebration`; params `level`, `pop`, `fizz`)
- **Reverb / bus helpers** they depend on:
  - `audio()` — lazily builds the shared `AudioContext` + master gain + gentle bus
    compressor + reverb bus `{ dry, wet }`. This is the graph to recreate.
  - `buildImpulse(c, seconds, decay)` — synthesizes the reverb impulse response.
  - `applyMasterGain()` — pushes level/mute onto the live master gain.
- **Lower-level synthesis helpers** the voices call:
  - `noiseBuffer(c, seconds)`, `route(c, node, bus, wet)`, `rpan(spread)`,
    `grain(...)`, `bellNote(...)`.
- **Sample playback helpers** (if any chosen beat is a sample):
  - `loadSample(c, path)` — fetch + `decodeAudioData` + cache by path.
  - `scheduleSample(c, master, buf, when)` — schedule a decoded buffer onto master.

The synth voices' offsets in the lab's arc (`offset` in the `CUES` array) are:
`envelope-tap` 0.0s, `envelope-open` 0.5s, `word-cascade` 1.35s, `celebration`
4.3s — a reference for relative spacing, though on the real reveal each beat is
fired from its own reveal hook (below) rather than one absolute schedule.

## Implementation guidance

Create **`public/pages/thanks/card-sound.js`** and wire it from
`public/pages/thanks/main.js`. The reveal stage machine is
`public/pages/thanks/reveal.js`: `playReveal(cardEl, opts)` drives the card
through stages `sealed → opening → unfolding → message → photos → ambient →
reply → complete`, invoking host callbacks (`opts.onOpen`, `opts.onReveal`,
`opts.onOpened`, `opts.onAmbient`, `opts.onReply`) at specific beats. main.js
passes those callbacks.

### Per-beat reveal hooks (real callback/function names)

| Sound beat (cue/choice) | Reveal stage | Hook to fire it from |
| ----------------------- | ------------ | -------------------- |
| **envelope tap** (`envelope-tap`) | `sealed` → `opening` (the tap gesture) | The `#tc-envelope` button **click** that `reveal.js` binds `onTap` to. The nearest existing `playReveal` callback is **`opts.onOpen`** (fired inside `onTap` via `beat("open", …)`), but main.js gates it behind `canReply`, so for a universal tap sound either widen `onOpen` to fire for all views or add a listener directly on the envelope element. **This click is also the audio-unlock user gesture** — unlock the `AudioContext` here. |
| **envelope opens** (`envelope-open`) | `opening` (flap lifts) | **`opts.onReveal(origin)`** — `reveal.js` fires it at the `opening` stage via `beat("reveal", …)`. (If you prefer the paper-rustle to land on the unfold, use **`opts.onOpened`**, fired at the `unfolding` stage.) |
| **word cascade** (`word-cascade`) | `message` (words appear) | **No callback exists yet.** `reveal.js` only `setStage("message")` here. Add an `onMessage` beat callback (mirror the existing `beat("ambient", () => opts.onAmbient?.())` line) fired right after `setStage("message")`, and wire card-sound to it. |
| **celebration** (`celebration`) | `ambient` (effects swell in — the finish) | **`opts.onAmbient()`** — `reveal.js` fires it at the `ambient` stage via `beat("ambient", …)`. Note the *visual* champagne/confetti one-shot (`fireRevealMoment` → `champagnePop`) currently fires much earlier at `onReveal`; if you want the celebration *sound* synced to that visual pop instead, fire it from `onReveal` and drop the celebration offset. |

### Hard requirements

- **Muted by default.** Add a small speaker toggle (🔊/🔇). Persist the
  preference in `localStorage` (e.g. key `tc-sound`). Sound only ever plays after
  an explicit unmute.
- **No-op under `prefers-reduced-motion`.** Use `prefersReducedMotion()` from
  `public/effects/effect-utils.js` (already imported in main.js). On the reduced
  path the reveal skips one-shots; card-sound must play nothing.
- **Never block or fail the reveal.** Fire-and-forget from each hook; wrap every
  call in try/catch and swallow. The reveal's own `beat(...)` wrapper already
  isolates callback throws, but do not rely on it — a decode error or a suspended
  context must never strand the guest.
- **Audio unlock rides the envelope-tap gesture.** Browsers require a user
  gesture to start an `AudioContext`; the envelope click is it. Create/`resume()`
  the context there.
- **Lazy sample loading.** Fetch + `decodeAudioData` chosen samples on first
  unmute (or first tap after unmute), not at page load. Cache decoded buffers.
- Zero deps, no regex, ESM `.js` imports, JSDoc types — same as the rest of the
  repo (see `CLAUDE.md`).

## Cleanup checklist (after implementation)

Once the decision is executed on the real card, remove the decision apparatus and
any unused assets:

1. **Unused sample files** — delete every `public/sounds/card/*.m4a` that the
   decision did not choose, and strip its row from `public/sounds/card/SOURCES.md`.
   If no beat chose a sample, delete `public/sounds/card/` entirely (files +
   SOURCES.md).
2. **Unused synth code** — from the lifted `card-sound.js`, strip cue builders /
   helpers for beats that ended up `sample`/`none`. Keep only what the chosen
   voices need.
3. **The Sound lab + decision apparatus** — decide whether `/studio`'s Sound lab
   panel stays (as living dev tooling) or goes. When the decision is *executed*,
   remove:
   - the dev-only endpoint: `api/studio.js`, its two routes in `core/router.js`,
     and its type block in `api/types.d.ts`;
   - `docs/post-wedding/sound-decision.json` and this `SOUND-DECISION.md`;
   - the Sound lab's Decision section (and, if the lab itself is retired,
     `public/pages/studio/sound-lab.js`, its import in
     `public/pages/studio/main.js`, the `#sound-lab-panel` markup in
     `public/pages/studio/index.html`, and the sound styles in
     `public/pages/studio/studio.css`).
4. **The walkthrough P.S.** — trim the Track-7 Sound lab paragraph in
   `docs/post-wedding/demo-walkthrough.html` if the lab is gone.

### Special case: all beats `"none"`

As stated above, if `choices` are all `"none"`, skip steps 1–2's "keep" logic
entirely: **delete the whole experiment** — all sample files + SOURCES.md, do not
create `card-sound.js`, and run steps 3–4 to remove the lab/endpoint/docs.
