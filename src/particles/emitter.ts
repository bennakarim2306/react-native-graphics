import type { ImageAsset } from '../assets/assets';
import { parseColor } from '../graphics/color';
import type { BlendMode } from '../graphics/paint';
import { validateBlendMode } from '../graphics/paint';
import type { Rect } from '../graphics/path';
import { InvalidOptionError } from '../runtime/errors';
import type { Random } from '../runtime/rng';
import { IDENTITY } from '../scene/matrix';
import type { Matrix2D, Point } from '../scene/matrix';
import type { SceneNode } from '../scene/node';
import type { ParticleDrawable, ParticleLookKind } from './burst';
import { resolveCurve, resolveSpread, sampleSpread } from './curves';
import type { CurveFunction, ResolvedSpread, Spread, ValueCurve } from './curves';
import { sharedParticlePool } from './pool';
import type { ParticleBuffers, ParticlePool } from './pool';
import { createShapeSampler } from './shapes';
import type { EmitterShape, ShapeSample, ShapeSampler } from './shapes';

/** How a particle looks. Images are drawn in batches (Skia `drawAtlas`). */
export type ParticleLook =
  | ParticleLookKind
  | {
      readonly type: 'image';
      readonly image: ImageAsset;
      /** Source rectangles in the image (sprite-sheet frames). Default: the whole image. */
      readonly frames?: readonly Rect[];
      /** `random`: each particle keeps one frame; `life`: frames play over the lifetime. Default `random`. */
      readonly frameMode?: 'random' | 'life';
    };

/** A burst of `count` particles at `at` ms after the emitter started. */
export interface EmitterBurst {
  readonly at?: number;
  readonly count: number;
}

/**
 * Configuration of a particle emitter. Every number is validated when the emitter is created.
 * Angles are degrees, clockwise on screen (0 = right, 90 = down, -90 = up). Distances are
 * points, times are ms, speeds are points per second.
 */
export interface EmitterConfig {
  /** Birth area in the emitter's local coordinates. Default a point. */
  readonly shape?: EmitterShape;
  /**
   * `world` (default): particles are simulated in overlay coordinates; once born they no longer
   * follow the emitter (trails, smoke, sparks flying off a moving object).
   * `local`: particles live in the emitter's coordinate system and move, rotate and scale with
   * it every frame (flames on a moving card, an aura).
   */
  readonly space?: 'world' | 'local';
  /** Continuous emission in particles per second. Default 0. */
  readonly rate?: number;
  /** One-off bursts. */
  readonly bursts?: readonly EmitterBurst[];
  /** How long continuous emission lasts in ms. Default: `Infinity` with a rate, else 0. */
  readonly duration?: number;
  /** Upper bound of live particles; extra births are dropped. Default 500, at most 5000. */
  readonly maxParticles?: number;
  /** Lifetime per particle in ms. Default { min: 600, max: 1000 }. */
  readonly lifetime?: Spread;
  /** Initial speed. Default { min: 60, max: 160 }. */
  readonly speed?: Spread;
  /** Mean emission angle in degrees. Default -90 (up). */
  readonly direction?: number;
  /** Angular spread around `direction`, 0 to 360. Default 360. */
  readonly spread?: number;
  /**
   * `fixed` (default): `direction` ± `spread / 2`.
   * `normal`: along the shape's outward normal at the birth point (± `spread / 2`), for borders.
   * `radial`: away from the emitter origin.
   */
  readonly directionMode?: 'fixed' | 'normal' | 'radial';
  /** Constant acceleration (a number means straight down). Default 0. */
  readonly gravity?: number | Point;
  /** Linear drag per second (velocity decays by e^(-drag·t)). Default 0. */
  readonly drag?: number;
  /** Particle radius (or half size) in points. Default 4. */
  readonly size?: Spread;
  /** Size multiplier over life. Default 1. */
  readonly scale?: ValueCurve;
  /** Opacity over life, 0 to 1. Default { from: 1, to: 0 }. */
  readonly opacity?: ValueCurve;
  /** Initial rotation. Default 0. */
  readonly rotation?: Spread;
  /** Rotation speed in degrees per second. Default 0. */
  readonly angularVelocity?: Spread;
  /** Rotate each particle to its direction of motion (sparks do this automatically). */
  readonly alignToVelocity?: boolean;
  /** Palette: each particle picks one color at birth. Default warm gold tones. */
  readonly colors?: readonly string[];
  /** Colors over life (evenly spaced), applied to every particle instead of `colors`. */
  readonly colorOverLife?: readonly string[];
  /** Default `circle`. */
  readonly look?: ParticleLook;
  /** Width to height ratio of `square` particles (confetti strips). Default 1. */
  readonly aspect?: number;
  /** Length of `spark` streaks as seconds of motion. Default 0.04. */
  readonly stretch?: number;
  /**
   * Halo around `spark` and `circle` particles, 0 to 1: a wider, faint pass under a whiter
   * core (one extra draw per particle). Default 0.
   */
  readonly glow?: number;
  /** How particles combine with what is below. `plus` makes fire and sparks glow. Default `normal`. */
  readonly blendMode?: BlendMode;
  /** World space only: fraction of the emitter's own velocity given to newborn particles. Default 0. */
  readonly inheritVelocity?: number;
}

