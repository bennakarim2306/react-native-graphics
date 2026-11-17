import { InvalidOptionError } from '../runtime/errors';

/** Maps linear progress in [0, 1] to eased progress. Must return 0 at 0 and 1 at 1. */
export type EasingFunction = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

/** Built-in easings, by name. */
export const easings = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeInSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t: number) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInBack: (t: number) => c3 * t * t * t - c1 * t * t,
  easeOutBack: (t: number) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  easeInOutBack: (t: number) =>
    t < 0.5
      ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
      : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  easeInBounce: (t: number) => 1 - bounceOut(1 - t),
  easeOutBounce: bounceOut,
  easeInOutBounce: (t: number) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
  /** Aliases for the cubic easings. */
  easeIn: (t: number) => t * t * t,
  easeOut: (t: number) => 1 - (1 - t) ** 3,
  easeInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
} satisfies Record<string, EasingFunction>;

export type EasingName = keyof typeof easings;

/** An easing given by name or as a function. */
export type Easing = EasingName | EasingFunction;

/**
 * CSS-style cubic Bézier easing through (0,0), (x1,y1), (x2,y2), (1,1).
 * `x1` and `x2` must be in [0, 1] so the curve is a function of time.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  for (const [value, name] of [[x1, 'x1'], [y1, 'y1'], [x2, 'x2'], [y2, 'y2']] as const) {
    if (!Number.isFinite(value)) throw new InvalidOptionError(`cubicBezier ${name} must be finite, got ${String(value)}.`);
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new InvalidOptionError('cubicBezier x1 and x2 must be within [0, 1].');
  }
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton-Raphson, then bisection as a fallback.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - t;
      if (Math.abs(err) < 1e-7) return sampleY(s);
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      const x = sampleX(s);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

/** Resolves an easing name or function. Throws `InvalidOptionError` for unknown names. */
export function resolveEasing(easing: Easing | undefined): EasingFunction {
  if (easing === undefined) return easings.linear;
  if (typeof easing === 'function') return easing;
  if (Object.prototype.hasOwnProperty.call(easings, easing)) return easings[easing];
  throw new InvalidOptionError(
    `Unknown easing "${easing}". Use one of: ${Object.keys(easings).join(', ')}, or a function.`,
  );
}
