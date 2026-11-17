import { withAlpha } from '../graphics/color';
import { validateFill } from '../graphics/paint';
import type { Color } from '../graphics/paint';
import type { ImageAsset } from '../assets/assets';
import type { Rect } from '../graphics/path';
import type { EmitterConfig } from '../particles/emitter';
import { contextQuality, defineEffect } from '../runtime/effect';
import type { Drawable, EffectDefinition } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { QualityProfile } from '../runtime/quality';
import { composeTransform } from '../scene/matrix';
import type { Point } from '../scene/matrix';
import { defineComposite } from './composite';
import type { CompositeLayer } from './composite';
import { checkNumber, Placement, shapeDrawable } from './placement';
import type { PlacementParams } from './placement';
import { flash, particles, ParticlesInstance, screenShake, shockwave } from './primitives';
import type { FlashParams, ParticlesParams, ScreenShakeParams, ShockwaveParams } from './primitives';

const placementOf = (p: PlacementParams): PlacementParams => ({
  ...(p.position ? { position: p.position } : {}),
  ...(p.target !== undefined ? { target: p.target } : {}),
  ...(p.offset ? { offset: p.offset } : {}),
  ...(p.follow !== undefined ? { follow: p.follow } : {}),
});

function colorsOf(colors: readonly string[] | undefined, fallback: readonly string[], name: string): readonly string[] {
  const list: readonly string[] = colors ?? fallback;
  const raw: unknown = list;
  if (!Array.isArray(raw) || list.length === 0) throw new InvalidOptionError(`${name} colors must be a non-empty array.`);
  for (const c of list) validateFill(c, `${name} color`);
  return list;
}

/** A preset that is one configured emitter (`build` may read the quality profile). */
function emitterPreset<P extends PlacementParams>(name: string, build: (params: P, quality: QualityProfile) => EmitterConfig): EffectDefinition<P> {
  return defineEffect<P>({
    name,
    create: (params, context) => new ParticlesInstance({ ...build(params, contextQuality(context)), ...placementOf(params) }, context, name),
  });
}

// --- confetti -------------------------------------------------------------------------------

export interface ConfettiParams extends PlacementParams {
  /** Pieces. Default 120. */
  readonly count?: number;
  /** Launch direction in degrees. Default -90 (up). */
  readonly direction?: number;
  /** Cone in degrees. Default 70. */
  readonly spread?: number;
  /** Launch speed multiplier. Default 1. */
  readonly power?: number;
  /** Fall time of a piece in ms. Default 2600. */
  readonly duration?: number;
  readonly colors?: readonly string[];
  /** Piece size in points. Default 5. */
  readonly size?: number;
}

export const CONFETTI_COLORS: readonly string[] = ['#FF4D6D', '#FFD54A', '#4DD0E1', '#7C4DFF', '#69F0AE', '#FF9100'];

/** Paper strips launched in a cone that tumble and drift down. */
export const confetti: EffectDefinition<ConfettiParams> = emitterPreset<ConfettiParams>('confetti', (p) => {
  const n = 'confetti';
  const count = checkNumber(p.count ?? 120, 'count', n, { min: 1, max: 2000 });
  const power = checkNumber(p.power ?? 1, 'power', n, { min: 0, max: 10 });
  const duration = checkNumber(p.duration ?? 2600, 'duration', n, { min: 100 });
  const size = checkNumber(p.size ?? 5, 'size', n, { min: 0.5, max: 100 });
  return {
    bursts: [{ count: Math.round(count) }],
    maxParticles: Math.min(5000, Math.round(count)),
    direction: p.direction ?? -90,
    spread: p.spread ?? 70,
    speed: { min: 220 * power, max: 640 * power },
    gravity: 520,
    // Paper is light: strong air drag makes pieces stall at the top and drift down slowly.
    drag: 1.9,
    lifetime: { min: duration * 0.65, max: duration },
    size: { min: size * 0.6, max: size * 1.4 },
    aspect: 0.55,
    look: 'square',
    rotation: { min: 0, max: 360 },
    angularVelocity: { min: -420, max: 420 },
    // Pieces flutter: the scale curve squashes them as if they were flipping over, faster at
    // the start (launch) than at the end (floating).
    scale: [1, 0.2, 1, 0.25, 1, 0.3, 1, 0.4, 1],
    opacity: [1, 1, 1, 1, 0.85, 0],
    colors: colorsOf(p.colors, CONFETTI_COLORS, n),
  };
});

