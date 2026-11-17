import { resolveEasing } from '../animation/easing';
import type { Easing } from '../animation/easing';
import { InvalidOptionError } from '../runtime/errors';
import type { Random } from '../runtime/rng';

/** A fixed value or a random value picked per particle in [min, max]. */
export type Spread = number | { readonly min: number; readonly max: number };

/**
 * A value over a particle's life (progress 0 at birth, 1 at death):
 * - a number: constant
 * - `{ from, to, easing }`: interpolated with an easing (default linear)
 * - an array: evenly spaced keys, linearly interpolated (`[0, 1, 1, 0]` fades in and out)
 */
export type ValueCurve = number | { readonly from: number; readonly to: number; readonly easing?: Easing } | readonly number[];

/** Resolved form of a `Spread`. */
export interface ResolvedSpread {
  readonly min: number;
  readonly max: number;
}

export function resolveSpread(value: Spread, name: string, options: { min?: number; max?: number } = {}): ResolvedSpread {
  const r: { min: number; max: number } = typeof value === 'number' ? { min: value, max: value } : value;
  const raw: unknown = r;
  if (typeof raw !== 'object' || raw === null || !Number.isFinite(r.min) || !Number.isFinite(r.max)) {
    throw new InvalidOptionError(`${name} must be a finite number or { min, max }.`);
  }
  if (r.min > r.max) throw new InvalidOptionError(`${name}.min must not exceed ${name}.max.`);
  if (options.min !== undefined && r.min < options.min) {
    throw new InvalidOptionError(`${name} must be >= ${String(options.min)}.`);
  }
  if (options.max !== undefined && r.max > options.max) {
    throw new InvalidOptionError(`${name} must be <= ${String(options.max)}.`);
  }
  return { min: r.min, max: r.max };
}

export function sampleSpread(spread: ResolvedSpread, random: Random): number {
  return spread.min === spread.max ? spread.min : random.range(spread.min, spread.max);
}

/** A curve compiled into a function of progress in [0, 1]. */
export type CurveFunction = (progress: number) => number;

export function resolveCurve(curve: ValueCurve, name: string, range: { min?: number; max?: number } = {}): CurveFunction {
  const check = (v: number) => {
    if (!Number.isFinite(v)) throw new InvalidOptionError(`${name} values must be finite numbers.`);
    if (range.min !== undefined && v < range.min) throw new InvalidOptionError(`${name} values must be >= ${String(range.min)}.`);
    if (range.max !== undefined && v > range.max) throw new InvalidOptionError(`${name} values must be <= ${String(range.max)}.`);
  };
  if (typeof curve === 'number') {
    check(curve);
    return () => curve;
  }
  if (Array.isArray(curve)) {
    const keys = curve as readonly number[];
    if (keys.length === 0) throw new InvalidOptionError(`${name} needs at least one key.`);
    keys.forEach(check);
    if (keys.length === 1) {
      const only = keys[0] ?? 0;
      return () => only;
    }
    const last = keys.length - 1;
    return (p) => {
      const x = Math.min(1, Math.max(0, p)) * last;
      const i = Math.min(last - 1, Math.floor(x));
      const a = keys[i] ?? 0;
      const b = keys[i + 1] ?? a;
      return a + (b - a) * (x - i);
    };
  }
  if (typeof curve === 'object' && (curve as unknown) !== null && 'from' in curve) {
    const { from, to } = curve;
    check(from);
    check(to);
    const ease = resolveEasing(curve.easing);
    return (p) => from + (to - from) * ease(Math.min(1, Math.max(0, p)));
  }
  throw new InvalidOptionError(`${name} must be a number, { from, to, easing } or an array of keys.`);
}
