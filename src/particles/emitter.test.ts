import { PathData } from '../graphics/path';
import { parseColor } from '../graphics/color';
import { InvalidOptionError } from '../runtime/errors';
import { createRandom } from '../runtime/rng';
import { composeTransform } from '../scene/matrix';
import { resolveCurve } from './curves';
import { ParticleEmitter } from './emitter';
import type { EmitterConfig } from './emitter';
import { ParticlePool } from './pool';
import { createShapeSampler } from './shapes';

const living = (e: ParticleEmitter, arr: Float32Array) => Array.from(arr).filter((_, i) => e.alive[i] === 1);

function emitter(config: EmitterConfig, seed = 1, pool = new ParticlePool()) {
  return new ParticleEmitter(config, createRandom(seed), { pool });
}

describe('ParticleEmitter: spawning and lifetime', () => {
  it('fires bursts at their time and continuous emission at exact intervals', () => {
    const e = emitter({ rate: 10, duration: 1000, bursts: [{ at: 0, count: 5 }, { at: 500, count: 3 }], lifetime: 5000, speed: 0 });
    e.update(0);
    // Burst of 5 plus the rate birth at t = 0.
    expect(e.born).toBe(6);
    e.update(499);
    expect(e.born).toBe(6 + 4); // births at 100, 200, 300, 400
    e.update(500);
    expect(e.born).toBe(10 + 3 + 1); // burst at 500 and the birth at 500
    e.update(2000);
    expect(e.born).toBe(5 + 3 + 10); // rate births at 0..900 (end of emission at 1000 is excluded)
    expect(e.emissionFinished).toBe(true);
  });

  it('expires particles after their lifetime, frees their slots and reports done', () => {
    const e = emitter({ bursts: [{ count: 20 }], lifetime: { min: 200, max: 400 }, maxParticles: 20 });
    e.update(0);
    expect(e.aliveCount).toBe(20);
    e.update(300);
    expect(e.aliveCount).toBeGreaterThan(0);
    expect(e.aliveCount).toBeLessThan(20);
    e.update(400);
    expect(e.aliveCount).toBe(0);
    expect(e.done).toBe(true);
  });

  it('reuses freed slots and drops births beyond maxParticles', () => {
    const e = emitter({ rate: 100, lifetime: 100, maxParticles: 5, speed: 0 });
    e.update(1000);
    // At any time at most ~11 are alive (100 ms lifetime at 100/s); the cap is 5.
    expect(e.aliveCount).toBeLessThanOrEqual(5);
    expect(e.dropped).toBeGreaterThan(0);
    const before = e.born;
    e.update(2000);
    expect(e.born).toBeGreaterThan(before); // slots came back after particles died
  });

  it('stop() ends emission and lets live particles finish', () => {
    const e = emitter({ rate: 50, lifetime: 300 });
    e.update(200);
    const born = e.born;
    e.stop();
    e.update(250);
    expect(e.born).toBe(born);
    expect(e.done).toBe(false);
    e.update(600);
    expect(e.done).toBe(true);
  });

  it('setRate changes emission without a burst of catch-up births', () => {
    const e = emitter({ rate: 10, lifetime: 10000, speed: 0 });
    e.update(1000);
    const before = e.born; // 0..1000 at 10/s = 11
    expect(before).toBe(11);
    e.setRate(100);
    e.update(1100);
    expect(e.born - before).toBe(10); // 1010..1100
    e.setRate(0);
    e.update(5000);
    expect(e.born - before).toBe(10);
  });

  it('bounds the work after a huge time jump', () => {
    const e = emitter({ rate: 1000, lifetime: 100, maxParticles: 500 });
    e.update(1e9);
    expect(e.born).toBeLessThanOrEqual(102);
    expect(e.aliveCount).toBeLessThanOrEqual(100);
  });
});

