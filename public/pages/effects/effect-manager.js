/** @file Effect manager — creates and starts all effects with default config.
 *
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS below.
 * To tweak an effect: edit its defaults in effect-config.js.
 */
/** @import * as Types from './types.js' */

import { createSparkleStars } from "./sparkle-stars.js"
import { createDiscoBall } from "./disco-ball.js"
import { createCursorTrail } from "./cursor-trail.js"
import { createMermaidShimmer } from "./mermaid-shimmer.js"
import { createSparkleBurst } from "./sparkle-burst.js"
import { createSparkleDividers } from "./sparkle-dividers.js"
import { createNameShimmer } from "./name-shimmer.js"
import { createCaustics } from "./caustics.js"
import { createTextSparkle } from "./text-sparkle.js"
import { createParallaxSparkles } from "./parallax-sparkles.js"
import { createGrandEntrance } from "./grand-entrance.js"
import { createDiscoSpotlight } from "./disco-spotlight.js"
import { createMirrorReflections } from "./mirror-reflections.js"
import { getDefaultConfig } from "./effect-config.js"

/** @type {Types.EffectDefinition[]} */
const EFFECT_DEFINITIONS = [
  { id: "sparkles", create: createSparkleStars },
  { id: "disco", create: createDiscoBall },
  { id: "cursor", create: createCursorTrail },
  { id: "shimmer", create: createMermaidShimmer },
  { id: "burst", create: createSparkleBurst },
  { id: "dividers", create: createSparkleDividers },
  { id: "namespark", create: createNameShimmer },
  { id: "caustics", create: createCaustics },
  { id: "textglow", create: createTextSparkle },
  { id: "parallaxsparkles", create: createParallaxSparkles },
  { id: "entrance", create: createGrandEntrance },
  { id: "spotlight", create: createDiscoSpotlight },
  { id: "reflections", create: createMirrorReflections },
]

/** @type {Types.initEffectManager} */
export function initEffectManager() {
  for (const def of EFFECT_DEFINITIONS) {
    const cfg = getDefaultConfig(def.id) || {}
    const instance = def.create(cfg)
    instance.start()
  }
}