// --- golden sparks --------------------------------------------------------------------------

export interface GoldenSparksParams extends PlacementParams {
  /** Sparks in the burst. Default 60. */
  readonly count?: number;
  /** Continuous sparks per second after the burst. Default 0. */
  readonly rate?: number;
  /** How long continuous sparks last (ms). Default: until stopped when `rate` > 0. */
  readonly duration?: number;
  /** Default 1. */
  readonly power?: number;
  readonly direction?: number;
  readonly spread?: number;
  readonly colors?: readonly string[];
}

export const GOLD_COLORS: readonly string[] = ['#FFF6D5', '#FFE082', '#FFD54A', '#FFB300'];

/** Bright additive streaks that arc under gravity, with a few glittering embers. */
export const goldenSparks: EffectDefinition<GoldenSparksParams> = emitterPreset<GoldenSparksParams>('golden-sparks', (p, quality) => {
  const n = 'golden-sparks';
  const count = checkNumber(p.count ?? 60, 'count', n, { min: 0, max: 2000 });
  const power = checkNumber(p.power ?? 1, 'power', n, { min: 0, max: 10 });
  const rate = checkNumber(p.rate ?? 0, 'rate', n, { min: 0, max: 2000 });
  return {
    bursts: count > 0 ? [{ count: Math.round(count) }] : [],
    rate,
    ...(p.duration !== undefined ? { duration: p.duration } : {}),
    maxParticles: 800,
    direction: p.direction ?? -90,
    spread: p.spread ?? 360,
    speed: { min: 120 * power, max: 420 * power },
    gravity: 380,
    drag: 1.2,
    lifetime: { min: 350, max: 950 },
    size: { min: 0.9, max: 2.4 },
    look: 'spark',
    stretch: 0.045,
    blendMode: 'plus',
    // A white-hot halo on high quality; colors stay the caller's palette.
    glow: quality.glow ? 0.7 : 0,
    opacity: { from: 1, to: 0, easing: 'easeInQuad' },
    colors: colorsOf(p.colors, GOLD_COLORS, n),
  };
});

// --- smoke ----------------------------------------------------------------------------------

export interface SmokeParams extends PlacementParams {
  /** Puffs per second. Default 16. */
  readonly rate?: number;
  /** One-off puffs at the start. Default 0. */
  readonly burst?: number;
  /** Emission time in ms. Default: until stopped. */
  readonly duration?: number;
  /** Puff radius in points. Default 14. */
  readonly size?: number;
  /** Default soft grays. */
  readonly colors?: readonly string[];
  /** Sideways drift in points per second squared. Default 8. */
  readonly wind?: number;
  /** Rise speed multiplier. Default 1. */
  readonly rise?: number;
  /** Life of a puff in ms. Default 2200. */
  readonly lifetime?: number;
  /** Emission area radius. Default 6. */
  readonly radius?: number;
  /** Peak opacity of a puff, 0 to 1. Default 0.32. */
  readonly opacity?: number;
}

export const SMOKE_COLORS: readonly string[] = ['#8E8A86', '#A7A29C', '#76726E', '#B8B2AA'];

/**
 * Soft puffs that rise, billow (grow quickly, then slowly), drift, turn and thin out. Many
 * faint overlapping puffs of slightly different greys read as volume rather than a disc.
 * Emits until stopped unless `duration` is set.
 */