/**
 * What `ParticleEmitter.configure` (and `handle.update` on the `particles` effect) can change
 * while the emitter runs:
 * - Birth properties (`shape`, `lifetime`, `speed`, `direction`, `spread`, `directionMode`,
 *   `size`, `rotation`, `angularVelocity`, `inheritVelocity`) apply to particles born from then on.
 * - Forces (`gravity`, `drag`) act on live particles from then on, without a jump in their
 *   position or velocity.
 * - Looks over life (`colors`, `colorOverLife`, `opacity`, `scale`) apply to every live particle
 *   at once.
 * - `rate` re-times continuous emission from now on.
 *
 * Fixed for the emitter's life (they size its storage or its batches): `space`, `maxParticles`,
 * `bursts`, `duration`, `look`, `aspect`, `stretch`, `glow` and `blendMode`.
 */
export type EmitterUpdate = Pick<
  EmitterConfig,
  | 'rate'
  | 'shape'
  | 'lifetime'
  | 'speed'
  | 'direction'
  | 'spread'
  | 'directionMode'
  | 'size'
  | 'rotation'
  | 'angularVelocity'
  | 'inheritVelocity'
  | 'gravity'
  | 'drag'
  | 'colors'
  | 'colorOverLife'
  | 'opacity'
  | 'scale'
>;

/** The keys of `EmitterUpdate`. */
export const EMITTER_UPDATE_KEYS: readonly (keyof EmitterUpdate)[] = [
  'rate',
  'shape',
  'lifetime',
  'speed',
  'direction',
  'spread',
  'directionMode',
  'size',
  'rotation',
  'angularVelocity',
  'inheritVelocity',
  'gravity',
  'drag',
  'colors',
  'colorOverLife',
  'opacity',
  'scale',
];
const UPDATE_KEYS: ReadonlySet<string> = new Set(EMITTER_UPDATE_KEYS);

export const MAX_EMITTER_PARTICLES = 5000;
export const DEFAULT_EMITTER_COLORS: readonly string[] = ['#FFD54A', '#FFB300', '#FF7043', '#FFF3C4'];

interface Resolved {
  readonly sampler: ShapeSampler;
  readonly space: 'world' | 'local';
  readonly rate: number;
  readonly bursts: readonly { at: number; count: number }[];
  readonly duration: number;
  readonly maxParticles: number;
  readonly lifetime: ResolvedSpread;
  readonly speed: ResolvedSpread;
  readonly direction: number;
  readonly spread: number;
  readonly directionMode: 'fixed' | 'normal' | 'radial';
  readonly gx: number;
  readonly gy: number;
  readonly drag: number;
  readonly size: ResolvedSpread;
  readonly scale: CurveFunction;
  readonly opacity: CurveFunction;
  readonly rotation: ResolvedSpread;
  readonly spin: ResolvedSpread;
  readonly align: boolean;
  readonly palette: Float32Array;
  readonly paletteAlpha: Float32Array;
  readonly overLife: Float32Array | null;
  readonly look: ParticleLookKind;
  readonly image: ImageAsset | undefined;
  readonly frames: readonly Rect[] | undefined;
  readonly frameMode: 'random' | 'life';
  readonly aspect: number;
  readonly stretch: number;
  readonly glow: number;
  readonly blendMode: BlendMode;
  readonly inheritVelocity: number;
}

