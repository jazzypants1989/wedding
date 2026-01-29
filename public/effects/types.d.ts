/** @file main.js - Types for shared effect utilities & initialization */

/**
 * An effect definition mapping an ID to its factory function.
 * @example
 * const def: EffectDefinition = { id: 'sparkles', create: createSparkleStars };
 */
export interface EffectDefinition {
  id: string
  create: (config?: Record<string, unknown>) => EffectInstance
}

/**
 * Initialize all effects with their default configs and start them.
 * Skips initialization if user prefers reduced motion.
 * @example
 * initEffectManager();
 */
export function initEffectManager(): void

/**
 * Stop all running effects and clear the registry.
 * @example
 * stopAllEffects();
 */
export function stopAllEffects(): void

/**
 * Stop a single effect by ID and remove it from the registry.
 * @example
 * stopEffect('disco');
 */
export function stopEffect(id: string): void
/**
 * An active effect instance with start/stop lifecycle.
 * All effect factory functions return this shape.
 * @example
 * const effect: EffectInstance = createSparkleStars();
 * effect.start();
 * effect.stop();
 */
export interface EffectInstance {
  start: () => void
  stop: () => void
}

/**
 * Check if the viewport is mobile-sized (width < 768px).
 * @example
 * if (isMobile()) { /* reduce particle count *\/ }
 */
export function isMobile(): boolean

/**
 * Check if the user prefers reduced motion.
 * @example
 * if (prefersReducedMotion()) return;
 */
export function prefersReducedMotion(): boolean

/**
 * Pick a random item from an array.
 * @example
 * const color = randomFrom(['#fff', '#ffd700', '#ff69b4']);
 */
export function randomFrom<T>(arr: T[]): T

/**
 * Generate a random number between min (inclusive) and max (exclusive).
 * @example
 * const x = randomBetween(0, 100); // 0 <= x < 100
 */
export function randomBetween(min: number, max: number): number

/**
 * Map a 0-100 slider value to an output range.
 * If invert is true, 100 maps to min and 0 maps to max.
 * @example
 * mapSlider(50, 0.3, 1.8);          // 1.05
 * mapSlider(50, 700, 150, true);     // 425
 */
export function mapSlider(
  sliderValue: number,
  min: number,
  max: number,
  invert?: boolean,
): number

/** @file config.js - Types for effect configuration defaults */

/**
 * A configuration entry with default values for an effect.
 * @example
 * const entry: EffectConfigEntry = { defaults: { intensity: 50, speed: 50 } };
 */
export interface EffectConfigEntry {
  defaults: Record<string, unknown>
}

/**
 * Default config for sparkle stars effect.
 * @example
 * const cfg: SparkleStarsConfig = { twinkleSpeed: 50, starSize: 50 };
 */
export interface SparkleStarsConfig {
  twinkleSpeed?: number
  starSize?: number
  spawnDensity?: number
  colorMix?: string[]
}

/**
 * Default config for disco ball effect.
 * @example
 * const cfg: DiscoBallConfig = { spinSpeed: 50, ballSize: 50, rayCount: 6 };
 */
export interface DiscoBallConfig {
  spinSpeed?: number
  ballSize?: number
  rayCount?: number
  rayBrightness?: number
  rayColors?: string[]
}

/**
 * Trail particle type for cursor trail effect.
 */
export type TrailType = "hearts" | "sparkles" | "stars" | "rings" | "mix"

/**
 * Default config for cursor trail effect.
 * @example
 * const cfg: CursorTrailConfig = { trailDensity: 50, trailType: 'mix' };
 */
export interface CursorTrailConfig {
  trailDensity?: number
  trailType?: TrailType
  fadeSpeed?: number
  size?: number
}

/**
 * Color palette for mermaid shimmer effect.
 */
export type ShimmerPalette = "iridescent" | "ocean" | "sunset"

/**
 * Default config for mermaid shimmer effect.
 * @example
 * const cfg: MermaidShimmerConfig = { opacity: 50, colorPalette: 'iridescent' };
 */
export interface MermaidShimmerConfig {
  opacity?: number
  gradientSpeed?: number
  colorPalette?: ShimmerPalette
  scaleSize?: number
}

/**
 * Default config for sparkle burst effect.
 * @example
 * const cfg: SparkleBurstConfig = { particleCount: 50 };
 */
export interface SparkleBurstConfig {
  particleCount?: number
  colors?: string[]
}

/**
 * Default config for sparkle dividers effect.
 * @example
 * const cfg: SparkleDividersConfig = { dotDensity: 50, color: 50 };
 */
export interface SparkleDividersConfig {
  dotDensity?: number
  color?: number
}

/**
 * Shimmer highlight color for name shimmer effect.
 */
