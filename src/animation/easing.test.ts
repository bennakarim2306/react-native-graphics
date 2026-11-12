import { InvalidOptionError } from '../runtime/errors';
import { cubicBezier, easings, resolveEasing } from './easing';

describe('easing', () => {
  it.each(Object.keys(easings))('%s maps 0 to 0 and 1 to 1', (name) => {
    const fn = resolveEasing(name as keyof typeof easings);
    expect(fn(0)).toBeCloseTo(0, 10);
    expect(fn(1)).toBeCloseTo(1, 10);
  });

  it('computes known values', () => {
    expect(easings.linear(0.25)).toBe(0.25);
    expect(easings.easeInQuad(0.5)).toBe(0.25);
    expect(easings.easeOutQuad(0.5)).toBe(0.75);
    expect(easings.easeInOutCubic(0.5)).toBe(0.5);
    expect(easings.easeOutBack(0.5)).toBeGreaterThan(1); // overshoots
    expect(easings.easeOutBounce(0.5)).toBeCloseTo(0.765625, 6);
  });

  it('cubicBezier matches the linear curve and CSS ease', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.33, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 5);
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('rejects invalid easings', () => {
    expect(() => resolveEasing('wobble' as never)).toThrow(InvalidOptionError);
    expect(() => cubicBezier(1.5, 0, 0, 1)).toThrow(InvalidOptionError);
    expect(() => cubicBezier(0, Number.NaN, 0, 1)).toThrow(InvalidOptionError);
  });

  it('passes functions through and defaults to linear', () => {
    const f = (t: number) => t * 2;
    expect(resolveEasing(f)).toBe(f);
    expect(resolveEasing(undefined)(0.3)).toBe(0.3);
  });
});
