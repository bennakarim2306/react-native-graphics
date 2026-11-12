import { createRandom } from '../runtime/rng';
import { InvalidOptionError } from '../runtime/errors';
import { ParticleBurst } from './burst';
import type { BurstConfig } from './burst';

const base: BurstConfig = {
  originX: 100,
  originY: 200,
  count: 10,
  lifetimeMin: 1000,
  lifetimeMax: 1000,
  speedMin: 100,
  speedMax: 100,
  direction: 0,
  spread: 0,
  gravityX: 0,
  gravityY: 0,
  radius: 4,
  scaleStart: 1,
  scaleEnd: 0,
  opacityStart: 1,
  opacityEnd: 0,
  colors: ['#ff0000'],
};

describe('ParticleBurst', () => {
  it('spawns all particles at the origin at t = 0', () => {
    const burst = new ParticleBurst(base, createRandom(1));
    expect(burst.count).toBe(10);
    expect(burst.aliveCount).toBe(10);
    for (let i = 0; i < burst.count; i++) {
      expect(burst.x[i]).toBe(100);
      expect(burst.y[i]).toBe(200);
      expect(burst.opacity[i]).toBe(1);
      expect(burst.radius[i]).toBe(4);
    }
  });

  it('moves with exact closed-form positions (velocity and gravity)', () => {
    const burst = new ParticleBurst({ ...base, direction: 90, gravityX: 10, gravityY: 200 }, createRandom(1));
    burst.update(500);
    // t = 0.5 s: x = 100 + cos(90°)*100*0.5 + 0.5*10*0.25, y = 200 + 100*0.5 + 0.5*200*0.25
    expect(burst.x[0]).toBeCloseTo(100 + 1.25, 4);
    expect(burst.y[0]).toBeCloseTo(200 + 50 + 25, 4);
    expect(burst.opacity[0]).toBeCloseTo(0.5, 5);
    expect(burst.radius[0]).toBeCloseTo(2, 5);
  });

  it('gives the same result no matter how many frames were rendered in between', () => {
    const config = { ...base, count: 200, spread: 360, speedMin: 20, speedMax: 300, gravityY: 400, lifetimeMin: 400 };
    const stepped = new ParticleBurst(config, createRandom(9));
    for (let t = 0; t <= 600; t += 16) stepped.update(t);
    stepped.update(600);
    const jumped = new ParticleBurst(config, createRandom(9));
    jumped.update(600);
    expect(Array.from(stepped.alive)).toEqual(Array.from(jumped.alive));
    expect(jumped.aliveCount).toBeGreaterThan(0);
    // Positions of expired particles are not meaningful; compare the living ones exactly.
    const living = (b: ParticleBurst, arr: Float32Array) => Array.from(arr).filter((_, i) => b.alive[i] === 1);
    expect(living(stepped, stepped.x)).toEqual(living(jumped, jumped.x));
    expect(living(stepped, stepped.y)).toEqual(living(jumped, jumped.y));
    expect(living(stepped, stepped.opacity)).toEqual(living(jumped, jumped.opacity));
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const config = { ...base, count: 50, spread: 360, speedMin: 10, speedMax: 300 };
    const a = new ParticleBurst(config, createRandom(5));
    const b = new ParticleBurst(config, createRandom(5));
    const c = new ParticleBurst(config, createRandom(6));
    a.update(300);
    b.update(300);
    c.update(300);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.x)).not.toEqual(Array.from(c.x));
  });

  it('expires particles at their lifetime and is done when all expired', () => {
    const burst = new ParticleBurst({ ...base, count: 100, lifetimeMin: 200, lifetimeMax: 1000 }, createRandom(3));
    const max = burst.maxLifetime;
    expect(max).toBeLessThanOrEqual(1000);
    burst.update(600);
    expect(burst.aliveCount).toBeGreaterThan(0);
    expect(burst.aliveCount).toBeLessThan(100);
    for (let i = 0; i < burst.count; i++) {
      if (burst.alive[i] === 0) expect(burst.opacity[i]).toBe(0);
    }
    burst.update(max);
    expect(burst.aliveCount).toBe(0);
    expect(burst.done).toBe(true);
  });

  it('handles very large and invalid elapsed times without throwing', () => {
    const burst = new ParticleBurst(base, createRandom(1));
    burst.update(1e12);
    expect(burst.done).toBe(true);
    const other = new ParticleBurst(base, createRandom(1));
    other.update(-50);
    other.update(Number.NaN);
    expect(other.aliveCount).toBe(10);
    expect(other.x[0]).toBe(100);
  });

  it('stops updating after dispose', () => {
    const burst = new ParticleBurst(base, createRandom(1));
    burst.dispose();
    burst.update(100);
    expect(burst.aliveCount).toBe(0);
    expect(burst.done).toBe(true);
  });

  it.each<[string, Partial<BurstConfig>]>([
    ['zero count', { count: 0 }],
    ['fractional count', { count: 1.5 }],
    ['too many particles', { count: 2001 }],
    ['NaN origin', { originX: Number.NaN }],
    ['zero lifetime', { lifetimeMin: 0, lifetimeMax: 0 }],
    ['negative speed', { speedMin: -1 }],
    ['min > max speed', { speedMin: 10, speedMax: 5 }],
    ['spread > 360', { spread: 400 }],
    ['opacity > 1', { opacityStart: 2 }],
    ['infinite gravity', { gravityY: Number.POSITIVE_INFINITY }],
    ['empty colors', { colors: [] }],
  ])('rejects invalid config: %s', (_label, patch) => {
    expect(() => new ParticleBurst({ ...base, ...patch }, createRandom(1))).toThrow(InvalidOptionError);
  });
});
