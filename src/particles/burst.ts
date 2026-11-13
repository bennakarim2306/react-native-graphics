import type { ImageAsset } from '../assets/assets';
import type { BlendMode } from '../graphics/paint';
import type { Rect } from '../graphics/path';
import type { Drawable } from '../runtime/effect';
import type { Matrix2D } from '../scene/matrix';
import { InvalidOptionError } from '../runtime/errors';
import type { Random } from '../runtime/rng';

/** Fully resolved burst configuration. All values are validated by `validateBurstConfig`. */
export interface BurstConfig {
  /** Emission origin in canvas points. */
  readonly originX: number;
  readonly originY: number;
  /** Number of particles, emitted all at once at t = 0. */
  readonly count: number;
  /** Per-particle lifetime range in ms. */
  readonly lifetimeMin: number;
  readonly lifetimeMax: number;
  /** Initial speed range in points per second. */
  readonly speedMin: number;
  readonly speedMax: number;
  /** Mean emission angle in degrees. 0 = right, 90 = down, -90 = up (screen coordinates). */
  readonly direction: number;
  /** Total angular spread in degrees, centered on `direction`. 360 = all directions. */
  readonly spread: number;
  /** Constant acceleration in points per second squared. */
  readonly gravityX: number;
  readonly gravityY: number;
  /** Base particle radius in points, multiplied by the animated scale. */
  readonly radius: number;
  readonly scaleStart: number;
  readonly scaleEnd: number;
  readonly opacityStart: number;
  readonly opacityEnd: number;
  /** Color palette. Each particle picks one color at spawn. */
  readonly colors: readonly string[];
}

export const MAX_BURST_PARTICLES = 2000;

/**
 * Renderer-independent particle data for one frame. Arrays are indexed by particle and are
 * reused between frames (no per-frame allocation). Only entries with `alive[i] === 1`
 * should be drawn.
 */
export interface ParticleDrawable extends Drawable {
  readonly kind: 'particles';
  readonly count: number;
  readonly aliveCount: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Radius in points (base radius times animated scale). */
  readonly radius: Float32Array;
  readonly opacity: Float32Array;
  readonly alive: Uint8Array;
  /** Palette mode: color of particle i is `colors[colorIndex[i]]`. */
  readonly colorIndex?: Uint8Array;
  readonly colors?: readonly string[];
  /** Per-particle color mode (0 to 1). Used instead of the palette when present. */
  readonly red?: Float32Array;
  readonly green?: Float32Array;
  readonly blue?: Float32Array;
  /** Rotation in degrees (squares, sparks, images). */
  readonly rotation?: Float32Array;
  /** Current velocity in points per second (spark streaks). */
  readonly vx?: Float32Array;
  readonly vy?: Float32Array;
  /** Default `circle`. */
  readonly look?: ParticleLookKind;
  /** Width to height ratio of squares. */
  readonly aspect?: number;
  /** Spark streak length in seconds of motion. */
  readonly stretch?: number;
  readonly blendMode?: BlendMode;
  /** Local-space particles: transform from particle space to overlay space. */
  readonly matrix?: Matrix2D | undefined;
  /** Image particles. */
  readonly image?: ImageAsset | undefined;
  readonly frames?: readonly Rect[] | undefined;
  readonly frame?: Uint16Array;
}

/** Built-in particle shapes. */
export type ParticleLookKind = 'circle' | 'square' | 'spark' | 'ring' | 'soft' | 'image';

export function isParticleDrawable(drawable: Drawable): drawable is ParticleDrawable {
  return drawable.kind === 'particles';
}

/**
 * A one-shot particle burst. Every particle's state is a closed-form function of elapsed time
 * (ballistic motion with constant acceleration, linear scale/opacity over its lifetime), so
 * results are identical regardless of frame rate or frame drops.
 */
export class ParticleBurst implements ParticleDrawable {
  readonly kind = 'particles' as const;
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
  readonly opacity: Float32Array;
  readonly alive: Uint8Array;
  readonly colorIndex: Uint8Array;
  readonly colors: readonly string[];
  private readonly velX: Float32Array;
  private readonly velY: Float32Array;
  private readonly lifetime: Float32Array;
  private aliveTotal: number;
  private disposed = false;