describe('ParticleEmitter: motion', () => {
  it('follows exact ballistic motion with gravity', () => {
    const e = emitter({ bursts: [{ count: 1 }], speed: 100, direction: 0, spread: 0, gravity: 200, lifetime: 2000 });
    e.update(500);
    expect(e.x[0]).toBeCloseTo(50, 4);
    expect(e.y[0]).toBeCloseTo(0.5 * 200 * 0.25, 4);
    expect(e.vy[0]).toBeCloseTo(100, 4);
  });

  it('applies linear drag in closed form (velocity decays towards a/k)', () => {
    const e = emitter({ bursts: [{ count: 1 }], speed: 100, direction: 0, spread: 0, drag: 2, lifetime: 10000 });
    e.update(1000);
    expect(e.vx[0]).toBeCloseTo(100 * Math.exp(-2), 3);
    expect(e.x[0]).toBeCloseTo((100 * (1 - Math.exp(-2))) / 2, 3);
    // With gravity and drag, velocity approaches the terminal value g / k.
    const f = emitter({ bursts: [{ count: 1 }], speed: 0, gravity: 300, drag: 3, lifetime: 100000 });
    f.update(20000);
    expect(f.vy[0]).toBeCloseTo(100, 3);
  });

  it('interpolates opacity, scale and color over life with easing', () => {
    const e = emitter({
      bursts: [{ count: 1 }],
      speed: 0,
      lifetime: 1000,
      size: 10,
      scale: { from: 1, to: 0, easing: 'easeInQuad' },
      opacity: [0, 1, 0],
      colorOverLife: ['#FF0000', '#0000FF'],
    });
    e.update(500);
    expect(e.radius[0]).toBeCloseTo(10 * (1 - 0.25), 4);
    expect(e.opacity[0]).toBeCloseTo(1, 4);
    expect(e.red[0]).toBeCloseTo(0.5, 4);
    expect(e.blue[0]).toBeCloseTo(0.5, 4);
    e.update(750);
    expect(e.opacity[0]).toBeCloseTo(0.5, 4);
  });

  it('rotates with angular velocity, and sparks align with their velocity', () => {
    const e = emitter({ bursts: [{ count: 1 }], speed: 0, rotation: 10, angularVelocity: 90, lifetime: 5000, look: 'square' });
    e.update(1000);
    expect(e.rotation[0]).toBeCloseTo(100, 4);
    const s = emitter({ bursts: [{ count: 1 }], speed: 100, direction: 90, spread: 0, look: 'spark', lifetime: 5000 });
    s.update(100);
    expect(s.rotation[0]).toBeCloseTo(90, 4);
  });
});

describe('ParticleEmitter: determinism', () => {
  const config: EmitterConfig = {
    rate: 120,
    bursts: [{ at: 50, count: 40 }],
    speed: { min: 20, max: 300 },
    lifetime: { min: 200, max: 900 },
    gravity: { x: 10, y: 400 },
    drag: 0.5,
    size: { min: 2, max: 6 },
    angularVelocity: { min: -180, max: 180 },
    duration: 800,
  };

  // Slots are reused in the order particles die, which depends on frame times, so the
  // particle sets are compared regardless of slot order.
  const sorted = (e: ParticleEmitter, arr: Float32Array) => living(e, arr).sort((p, q) => p - q);

  it('gives identical particles at 60 fps, 144 fps and one big step', () => {
    const run = (step: number) => {
      const e = emitter(config, 7);
      for (let t = 0; t < 700; t += step) e.update(t);
      e.update(700);
      return e;
    };
    const a = run(1000 / 60);
    const b = run(1000 / 144);
    const c = emitter(config, 7);
    c.update(700);
    for (const other of [b, c]) {
      expect(other.born).toBe(a.born);
      expect(sorted(other, other.x)).toEqual(sorted(a, a.x));
      expect(sorted(other, other.y)).toEqual(sorted(a, a.y));
      expect(sorted(other, other.opacity)).toEqual(sorted(a, a.opacity));
    }
    expect(a.aliveCount).toBeGreaterThan(20);
  });

  it('repeats exactly for a seed and differs for another seed', () => {
    const a = emitter(config, 3);
    const b = emitter(config, 3);
    const c = emitter(config, 4);
    for (const e of [a, b, c]) e.update(400);
    expect(living(a, a.x)).toEqual(living(b, b.x));
    expect(living(a, a.x)).not.toEqual(living(c, c.x));
  });
});

