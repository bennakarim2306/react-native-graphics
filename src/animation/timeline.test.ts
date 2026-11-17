import { InvalidOptionError } from '../runtime/errors';
import { wait } from './playable';
import type { ScheduledEvent } from './playable';
import { objectTarget } from './target';
import { parallel, sequence, stagger, timeline } from './timeline';
import { tween } from './tween';

const ctx = {};

function events(tl: { collectEvents: (a: number, b: number, i: boolean, o: ScheduledEvent[], off: number) => void }, from: number, to: number, include = false) {
  const out: ScheduledEvent[] = [];
  tl.collectEvents(from, to, include, out, 0);
  return out.sort((a, b) => a.time - b.time || a.order - b.order).map((e) => `${e.name}@${String(e.time)}`);
}

describe('Timeline positions', () => {
  it('places children sequentially by default and supports <, +=, -=, numbers and markers', () => {
    const o = objectTarget({ a: 0, b: 0, c: 0, d: 0, e: 0 });
    const tl = timeline()
      .add(tween(o, { a: 1, duration: 100 })) // 0-100
      .add(tween(o, { b: 1, duration: 50 })) // 100-150
      .add(tween(o, { c: 1, duration: 10 }), '<') // 100-110 (with previous)
      .mark('impact', '+=20') // 170
      .add(tween(o, { d: 1, duration: 30 }), 'impact-=10') // 160-190
      .add(tween(o, { e: 1, duration: 5 }), 400); // 400-405
    expect(tl.markerTime('impact')).toBe(170);
    expect(tl.duration).toBe(405);
    expect(tl.totalDuration).toBe(405);
  });

  it('rejects bad positions and edits after locking', () => {
    const o = objectTarget({ a: 0 });
    const tl = timeline();
    expect(() => tl.add(tween(o, { a: 1 }), 'nowhere')).toThrow(InvalidOptionError);
    expect(() => tl.add(tween(o, { a: 1 }), -1)).toThrow(InvalidOptionError);
    expect(() => tl.add(tween(o, { a: 1 }), '-=10')).toThrow(InvalidOptionError);
    expect(() => tl.add(tween(o, { a: 1, repeat: Infinity }))).toThrow('infinitely');
    expect(() => tl.mark('')).toThrow(InvalidOptionError);
    expect(() => tl.add(tl)).toThrow(InvalidOptionError);
    const child = tween(o, { a: 1 });
    tl.add(child);
    expect(() => timeline().add(child)).toThrow('already in a timeline');
    const outer = timeline().add(tl);
    expect(outer.duration).toBe(300);
    expect(() => tl.add(tween(o, { a: 2 }))).toThrow('can no longer be changed');
  });
});

describe('Timeline rendering', () => {
  it('sequences tweens on the same property, each starting from where the previous ended', () => {
    const obj = { y: 0 };
    const t = objectTarget(obj);
    const tl = sequence([tween(t, { y: -300, duration: 500 }), tween(t, { y: 0, duration: 700 })]);
    tl.render(250, ctx);
    expect(obj.y).toBe(-150);
    tl.render(500, ctx);
    expect(obj.y).toBe(-300);
    tl.render(850, ctx);
    expect(obj.y).toBe(-150);
    tl.render(1200, ctx);
    expect(obj.y).toBe(0);
  });

  it('runs parallel children at the same time', () => {
    const obj = { x: 0, y: 0 };
    const t = objectTarget(obj);
    const tl = parallel([tween(t, { x: 100, duration: 100 }), tween(t, { y: 50, duration: 200 })]);
    expect(tl.duration).toBe(200);
    tl.render(100, ctx);
    expect(obj).toEqual({ x: 100, y: 25 });
  });

  it('staggers children', () => {
    const objs = [{ x: 0 }, { x: 0 }, { x: 0 }];
    const tl = stagger(objs.map((o) => tween(objectTarget(o), { x: 100, duration: 100 })), 50);
    expect(tl.duration).toBe(200);
    tl.render(100, ctx);
    expect(objs.map((o) => o.x)).toEqual([100, 50, 0]);
  });

  it('seeks backwards to the exact earlier state, including children not yet started', () => {
    const obj = { y: 0 };
    const t = objectTarget(obj);
    const tl = sequence([tween(t, { y: -300, duration: 500 }), wait(100), tween(t, { y: 0, duration: 700 })]);
    tl.render(1300, ctx);
    expect(obj.y).toBe(0);
    tl.render(550, ctx);
    expect(obj.y).toBe(-300);
    tl.render(0, ctx);
    expect(obj.y).toBe(0);
    tl.render(250, ctx);
    expect(obj.y).toBe(-150);
  });

  it('repeats a whole timeline and yoyos it', () => {
    const obj = { x: 0 };
    const t = objectTarget(obj);
    const tl = timeline({ repeat: 1, yoyo: true }).add(tween(t, { x: 100, duration: 100 })).add(tween(t, { x: 200, duration: 100 }));
    expect(tl.totalDuration).toBe(400);
    tl.render(150, ctx);
    expect(obj.x).toBe(150);
    tl.render(250, ctx); // reversed second iteration at inner time 150
    expect(obj.x).toBe(150);
    tl.render(350, ctx);
    expect(obj.x).toBe(50);
    tl.render(400, ctx);
    expect(obj.x).toBe(0);
  });

  it('nests timelines', () => {
    const obj = { x: 0, y: 0 };
    const t = objectTarget(obj);
    const inner = sequence([tween(t, { x: 100, duration: 100 }), tween(t, { x: 0, duration: 100 })]);
    const outer = timeline().add(tween(t, { y: 10, duration: 50 })).add(inner);
    expect(outer.duration).toBe(250);
    outer.render(200, ctx);
    expect(obj).toEqual({ x: 50, y: 10 });
  });
});

describe('Timeline events', () => {
  it('collects markers and callbacks in an interval, inclusive of the start only when asked', () => {
    const call = jest.fn();
    const tl = timeline().mark('start', 0).add(wait(100)).mark('mid').call(call, 150).add(wait(100)).mark('end');
    expect(events(tl, 0, 300, true)).toEqual(['start@0', 'mid@100', 'call@150', 'end@250']);
    expect(events(tl, 0, 100)).toEqual(['mid@100']);
    expect(events(tl, 100, 199)).toEqual(['call@150']);
  });

  it('includes markers of nested timelines at their offsets', () => {
    const inner = timeline().add(wait(50)).mark('impact');
    const outer = timeline().add(wait(100)).add(inner).mark('after');
    expect(events(outer, 0, 1000, true)).toEqual(['impact@150', 'after@150']);
  });

  it('fires markers once per iteration and mirrors them in yoyo iterations', () => {
    const tl = timeline({ repeat: 2, yoyo: true }).add(wait(100)).mark('m', 30);
    expect(events(tl, 0, 300, true)).toEqual(['m@30', 'm@170', 'm@230']);
  });

  it('caps the scanned iterations for huge jumps in endless loops', () => {
    const tl = timeline({ repeat: Infinity }).add(wait(1)).mark('tick', 0);
    expect(events(tl, 0, 1e9).length).toBeLessThanOrEqual(1001);
  });
});