const LOOKS: readonly ParticleLookKind[] = ['circle', 'square', 'spark', 'ring', 'soft'];

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidOptionError(`${name} must be a finite number.`);
  return value;
}

/** Applies a quality multiplier to counts and validates the configuration. */
export function resolveEmitterConfig(config: EmitterConfig, qualityScale = 1): Resolved {
  const raw: unknown = config;
  if (typeof raw !== 'object' || raw === null) throw new InvalidOptionError('Emitter config must be an object.');
  const q = Math.max(0, qualityScale);
  const scaleCount = (n: number) => (n <= 0 ? 0 : Math.max(1, Math.round(n * q)));
  const rate = finiteNumber(config.rate ?? 0, 'rate');
  if (rate < 0) throw new InvalidOptionError('rate must be >= 0.');
  const bursts = (config.bursts ?? []).map((b, i) => {
    const at = finiteNumber(b.at ?? 0, `bursts[${String(i)}].at`);
    const count = b.count;
    if (!Number.isInteger(count) || count < 0) throw new InvalidOptionError(`bursts[${String(i)}].count must be an integer >= 0.`);
    if (at < 0) throw new InvalidOptionError(`bursts[${String(i)}].at must be >= 0.`);
    return { at, count: scaleCount(count) };
  });
  bursts.sort((a, b) => a.at - b.at);
  const duration = config.duration ?? (rate > 0 ? Infinity : 0);
  if (!(duration >= 0) || Number.isNaN(duration)) throw new InvalidOptionError('duration must be >= 0.');
  const maxRaw = config.maxParticles ?? 500;
  if (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > MAX_EMITTER_PARTICLES) {
    throw new InvalidOptionError(`maxParticles must be an integer between 1 and ${String(MAX_EMITTER_PARTICLES)}.`);
  }
  const spread = finiteNumber(config.spread ?? 360, 'spread');
  if (spread < 0 || spread > 360) throw new InvalidOptionError('spread must be between 0 and 360.');
  const gravity = config.gravity ?? 0;
  const gx = typeof gravity === 'number' ? 0 : finiteNumber(gravity.x, 'gravity.x');
  const gy = typeof gravity === 'number' ? finiteNumber(gravity, 'gravity') : finiteNumber(gravity.y, 'gravity.y');
  const drag = finiteNumber(config.drag ?? 0, 'drag');
  if (drag < 0) throw new InvalidOptionError('drag must be >= 0.');
  const lifetime = resolveSpread(config.lifetime ?? { min: 600, max: 1000 }, 'lifetime', { min: 0 });
  if (lifetime.max <= 0) throw new InvalidOptionError('lifetime must be > 0.');
  const colors: readonly string[] = config.colors ?? DEFAULT_EMITTER_COLORS;
  const rawColors: unknown = colors;
  if (!Array.isArray(rawColors) || colors.length < 1 || colors.length > 1024) {
    throw new InvalidOptionError('colors must contain between 1 and 1024 colors.');
  }
  const palette = new Float32Array(colors.length * 3);
  const paletteAlpha = new Float32Array(colors.length);
  colors.forEach((c, i) => {
    const rgba = parseColor(c);
    palette[i * 3] = rgba.r;
    palette[i * 3 + 1] = rgba.g;
    palette[i * 3 + 2] = rgba.b;
    paletteAlpha[i] = rgba.a;
  });
  let overLife: Float32Array | null = null;
  if (config.colorOverLife !== undefined) {
    const rawOverLife: unknown = config.colorOverLife;
    if (!Array.isArray(rawOverLife) || config.colorOverLife.length < 1) {
      throw new InvalidOptionError('colorOverLife needs at least one color.');
    }
    overLife = new Float32Array(config.colorOverLife.length * 4);
    config.colorOverLife.forEach((c, i) => {
      const rgba = parseColor(c);
      overLife?.set([rgba.r, rgba.g, rgba.b, rgba.a], i * 4);
    });
  }
  const lookOption = config.look ?? 'circle';
  let look: ParticleLookKind;
  let image: ImageAsset | undefined;
  let frames: readonly Rect[] | undefined;
  let frameMode: 'random' | 'life' = 'random';
  if (typeof lookOption === 'string') {
    if (!LOOKS.includes(lookOption)) throw new InvalidOptionError(`Unknown particle look "${lookOption}".`);
    look = lookOption;
  } else {
    if ((lookOption.type as string) !== 'image' || typeof lookOption.image !== 'object') {
      throw new InvalidOptionError('An image particle look needs { type: "image", image }.');
    }
    look = 'image';
    image = lookOption.image;
    frames = lookOption.frames && lookOption.frames.length > 0 ? lookOption.frames : undefined;
    frameMode = lookOption.frameMode ?? 'random';
  }
  const aspect = finiteNumber(config.aspect ?? 1, 'aspect');
  if (aspect <= 0) throw new InvalidOptionError('aspect must be > 0.');
  const stretch = finiteNumber(config.stretch ?? 0.04, 'stretch');
  const glow = finiteNumber(config.glow ?? 0, 'glow');
  if (glow < 0 || glow > 1) throw new InvalidOptionError('glow must be between 0 and 1.');
  const blendMode = config.blendMode ?? 'normal';
  validateBlendMode(blendMode);
  const inheritVelocity = finiteNumber(config.inheritVelocity ?? 0, 'inheritVelocity');
  const directionMode = config.directionMode ?? 'fixed';
  if (!['fixed', 'normal', 'radial'].includes(directionMode)) throw new InvalidOptionError(`Unknown directionMode "${directionMode}".`);
  const space = config.space ?? 'world';
  if ((space as string) !== 'world' && space !== 'local') throw new InvalidOptionError(`space must be "world" or "local".`);
  return {
    sampler: createShapeSampler(config.shape ?? { type: 'point' }),
    space,
    rate: rate * q,
    bursts,
    duration,
    maxParticles: Math.max(1, Math.round(maxRaw * Math.min(1, Math.max(q, 0.1)))),
    lifetime,
    speed: resolveSpread(config.speed ?? { min: 60, max: 160 }, 'speed', { min: 0 }),
    direction: finiteNumber(config.direction ?? -90, 'direction'),
    spread,
    directionMode,
    gx,
    gy,
    drag,
    size: resolveSpread(config.size ?? 4, 'size', { min: 0 }),
    scale: resolveCurve(config.scale ?? 1, 'scale', { min: 0 }),
    opacity: resolveCurve(config.opacity ?? { from: 1, to: 0 }, 'opacity', { min: 0, max: 1 }),
    rotation: resolveSpread(config.rotation ?? 0, 'rotation'),
    spin: resolveSpread(config.angularVelocity ?? 0, 'angularVelocity'),
    align: config.alignToVelocity ?? false,
    palette,
    paletteAlpha,
    overLife,
    look,
    image,
    frames,
    frameMode,
    aspect,
    stretch,
    glow,
    blendMode,
    inheritVelocity,
  };
}