  constructor(
    private readonly config: BurstConfig,
    random: Random,
  ) {
    validateBurstConfig(config);
    const n = config.count;
    this.count = n;
    this.colors = [...config.colors];
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.opacity = new Float32Array(n);
    this.alive = new Uint8Array(n);
    this.colorIndex = new Uint8Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);
    this.lifetime = new Float32Array(n);
    const toRad = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const angle = (config.direction + (random.next() - 0.5) * config.spread) * toRad;
      const speed = random.range(config.speedMin, config.speedMax);
      this.velX[i] = Math.cos(angle) * speed;
      this.velY[i] = Math.sin(angle) * speed;
      this.lifetime[i] = random.range(config.lifetimeMin, config.lifetimeMax);
      this.colorIndex[i] = random.int(this.colors.length);
    }
    this.aliveTotal = n;
    this.update(0);
  }

  get aliveCount(): number {
    return this.aliveTotal;
  }

  /** True when every particle has expired. */
  get done(): boolean {
    return this.aliveTotal === 0;
  }

  /** Longest particle lifetime in ms; the burst is done after this. */
  get maxLifetime(): number {
    let max = 0;
    for (const life of this.lifetime) max = Math.max(max, life);
    return max;
  }

  /** Sets every particle to its state at `elapsedMs` after emission. */
  update(elapsedMs: number): void {
    if (this.disposed) return;
    const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
    const t = elapsed / 1000;
    const c = this.config;
    const halfT2 = 0.5 * t * t;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.lifetime[i] ?? 0;
      if (elapsed >= life) {
        this.alive[i] = 0;
        this.opacity[i] = 0;
        continue;
      }
      const progress = elapsed / life;
      this.alive[i] = 1;
      this.x[i] = c.originX + (this.velX[i] ?? 0) * t + c.gravityX * halfT2;
      this.y[i] = c.originY + (this.velY[i] ?? 0) * t + c.gravityY * halfT2;
      this.radius[i] = c.radius * (c.scaleStart + (c.scaleEnd - c.scaleStart) * progress);
      this.opacity[i] = c.opacityStart + (c.opacityEnd - c.opacityStart) * progress;
      alive++;
    }
    this.aliveTotal = alive;
  }

  /** Marks every particle dead. The typed arrays are left to the garbage collector. */
  dispose(): void {
    this.disposed = true;
    this.alive.fill(0);
    this.opacity.fill(0);
    this.aliveTotal = 0;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new InvalidOptionError(message);
}

export function validateBurstConfig(c: BurstConfig): void {
  const finite = (value: number, name: string): void => {
    check(Number.isFinite(value), `${name} must be a finite number, got ${String(value)}.`);
  };
  finite(c.originX, 'position.x');
  finite(c.originY, 'position.y');
  check(
    Number.isInteger(c.count) && c.count >= 1 && c.count <= MAX_BURST_PARTICLES,
    `count must be an integer between 1 and ${String(MAX_BURST_PARTICLES)}, got ${String(c.count)}.`,
  );
  for (const [value, name] of [
    [c.lifetimeMin, 'lifetime min'],
    [c.lifetimeMax, 'lifetime max'],
    [c.speedMin, 'speed min'],
    [c.speedMax, 'speed max'],
    [c.radius, 'size'],
    [c.scaleStart, 'scale.from'],
    [c.scaleEnd, 'scale.to'],
  ] as const) {
    check(Number.isFinite(value) && value >= 0, `${name} must be a finite number >= 0, got ${String(value)}.`);
  }
  check(c.lifetimeMax > 0, `duration must be > 0, got ${String(c.lifetimeMax)}.`);
  check(c.lifetimeMin <= c.lifetimeMax, 'lifetime min must not exceed lifetime max.');
  check(c.speedMin <= c.speedMax, 'speed.min must not exceed speed.max.');
  finite(c.direction, 'direction');
  check(Number.isFinite(c.spread) && c.spread >= 0 && c.spread <= 360, `spread must be between 0 and 360, got ${String(c.spread)}.`);
  finite(c.gravityX, 'gravity.x');
  finite(c.gravityY, 'gravity.y');
  for (const [value, name] of [
    [c.opacityStart, 'opacity.from'],
    [c.opacityEnd, 'opacity.to'],
  ] as const) {
    check(Number.isFinite(value) && value >= 0 && value <= 1, `${name} must be between 0 and 1, got ${String(value)}.`);
  }
  check(c.colors.length >= 1 && c.colors.length <= 256, 'colors must contain between 1 and 256 entries.');
  check(
    c.colors.every((color) => typeof color === 'string' && color.length > 0),
    'colors must be non-empty strings.',
  );
}
