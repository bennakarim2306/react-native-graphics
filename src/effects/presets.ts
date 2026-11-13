import { validateFill } from '../graphics/paint';
import type { Color } from '../graphics/paint';
import type { ImageAsset } from '../assets/assets';
import type { Rect } from '../graphics/path';
import type { EmitterConfig } from '../particles/emitter';
import { contextQuality, defineEffect } from '../runtime/effect';
import type { Drawable, EffectDefinition } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import { composeTransform } from '../scene/matrix';
import type { Point } from '../scene/matrix';
import { defineComposite } from './composite';
import type { CompositeLayer } from './composite';
import { checkNumber, Placement, shapeDrawable } from './placement';
import type { PlacementParams } from './placement';
import { flash, particles, ParticlesInstance, screenShake, shockwave } from './primitives';
import type { ParticlesParams, ScreenShakeParams } from './primitives';

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

/** A preset that is one configured emitter. */
function emitterPreset<P extends PlacementParams>(name: string, build: (params: P) => EmitterConfig): EffectDefinition<P> {
  return defineEffect<P>({
    name,
    create: (params, context) => new ParticlesInstance({ ...build(params), ...placementOf(params) }, context, name),
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
    speed: { min: 260 * power, max: 620 * power },
    gravity: 520,
    drag: 1.6,
    lifetime: { min: duration * 0.7, max: duration },
    size: { min: size * 0.7, max: size * 1.3 },
    aspect: 0.5,
    look: 'square',
    rotation: { min: 0, max: 360 },
    angularVelocity: { min: -540, max: 540 },
    // Pieces flutter: the scale curve squashes them as if they were flipping.
    scale: [1, 0.35, 1, 0.35, 1, 0.35, 1],
    opacity: [1, 1, 1, 1, 0],
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
export const goldenSparks: EffectDefinition<GoldenSparksParams> = emitterPreset<GoldenSparksParams>('golden-sparks', (p) => {
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
    lifetime: { min: 350, max: 900 },
    size: { min: 1.2, max: 2.6 },
    look: 'spark',
    stretch: 0.045,
    blendMode: 'plus',
    opacity: { from: 1, to: 0, easing: 'easeInQuad' },
    colors: colorsOf(p.colors, GOLD_COLORS, n),
  };
});

// --- smoke ----------------------------------------------------------------------------------

export interface SmokeParams extends PlacementParams {
  /** Puffs per second. Default 14. */
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
}

export const SMOKE_COLORS: readonly string[] = ['#9E9E9E', '#BDBDBD', '#757575'];

/** Soft puffs that rise, grow, drift and fade. Emits until stopped unless `duration` is set. */
export const smoke: EffectDefinition<SmokeParams> = emitterPreset<SmokeParams>('smoke', (p) => {
  const n = 'smoke';
  const rate = checkNumber(p.rate ?? 14, 'rate', n, { min: 0, max: 500 });
  const burst = checkNumber(p.burst ?? 0, 'burst', n, { min: 0, max: 500 });
  const size = checkNumber(p.size ?? 14, 'size', n, { min: 1, max: 300 });
  const rise = checkNumber(p.rise ?? 1, 'rise', n, { min: 0, max: 10 });
  const lifetime = checkNumber(p.lifetime ?? 2200, 'lifetime', n, { min: 100 });
  const radius = checkNumber(p.radius ?? 6, 'radius', n, { min: 0 });
  return {
    rate,
    bursts: burst > 0 ? [{ count: Math.round(burst) }] : [],
    ...(p.duration !== undefined ? { duration: p.duration } : rate > 0 ? {} : { duration: 0 }),
    maxParticles: 400,
    shape: { type: 'circle', radius },
    direction: -90,
    spread: 40,
    speed: { min: 18 * rise, max: 46 * rise },
    gravity: { x: checkNumber(p.wind ?? 8, 'wind', n), y: -10 * rise },
    drag: 0.4,
    lifetime: { min: lifetime * 0.7, max: lifetime },
    size: { min: size * 0.7, max: size * 1.2 },
    scale: { from: 0.6, to: 2.4, easing: 'easeOutQuad' },
    opacity: [0, 0.55, 0.4, 0],
    rotation: { min: 0, max: 360 },
    angularVelocity: { min: -30, max: 30 },
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
        const grow = expand * phase;
        const fade = (1 - phase) * intensity * placement.opacity;
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
        drawables.push(shapeDrawable(elapsed, shape, matrix, Math.min(1, fade), { blendMode: 'plus', effects }));
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
        drawables.push(shapeDrawable(elapsed, inner, matrix, Math.min(1, 0.6 * intensity * placement.opacity), { blendMode: 'plus' }));
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
  /** Shake the overlay (true) or given scopes. Default false. */
  readonly screenShake?: boolean | Omit<ScreenShakeParams, 'intensity'>;
}

export const EXPLOSION_COLORS: readonly string[] = ['#FFF8E1', '#FFD54A', '#FF9100', '#FF3D00', '#B71C1C'];

/**
 * An explosion built from reusable primitives: a flash, a shockwave, a burst of sparks and
 * embers, smoke, optional debris and an optional screen shake, all on one clock and one
 * handle. Each part can be turned off; quality profiles drop the secondary parts.
 */
export const explosion: EffectDefinition<ExplosionParams> = defineComposite<ExplosionParams>({
  name: 'explosion',
  layers(p, context) {
    const n = 'explosion';
    const intensity = checkNumber(p.intensity ?? 1, 'intensity', n, { min: 0.1, max: 3 });
    const count = checkNumber(p.particles ?? 150, 'particles', n, { min: 0, max: 2000 });
    const radius = checkNumber(p.radius ?? 120, 'radius', n, { min: 1 }) * Math.sqrt(intensity);
    const colors = colorsOf(p.colors, EXPLOSION_COLORS, n);
    const details = contextQuality(context).details;
    const where = { ...placementOf(p), follow: p.follow ?? false };
    const speed = radius * 3.2;
    const layers: CompositeLayer[] = [];
    if (p.smoke !== false && details) {
      layers.push({
        name: 'smoke',
        effect: smoke,
        delay: 80,
        params: { ...where, rate: 0, burst: Math.round(14 * intensity), size: radius * 0.22, radius: radius * 0.25, lifetime: 1800, rise: 1.4, duration: 0 } satisfies SmokeParams,
      });
    }
    if (p.flash !== false) {
      layers.push({ name: 'flash', effect: flash, params: { ...where, radius: radius * 1.1, color: colors[1] ?? '#FFD54A', duration: 240 } });
    }
    if (p.shockwave !== false) {
      layers.push({ name: 'shockwave', effect: shockwave, params: { ...where, radius: radius * 1.5, color: colors[0] ?? '#FFF8E1', duration: 560, width: 8 * Math.sqrt(intensity) } });
    }
    if (p.sparks !== false) {
      layers.push({
        name: 'sparks',
        effect: particles,
        params: {
          ...where,
          bursts: [{ count: Math.round(count * intensity) }],
          maxParticles: Math.min(5000, Math.max(1, Math.round(count * intensity))),
          speed: { min: speed * 0.25, max: speed },
          drag: 2.2,
          gravity: 260,
          lifetime: { min: 380, max: 900 },
          size: { min: 1.4, max: 3 },
          look: 'spark',
          stretch: 0.05,
          blendMode: 'plus',
          colors,
        } satisfies ParticlesParams,
      });
      if (details) {
        layers.push({
          name: 'embers',
          effect: particles,
          params: {
            ...where,
            bursts: [{ count: Math.round(count * 0.35 * intensity) }],
            maxParticles: Math.min(5000, Math.max(1, Math.round(count * 0.35 * intensity))),
            shape: { type: 'circle', radius: radius * 0.15 },
            speed: { min: speed * 0.1, max: speed * 0.45 },
            drag: 1.5,
            gravity: -40,
            lifetime: { min: 500, max: 1300 },
            size: { min: 2.5, max: 6 },
            scale: { from: 1, to: 0.2 },
            look: 'soft',
            blendMode: 'plus',
            colorOverLife: [colors[0] ?? '#FFF8E1', colors[2] ?? '#FF9100', `${(colors[4] ?? '#B71C1C').slice(0, 7)}00`],
          } satisfies ParticlesParams,
        });
      }
    }
    if (p.debris) {
      const image = typeof p.debris === 'object' ? p.debris : null;
      layers.push({
        name: 'debris',
        effect: particles,
        params: {
          ...where,
          bursts: [{ count: Math.round(14 * intensity) }],
          maxParticles: 64,
          direction: -90,
          spread: 220,
          speed: { min: speed * 0.3, max: speed * 0.7 },
          gravity: 900,
          lifetime: { min: 700, max: 1200 },
          size: { min: 3, max: 7 },
          rotation: { min: 0, max: 360 },
          angularVelocity: { min: -720, max: 720 },
          opacity: [1, 1, 1, 0],
          look: image ? { type: 'image', image: image.image, ...(image.frames ? { frames: image.frames } : {}) } : 'square',
          colors: ['#5D4037', '#424242', '#8D6E63'],
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
      { name: 'sparks', effect: goldenSparks, params: { ...at(0), count: Math.round(70 * intensity), power: 1.1 } satisfies GoldenSparksParams },
      { name: 'ring', effect: shockwave, params: { ...at(0), radius: width * 0.45, color: '#FFE082' } },
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