const DEG = Math.PI / 180;

/**
 * A particle emitter: continuous emission and bursts from a shape, with closed-form motion
 * (velocity, constant acceleration, linear drag), so a particle's state depends only on its
 * age and the forces since the last change. Births happen at exact scheduled times
 * (`n / rate`), and each newborn particle uses the seeded random generator in birth order. A
 * static emitter therefore produces identical results at any frame rate; a moving world-space
 * emitter interpolates its position between frames for births in between. The same seed and
 * the same sequence of `configure` calls at the same times give the same particles.
 *
 * Storage comes from a `ParticlePool` and is returned on `dispose`.
 */
export class ParticleEmitter implements ParticleDrawable {
  readonly kind = 'particles' as const;
  readonly look: ParticleLookKind;
  readonly blendMode: BlendMode;
  readonly aspect: number;
  readonly stretch: number;
  readonly glow: number;
  readonly image: ImageAsset | undefined;
  readonly frames: readonly Rect[] | undefined;
  /** Local space: transform applied to every particle when drawing. */
  matrix: Matrix2D | undefined;
  /** Node the particles move rigidly with (set by effects for local-space emitters); see `Drawable.anchor`. */
  anchor: SceneNode | undefined;
  private cfg: Resolved;
  private source: EmitterConfig;
  private readonly qualityScale: number;
  private buffers: ParticleBuffers;
  private freeTop: number;
  private aliveTotal = 0;
  private elapsed = 0;
  private rateIndex = 0;
  private burstIndex = 0;
  private emissionEnd: number;
  private current: Matrix2D = IDENTITY;
  private previous: Matrix2D = IDENTITY;
  private previousTime = 0;
  private hasPrevious = false;
  private droppedCount = 0;
  private bornCount = 0;
  private disposed = false;
  private readonly sample: ShapeSample = { x: 0, y: 0, normal: 0 };
  private readonly pool: ParticlePool;
  /** Time the current update advances to (set before births are emitted). */
  private pendingTarget = 0;
  private rate: number;