export const smoke: EffectDefinition<SmokeParams> = emitterPreset<SmokeParams>('smoke', (p) => {
  const n = 'smoke';
  const rate = checkNumber(p.rate ?? 16, 'rate', n, { min: 0, max: 500 });
  const burst = checkNumber(p.burst ?? 0, 'burst', n, { min: 0, max: 500 });
  const size = checkNumber(p.size ?? 14, 'size', n, { min: 1, max: 300 });
  const rise = checkNumber(p.rise ?? 1, 'rise', n, { min: 0, max: 10 });
  const lifetime = checkNumber(p.lifetime ?? 2200, 'lifetime', n, { min: 100 });
  const radius = checkNumber(p.radius ?? 6, 'radius', n, { min: 0 });
  const peak = checkNumber(p.opacity ?? 0.32, 'opacity', n, { min: 0, max: 1 });
  return {
    rate,
    bursts: burst > 0 ? [{ count: Math.round(burst) }] : [],
    ...(p.duration !== undefined ? { duration: p.duration } : rate > 0 ? {} : { duration: 0 }),
    maxParticles: 400,
    shape: { type: 'circle', radius },
    direction: -90,
    spread: 36,
    speed: { min: 22 * rise, max: 52 * rise },
    gravity: { x: checkNumber(p.wind ?? 8, 'wind', n), y: -16 * rise },
    drag: 0.25,
    lifetime: { min: lifetime * 0.65, max: lifetime },
    size: { min: size * 0.55, max: size * 1.25 },
    scale: { from: 0.4, to: 2.3, easing: 'easeOutCubic' },
    opacity: [0, peak, peak * 0.72, peak * 0.33, 0],
    rotation: { min: 0, max: 360 },
    angularVelocity: { min: -40, max: 40 },
    look: 'soft',
    colors: colorsOf(p.colors, SMOKE_COLORS, n),
  };
});

// --- trail ----------------------------------------------------------------------------------

export interface TrailParams extends PlacementParams {
  /** Particles per second. Default 70. */
  readonly rate?: number;
  /** Particle radius. Default 5. */
  readonly size?: number;
  /** How long each particle lingers (ms). Default 500. */
  readonly lifetime?: number;
  /** Colors from birth to death. Default gold to transparent orange. */
  readonly colors?: readonly string[];
  /** `soft`, `circle` or `spark`. Default `soft`. */
  readonly look?: 'soft' | 'circle' | 'spark';
  /** Additive glow. Default true. */
  readonly additive?: boolean;
}

/**
 * Particles left behind a moving target (world space, births interpolated between frames so
 * fast motion leaves no gaps). Runs until stopped or the target is destroyed.
 */
export const trail: EffectDefinition<TrailParams> = emitterPreset<TrailParams>('trail', (p) => {
  const n = 'trail';
  if (p.target === undefined) throw new InvalidOptionError('trail needs a target to follow.');
  const rate = checkNumber(p.rate ?? 70, 'rate', n, { min: 1, max: 2000 });
  const size = checkNumber(p.size ?? 5, 'size', n, { min: 0.5, max: 100 });
  const lifetime = checkNumber(p.lifetime ?? 500, 'lifetime', n, { min: 16 });
  return {
    rate,
    space: 'world',
    maxParticles: Math.min(5000, Math.ceil((rate * lifetime) / 1000) + 8),
    speed: { min: 0, max: 18 },
    spread: 360,
    lifetime: { min: lifetime * 0.8, max: lifetime },
    size: { min: size * 0.8, max: size },
    scale: { from: 1, to: 0.2 },
    opacity: { from: 0.9, to: 0 },
    look: p.look ?? 'soft',
    blendMode: p.additive === false ? 'normal' : 'plus',
    inheritVelocity: 0.1,
    colorOverLife: colorsOf(p.colors, ['#FFF3C4', '#FFB300', '#FF704300'], n),
  };
});

// --- glow pulse -----------------------------------------------------------------------------

export interface GlowPulseParams extends PlacementParams {
  /** Default `#FFD54A`. */
  readonly color?: Color;
  /** Pulses per second. Default 1.2. */
  readonly frequency?: number;
  /** Number of pulses; `Infinity` until stopped. Default Infinity. */
  readonly pulses?: number;
  /** Blur radius of the glow. Default 14. */
  readonly radius?: number;
  /** How far the ring grows per pulse, in points. Default 10. */
  readonly expand?: number;
  /** Padding around the target. Default 4. */
  readonly padding?: number;
  readonly cornerRadius?: number;
  /** `rect` (rounded, fitted to the target) or `circle`. Default `rect`. */
  readonly shape?: 'rect' | 'circle';
  /** 0 to 2. Default 1. */
  readonly intensity?: number;
  /** Size when there is no target. Default 60. */
  readonly size?: number;
}

