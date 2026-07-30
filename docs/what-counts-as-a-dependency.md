# What counts as a dependency?

*Adding face recognition to an app with none.*

**Date:** 2026-07-29 (revised)
**Companion documents:** [feasibility study](./post-wedding/RESEARCH-face-recognition.md) ·
[build spec](./post-wedding/SPEC-vision-lab.md) ·
[model provenance ledger](./post-wedding/VISION-MODELS.md)

---

## The question

This is a wedding RSVP site. It has one hard architectural rule, stated at the
top of its `CLAUDE.md`: **zero dependencies.** Node built-ins only. No npm
packages. The `package.json` dev-dependency block contains `typescript` and
`@types/node`, and neither is ever imported at runtime.

It also has, by now, a media gallery holding a couple of thousand wedding
photos, and an obvious itch: *could we do face recognition on those?* Not
because anyone needs it. Because it's the kind of thing you're told requires a
dependency, and this codebase has spent its whole life not having any.

The interesting part turned out not to be the machine learning. It was
discovering that "zero dependencies" is a slogan that doesn't survive contact
with the problem — and that the version which replaces it is better.

Then, on a second pass, it turned out that most of what I'd written about the
models was wrong, and that finding out *why* was more interesting than the
original argument.

---

## First: face recognition is four things, not one

The phrase describes a pipeline, and its stages have wildly different costs. Most
of the intimidation attaches to the wrong one.

**Detect.** Find face-shaped boxes in a photo. This is a solved 2001-era problem —
Viola-Jones and its descendants — and the modern small-CNN version is a
54,000-parameter network. Not hard.

**Align.** Find the eyes, rotate and scale the crop so they land in canonical
positions. A few hundred lines. Also not hard. Also *not optional* — skip it and
everything downstream silently degrades.

**Embed.** Turn a face crop into a vector where distance means identity. This is a
convolutional neural network and there is no way around that. This is the hard
one.

**Cluster.** Group the vectors, let a human name the groups. Trivially easy —
maybe 150 lines.

Three of the four are ordinary programming. The whole difficulty concentrates in
one stage, and — this matters — the difficulty there isn't *writing the code*. The
network I settled on is fourteen convolution blocks and a matrix multiply.
Implementing that from scratch is tedious and error-prone, but it is not research.
It's maybe 800 lines of careful array arithmetic.

The difficulty is that those convolutions need **numbers in them**, and you
cannot derive the numbers by thinking hard.

Hold that thought.

---

## Two surprises from the codebase, and why I got both of them wrong

Before the philosophy, two findings that inverted my instincts about where this
code should live. I'm keeping them in, including the parts I had to retract,
because the retractions are the useful bit.

### "The server is the wrong place to run this"

My first instinct was a batch job on the server: read the photos off disk, chew
through them, write results to SQLite. Obvious. I talked myself out of it:

```
$ node -e "console.log(typeof createImageBitmap, typeof OffscreenCanvas, typeof ImageData)"
undefined undefined undefined
```

Node has no canvas and no image decoding. To process an image server-side you
must first decode it yourself. JPEG is survivable — a baseline decoder is a few
hundred lines. But this app's client-side pipeline calls `encodePreferWebp()`,
so most stored variants are **WebP** — and a pure-JS WebP decoder means
implementing a VP8 intra-frame decoder. That's not a weekend; that's a project
with its own blog post.

So I concluded the browser was the only venue, and built an entire architecture on
it.

**The premise was true and the conclusion was wrong**, because you don't have to
decode an image in JavaScript to decode an image. You can ask the operating system:

```
$ magick photo.jpg -depth 8 RGB:-        # raw pixel bytes on stdout
```

Straight into a `Float32Array`. No decoder, no VP8, HEIC included.

The part that stings: **this repo already does exactly that.** There is a file
called `scripts/lib/image-backend.js`, on the branch I was working on, that shells
out to vips, ImageMagick, sips and ffmpeg, with try-exec probing and argv-array
safety. There is a section in `CLAUDE.md` called *"System Binaries Are a
Dependency Too — CLI Only"* that governs it. I had written a long argument about
where computation must live while standing on a solved version of the problem,
two directories over.

The lesson isn't "read the codebase," which everyone already knows. It's that
**a constraint you discover feels more authoritative than a constraint someone
else already resolved**, and that asymmetry is worth distrusting. The finding was
mine, so I believed it harder than the code.

### "The Content-Security-Policy had already made the architecture decision"

