/** @file Effect registry — the id→factory table of every available effect.
 *
 * Split out of main.js (the DOM lifecycle manager) so it carries no import-time
 * DOM side effects: dev tooling (the studio) and unit tests can import the real
 * registry in any environment. A theme (themes.js) selects a subset of these ids;
 * per-effect defaults live in config.js EFFECT_CONFIGS. Every id here MUST have a
 * matching EFFECT_CONFIGS entry (guarded by tests/unit/effect-themes.test.js).
 */
/** @import * as Types from './types.js' */

import { createDiscoBall } from "./disco-ball.js"
import { createCursorTrail } from "./cursor-trail.js"
import { createMermaidShimmer } from "./mermaid-shimmer.js"
import { createSparkleDividers } from "./sparkle-dividers.js"
import { createNameShimmer } from "./name-shimmer.js"
import { createTextSparkle } from "./text-sparkle.js"
import { createParallaxSparkles } from "./parallax-sparkles.js"
import { createGrandEntrance } from "./grand-entrance.js"
import { createDiscoSpotlight } from "./disco-spotlight.js"
import { createMirrorReflections } from "./mirror-reflections.js"
import { createRosePetals } from "./rose-petals.js"
import { createFloatingHearts } from "./floating-hearts.js"
import { createGoldenDust } from "./golden-dust.js"
import { createStarfield } from "./starfield.js"
import { createShootingStars } from "./shooting-stars.js"
import { createAuroraWash } from "./aurora-wash.js"
import { createFireflies } from "./fireflies.js"
import { createFallingLeaves } from "./falling-leaves.js"
import { createSnowfall } from "./snowfall.js"
import { createFrostShimmer } from "./frost-shimmer.js"
import { createBubblesRising } from "./bubbles-rising.js"
import { createCaustics } from "./caustics.js"

/** Registry of every effect, mapping its ID to its factory. A theme selects a
 *  subset by id; unlisted ids never run.
 *  @type {Types.EffectDefinition[]} */
export const EFFECT_DEFINITIONS = [
  { id: "disco", create: createDiscoBall },
  { id: "cursor", create: createCursorTrail },
  { id: "shimmer", create: createMermaidShimmer },
  { id: "dividers", create: createSparkleDividers },
  { id: "namespark", create: createNameShimmer },
  { id: "textglow", create: createTextSparkle },
  { id: "parallaxsparkles", create: createParallaxSparkles },
  { id: "entrance", create: createGrandEntrance },
  { id: "spotlight", create: createDiscoSpotlight },
  { id: "reflections", create: createMirrorReflections },
  { id: "petals", create: createRosePetals },
  { id: "hearts", create: createFloatingHearts },
  { id: "dust", create: createGoldenDust },
  { id: "starfield", create: createStarfield },
  { id: "shootingstars", create: createShootingStars },
  { id: "aurora", create: createAuroraWash },
  { id: "fireflies", create: createFireflies },
  { id: "leaves", create: createFallingLeaves },
  { id: "snow", create: createSnowfall },
  { id: "frost", create: createFrostShimmer },
  { id: "bubbles", create: createBubblesRising },
  { id: "caustics", create: createCaustics },
]