/**
 * A soft light that breathes around a target: the outline grows and fades with each pulse.
 * Fits the target's size and follows its position, rotation and scale.
 */
export const glowPulse: EffectDefinition<GlowPulseParams> = defineEffect<GlowPulseParams>({
  name: 'glow-pulse',
  create(params, context) {
    const n = 'glow-pulse';
    const placement = new Placement(params, context, n);
    const color = params.color ?? '#FFD54A';
    validateFill(color, `${n} color`);
    const frequency = checkNumber(params.frequency ?? 1.2, 'frequency', n, { min: 0.05, max: 20 });
    const pulses = params.pulses ?? Infinity;
    if (!(pulses > 0)) throw new InvalidOptionError(`${n} pulses must be > 0.`);
    const radius = checkNumber(params.radius ?? 14, 'radius', n, { min: 0 });
    const expand = checkNumber(params.expand ?? 10, 'expand', n, { min: 0 });
    const padding = checkNumber(params.padding ?? 4, 'padding', n, { min: 0 });
    const corner = checkNumber(params.cornerRadius ?? 12, 'cornerRadius', n, { min: 0 });
    const fallbackSize = checkNumber(params.size ?? 60, 'size', n, { min: 0 });
    let intensity = checkNumber(params.intensity ?? 1, 'intensity', n, { min: 0, max: 2 });
    const circle = params.shape === 'circle';
    const glow = contextQuality(context).glow;
    const period = 1000 / frequency;
    const end = pulses * period;
    let stopAt = Infinity;
    let drawables: Drawable[] = [];
    let done = false;
    return {
      get drawables() {
        return drawables;
      },
      get done() {
        return done;
      },
      update(elapsed) {
        if (placement.targetGone || elapsed >= Math.min(end, stopAt)) {
          done = true;
          drawables = [];
          return;
        }
        drawables = [];
        if (!placement.visible) return;
        const m = placement.matrix();
        const size = placement.node ? placement.targetSize() : { width: fallbackSize, height: fallbackSize };
        const sx = placement.node ? Math.hypot(m[0], m[1]) : 1;
        const sy = placement.node ? Math.hypot(m[2], m[3]) : 1;
        const rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
        const phase = (elapsed % period) / period;
        // Ease out: the light swells quickly and fades softly.
        const grow = expand * (1 - (1 - phase) ** 2);
        const fade = (1 - phase) ** 1.5 * intensity * placement.opacity;
        const w = size.width * sx + padding * 2 + grow * 2;
        const h = size.height * sy + padding * 2 + grow * 2;
        const matrix = composeTransform(m[4], m[5], rotation, 1, 1);
        const shape = circle
          ? { type: 'circle' as const, radius: Math.max(w, h) / 2, stroke: { fill: color, width: 3 } }
          : {
              type: 'rect' as const,
              width: w,
              height: h,
              cornerRadius: Math.min(corner + grow, w / 2, h / 2),
              stroke: { fill: color, width: 3 },
            };
        const effects = glow ? [{ type: 'glow' as const, color, radius: radius * (0.7 + 0.3 * (1 - phase)), strength: Math.min(2, intensity * 1.4) }] : [];
        drawables.push(shapeDrawable(elapsed, shape, matrix, Math.min(1, fade), { blendMode: 'plus', effects, anchor: placement.anchor }));
        // A steady inner line keeps the target outlined between pulses.
        const inner = circle
          ? { type: 'circle' as const, radius: Math.max(w - grow * 2, h - grow * 2) / 2, stroke: { fill: color, width: 2 } }
          : {
              type: 'rect' as const,
              width: w - grow * 2,
              height: h - grow * 2,
              cornerRadius: Math.min(corner, (w - grow * 2) / 2, (h - grow * 2) / 2),
              stroke: { fill: color, width: 2 },
            };
        drawables.push(shapeDrawable(elapsed, inner, matrix, Math.min(1, 0.6 * intensity * placement.opacity), { blendMode: 'plus', anchor: placement.anchor }));
      },
      stop() {
        stopAt = 0;
        done = true;
        drawables = [];
      },
      setParams(patch) {
        if (patch.intensity !== undefined) intensity = checkNumber(patch.intensity, 'intensity', n, { min: 0, max: 2 });
      },
      dispose() {
        drawables = [];
      },
    };
  },
});