There are two ways to get fast numerical code into a browser: WebAssembly, or
WebGPU compute shaders. I assumed WASM, because that's the well-trodden path.

But this app serves `script-src 'self' 'sha256-…'` with no `unsafe-eval` and no
`wasm-unsafe-eval` — and Chrome requires the latter to instantiate WebAssembly at
all. So WASM would mean **relaxing the CSP on a public website** to add a feature
that doesn't need it.

I found this delightful, and wrote:

> *A security decision made years earlier, for unrelated reasons, had quietly
> eliminated one of the two options and left the other untouched. I've come to
> think this is the most underrated thing about strict constraints: they don't
> just forbid, they choose, and often they choose better than you would have.*

It's a nice paragraph about a thing that didn't happen.

The CSP in this app is **already per-page** — `core/static.js` has a
`FRAMEABLE_SAMEORIGIN_PAGES` list that relaxes framing for exactly one page. The
vision tooling lives at `/studio`, which is already dev-only and already 404s in
production. Scoping `wasm-unsafe-eval` to that one page would be a five-line
change with existing precedent, not a posture shift.

And it wouldn't matter anyway, because every WASM runtime worth having is
third-party code, which the rule below forbids. **WASM is out because of our own
rule.** The CSP was never the binding constraint; I promoted a coincidence to a
cause because the story was better that way.

I've left the original paragraph in because the failure mode it demonstrates is
common and flattering and hard to notice: constraints-that-choose-for-you is a
genuinely good idea, and believing in it made me manufacture an instance.

---

## The actual question: what is a dependency?

Here's where it got interesting.

The owner's position, arrived at independently and offered with appropriate
suspicion — *"does this make sense, or am I twisting myself in knots to accept
what is essentially a dependency lol"* — was a split:

- **Third-party code:** no. Even MIT-licensed, even 200 lines. Write it ourselves,
  in our own idiom, from a description of the algorithm.
- **Third-party trained weights:** fine. "I look at that on the same level as the
  OS primitives we use, or WebGPU. Common substrate."

The instinct is right. The justification isn't, and finding the one that works
turned out to be the most useful thing in the whole exercise.

### Why "common substrate" fails

WebGPU and OS primitives are **specifications with multiple independent
implementations.** If Chrome's WebGPU is bad, Firefox's exists. They're
standardised, adversarially reviewed by competing vendors, and replaceable.

A weights file is a **single artifact from a single source.** It is unauditable
in principle — it's ten megabytes of floating-point numbers; there is no reading
it. Its licence may restrict you in ways no OS primitive ever would. If it
disappears, or its terms are challenged, there's no swap.

That's not substrate. That's a single-source supplier, and calling it substrate
is exactly the knot-tying the owner suspected.

### The line that does hold

Ask instead what "dependency" is actually a proxy for. Every real cost is a cost
of **code that executes and changes**:

- supply-chain injection — needs a publish pipeline you don't control
- transitive graphs — needs a package manager resolving other people's needs
- upgrade treadmills, API churn, breaking majors — needs *versions*
- CVEs — needs an attack surface, which needs execution

A pinned array of floats has none of these. It doesn't execute. It doesn't have
versions in any meaningful sense — you pin it once and it never moves again.
`npm audit` has nothing to say about it, and never will.

This is why nobody calls **tzdata** a dependency, or the Unicode tables compiled
into V8, or a `.woff2` file. They're all third-party artifacts. They're all
inert.

And there was precedent sitting in this repo already: the sound lab ships **CC0
sample recordings**, and nobody thought that violated zero-dependencies.

So:

> **If it executes, we write it. If it's inert data, we may vendor it — with its
> licence recorded, its provenance documented, and its hash pinned.**

Which, combined with the system-binaries rule that was already written, gives
three tiers rather than two:

| Tier | Examples | Rule |
|---|---|---|
| **Code that executes in our process** | kernels, decode, clustering, loaders | We write it. All of it |
| **Inert data** | trained weights, CC0 samples, tzdata, fonts | May vendor. Licence recorded, hash pinned |
| **Dev-machine tools** | vips, ImageMagick, ffmpeg, macOS Vision | CLI only, never the request path |

Checkable. Principled. Draws itself in every case. And note that the third tier
already existed and the first was already implied — the only genuinely new work
was the middle row. The rule I thought I was inventing was mostly a rule I was
finishing.

### The rule pays for itself immediately

Apply it, and the pipeline splits along a seam I wouldn't have found by argument:

- The scanner, the decode, the box clustering, the alignment, the network
  evaluation — **code.** Write it.
- The trained convolution kernels — thousands of floating-point numbers that no
  human wrote — **data.** Fetch it, hash it, document it.

That's not a compromise between the two positions. It's what the rule says, and
it happens to give the owner precisely the first-party implementation they wanted,
without pretending the trained parameters could have come from anywhere else.

### One more turn: don't commit it either

There's a codicil I missed the first time. This repository is **public.**

Using a weights file and *redistributing* one are different permissions. Committing
a 10 MB blob to a public GitHub repo makes you its distributor, and that's the
exact point where "it's a personal project, it's non-commercial" stops being a
sufficient answer — most obviously for copyleft, which doesn't care whether you
charge money.

The fix is embarrassingly easy and strictly better: **don't commit the weights.**
A `fetch-weights.js` script, a hash-pinned manifest, a gitignored directory, and a
generated `LICENCE.md` per artifact. Now the repo contains zero encumbered bytes,
and every question about no-derivatives and non-commercial and ShareAlike
redistribution isn't answered — it's *absent*. Each person who clones it makes
their own decision at fetch time.

It also happens to be the thing the owner had already proposed, in different
words, in the first conversation: *use something for our personal project and
leave convenient holes that others could fill themselves.* The holes turn out to
be a hash table and a download script.

---

## The part that's actually philosophically interesting

Which brings back the held thought.

A face detector's trained parameters are not arbitrary constants that a
sufficiently clever programmer could derive. They are the **output of a training
run over tens of thousands of labelled face crops.** They encode what a face
looks like, learned from examples, in a form no human can read or write.

So you can write every line of the detector yourself — genuinely from first
principles, no copying — and it will not detect a single face until you give it
numbers that somebody else's training run produced.

This is a different category from anything else in a normal codebase. You can, in
principle, write your own JSON parser, HTTP server, SQLite driver, and image
codec. People do. Every one of those is *knowable*: a specification exists, and a
sufficiently determined person can derive an implementation from it.

There is no specification for "what a face looks like." There is only a dataset,
and a training run, and a pile of numbers that came out the other end.

So a codebase can be one hundred percent first-party **code** and still be unable
to function without borrowed **knowledge**. The zero-dependency ideal turns out to
have a floor, and the floor isn't where you'd guess — it isn't at the OS, or the
language runtime, or the browser. It's at the boundary of what is derivable
versus what must be learned from examples.

You could go below it: training your own detector cascade is genuinely tractable
— it's AdaBoost over pixel-comparison stumps, classical ML, a few CPU-hours on a
public face dataset, no GPU needed. But you'd need a dataset, which has its own
licence, which was assembled by other people from photographs of other people. The
borrowing doesn't stop; it just changes shape. At some point you are standing in
a field taking pictures of your friends, and that is a fine place to stop and
admit the ideal was always asymptotic.

---

## What fell out of it

Once the venue question was settled properly — offline batch on the owner's Mac
for the existing two thousand photos, and *also* in the browser at upload time
for new ones — the design fell out of one constraint: the pipeline has to be
written once and run in both places. So `public/vision/` is pure numeric
JavaScript that may not import `node:*` and may not touch the DOM, with four
adapter seams around it: pixel source, compute backend, storage, and model
registry.

The nicest thing in the whole design is a side effect of that. The upload path
already calls `createImageBitmap()` and draws to a canvas to make thumbnails, so
the pixels are already decoded, on the guest's own device. Running the detector
there is nearly free — and it means the work is *already distributed across the
guest population*. Every phone processes its own photos. No queue, no server
compute, no batch.

And it lands the privacy seam in exactly the right place, which I did not plan.
A bounding box is not a biometric identifier. An embedding is. So: guests' devices
find *where the faces are*; the couple's machine works out *who they are*. That
split isn't a policy bolted on afterwards — it's where the hardware boundary
already was.

The other thing I'd claimed and had to withdraw: I sold this as "one GPU substrate
consolidating graphics, audio and vision," while simultaneously declaring that
rewriting the 29 existing visual effects onto the GPU was an explicit non-goal.
Which means the substrate would have had exactly one consumer. That's not
consolidation, it's an abstraction layer with a press release. The GPU backend is
now an optional tier six, wanted rather than needed, and the honest reason to build
it is that WGSL is fun.

---

## The part where I went looking, and found something worse

The essay could have ended there. Then I ran the model search — deliberately,
because licensing in this corner moves faster than any model's memory of it —
and the findings sharpened the thesis rather than merely completing it.

