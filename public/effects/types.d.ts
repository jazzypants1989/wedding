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
 * Clamp a desired element count to an absolute ceiling, so a stray config
 * override can't spawn thousands of animated (will-change'd) nodes and hang
 * low-end phones. Mobile scaling still applies before this cap.
 * @example
 * const count = cappedCount(isMobile() ? n / 2 : n, 120);
 */
export function cappedCount(desired: number, max: number): number

/**
 * Return a Promise that resolves after the given delay, or rejects
 * with an AbortError when the signal fires.
 * @example
 * await cancellableDelay(300, controller.signal);
 */
export function cancellableDelay(ms: number, signal: AbortSignal): Promise<void>

/** @file control-meta.js - Types for the generic per-parameter control metadata */

/** Slider/number bounds (and enum options) for a single config parameter. */
export interface ControlHint {
  min?: number
  max?: number
  step?: number
  options?: string[]
  /**
   * Rendering hint for control shapes the value type alone can't disambiguate.
   * `"glyphs"` marks a `string[]` whose entries are text glyphs/emoji (not
   * colors), so the UI renders plain text chips instead of color swatches.
   */
  kind?: "glyphs"
}

/** Resolved numeric slider bounds. */
export interface NumericBounds {
  min: number
  max: number
  step: number
}

/**
 * Resolve the control hint for an effect+param, or undefined when none is set.
 */
export function getHint(effectId: string, param: string): ControlHint | undefined

/**
 * Resolve numeric slider bounds from a hint, or heuristically from the current
 * value when no hint exists (keeps unknown params usable).
 */
export function numericBounds(value: number, hint?: ControlHint): NumericBounds

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
  tileSize?: number
  tileGap?: number
  rayDurationRange?: [number, number]
  rayDelayRange?: [number, number]
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
  throttleMs?: number
  fadeSpeed?: number
  size?: number
  colors?: string[]
  minDistance?: number
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
  gradientAngle?: number
}

/**
 * Default config for sparkle dividers effect.
 * @example
 * const cfg: SparkleDividersConfig = { dotDensity: 50, color: 50 };
 */
export interface SparkleDividersConfig {
  dotDensity?: number
  color?: number
  animationDelayStep?: number
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
  layerCount?: number
}

/**
 * Default config for text sparkle effect.
 * @example
 * const cfg: TextSparkleConfig = { intensity: 50 };
 */