// --- explosion ------------------------------------------------------------------------------

export interface ExplosionParams extends PlacementParams {
  /** Scales size, particle counts and shake (0.1 to 3). Default 1. */
  readonly intensity?: number;
  /** Spark count at intensity 1. Default 150. */
  readonly particles?: number;
  /** Blast radius in points at intensity 1. Default 120. */
  readonly radius?: number;
  /** Fire colors, hot to cool. */
  readonly colors?: readonly string[];
  /** Default true. */
  readonly flash?: boolean;
  /** Default true. */
  readonly shockwave?: boolean;
  /** Default true. */
  readonly sparks?: boolean;
  /** Default true. */
  readonly smoke?: boolean;
  /** Tumbling fragments: true for squares, or an image (sprite-sheet frames). Default false. */
  readonly debris?: boolean | { readonly image: ImageAsset; readonly frames?: readonly Rect[] };
  /**
   * Strength of the light: the wide bloom and, on high quality, the halos of sparks and
   * embers. 0 to 2. Default 1.
   */
  readonly glow?: number;
  /** Shake the overlay (true) or given scopes. Default false. */
  readonly screenShake?: boolean | Omit<ScreenShakeParams, 'intensity'>;
}

export const EXPLOSION_COLORS: readonly string[] = ['#FFF8E1', '#FFD54A', '#FF9100', '#FF3D00', '#B71C1C'];

const transparent = (color: string) => withAlpha(color, 0);

/**
 * A layered explosion built from reusable primitives, all on one clock and one handle:
 *
 * | layer | starts | lasts | what |
 * | --- | --- | --- | --- |
 * | smoke | 120 ms | ~2.4 s | grey puffs rising from the blast, under everything (normal blend) |
 * | bloom | 0 | 320 ms | a wide, faint warm light |
 * | fireball | 0 | ~0.8 s | hot puffs that burst outward, stall (drag) and cool white → orange → red |
 * | flash | 0 | 160 ms | a small white-hot core |
 * | shockwave | 30 ms | 480 ms | a thin bright front over a faint band, decelerating |
 * | sparks | 0 | ~0.9 s | white-hot streaks that cool to red, slowed by drag and pulled down |
 * | embers | 60 ms | ~1.6 s | small glowing dots that drift and float up |
 * | debris | 0 | ~1.2 s | glowing chunks that cool to charcoal, tumble and fall (on top: depth) |
 * | shake | 0 | 420 ms | optional |
 *
 * Quality profiles keep every layer's timing and drop or thin the secondary ones: `low` has no
 * smoke or embers and thinner counts; spark halos only on `high`. Colors run hot to cool.
 */