I expected to find a shortlist with a clear winner. What I found was that the
borrowed knowledge is not only borrowed; **it is borrowed under terms that
substantially nobody can state precisely, and which have never been tested.**

A partial inventory, all verified against actual licence files rather than
remembered:

**InsightFace — the most widely used face-recognition codebase in the world — has
no LICENSE file.** Not a restrictive one. None; the URL 404s. Its entire
licensing position is prose in a README, which says its models are for
non-commercial research only. Everyone cites it as "MIT."

**WIDER FACE is CC BY-NC-ND 4.0.** That's the benchmark dataset behind
essentially every open-source face detector — and the licence is
*no-derivatives*, on a dataset whose entire purpose is producing derivative
models. Whether a trained weight file is a "derivative" of its training data is
legally unsettled, and there is no case law. Every detector in my shortlist
inherits this. (Worth noting how hard this was to pin down: the canonical terms
page serves a mismatched TLS certificate and the university mirror is now a
redirect stub, so the licence had to be read off the dataset's Hugging Face card.
The most-cited face dataset in the field, and its terms are effectively
unreachable at the source.)

There's a second layer under that one. The permissively-licensed detectors are
trained on *annotations* that came from InsightFace's corpus — MIT and BSD tags
sitting on top of an annotation set its own author restricts to non-commercial
research. So the chain is: restricted annotations → permissively-tagged weights →
your app. Nobody in that chain is being dishonest. The links just don't compose.

**Ultralytics asserts that AGPL-3.0 reaches trained weights** — in published text,
*"even if you train your own model from scratch"* and *"do not use pretrained
weights"* — and that deploying over a network triggers source disclosure of your
entire application. The counterargument (weights are program *output*, not a work
based on the program) is substantial. Also untested. Worth noting that this is the
one restriction in the whole survey that a non-commercial personal project does
*not* escape, since copyleft has never been about money.

**Third-party re-uploads relabel licences with no authority.** Several
much-downloaded Hugging Face repos tag InsightFace-derived weights `apache-2.0`
or `mit`. A downstream trainer cannot grant a licence they don't hold. At least
one of these is demonstrably, checkably wrong, and people are building on it.

And then, in the middle of all that, one person doing it properly. Davis King
released his dlib models into the public domain — except the 68-point facial
landmark predictor, where he notes that the training set's licence excludes
commercial use and that a co-author *"asked me to include a note here saying that
the trained model therefore can't be used in a commercial product."* It is the
only case I found of a model author conceding in writing that dataset terms
propagate into trained weights — the exact question everyone else's licence tag
quietly assumes away. He gave up a claim he could easily have made. The
convention is to ignore this; he didn't.

And the escape hatch — **models trained on synthetic faces**, a research programme
aimed precisely at this problem — turns out not to have an exit yet. The one
lightweight synthetic-trained family is GPL-3.0 *and* distilled from a teacher
trained on MS-Celeb-1M, the dataset Microsoft withdrew. The cleanest provenance
anywhere in the field belongs to a synthetic dataset built from 511 consented 3D
scans, whose data agreement explicitly defines models trained on it as "Results"
and forbids commercial use of those. The contamination routes around the fix.

The net result: **you cannot currently have all three of small, permissively
licensed, and clean training-data lineage in a face embedding model.** Pick two.
That gap is real, and it is not a search failure.

---

## And then the part where I checked my own homework

One more pass, and it produced the finding I actually didn't expect.

Everything above — the sizes, the architectures, the operator inventories, the
licences — I had assembled from papers, model cards, READMEs and repository
metadata. Standard practice. It's what the documents are for.

Then I wrote a two-hundred-line protobuf walker and read the files.

**Roughly half of it was wrong.** Not subtly:

- The detector I'd recorded as BSD-3-Clause is **MIT**. Its `LICENSE` file says
  so, and the README says "all files in this directory," which is a *cleaner*
  grant than I'd credited it with.
- I'd described the detector's output decoding as anchor-based — predictions
  relative to prior boxes. **There are no anchors.** It's centre-based: cell
  index plus offset, exponential for size. An implementer following my
  description would have gone looking for a prior-box generator that does not
  exist.
- I'd warned at length about letterboxing, and the delicate inverse transform
  needed to map coordinates back, and how a subtle error there would offset every
  box. **There is no letterboxing.** The reference pads bottom-and-right only, so
  coordinates come out already correct. I had written a careful warning about a
  bug that cannot occur.
