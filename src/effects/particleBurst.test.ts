import { InvalidOptionError } from '../runtime/errors';
import { DEFAULT_BURST_COLORS, resolveBurstParams } from './particleBurst';
import type { ParticleBurstParams } from './particleBurst';

describe('resolveBurstParams', () => {
  it('fills documented defaults', () => {
    const c = resolveBurstParams({ position: { x: 1, y: 2 } });
    expect(c).toMatchObject({
      originX: 1,
      originY: 2,
      count: 50,
      lifetimeMax: 800,
      lifetimeMin: 480,
      speedMin: 80,
      speedMax: 260,
      direction: -90,
      spread: 360,
      gravityX: 0,
      gravityY: 400,
      radius: 4,
      scaleStart: 1,
      scaleEnd: 0.3,
      opacityStart: 1,
      opacityEnd: 0,
    });
    expect(c.colors).toEqual(DEFAULT_BURST_COLORS);
  });

  it('accepts scalar shorthands', () => {
    const c = resolveBurstParams({ position: { x: 0, y: 0 }, speed: 120, gravity: { x: 5, y: -10 } });
    expect([c.speedMin, c.speedMax, c.gravityX, c.gravityY]).toEqual([120, 120, 5, -10]);
  });

  it('rejects a missing position and a bad lifetime ratio', () => {
    expect(() => resolveBurstParams({} as unknown as ParticleBurstParams)).toThrow(InvalidOptionError);
    expect(() => resolveBurstParams({ position: { x: 0, y: 0 }, minLifetimeRatio: 2 })).toThrow(InvalidOptionError);
  });
});