export type ShimmerColor = "gold" | "white" | "pink"

/**
 * Default config for name shimmer effect.
 * @example
 * const cfg: NameShimmerConfig = { shimmerSpeed: 50, shimmerColor: 'gold' };
 */
export interface NameShimmerConfig {
  shimmerSpeed?: number
  shimmerColor?: ShimmerColor
}

/**
 * Default config for caustics effect.
 * @example
 * const cfg: CausticsConfig = { intensity: 50, speed: 50 };
 */
export interface CausticsConfig {
  intensity?: number
  speed?: number
}

/**
 * Default config for text sparkle effect.
 * @example
 * const cfg: TextSparkleConfig = { intensity: 50 };
 */
export interface TextSparkleConfig {
  intensity?: number
}

/**
 * Celebration style for scroll confetti effect.
 */
export type CelebrationStyle = "burst" | "sides" | "rain"

/**
 * Default config for scroll confetti effect.
 * @example
 * const cfg: ScrollConfettiConfig = { milestoneCount: 4, celebrationStyle: 'burst' };
 */
export interface ScrollConfettiConfig {
  milestoneCount?: number
  particleCount?: number
  celebrationStyle?: CelebrationStyle
  colors?: string[]
}

/**
 * Color scheme for parallax sparkles effect.
 */
export type ParallaxColorScheme = "gold" | "rose" | "cool" | "mixed"

/**
 * Default config for parallax sparkles effect.
 * @example
 * const cfg: ParallaxSparklesConfig = { layerCount: 3, colorScheme: 'gold' };
 */
export interface ParallaxSparklesConfig {
  layerCount?: number
  density?: number
  speedMultiplier?: number
  colorScheme?: ParallaxColorScheme
}

/**
 * Entrance animation style for grand entrance effect.
 */
export type EntranceStyle = "curtain" | "shower" | "golden"

/**
 * Default config for grand entrance effect.
 * @example
 * const cfg: GrandEntranceConfig = { entranceStyle: 'curtain', sparkleIntensity: 50 };
 */
export interface GrandEntranceConfig {
  entranceStyle?: EntranceStyle
  sparkleIntensity?: number
  speed?: number
  colors?: string[]
}

/**
 * Default config for disco spotlight effect.
 * @example
 * const cfg: DiscoSpotlightConfig = { beamCount: 3, sweepSpeed: 50 };
 */
export interface DiscoSpotlightConfig {
  beamCount?: number
  sweepSpeed?: number
  beamWidth?: number
  colors?: string[]
}

/**
 * Default config for mirror reflections effect.
 * @example
 * const cfg: MirrorReflectionsConfig = { reflectionCount: 50, speed: 50 };
 */
export interface MirrorReflectionsConfig {
  reflectionCount?: number
  speed?: number
  brightness?: number
  colors?: string[]
}

/**
 * Map of all effect config entries by effect ID.
 * @example
 * EFFECT_CONFIGS.sparkles.defaults.twinkleSpeed; // 50
 */
export const EFFECT_CONFIGS: Record<string, EffectConfigEntry>

export const EFFECT_PALETTE: Record<string, string>

/**
 * Get the default config for a given effect ID.
 * Returns null if the ID is not recognized.
 * @example
 * const cfg = getDefaultConfig('sparkles'); // { twinkleSpeed: 50, ... }
 * const unknown = getDefaultConfig('nope'); // null
 */
export function getDefaultConfig(id: string): Record<string, unknown> | null

/** @file sparkle-stars.js - Types for twinkling stars effect */

/**
 * Create a twinkling stars effect.
 * Stars appear at random positions and fade out.
 * @example
 * const stars = createSparkleStars({ twinkleSpeed: 80, starSize: 60 });
 * stars.start();
 */
export function createSparkleStars(config?: SparkleStarsConfig): EffectInstance

/** @file disco-ball.js - Types for spinning disco ball effect */

/**
 * Create a spinning disco ball with light rays.
 * Ball tiles cycle through colors with specular highlights.
 * @example
 * const disco = createDiscoBall({ spinSpeed: 70, rayCount: 6 });
 * disco.start();
 */
export function createDiscoBall(config?: DiscoBallConfig): EffectInstance

/** @file cursor-trail.js - Types for cursor trail effect */

/**
 * Create hearts and sparkles that follow the mouse cursor.
 * Supports touch events on mobile.
 * @example
 * const trail = createCursorTrail({ trailType: 'hearts', fadeSpeed: 60 });
 * trail.start();
 */
export function createCursorTrail(config?: CursorTrailConfig): EffectInstance

/** @file mermaid-shimmer.js - Types for iridescent holographic overlay effect */