- Worst: I'd described the embedding network as MobileFaceNet, with
  inverted-residual bottlenecks and a global-depthwise-convolution head, and
  cited the paper. The distributor's own README says "MobileFaceNet instances."
  **The file is a MobileNetV1** — no residual connections at all (there are zero
  `Add` nodes), and a head that flattens to 50,176 values and runs one dense
  matrix multiply holding two thirds of the model's parameters. It is ten times
  larger than MobileFaceNet. Someone implementing my description would have built
  the wrong network and spent days wondering why the numbers didn't match.

Every one of those took minutes to establish from the artifact and would have
taken days to discover from the symptoms.

And there's a specific irony in it. The thesis of this essay is that weights are
**unauditable** — that you reach a floor below which software is knowledge
extracted from data, and you cannot read it. That's true. But the *graph* around
the weights is completely auditable. It's a protobuf. It says exactly how many
convolutions there are, what their strides and padding and group counts are, what
the normalisation constants are, what shape the output is. It took an afternoon to
write the reader.

Almost nobody does this. I didn't, for a whole draft. The write-ups get copied
forward — including by the people distributing the files, since the README
describing this model as a MobileFaceNet is *upstream's own* — and everyone
downstream inherits the error, because checking requires opening a binary format
and the description is right there and reads plausibly.

So the floor is lower than I said, but the reason is different from the one I gave.
It isn't only that the numbers can't be read. It's that **the layer of description
wrapped around them is unreliable in a way that nothing else in a normal
dependency chain is.** A library with wrong documentation fails loudly: you call
the function, it throws. A neural network with wrong documentation runs fine and
returns garbage, and you blame yourself.

The one useful rule I'd carry out of this whole exercise, then, is not
philosophical:

> **Parse the artifact. Don't cite the write-up.**

Which is also, I notice, just "read the source" — the oldest advice in the trade —
applied one layer lower than people usually apply it.

---

## The rule keeps paying, which is either satisfying or ominous

A later pass applied that rule three more times and it caught something each
time. I'm recording them because the pattern is what's interesting: the errors
aren't in the science, they're in the *packaging*, and each one is invisible until
you touch the thing itself.

**The download lies.** The canonical URLs for these two model files don't serve
model files. They're stored in git-lfs, so a plain fetch returns a
hundred-and-thirty-one-byte text stub — and if you write that to
`detector.onnx` you now have a file with the right name, the right extension, and
none of the right contents. It fails later, somewhere else, as a parse error you'd
reasonably blame on your own parser.

**The parameter count lies about cost.** The recogniser has 9.67 million
parameters against the 1.0 million I'd budgeted for, and I wrote a worried
paragraph about it being ten times too slow. But two thirds of those parameters
are a *single matrix* at the very end, and one matrix multiply is about one
percent of the arithmetic. Subtract it and the convolution body is 3.25 million
parameters — which is, to two significant figures, plain MobileNetV1, whose cost
is published. It's two-and-a-half times MobileFaceNet, not ten. I had performed
the classic move of measuring the thing that's easy to count instead of the thing
I cared about.

**The quantised file doesn't run.** It declares thirty required inputs — the image
plus twenty-nine weight tensors — so a stock runtime refuses to execute it
without being handed its own weights. The float version, same model, declares
one. If you'd tried to check your implementation against the small file, the
runtime's complaint would have looked like your bug.

Three more instances of the same shape. Nobody is lying; the description just
detaches from the artifact and drifts, and there's no mechanism anywhere in the
chain that pulls it back. That's the actual difference from a normal dependency,
and it's worse than "the weights are unauditable." The weights are honest. It's
everything wrapped around them that isn't.

---

## Costs, honestly

About **four to six weeks of focused evenings**, down from six to nine. Not
because anything got easier, but because reading the files removed work I'd
budgeted for: bilinear resize the model doesn't use, dilated convolutions it
doesn't use, separate dense and depthwise kernels that are one kernel, a
letterbox transform that doesn't exist, and a GPU substrate that turned out to be
optional. Four kernels, in the end: grouped convolution, matrix multiply, max
pool, nearest-neighbour resize.

The GPU backend is now firmly a hobby. In optimised C++ the detector costs about
seventeen milliseconds a photograph at working resolution and the recogniser five
per face, so a gallery is under a minute of model time; hand-written scalar
JavaScript typically pays twenty to fifty times that, single-threaded, which is a
coffee break across eight workers. There was never a performance problem. There
was an arithmetic error in my estimate of one.