describe('ParticleEmitter: shapes and spaces', () => {
  it('samples points, lines, circles, rects and paths inside their area or on their edge', () => {
    const r = createRandom(5);
    const out = { x: 0, y: 0, normal: 0 };
    const circle = createShapeSampler({ type: 'circle', radius: 10, edge: true });
    for (let i = 0; i < 50; i++) {
      circle.sample(r, out);
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(10, 5);
      expect(Math.atan2(out.y, out.x)).toBeCloseTo(out.normal > Math.PI ? out.normal - 2 * Math.PI : out.normal, 5);
    }
    const area = createShapeSampler({ type: 'rect', width: 40, height: 20 });
    for (let i = 0; i < 50; i++) {
      area.sample(r, out);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(20);
      expect(Math.abs(out.y)).toBeLessThanOrEqual(10);
    }
    const line = createShapeSampler({ type: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    expect(line.perimeter).toBe(100);
    for (let i = 0; i < 20; i++) {
      line.sample(r, out);
      expect(out.y).toBe(0);
      expect(out.x).toBeGreaterThanOrEqual(0);
      expect(out.x).toBeLessThanOrEqual(100);
    }
    const tri = createShapeSampler({ type: 'path', path: new PathData().moveTo(0, 0).lineTo(30, 0).lineTo(0, 40).close() });
    expect(tri.perimeter).toBeCloseTo(120, 5);
  });

  it('gives outward normals on rectangle edges in both windings', () => {
    const r = createRandom(2);
    const out = { x: 0, y: 0, normal: 0 };
    const rect = createShapeSampler({ type: 'rect', width: 100, height: 50, edge: true });
    expect(rect.perimeter).toBeCloseTo(300, 5);
    for (let i = 0; i < 100; i++) {
      rect.sample(r, out);
      // The normal points away from the centre on every side.
      const dot = Math.cos(out.normal) * out.x + Math.sin(out.normal) * out.y;
      expect(dot).toBeGreaterThan(0);
    }
    const ccw = createShapeSampler({ type: 'path', path: new PathData().moveTo(-10, -10).lineTo(-10, 10).lineTo(10, 10).lineTo(10, -10).close() });
    for (let i = 0; i < 40; i++) {
      ccw.sample(r, out);
      expect(Math.cos(out.normal) * out.x + Math.sin(out.normal) * out.y).toBeGreaterThan(0);
    }
  });

  it('emits along the normal of a border', () => {
    const e = emitter({ shape: { type: 'rect', width: 100, height: 60, edge: true, cornerRadius: 10 }, directionMode: 'normal', spread: 0, speed: 50, bursts: [{ count: 50 }], lifetime: 1000 });
    e.update(200);
    for (let i = 0; i < 50; i++) {
      // Moving outward: further from the centre than the border itself.
      const vx = e.vx[i] ?? 0;
      const vy = e.vy[i] ?? 0;
      expect(vx * (e.x[i] ?? 0) + vy * (e.y[i] ?? 0)).toBeGreaterThan(0);
    }
  });

  it('world space: births use the emitter transform; particles stay where they were born', () => {
    const e = emitter({ bursts: [{ count: 3 }], speed: 0, lifetime: 5000 });
    e.setTransform(composeTransform(100, 50, 0, 1, 1));
    e.update(0);
    expect(e.x[0]).toBe(100);
    e.setTransform(composeTransform(300, 50, 0, 1, 1));
    e.update(100);
    expect(e.x[0]).toBe(100); // did not follow
    expect(e.matrix).toBeUndefined();
  });

  it('world space: interpolates the position of births between frames (no gaps in trails)', () => {
    const e = emitter({ rate: 100, speed: 0, lifetime: 5000 });
    e.setTransform(composeTransform(0, 0, 0, 1, 1));
    e.update(0);
    e.setTransform(composeTransform(100, 0, 0, 1, 1));
    e.update(100);
    const xs = living(e, e.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => expect.closeTo(v, 4) as unknown as number));
  });

  it('world space: rotates emission directions with the emitter and can inherit its velocity', () => {
    const e = emitter({ bursts: [{ count: 1 }], speed: 100, direction: 0, spread: 0, lifetime: 5000 });
    e.setTransform(composeTransform(0, 0, 90, 2, 2));
    e.update(0);
    e.update(1000);
    expect(e.x[0]).toBeCloseTo(0, 3);
    expect(e.y[0]).toBeCloseTo(100, 3); // rotated to point down, speed not scaled
    const f = emitter({ rate: 10, speed: 0, inheritVelocity: 1, lifetime: 5000 });
    f.setTransform(composeTransform(0, 0, 0, 1, 1));
    f.update(0);
    f.setTransform(composeTransform(50, 0, 0, 1, 1));
    f.update(500); // emitter moves at 100 pt/s
    const born = Array.from(f.vx).filter((_, i) => f.alive[i] === 1 && (f.x[i] ?? 0) > 0);
    expect(born.every((v) => Math.abs(v - 100) < 1e-3)).toBe(true);
  });

  it('local space: particles keep emitter-local coordinates and the drawable carries the transform', () => {
    const e = emitter({ space: 'local', bursts: [{ count: 1 }], speed: 0, lifetime: 5000 });
    const m = composeTransform(100, 100, 45, 2, 2);
    e.setTransform(m);
    e.update(0);
    expect(e.x[0]).toBe(0);
    expect(e.matrix).toBe(m);
    const m2 = composeTransform(300, 100, 90, 1, 1);
    e.setTransform(m2);
    e.update(10);
    expect(e.matrix).toBe(m2); // particles follow the parent from now on
  });
});

describe('ParticleEmitter: pooling and validation', () => {
  it('returns buffers to the pool and reuses them for later emitters', () => {
    const pool = new ParticlePool();
    for (let i = 0; i < 100; i++) {
      const e = emitter({ bursts: [{ count: 150 }], lifetime: 100, maxParticles: 150 }, i, pool);
      e.update(0);
      expect(e.aliveCount).toBe(150);
      e.update(100);
      expect(e.done).toBe(true);
      e.dispose();
    }
    expect(pool.stats.allocated).toBe(1);
    expect(pool.stats.reused).toBe(99);
    expect(pool.stats.idle).toBe(1);
  });

  it('a reused buffer starts clean', () => {
    const pool = new ParticlePool();
    const a = emitter({ bursts: [{ count: 10 }], lifetime: 10000 }, 1, pool);
    a.update(0);
    a.dispose();
    const b = emitter({ lifetime: 1000 }, 1, pool);
    b.update(0);
    expect(b.aliveCount).toBe(0);
    expect(Array.from(b.alive).every((v) => v === 0)).toBe(true);
  });

  it('scales counts by the quality factor', () => {
    const e = new ParticleEmitter({ bursts: [{ count: 100 }], rate: 100, lifetime: 10000, maxParticles: 1000 }, createRandom(1), {
      qualityScale: 0.5,
      pool: new ParticlePool(),
    });
    e.update(1000);
    expect(e.born).toBe(50 + 51);
  });

  it.each<[string, EmitterConfig]>([
    ['negative rate', { rate: -1 }],
    ['fractional burst', { bursts: [{ count: 1.5 }] }],
    ['too many particles', { maxParticles: 9000 }],
    ['spread > 360', { spread: 400 }],
    ['zero lifetime', { lifetime: 0 }],
    ['min > max speed', { speed: { min: 5, max: 1 } }],
    ['opacity > 1', { opacity: 2 }],
    ['bad color', { colors: ['not-a-color'] }],
    ['unknown look', { look: 'triangle' as never }],
    ['negative drag', { drag: -1 }],
    ['bad shape', { shape: { type: 'hexagon' } as never }],
    ['empty path', { shape: { type: 'path', path: new PathData() } }],
  ])('rejects %s', (_label, config) => {
    expect(() => emitter(config)).toThrow(InvalidOptionError);
  });

  it('does nothing after dispose', () => {
    const e = emitter({ rate: 10 });
    e.dispose();
    e.dispose();
    e.update(1000);
    expect(e.born).toBe(0);
    expect(e.done).toBe(true);
  });
});

describe('curves and colors', () => {
  it('evaluates constants, eased ranges and key arrays', () => {
    expect(resolveCurve(3, 'v')(0.7)).toBe(3);
    expect(resolveCurve({ from: 0, to: 10 }, 'v')(0.25)).toBe(2.5);
    expect(resolveCurve([0, 10, 0], 'v')(0.75)).toBe(5);
    expect(resolveCurve([4], 'v')(0.5)).toBe(4);
    expect(() => resolveCurve([], 'v')).toThrow(InvalidOptionError);
    expect(() => resolveCurve({ from: 0, to: 1, easing: 'nope' as never }, 'v')).toThrow(InvalidOptionError);
  });

  it('parses hex, rgb() and named colors', () => {
    expect(parseColor('#F00')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor('#00FF0080').a).toBeCloseTo(128 / 255, 5);
    expect(parseColor('rgba(0, 0, 255, 0.5)')).toEqual({ r: 0, g: 0, b: 1, a: 0.5 });
    expect(parseColor('white')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(() => parseColor('nope')).toThrow(InvalidOptionError);
  });
});
