import { ParticleBurst } from '../particles/burst';
import type { BurstConfig } from '../particles/burst';
import { defineEffect } from '../runtime/effect';
import type { EffectInstance } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface FromTo {
  readonly from: number;
  readonly to: number;
}

/** Parameters of the built-in `particle-burst` effect. */
export interface ParticleBurstParams {
  /** Emission point in canvas coordinates (points from the overlay's top-left corner). */
  readonly position: Point;
  /** Number of particles, 1 to 2000. Default 50. */
  readonly count?: number;
  /** Lifetime of the longest-lived particle in ms (> 0). Default 800. */
  readonly duration?: number;
  /** Shortest particle lifetime as a fraction of `duration`, 0 to 1. Default 0.6. */
  readonly minLifetimeRatio?: number;
  /** Initial speed in points per second. Default { min: 80, max: 260 }. */
  readonly speed?: number | Range;
  /** Mean direction in degrees (0 = right, 90 = down, -90 = up). Default -90. */
  readonly direction?: number;
  /** Angular spread in degrees, 0 to 360. Default 360 (all directions). */
  readonly spread?: number;
  /** Downward acceleration in points per second squared, or a vector. Default 400. */
  readonly gravity?: number | Point;
  /** Particle radius in points. Default 4. */
  readonly size?: number;
  /** Radius multiplier over each particle's lifetime. Default { from: 1, to: 0.3 }. */
  readonly scale?: FromTo;
  /** Opacity over each particle's lifetime, 0 to 1. Default { from: 1, to: 0 }. */
  readonly opacity?: FromTo;
  /** Color palette (any Skia color string). Default warm gold/orange tones. */
  readonly colors?: readonly string[];
}

export const DEFAULT_BURST_COLORS: readonly string[] = ['#FFD54A', '#FFB300', '#FF7043', '#FFF3C4'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Turns public parameters into a fully specified, validated burst configuration. */
export function resolveBurstParams(params: ParticleBurstParams): BurstConfig {
  if (!isObject(params) || !isObject(params.position)) {
    throw new InvalidOptionError('particle-burst requires a `position` with numeric x and y.');
  }
  const duration = params.duration ?? 800;
  const ratio = params.minLifetimeRatio ?? 0.6;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new InvalidOptionError(`minLifetimeRatio must be between 0 and 1, got ${String(ratio)}.`);
  }
  const speed = params.speed ?? { min: 80, max: 260 };
  const speedRange: Range = typeof speed === 'number' ? { min: speed, max: speed } : speed;
  const gravity = params.gravity ?? 400;
  const gravityVector: Point = typeof gravity === 'number' ? { x: 0, y: gravity } : gravity;
  const scale = params.scale ?? { from: 1, to: 0.3 };
  const opacity = params.opacity ?? { from: 1, to: 0 };
  return {
    originX: params.position.x,
    originY: params.position.y,
    count: params.count ?? 50,
    lifetimeMin: duration * ratio,
    lifetimeMax: duration,
    speedMin: speedRange.min,
    speedMax: speedRange.max,
    direction: params.direction ?? -90,
    spread: params.spread ?? 360,
    gravityX: gravityVector.x,
    gravityY: gravityVector.y,
    radius: params.size ?? 4,
    scaleStart: scale.from,
    scaleEnd: scale.to,
    opacityStart: opacity.from,
    opacityEnd: opacity.to,
    colors: params.colors ?? DEFAULT_BURST_COLORS,
  };
}

/** Built-in effect: a one-shot radial burst of fading particles. */
export const particleBurst = defineEffect<ParticleBurstParams>({
  name: 'particle-burst',
  create(params, { random }): EffectInstance {
    const burst = new ParticleBurst(resolveBurstParams(params), random);
    const drawables = [burst] as const;
    return {
      update: (elapsedMs) => {
        burst.update(elapsedMs);
      },
      get done() {
        return burst.done;
      },
      drawables,
      dispose: () => {
        burst.dispose();
      },
    };
  },
});