The order matters more than the total, and the order I'd have got wrong. My
instinct was bottom-up: tensor format, then kernels, then the detector, then
eventually find out whether the feature works. But the only genuine unknown in the
project is whether the descriptors separate these particular people in these
particular photographs, and a stock inference runtime — in a scratch directory, as
scaffolding, never in the repo — answers that in an evening. So: build outside-in.
Write the alignment, the quality gate, the grouping and the measurement first,
with a borrowed engine standing in for the middle, and the go/no-go arrives on day
one instead of in week four. Then replace the engine one layer at a time, checking
each against the thing it replaces. The verification harness you'd otherwise have
to remember to build turns out to be a side effect of building in the right order.

That inversion has a cost worth naming, which is that the borrowed engine is
*genuinely* forbidden by the rule this whole essay is about — it's third-party
code executing in our process, tier one, no exceptions. As scaffolding and as an
oracle that's fine, because it never ships and nothing it produces is trusted
without re-checking. As the implementation it isn't, and the tempting move — "it's
CLI-only, like vips" — is false: vips is a separate binary over a pipe. An
imported library is not the same animal, and noticing that I wanted it to be was
its own small lesson in how these rules erode.

The risk worth naming hasn't changed: hand-written neural network inference fails
**silently and numerically.** A transposed weight layout or an off-by-one in
padding produces plausible-looking output and quietly terrible accuracy, and you
will spend days blaming the model. The mitigation is oracles — dump reference
activations from the upstream model offline and assert layer-by-layer, with
per-layer deviation visible in the lab. Build that harness *before* the network,
not after the network disappoints.

There's a second oracle available, which I found by accident and which is my
favourite small discovery in the project. macOS ships a face detector in
Vision.framework. A page of Swift, compiled with the `swiftc` already on the
machine, and you have an independent implementation that returns boxes,
sharpness, pose and seventy-six landmarks in about fifteen milliseconds an image.
It's a dev-machine tool — tier three, never on a code path the app depends on —
and it means that when the hand-written detector and Apple's disagree, you know
something is wrong. Without it you are comparing your detector against your own
expectations, which is not a comparison.

Running it over the repo's seeded test images, incidentally, found almost no faces
at all — that set is props and room shots. Which is its own small lesson about
validating against real data: tuned against it, any detector looks broken.

Which points at the one rule in this project that isn't about code. Tuning needs
real photographs of real people, and photographs of people belong to the person
whose photographs they are. So the pipeline is built to be handed a path and to
keep everything it derives in scratch: no searching for input, nothing read that
wasn't pointed at, no crops or descriptors or distributions surviving the run, and
no statistic about anybody's photographs written into a document — least of all
this one, in a public repo. Spec §15 states it as build constraints rather than as
sentiment, which is the only form that survives contact with an implementer.

---

## The unglamorous part

Face embeddings are biometric identifiers. Illinois' BIPA requires consent and
carries a private right of action with statutory damages; Texas and Washington
have analogues; GDPR Article 9 treats biometric data used for identification as
special-category.

The cost of designing as though that mattered rounds to zero, so it's designed
that way: embeddings never reach a guest-facing endpoint, embeddings are computed
only on the owner's own machine, tags are never auto-published, a human confirms
every cluster before a name attaches to a face, and deleting a guest or a photo
cascades to the face rows.

Four cheap decisions, taken once, and then not talked about again.

---

## Which is, in the end, the actual finding

The project is fine. A wedding site is non-commercial, so nearly every
restriction in that table is *already satisfied*; the two files it settles on are
MIT and Apache-2.0; the pipeline can be built, honestly documented, and enjoyed.
The practical answer is anticlimactic.

But the exercise set out to ask how few dependencies an application can have, and
the honest answer arrived from an angle I wasn't watching. It isn't the number of
`node_modules` entries. It's that below a certain layer, software stops being
made of instructions and starts being made of **knowledge extracted from data
about people** — and that layer has no clean specification, no reference
implementation, no settled ownership, and, as it turns out, no reliable
documentation either.

You can write every line yourself and still be standing on that. The zero-
dependency ideal has a floor, the floor is lower than the OS, and when you get
down there and look at it properly, it's less solid than the code above it — and
the map of it that everyone is using, including the people who drew it, has
errors on it that nobody has checked in years.

Which is a strange thing to discover while trying to tag photographs of your
friends at your own wedding. But there it is.