  constructor(
    config: EmitterConfig,
    private readonly random: Random,
    options: { qualityScale?: number; pool?: ParticlePool; transform?: Matrix2D } = {},
  ) {
    this.qualityScale = options.qualityScale ?? 1;
    this.cfg = resolveEmitterConfig(config, this.qualityScale);
    this.source = config;
    this.look = this.cfg.look;
    this.blendMode = this.cfg.blendMode;
    this.aspect = this.cfg.aspect;
    this.stretch = this.cfg.stretch;
    this.glow = this.cfg.glow;
    this.image = this.cfg.image;
    this.frames = this.cfg.frames;
    this.pool = options.pool ?? sharedParticlePool;
    this.buffers = this.pool.acquire(this.cfg.maxParticles);
    this.freeTop = 0;
    for (let i = this.cfg.maxParticles - 1; i >= 0; i--) this.buffers.free[this.freeTop++] = i;
    this.emissionEnd = this.cfg.duration;
    this.rate = this.cfg.rate;
    if (options.transform) this.setTransform(options.transform);
    if (this.cfg.space === 'local') this.matrix = this.current;
  }

  get count(): number {
    return this.cfg.maxParticles;
  }

  get aliveCount(): number {
    return this.aliveTotal;
  }

  /** Particles that could not be born because `maxParticles` were alive. */
  get dropped(): number {
    return this.droppedCount;
  }

  /** Total particles born so far. */
  get born(): number {
    return this.bornCount;
  }

  get space(): 'world' | 'local' {
    return this.cfg.space;
  }

  // Views of the current state, read by renderers.
  get x(): Float32Array {
    return this.buffers.x;
  }
  get y(): Float32Array {
    return this.buffers.y;
  }
  get vx(): Float32Array {
    return this.buffers.vx;
  }
  get vy(): Float32Array {
    return this.buffers.vy;
  }
  get radius(): Float32Array {
    return this.buffers.radius;
  }
  get opacity(): Float32Array {
    return this.buffers.opacity;
  }
  get alive(): Uint8Array {
    return this.buffers.alive;
  }
  get rotation(): Float32Array {
    return this.buffers.rotation;
  }
  get red(): Float32Array {
    return this.buffers.red;
  }
  get green(): Float32Array {
    return this.buffers.green;
  }
  get blue(): Float32Array {
    return this.buffers.blue;
  }
  get frame(): Uint16Array {
    return this.buffers.frame;
  }

  /** True when emission has ended and every particle has died. */
  get done(): boolean {
    return this.disposed || (this.emissionFinished && this.aliveTotal === 0);
  }

