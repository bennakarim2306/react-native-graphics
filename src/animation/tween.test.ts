import { InvalidOptionError } from '../runtime/errors';
import type { ScheduledEvent } from './playable';
import { objectTarget } from './target';
import { keyframes, tween } from './tween';

const ctx = {};

describe('Tween', () => {
  it('interpolates from captured start values at exact times', () => {
    const obj = { x: 10, y: 0 };
    const t = tween(objectTarget(obj), { x: 110, y: -50, duration: 100 });
    t.render(0, ctx);
    expect(obj).toEqual({ x: 10, y: 0 });
    t.render(25, ctx);
    expect(obj).toEqual({ x: 35, y: -12.5 });
    t.render(100, ctx);
    expect(obj).toEqual({ x: 110, y: -50 });
    t.render(50, ctx); // rendering backwards is the same pure function
    expect(obj.x).toBe(60);
  });

  it('applies easing and explicit from values', () => {
    const obj = { x: 999 };
    const t = tween(objectTarget(obj), { x: 100, from: { x: 0 }, easing: 'easeInQuad', duration: 200 });
    t.render(100, ctx);
    expect(obj.x).toBe(25);
  });

  it('waits for its delay before capturing start values', () => {
    const obj = { x: 0 };
    const t = tween(objectTarget(obj), { x: 100, duration: 100, delay: 50 });
    expect(t.totalDuration).toBe(150);
    t.render(20, ctx);
    expect(obj.x).toBe(0);
    obj.x = 40; // changed before the tween starts: becomes the start value
    t.render(100, ctx);
    expect(obj.x).toBe(70);
    t.render(10, ctx); // back into the delay: initial state
    expect(obj.x).toBe(40);
  });

  it('repeats and yoyos', () => {
    const obj = { x: 0 };
    const t = tween(objectTarget(obj), { x: 100, duration: 100, repeat: 2, yoyo: true });
    expect(t.totalDuration).toBe(300);
    t.render(50, ctx);
    expect(obj.x).toBe(50);
    t.render(125, ctx); // second iteration runs backwards
    expect(obj.x).toBe(75);
    t.render(250, ctx);
    expect(obj.x).toBe(50);
    t.render(300, ctx);
    expect(obj.x).toBe(100);
    t.render(1000, ctx);
    expect(obj.x).toBe(100);
    expect(t.iterationAt(150)).toBe(1);
    expect(t.iterationAt(10_000)).toBe(2);
  });

  it('loops forever with repeat: Infinity', () => {
    const obj = { x: 0 };
    const t = tween(objectTarget(obj), { x: 10, duration: 100, repeat: Infinity });
    expect(t.totalDuration).toBe(Infinity);
    t.render(1_000_050, ctx);
    expect(obj.x).toBe(5);
  });

  it('jumps to the end with duration 0', () => {
    const obj = { x: 0 };
    const t = tween(objectTarget(obj), { x: 7, duration: 0 });
    expect(t.totalDuration).toBe(0);
    t.render(0, ctx);
    expect(obj.x).toBe(7);
  });

  it('rejects invalid options synchronously', () => {
    const target = objectTarget({ x: 0 });
    expect(() => tween(target, { duration: 100 })).toThrow('at least one property');
    expect(() => tween(target, { x: Number.NaN })).toThrow(InvalidOptionError);
    expect(() => tween(target, { x: 1, duration: -1 })).toThrow(InvalidOptionError);
    expect(() => tween(target, { x: 1, duration: Infinity })).toThrow(InvalidOptionError);
    expect(() => tween(target, { x: 1, delay: -5 })).toThrow(InvalidOptionError);
    expect(() => tween(target, { x: 1, repeat: 1.5 })).toThrow(InvalidOptionError);
    expect(() => tween(target, { x: 1, easing: 'nope' as never })).toThrow(InvalidOptionError);
    expect(() => tween(target, { x: 1, overwrite: 'maybe' as never })).toThrow(InvalidOptionError);
    expect(() => tween(target, { ['z' as 'x']: 1 })).toThrow('no animatable property "z"');
    expect(() => tween({} as never, { x: 1 })).toThrow(InvalidOptionError);
  });

  it('never writes to a destroyed target', () => {
    let destroyed = false;
    const values = { x: 0 };
    const base = objectTarget(values);
    const target = { ...base, get destroyed() { return destroyed; } };
    const t = tween(target, { x: 100, duration: 100 });
    t.render(50, ctx);
    destroyed = true;
    t.render(100, ctx);
    expect(values.x).toBe(50);
  });

  it('stops writing killed (interrupted) properties', () => {
    const obj = { x: 0, y: 0 };
    const t = tween(objectTarget(obj), { x: 100, y: 100, duration: 100 });
    t.render(50, ctx);
    expect(t.killOverlapping(new Set(['x']))).toEqual(['x']);
    t.render(100, ctx);
    expect(obj).toEqual({ x: 50, y: 100 });
    expect(t.fullyInterrupted).toBe(false);
  });

  it('has no events of its own', () => {
    const out: ScheduledEvent[] = [];
    tween(objectTarget({ x: 0 }), { x: 1 }).collectEvents(0, 1000, true, out, 0);
    expect(out).toEqual([]);
  });
});

describe('KeyframeAnimation', () => {
  it('interpolates each property between the keyframes that mention it', () => {
    const obj = { y: 0, rotation: 0 };
    const k = keyframes(objectTarget(obj), {
      duration: 1000,
      keyframes: [
        { at: 0.5, y: -300, rotation: 180 },
        { at: 1, y: 0 },
      ],
    });
    k.render(250, ctx);
    expect(obj).toEqual({ y: -150, rotation: 90 });
    k.render(500, ctx);
    expect(obj).toEqual({ y: -300, rotation: 180 });
    k.render(750, ctx);
    expect(obj).toEqual({ y: -150, rotation: 180 }); // rotation holds its last keyframe
    k.render(1000, ctx);
    expect(obj).toEqual({ y: 0, rotation: 180 });
  });

  it('uses the easing of the keyframe being approached', () => {
    const obj = { x: 0 };
    const k = keyframes(objectTarget(obj), {
      duration: 100,
      keyframes: [{ at: 0, x: 0 }, { at: 1, x: 100, easing: 'easeInQuad' }],
    });
    k.render(50, ctx);
    expect(obj.x).toBe(25);
  });

  it('validates keyframes', () => {
    const target = objectTarget({ x: 0 });
    expect(() => keyframes(target, { duration: 100, keyframes: [] })).toThrow(InvalidOptionError);
    expect(() => keyframes(target, { duration: 100, keyframes: [{ at: 1.5, x: 1 }] })).toThrow(InvalidOptionError);
    expect(() =>
      keyframes(target, { duration: 100, keyframes: [{ at: 0.8, x: 1 }, { at: 0.2, x: 2 }] }),
    ).toThrow('ascending');
    expect(() => keyframes(target, { duration: 100, keyframes: [{ at: 0.5 }] })).toThrow(InvalidOptionError);
  });
});