export interface TextSparkleConfig {
  intensity?: number
  threshold?: number
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
  sizeRange?: [number, number]
  opacityRange?: [number, number]
  glowThreshold?: number
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
  sparkleSizeRange?: [number, number]
  waveCount?: number
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
  colorCycleMs?: number
  beamStagger?: number
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
  sizeRange?: [number, number]
  frameInterval?: number
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

/** localStorage key holding the studio's per-browser override map. */
export const OVERRIDE_STORAGE_KEY: string

/**
 * Get the effective config for an effect ID: the default config deep-merged with
 * the active theme's per-effect override, then with the studio's per-browser
 * localStorage override (which wins). Returns null for an unknown ID.
 * @example
 * const cfg = getEffectiveConfig('parallaxsparkles');
 */
export function getEffectiveConfig(id: string): Record<string, unknown> | null

/**
 * Deep-merge `override` onto a clone of `base`, returning a new object (neither
 * input is mutated). Plain objects recurse; arrays/scalars replace wholesale;
 * prototype-pollution keys are skipped.
 * @example
 * const cfg = mergeConfig(getDefaultConfig("petals"), { petalCount: 30 });
 */
export function mergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown>

/** @file themes.js - Types for the effect theme registry */

/**
 * A theme: a subset of the effect registry to run, plus optional per-effect
 * config overrides deep-merged over each effect's defaults.
 * @example
 * const t: EffectTheme = { id: 'elegant', label: 'Elegant', effectIds: ['dust'] };
 */
export interface EffectTheme {
  id: string
  label: string
  effectIds: string[]
  configs?: Record<string, Record<string, unknown>>
}

/**
 * The studio's per-browser localStorage override shape: effectId → partial config.
 */
export type EffectConfigOverride = Record<string, Record<string, unknown>>

/** The id of the shipped default theme. */
export const DEFAULT_THEME_ID: string

/** All available themes. The admin picker and studio read this directly. */
export const EFFECT_THEMES: EffectTheme[]

/**
 * Resolve a theme by id, falling back to the default theme for an unknown id.
 * @example
 * const theme = resolveTheme('romantic');
 */
export function resolveTheme(id: string | undefined): EffectTheme

/**
 * Read the active theme id from the server-rendered <html data-effect-theme>
 * attribute, falling back to the default id in non-DOM contexts.
 */
export function getActiveThemeId(): string

/**
 * Resolve the currently active theme (getActiveThemeId + resolveTheme).
 */
export function getActiveTheme(): EffectTheme

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

/**
 * Default config for rose petals effect.
 * @example
 * const cfg: RosePetalsConfig = { petalCount: 18, swayRange: [20, 60] };
 */
export interface RosePetalsConfig {
  petalCount?: number
  fallDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  swayRange?: [number, number]
  colors?: string[]
}

/**
 * Default config for floating hearts effect.
 * @example
 * const cfg: FloatingHeartsConfig = { heartCount: 14, driftRange: [15, 50] };
 */
export interface FloatingHeartsConfig {
  heartCount?: number
  riseDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  driftRange?: [number, number]
  colors?: string[]
}

/**
 * Default config for golden dust effect.
 * @example
 * const cfg: GoldenDustConfig = { density: 26, swayRange: [10, 30] };
 */
export interface GoldenDustConfig {
  density?: number
  driftDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  swayRange?: [number, number]
  colors?: string[]
}

/** @file rose-petals.js - Types for drifting rose petals effect */

/**
 * Create soft petals drifting down with lateral sway and spin.
 * @example
 * const petals = createRosePetals({ petalCount: 24 });
 * petals.start();
 */
export function createRosePetals(config?: RosePetalsConfig): EffectInstance

/** @file floating-hearts.js - Types for rising hearts effect */

/**
 * Create small hearts that rise and fade with a gentle horizontal drift.
 * @example
 * const hearts = createFloatingHearts({ heartCount: 20 });
 * hearts.start();
 */
export function createFloatingHearts(
  config?: FloatingHeartsConfig,
): EffectInstance

/** @file golden-dust.js - Types for drifting champagne dust effect */

/**
 * Create fine champagne motes drifting slowly upward with a soft glow.
 * @example
 * const dust = createGoldenDust({ density: 30 });
 * dust.start();
 */
export function createGoldenDust(config?: GoldenDustConfig): EffectInstance

/** Default config for the starfield effect. */
export interface StarfieldConfig {
  starCount?: number
  sizeRange?: [number, number]
  twinkleDurationRange?: [number, number]
  delayRange?: [number, number]
  colors?: string[]
}

/** Default config for the shooting-stars effect. */
export interface ShootingStarsConfig {
  streakCount?: number
  cycleDurationRange?: [number, number]
  delayRange?: [number, number]
  lengthRange?: [number, number]
  colors?: string[]
}

/** Default config for the aurora-wash effect. */
export interface AuroraWashConfig {
  opacity?: number
  speed?: number
  /** Named gradient palette: "aurora" | "polar" | "dusk". */
  palette?: string
  height?: number
  angle?: number
}

/** Default config for the fireflies effect. */
export interface FirefliesConfig {
  flyCount?: number
  sizeRange?: [number, number]
  blinkDurationRange?: [number, number]
  driftDurationRange?: [number, number]
  driftRange?: [number, number]
  colors?: string[]
}

/** Default config for the falling-leaves effect. */
export interface FallingLeavesConfig {
  leafCount?: number
  fallDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  swayRange?: [number, number]
  colors?: string[]
}

/** Default config for the snowfall effect. */
export interface SnowfallConfig {
  flakeCount?: number
  fallDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  swayRange?: [number, number]
  colors?: string[]
}

/** Default config for the frost-shimmer effect. */
export interface FrostShimmerConfig {
  opacity?: number
  breatheSpeed?: number
  color?: string
  clearRadius?: number
}

/** Default config for the bubbles-rising effect. */
export interface BubblesRisingConfig {
  bubbleCount?: number
  riseDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  wobbleRange?: [number, number]
}

/** @file starfield.js - Types for the twinkling starfield effect */
/** Create a scatter of stars twinkling in place. */
export function createStarfield(config?: StarfieldConfig): EffectInstance

/** @file shooting-stars.js - Types for occasional diagonal streaks */
/** Create occasional shooting-star streaks across the upper sky. */
export function createShootingStars(config?: ShootingStarsConfig): EffectInstance

/** @file aurora-wash.js - Types for the drifting aurora gradient band */
/** Create a slow, soft aurora gradient band across the top of the page. */
export function createAuroraWash(config?: AuroraWashConfig): EffectInstance

/** @file fireflies.js - Types for blinking, drifting fireflies */
/** Create warm points that blink and wander slowly. */
export function createFireflies(config?: FirefliesConfig): EffectInstance

/** @file falling-leaves.js - Types for tumbling autumn leaves */
/** Create autumn leaves tumbling down with sway and spin. */
export function createFallingLeaves(config?: FallingLeavesConfig): EffectInstance

/** @file snowfall.js - Types for drifting snow */
/** Create soft snowflakes drifting down with lateral sway. */
export function createSnowfall(config?: SnowfallConfig): EffectInstance

/** @file frost-shimmer.js - Types for the breathing frost vignette */
/** Create a frosted vignette at the page edges that gently breathes. */
export function createFrostShimmer(config?: FrostShimmerConfig): EffectInstance

/** @file bubbles-rising.js - Types for rising underwater bubbles */
/** Create translucent bubbles floating up with a lateral wobble. */
export function createBubblesRising(config?: BubblesRisingConfig): EffectInstance

/** Default config for the lantern-rise effect. */
export interface LanternRiseConfig {
  lanternCount?: number
  riseDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  swayRange?: [number, number]
  colors?: string[]
}

/** Default config for the ribbon-curl effect. */
export interface RibbonCurlConfig {
  ribbonCount?: number
  unfurlDurationRange?: [number, number]
  delayRange?: [number, number]
  widthRange?: [number, number]
  colors?: string[]
}

/** Default config for the champagne-fizz effect. */
export interface ChampagneFizzConfig {
  streamCount?: number
  bubblesPerStream?: number
  riseDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  colors?: string[]
}

/** Default config for the frame-glint effect. */
export interface FrameGlintConfig {
  sweepIntervalMs?: number
  sweepDurationMs?: number
  angle?: number
  intensity?: number
}

/** Default config for the confetti-drift effect. */
export interface ConfettiDriftConfig {
  pieceCount?: number
  fallDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  spinRange?: [number, number]
  colors?: string[]
}

/** Default config for the ink-sparkle effect. */
export interface InkSparkleConfig {
  glyphCount?: number
  driftDurationRange?: [number, number]
  delayRange?: [number, number]
  sizeRange?: [number, number]
  glyphs?: string[]
  colors?: string[]
}

/** @file lantern-rise.js - Types for rising paper lanterns */
/** Create warm paper lanterns rising with a glow, gentle sway, and flicker. */
export function createLanternRise(config?: LanternRiseConfig): EffectInstance

/** @file ribbon-curl.js - Types for silk ribbons unfurling down page edges */
/** Create glossy ribbons unfurling down the left/right page edges only. */
export function createRibbonCurl(config?: RibbonCurlConfig): EffectInstance

/** @file champagne-fizz.js - Types for rising champagne bubble streams */
/** Create fine champagne bubble streams rising in a few tight columns. */
export function createChampagneFizz(config?: ChampagneFizzConfig): EffectInstance

/** @file frame-glint.js - Types for the periodic specular sweep on framed elements */
/** Create a periodic diagonal light sweep across `.tc-polaroid` elements. */
export function createFrameGlint(config?: FrameGlintConfig): EffectInstance

/** @file confetti-drift.js - Types for gently tumbling ambient confetti */
/** Create a calm, continuous fall of tumbling paper confetti. */
export function createConfettiDrift(config?: ConfettiDriftConfig): EffectInstance

/** @file ink-sparkle.js - Types for drifting calligraphy-glyph sparkles */
/** Create drifting calligraphy-glyph sparkles that fade along a curved path. */
export function createInkSparkle(config?: InkSparkleConfig): EffectInstance

/** Default config for the tilt-depth (pointer/gyroscope parallax) effect. */
export interface TiltDepthConfig {
  /** CSS selector for the elements to tilt. First match is the primary (rotates);
   *  the rest are secondaries (parallax translate). */
  selector?: string
  /** Maximum rotateX/rotateY magnitude, in degrees. */
  maxTilt?: number
  /** Parallax translate magnitude for secondary targets, in px. */
  depth?: number
}

/** @file tilt-depth.js - Types for pointer/gyroscope parallax tilt */
/**
 * Create a gentle pointer/gyroscope parallax tilt on the matched elements.
 * Damped easing toward the pointer/tilt target; no-ops under reduced motion.
 * @example
 * const tilt = createTiltDepth({ selector: ".lightbox-media", maxTilt: 5 });
 * tilt.start();
 */
export function createTiltDepth(config?: TiltDepthConfig): EffectInstance

/**
 * Request DeviceOrientation permission from within a user gesture (iOS 13+).
 * Pages must call this inside their own tap/click handler — the effect cannot
 * prompt on its own. Resolves true when granted or when no permission is needed.
 * @example
 * button.addEventListener("click", () => { void requestTiltPermission(); });
 */
export function requestTiltPermission(): Promise<boolean>