  /** True when no more particles will be born. */
  get emissionFinished(): boolean {
    return this.elapsed >= this.emissionEnd && this.burstIndex >= this.cfg.bursts.length;
  }

  /**
   * Places the emitter (its local origin, rotation and scale) for the next update. World-space
   * births between two updates interpolate between the previous and this transform.
   */
  setTransform(matrix: Matrix2D): void {
    this.current = matrix;
    if (this.cfg.space === 'local') this.matrix = matrix;
  }

  /** Stops emitting now; live particles finish their life. */
  stop(): void {
    this.emissionEnd = Math.min(this.emissionEnd, this.elapsed);
    this.burstIndex = this.cfg.bursts.length;
  }

  /** Changes the continuous emission rate from now on (0 pauses emission). */
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0) throw new InvalidOptionError('rate must be a finite number >= 0.');
    // Re-anchor the schedule so the next birth follows the new rate without a jump.
    this.rate = rate;
    this.rateIndex = rate > 0 ? Math.floor((this.elapsed * rate) / 1000) + 1 : 0;
  }

  /**
   * Changes properties of the running emitter (see `EmitterUpdate` for what each one affects).
   * Keys set to `undefined` are ignored. Validates everything first and throws
   * `InvalidOptionError` without changing anything when a key or value is invalid.
   */
  configure(patch: EmitterUpdate): void {
    const raw: unknown = patch;
    if (typeof raw !== 'object' || raw === null) throw new InvalidOptionError('configure expects an object of emitter properties.');
    const changes: Record<string, unknown> = {};
    // Typed as unknown: JavaScript callers can pass anything, including undefined values.
    const entries: [string, unknown][] = Object.entries(patch);
    for (const [key, value] of entries) {
      if (!UPDATE_KEYS.has(key)) {
        throw new InvalidOptionError(`An emitter cannot change "${key}" while running (allowed: ${EMITTER_UPDATE_KEYS.join(', ')}).`);
      }
      if (value !== undefined) changes[key] = value;
    }
    const source: EmitterConfig = { ...this.source, ...changes };
    const next = resolveEmitterConfig(source, this.qualityScale);
    if (this.disposed) return;
    if (next.gx !== this.cfg.gx || next.gy !== this.cfg.gy || next.drag !== this.cfg.drag) this.rebase();
    this.source = source;
    this.cfg = next;
    if ('rate' in changes) this.setRate(next.rate);
  }

  /** Advances to `elapsedMs` since the emitter started: births, then every particle's state. */
  update(elapsedMs: number): void {
    if (this.disposed) return;
    const target = Number.isFinite(elapsedMs) ? Math.max(this.elapsed, elapsedMs) : this.elapsed;
    if (!this.hasPrevious) {
      this.previous = this.current;
      this.previousTime = this.elapsed;
      this.hasPrevious = true;
    }
    this.pendingTarget = target;
    this.emit(target);
    this.elapsed = target;
    this.simulate(target);
    this.previous = this.current;
    this.previousTime = target;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.aliveTotal = 0;
    this.pool.release(this.buffers);
  }

  /**
   * Restarts every live particle's motion from its current state, so new forces apply from now
   * on without a jump.
   */
  private rebase(): void {
    const b = this.buffers;
    const n = this.cfg.maxParticles;
    for (let i = 0; i < n; i++) {
      if (b.alive[i] !== 1) continue;
      b.x0[i] = b.x[i] ?? 0;
      b.y0[i] = b.y[i] ?? 0;
      b.vx0[i] = b.vx[i] ?? 0;
      b.vy0[i] = b.vy[i] ?? 0;
      b.t0[i] = this.elapsed;
    }
  }

  /** Births up to `to`, in time order (a burst before a rate birth at the same time). */
  private emit(to: number): void {
    const c = this.cfg;
    const interval = this.rate > 0 ? 1000 / this.rate : Infinity;
    const rateEnd = Math.min(to, this.emissionEnd);
    if (this.rate > 0) {
      // Bound the work after a huge time jump: older births would be dead anyway.
      const earliest = Math.max(0, rateEnd - c.lifetime.max);
      if (this.rateIndex * interval < earliest) this.rateIndex = Math.ceil(earliest / interval);
    }
    for (;;) {
      const burst = c.bursts[this.burstIndex];
      const burstAt = burst && burst.at <= to ? burst.at : Infinity;
      const rateAt = this.rate > 0 ? this.rateIndex * interval : Infinity;
      const rateDue = rateAt <= rateEnd && rateAt < this.emissionEnd;
      if (burst && burst.at <= to && (!rateDue || burstAt <= rateAt)) {
        for (let i = 0; i < burst.count; i++) this.spawn(burst.at);
        this.burstIndex++;
      } else if (rateDue) {
        this.spawn(rateAt);
        this.rateIndex++;
      } else {
        break;
      }
    }
  }

  private spawn(time: number): void {
    const c = this.cfg;
    const b = this.buffers;
    const r = this.random;
    // Random numbers are drawn even when the particle is dropped, so the sequence of later
    // particles does not depend on the cap.
    c.sampler.sample(r, this.sample);
    const angleBase =
      c.directionMode === 'normal' && !Number.isNaN(this.sample.normal)
        ? this.sample.normal / DEG
        : c.directionMode === 'radial' && (this.sample.x !== 0 || this.sample.y !== 0)
          ? Math.atan2(this.sample.y, this.sample.x) / DEG
          : c.direction;
    const angle = (angleBase + (r.next() - 0.5) * c.spread) * DEG;
    const speed = sampleSpread(c.speed, r);
    const life = sampleSpread(c.lifetime, r);
    const size = sampleSpread(c.size, r);
    const rotation0 = sampleSpread(c.rotation, r);
    const spin = sampleSpread(c.spin, r);
    const paletteIndex = c.palette.length > 3 ? r.int(c.palette.length / 3) : 0;
    const frameCount = c.frames?.length ?? 1;
    const frame = frameCount > 1 && c.frameMode === 'random' ? r.int(frameCount) : 0;
    if (this.freeTop === 0) {
      this.droppedCount++;
      return;
    }
    const i = b.free[--this.freeTop] ?? 0;
    let lx = this.sample.x;
    let ly = this.sample.y;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    if (c.space === 'world') {
      // Interpolate the emitter transform for births between two updates.
      const span = this.pendingTarget - this.previousTime;
      const k = span > 0 ? Math.min(1, Math.max(0, (time - this.previousTime) / span)) : 1;
      const m = lerpMatrix(this.previous, this.current, k);
      const wx = m[0] * lx + m[2] * ly + m[4];
      const wy = m[1] * lx + m[3] * ly + m[5];
      const wvx = m[0] * vx + m[2] * vy;
      const wvy = m[1] * vx + m[3] * vy;
      // Directions rotate with the emitter but speeds are not scaled by it.
      const sx = Math.hypot(m[0], m[1]) || 1;
      lx = wx;
      ly = wy;
      vx = wvx / sx;
      vy = wvy / sx;
      if (c.inheritVelocity !== 0) {
        const dt = (this.pendingTarget - this.previousTime) / 1000;
        if (dt > 0) {
          vx += ((this.current[4] - this.previous[4]) / dt) * c.inheritVelocity;
          vy += ((this.current[5] - this.previous[5]) / dt) * c.inheritVelocity;
        }
      }
    }
    b.birth[i] = time;
    b.t0[i] = time;
    b.life[i] = life;
    b.x0[i] = lx;
    b.y0[i] = ly;
    b.vx0[i] = vx;
    b.vy0[i] = vy;
    b.size[i] = size;
    b.rotation0[i] = rotation0;
    b.spin[i] = spin;
    b.paletteIndex[i] = paletteIndex;
    b.frame[i] = frame;
    b.alive[i] = 1;
    this.bornCount++;
  }

  private simulate(now: number): void {
    const c = this.cfg;
    const b = this.buffers;
    const n = c.maxParticles;
    const k = c.drag;
    const ax = c.gx;
    const ay = c.gy;
    const frames = c.frames?.length ?? 1;
    const colorCount = c.paletteAlpha.length;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (b.alive[i] !== 1) continue;
      const ageMs = now - (b.birth[i] ?? 0);
      const life = b.life[i] ?? 0;
      if (ageMs >= life) {
        b.alive[i] = 0;
        b.opacity[i] = 0;
        b.free[this.freeTop++] = i;
        continue;
      }
      // Motion restarts at t0 (birth or the last force change); spin counts from birth.
      const t = (now - (b.t0[i] ?? 0)) / 1000;
      const p = ageMs / life;
      const vx0 = b.vx0[i] ?? 0;
      const vy0 = b.vy0[i] ?? 0;
      let x: number;
      let y: number;
      let vx: number;
      let vy: number;
      if (k > 0) {
        const e = Math.exp(-k * t);
        const f = (1 - e) / k;
        x = (b.x0[i] ?? 0) + (vx0 - ax / k) * f + (ax / k) * t;
        y = (b.y0[i] ?? 0) + (vy0 - ay / k) * f + (ay / k) * t;
        vx = (vx0 - ax / k) * e + ax / k;
        vy = (vy0 - ay / k) * e + ay / k;
      } else {
        x = (b.x0[i] ?? 0) + vx0 * t + 0.5 * ax * t * t;
        y = (b.y0[i] ?? 0) + vy0 * t + 0.5 * ay * t * t;
        vx = vx0 + ax * t;
        vy = vy0 + ay * t;
      }
      b.x[i] = x;
      b.y[i] = y;
      b.vx[i] = vx;
      b.vy[i] = vy;
      b.radius[i] = (b.size[i] ?? 0) * c.scale(p);
      b.rotation[i] =
        c.align || c.look === 'spark' ? Math.atan2(vy, vx) / DEG : (b.rotation0[i] ?? 0) + ((b.spin[i] ?? 0) * ageMs) / 1000;
      let alpha: number;
      if (c.overLife) {
        const stops = c.overLife.length / 4;
        const xk = Math.min(1, p) * (stops - 1);
        const j = Math.min(stops - 2, Math.floor(xk));
        if (stops === 1 || j < 0) {
          b.red[i] = c.overLife[0] ?? 1;
          b.green[i] = c.overLife[1] ?? 1;
          b.blue[i] = c.overLife[2] ?? 1;
          alpha = c.overLife[3] ?? 1;
        } else {
          const u = xk - j;
          const o = j * 4;
          const mix = (a: number | undefined, z: number | undefined) => (a ?? 0) + ((z ?? 0) - (a ?? 0)) * u;
          b.red[i] = mix(c.overLife[o], c.overLife[o + 4]);
          b.green[i] = mix(c.overLife[o + 1], c.overLife[o + 5]);
          b.blue[i] = mix(c.overLife[o + 2], c.overLife[o + 6]);
          alpha = mix(c.overLife[o + 3], c.overLife[o + 7]);
        }
      } else {
        // Modulo: the palette may have been replaced by a shorter one since the particle was born.
        const ci = (b.paletteIndex[i] ?? 0) % colorCount;
        b.red[i] = c.palette[ci * 3] ?? 1;
        b.green[i] = c.palette[ci * 3 + 1] ?? 1;
        b.blue[i] = c.palette[ci * 3 + 2] ?? 1;
        alpha = c.paletteAlpha[ci] ?? 1;
      }
      b.opacity[i] = c.opacity(p) * alpha;
      if (frames > 1 && c.frameMode === 'life') b.frame[i] = Math.min(frames - 1, Math.floor(p * frames));
      alive++;
    }
    this.aliveTotal = alive;
  }
}

function lerpMatrix(a: Matrix2D, b: Matrix2D, k: number): Matrix2D {
  if (k >= 1 || a === b) return b;
  if (k <= 0) return a;
  // Linear interpolation of the translation; rotation and scale come from the newer matrix.
  return [b[0], b[1], b[2], b[3], a[4] + (b[4] - a[4]) * k, a[5] + (b[5] - a[5]) * k];
}