export const explosion: EffectDefinition<ExplosionParams> = defineComposite<ExplosionParams>({
  name: 'explosion',
  layers(p, context) {
    const n = 'explosion';
    const intensity = checkNumber(p.intensity ?? 1, 'intensity', n, { min: 0.1, max: 3 });
    const count = checkNumber(p.particles ?? 150, 'particles', n, { min: 0, max: 2000 });
    const radius = checkNumber(p.radius ?? 120, 'radius', n, { min: 1 }) * Math.sqrt(intensity);
    const colors = colorsOf(p.colors, EXPLOSION_COLORS, n);
    const glow = checkNumber(p.glow ?? 1, 'glow', n, { min: 0, max: 2 });
    const quality = contextQuality(context);
    const details = quality.details;
    const halo = (base: number) => (quality.glow ? Math.min(1, base * glow) : 0);
    const where = { ...placementOf(p), follow: p.follow ?? false };
    const hot = colors[0] ?? '#FFF8E1';
    const yellow = colors[1] ?? hot;
    const orange = colors[2] ?? yellow;
    const red = colors[3] ?? orange;
    const dark = colors[4] ?? red;
    const speed = radius * 3.2;
    const layers: CompositeLayer[] = [];
    if (p.smoke !== false && details) {
      layers.push({
        name: 'smoke',
        effect: smoke,
        delay: 120,
        params: {
          ...where,
          rate: 0,
          burst: Math.round(11 * intensity),
          size: radius * 0.13,
          radius: radius * 0.3,
          lifetime: 2200,
          rise: 1.9,
          opacity: 0.3,
          duration: 0,
          colors: ['#6F6660', '#857C74', '#5C5652', '#9A928A'],
        } satisfies SmokeParams,
      });
    }
    if (p.flash !== false && glow > 0) {
      layers.push({ name: 'bloom', effect: flash, params: { ...where, radius: radius * 1.5, color: orange, duration: 320, intensity: Math.min(1, 0.32 * glow) } satisfies FlashParams });
    }
    // The fireball is the explosion's body: drawn whenever sparks or the flash are on.
    if (p.sparks !== false || p.flash !== false) {
      const puffs = Math.max(4, Math.round(26 * intensity));
      layers.push({
        name: 'fireball',
        effect: particles,
        params: {
          ...where,
          bursts: [{ count: puffs }],
          maxParticles: puffs,
          shape: { type: 'circle', radius: radius * 0.08 },
          directionMode: 'radial',
          speed: { min: radius * 0.9, max: radius * 2.8 },
          drag: 4.2,
          gravity: -radius * 0.3,
          lifetime: { min: 380, max: 780 },
          size: { min: radius * 0.09, max: radius * 0.19 },
          scale: { from: 0.6, to: 1.6, easing: 'easeOutCubic' },
          opacity: [0.75, 0.6, 0.4, 0],
          look: 'soft',
          blendMode: 'plus',
          colorOverLife: [hot, yellow, orange, red, transparent(dark)],
        } satisfies ParticlesParams,
      });
    }
    if (p.flash !== false) {
      layers.push({ name: 'flash', effect: flash, params: { ...where, radius: radius * 0.7, color: yellow, duration: 160 } satisfies FlashParams });
    }
    if (p.shockwave !== false) {
      layers.push({
        name: 'shockwave',
        effect: shockwave,
        delay: 30,
        params: { ...where, radius: radius * 1.05, color: yellow, duration: 460, width: 5 * Math.sqrt(intensity), intensity: 0.75, echoes: 0 } satisfies ShockwaveParams,
      });
    }
    if (p.sparks !== false) {
      const sparks = Math.round(count * intensity);
      layers.push({
        name: 'sparks',
        effect: particles,
        params: {
          ...where,
          bursts: [{ count: sparks }],
          maxParticles: Math.min(5000, Math.max(1, sparks)),
          shape: { type: 'circle', radius: radius * 0.06 },
          directionMode: 'radial',
          speed: { min: speed * 0.2, max: speed },
          drag: 2.6,
          gravity: 320,
          lifetime: { min: 320, max: 950 },
          size: { min: 0.9, max: 2.4 },
          look: 'spark',
          stretch: 0.04,
          blendMode: 'plus',
          glow: halo(0.8),
          opacity: [1, 1, 0.85, 0],
          colorOverLife: ['#FFFFFF', hot, yellow, orange, red, transparent(dark)],
        } satisfies ParticlesParams,
      });
      if (details) {
        const embers = Math.round(count * 0.3 * intensity);
        layers.push({
          name: 'embers',
          effect: particles,
          delay: 60,
          params: {
            ...where,
            bursts: [{ count: embers }],
            maxParticles: Math.min(5000, Math.max(1, embers)),
            shape: { type: 'circle', radius: radius * 0.25 },
            directionMode: 'radial',
            speed: { min: speed * 0.06, max: speed * 0.3 },
            drag: 1.4,
            gravity: -60,
            lifetime: { min: 700, max: 1600 },
            size: { min: 1.2, max: 3 },
            scale: { from: 1, to: 0.3 },
            opacity: [0, 1, 0.9, 0.6, 0],
            look: 'circle',
            blendMode: 'plus',
            glow: halo(0.6),
            colorOverLife: [yellow, orange, red, transparent(dark)],
          } satisfies ParticlesParams,
        });
      }
    }
    if (p.debris) {
      const image = typeof p.debris === 'object' ? p.debris : null;
      const chunks = Math.round(14 * intensity);
      layers.push({
        name: 'debris',
        effect: particles,
        params: {
          ...where,
          bursts: [{ count: chunks }],
          maxParticles: Math.max(1, chunks),
          shape: { type: 'circle', radius: radius * 0.1 },
          direction: -90,
          spread: 230,
          speed: { min: speed * 0.25, max: speed * 0.65 },
          drag: 0.9,
          gravity: 950,
          lifetime: { min: 750, max: 1250 },
          size: { min: 2, max: 6 },
          aspect: 0.7,
          rotation: { min: 0, max: 360 },
          angularVelocity: { min: -900, max: 900 },
          opacity: [1, 1, 1, 0],
          look: image ? { type: 'image', image: image.image, ...(image.frames ? { frames: image.frames } : {}) } : 'square',
          // Chunks leave the blast glowing and cool to charcoal as they fall.
          ...(image ? {} : { colorOverLife: ['#FFD08A', '#E0782C', '#6B3A22', '#2E2724', '#2A2522'] }),
        } satisfies ParticlesParams,
      });
    }
    if (p.screenShake) {
      const shake = typeof p.screenShake === 'object' ? p.screenShake : {};
      layers.push({
        name: 'shake',
        effect: screenShake,
        params: { amplitude: 9, duration: 420, ...shake, intensity: Math.min(3, intensity) } satisfies ScreenShakeParams,
      });
    }
    return layers;
  },
});