/**
 * Create an iridescent holographic shimmer overlay.
 * Supports multiple color palettes.
 * @example
 * const shimmer = createMermaidShimmer({ colorPalette: 'ocean' });
 * shimmer.start();
 */
export function createMermaidShimmer(
  config?: MermaidShimmerConfig,
): EffectInstance

/** @file sparkle-burst.js - Types for page load sparkle burst effect */

/**
 * Create a cascading sparkle burst on page load.
 * Container auto-removes after all particles finish.
 * @example
 * const burst = createSparkleBurst({ particleCount: 70 });
 * burst.start();
 */
export function createSparkleBurst(config?: SparkleBurstConfig): EffectInstance

/** @file sparkle-dividers.js - Types for animated divider lines effect */

/**
 * Create animated sparkle divider lines between content sections.
 * Targets .schedule-item and .content-section elements.
 * @example
 * const dividers = createSparkleDividers({ dotDensity: 60 });
 * dividers.start();
 */
export function createSparkleDividers(
  config?: SparkleDividersConfig,
): EffectInstance

/** @file name-shimmer.js - Types for name shimmer highlight effect */

/**
 * Create a traveling light highlight on the .couple-names element.
 * @example
 * const shimmer = createNameShimmer({ shimmerColor: 'pink' });
 * shimmer.start();
 */
export function createNameShimmer(config?: NameShimmerConfig): EffectInstance

/** @file caustics.js - Types for underwater light refraction effect */

/**
 * Create underwater caustics light refraction patterns.
 * Renders 3 animated overlay layers with staggered durations.
 * @example
 * const caustics = createCaustics({ intensity: 60, speed: 40 });
 * caustics.start();
 */
export function createCaustics(config?: CausticsConfig): EffectInstance

/** @file text-sparkle.js - Types for text glow on scroll effect */

/**
 * Create a text glow effect triggered by scroll visibility.
 * Observes .content-section p, .schedule-details, and .rsvp-intro elements.
 * @example
 * const glow = createTextSparkle({ intensity: 70 });
 * glow.start();
 */
export function createTextSparkle(config?: TextSparkleConfig): EffectInstance

/**
 * A single confetti particle in the scroll confetti effect.
 */
export interface ConfettiParticle {
  x: number
  y: number
  vx: number
  vy: number
  gravity: number
  rotation: number
  rotationSpeed: number
  width: number
  height: number
  color: string
  opacity: number
  drag: number
  shape: "rect" | "circle"
}

/** @file parallax-sparkles.js - Types for multi-depth scrolling sparkles effect */

/**
 * A parallax layer with its DOM element and depth factor.
 */
export interface ParallaxLayer {
  element: HTMLDivElement
  depth: number
}

/**
 * Create multi-depth sparkle layers that shift on scroll.
 * Respects prefers-reduced-motion.
 * @example
 * const parallax = createParallaxSparkles({ layerCount: 4, colorScheme: 'rose' });
 * parallax.start();
 */
export function createParallaxSparkles(
  config?: ParallaxSparklesConfig,
): EffectInstance

/** @file grand-entrance.js - Types for welcome cascade on page load effect */

/**
 * Create a choreographed welcome cascade on page load.
 * Supports curtain, shower, and golden entrance styles.
 * Respects prefers-reduced-motion.
 * @example
 * const entrance = createGrandEntrance({ entranceStyle: 'golden', speed: 60 });
 * entrance.start();
 */
export function createGrandEntrance(
  config?: GrandEntranceConfig,
): EffectInstance

/**
 * A spotlight beam with its DOM element and animation state.
 */
export interface SpotlightBeam {
  element: HTMLDivElement
  colorIdx: number
  phase: number
}

/** @file disco-spotlight.js - Types for sweeping colored spotlight beams effect */

/**
 * Create sweeping colored spotlight beams.
 * Colors cycle every 3 seconds with alternating sweep directions.
 * @example
 * const spotlight = createDiscoSpotlight({ beamCount: 4, sweepSpeed: 60 });
 * spotlight.start();
 */
export function createDiscoSpotlight(
  config?: DiscoSpotlightConfig,
): EffectInstance

/**
 * A bouncing light reflection with position, velocity, and flicker state.
 */
export interface Reflection {
  el: HTMLDivElement
  x: number
  y: number
  vx: number
  vy: number
  size: number
  flickerPhase: number
  flickerSpeed: number
  baseBrightness: number
}

/** @file mirror-reflections.js - Types for bouncing light squares effect */

/**
 * Create bouncing light squares with flicker animation.
 * Uses velocity-based physics with wall bouncing.
 * Respects prefers-reduced-motion.
 * @example
 * const reflections = createMirrorReflections({ speed: 60, brightness: 70 });
 * reflections.start();
 */
export function createMirrorReflections(
  config?: MirrorReflectionsConfig,
): EffectInstance