// --- victory --------------------------------------------------------------------------------

export interface VictoryParams extends PlacementParams {
  /** Width of the celebration in points (confetti cannons sit at its edges). Default 280. */
  readonly width?: number;
  /** Default 1. */
  readonly intensity?: number;
  readonly colors?: readonly string[];
  /** Default true. */
  readonly glow?: boolean;
}

/**
 * A celebration: a central burst of golden sparks with a shockwave, then confetti from two
 * sides and the centre, then a second wave, plus a pulsing glow when it has a target.
 */
export const victory: EffectDefinition<VictoryParams> = defineComposite<VictoryParams>({
  name: 'victory',
  layers(p, context) {
    const n = 'victory';
    const width = checkNumber(p.width ?? 280, 'width', n, { min: 10 });
    const intensity = checkNumber(p.intensity ?? 1, 'intensity', n, { min: 0.1, max: 3 });
    const colors = colorsOf(p.colors, CONFETTI_COLORS, n);
    const centre = new Placement(placementOf(p), context, n).position();
    const at = (dx: number): PlacementParams => ({ position: { x: centre.x + dx, y: centre.y } satisfies Point });
    const layers: CompositeLayer[] = [
      { name: 'bloom', effect: flash, params: { ...at(0), radius: width * 0.4, color: '#FFD54A', duration: 360, intensity: 0.45 } satisfies FlashParams },
      { name: 'sparks', effect: goldenSparks, params: { ...at(0), count: Math.round(70 * intensity), power: 1.1 } satisfies GoldenSparksParams },
      { name: 'ring', effect: shockwave, params: { ...at(0), radius: width * 0.45, color: '#FFE082', width: 6 } satisfies ShockwaveParams },
      { name: 'confetti-left', delay: 120, effect: confetti, params: { ...at(-width / 2), direction: -60, spread: 40, count: Math.round(70 * intensity), colors } satisfies ConfettiParams },
      { name: 'confetti-right', delay: 120, effect: confetti, params: { ...at(width / 2), direction: -120, spread: 40, count: Math.round(70 * intensity), colors } satisfies ConfettiParams },
      { name: 'confetti-centre', delay: 420, effect: confetti, params: { ...at(0), spread: 50, power: 1.2, count: Math.round(80 * intensity), colors } satisfies ConfettiParams },
      { name: 'sparks-2', delay: 700, effect: goldenSparks, params: { ...at(0), count: Math.round(40 * intensity), power: 0.8 } satisfies GoldenSparksParams },
    ];
    if (p.glow !== false && p.target !== undefined) {
      layers.push({ name: 'glow', effect: glowPulse, params: { ...placementOf(p), pulses: 3, frequency: 1.4 } satisfies GlowPulseParams });
    }
    return layers;
  },
});
