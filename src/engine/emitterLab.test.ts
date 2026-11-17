import { builtInEffects } from '../effects';
import type { ParticlesParams } from '../effects';
import { isParticleDrawable } from '../particles/burst';
import type { ParticleEmitter } from '../particles/emitter';
import { sharedParticlePool } from '../particles/pool';
import { VirtualClock } from '../runtime/clock';
import type { Drawable } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { QualityLevel } from '../runtime/quality';
import type { SceneNode } from '../scene/node';
import { createEngine } from './engine';
import type { EffectHandle, Engine } from './engine';

/*
 * The Phase 4A emitter scenario, through the public engine API only: several emitters of
 * different shapes and spaces at once, on a rotating scene object and fixed positions, changed,
 * paused and cancelled while they run, and cleaned up when their target is removed. The
 * showcase's Emitter lab (example/EmitterLab.tsx) drives the same calls.
 */

const emitters = (ds: readonly Drawable[]) => ds.filter(isParticleDrawable) as ParticleEmitter[];
const living = (e: ParticleEmitter, arr: Float32Array) => Array.from(arr).filter((_, i) => e.alive[i] === 1);

const TRAIL: Omit<ParticlesParams, 'target'> = { rate: 60, lifetime: 600, speed: { min: 5, max: 20 }, size: 3 };
const HALO: Omit<ParticlesParams, 'target'> = {
  space: 'local',
  shape: { type: 'circle', radius: 18, edge: true },
  directionMode: 'normal',
  spread: 20,
  rate: 40,
  lifetime: 500,
  speed: 20,
  colors: ['#B388FF'],
};
const FOUNTAIN: ParticlesParams = {
  position: { x: 200, y: 380 },
  shape: { type: 'line', from: { x: -60, y: 0 }, to: { x: 60, y: 0 } },
  direction: -90,
  spread: 20,
  speed: { min: 150, max: 220 },
  gravity: 400,
  rate: 50,
  lifetime: 900,
};
const SNOW: Omit<ParticlesParams, 'target'> = { shape: { type: 'rect', width: 120, height: 10 }, direction: 90, spread: 30, speed: 30, rate: 30, lifetime: 1200, colors: ['#FFFFFF'] };

interface Lab {
  readonly clock: VirtualClock;
  readonly engine: Engine;
  readonly pivot: SceneNode;
  readonly orb: SceneNode;
  readonly box: SceneNode;
  readonly handles: { trail: EffectHandle; halo: EffectHandle; fountain: EffectHandle; snow: EffectHandle };
}

function lab(options: { seed?: number; quality?: QualityLevel } = {}): Lab {
  const clock = new VirtualClock(0);
  const engine = createEngine({ clock, effects: builtInEffects, seed: options.seed ?? 7, quality: options.quality ?? 'high' });
  const pivot = engine.scene.createNode({ x: 200, y: 200 });
  const orb = engine.scene.createNode({ parent: pivot, x: 80, y: 0 });
  const box = engine.scene.createNode({ x: 100, y: 60 });
  engine.animate(pivot, { rotation: 360, duration: 4000, repeat: Infinity, easing: 'linear' }).play();
  const handles = {
    trail: engine.play('particles', { ...TRAIL, target: orb }),
    halo: engine.play('particles', { ...HALO, target: orb }),
    fountain: engine.play('particles', FOUNTAIN),
    snow: engine.play('particles', { ...SNOW, target: box }),
  };
  return { clock, engine, pivot, orb, box, handles };
}

/** The four emitters in start order (trail, halo, fountain, snow), after one frame. */
function lookUp(l: Lab) {
  l.clock.advance(16);
  const [trail, halo, fountain, snow] = emitters(l.engine.drawables);
  if (!trail || !halo || !fountain || !snow) throw new Error('missing emitter');
  return { trail, halo, fountain, snow };
}

describe('Emitter lab scenario (Phase 4A)', () => {
  beforeEach(() => {
    // Predictable pool counts in each test.
    sharedParticlePool.clear();
  });

  it('runs point, circle, line and rect emitters at once, on a rotating node and fixed positions', () => {
    const l = lab();
    const e = lookUp(l);
    l.clock.advance(1000, { frameMs: 16 });
    expect(emitters(l.engine.drawables)).toHaveLength(4);
    for (const emitter of Object.values(e)) expect(emitter.aliveCount).toBeGreaterThan(0);
    expect(l.engine.activeCount).toBe(4);
    // The orb has moved along its circle; the local halo moves (and rotates) with it.
    expect(l.pivot.rotation).toBeGreaterThan(80);
    expect(e.halo.space).toBe('local');
    expect(e.halo.matrix).toEqual(l.orb.worldMatrix);
    expect(e.halo.anchor).toBe(l.orb);
    // Halo particles stay on and just outside the ring, in the orb's coordinates.
    const r = living(e.halo, e.halo.x).map((x, i) => Math.hypot(x, living(e.halo, e.halo.y)[i] ?? 0));
    expect(Math.min(...r)).toBeGreaterThanOrEqual(17.9);
    expect(Math.max(...r)).toBeLessThanOrEqual(18 + 20 * 0.5 + 0.1);
    // World trail particles are left behind where the orb was: the newest one is next to it.
    const orbAt = l.orb.localToWorld({ x: 0, y: 0 });
    const distances = living(e.trail, e.trail.x).map((x, i) => Math.hypot(x - orbAt.x, (living(e.trail, e.trail.y)[i] ?? 0) - orbAt.y));
    expect(Math.min(...distances)).toBeLessThan(8);
    expect(e.trail.anchor).toBeUndefined();
    // The fountain falls back under gravity; the snow drifts down from the box.
    expect(living(e.fountain, e.fountain.vy).some((vy) => vy > 0)).toBe(true);
    expect(living(e.snow, e.snow.y).every((y) => y >= 60 - 5)).toBe(true);
    l.engine.dispose();
  });

  it('changes emission properties of one emitter while it runs, through handle.update', () => {
    const l = lab();
    const e = lookUp(l);
    l.clock.advance(500, { frameMs: 16 });
    // Colors apply to live particles at once; other emitters keep theirs.
    l.handles.trail.update({ colors: ['#00FF00'] });
    l.clock.advance(16);
    expect(living(e.trail, e.trail.green).every((v) => v === 1)).toBe(true);
    expect(living(e.trail, e.trail.red).every((v) => v === 0)).toBe(true);
    expect(living(e.snow, e.snow.red).every((v) => v === 1)).toBe(true);
    // Rate: 60/s becomes 150/s from now on.
    const before = e.trail.born;
    l.handles.trail.update({ rate: 150 });
    l.clock.advance(1000, { frameMs: 16 });
    expect(e.trail.born - before).toBeGreaterThanOrEqual(149);
    expect(e.trail.born - before).toBeLessThanOrEqual(151);
    // Gravity reversed on the fountain (and emission paused, so the slots keep their particles):
    // every live particle now accelerates upwards, from its current velocity.
    l.handles.fountain.update({ gravity: -300, rate: 0 });
    const before96 = new Map<number, number>();
    e.fountain.alive.forEach((a, i) => {
      if (a === 1) before96.set(i, e.fountain.vy[i] ?? 0);
    });
    l.clock.advance(96, { frameMs: 16 });
    let checked = 0;
    e.fountain.alive.forEach((a, i) => {
      if (a !== 1) return;
      expect((e.fountain.vy[i] ?? 0) - (before96.get(i) ?? NaN)).toBeCloseTo(-300 * 0.096, 3);
      checked++;
    });
    expect(checked).toBeGreaterThan(10);
    // Intensity still multiplies the (new) rate.
    l.handles.snow.update({ rate: 20, intensity: 2 });
    const snowBefore = e.snow.born;
    l.clock.advance(1000, { frameMs: 16 });
    expect(Math.abs(e.snow.born - snowBefore - 40)).toBeLessThanOrEqual(1);
    l.engine.dispose();
  });

  it('rejects invalid updates without changing the emitter, and presets keep their narrow update set', () => {
    const a = lab({ seed: 3 });
    const b = lab({ seed: 3 });
    const ea = lookUp(a);
    const eb = lookUp(b);
    a.clock.advance(400, { frameMs: 16 });
    b.clock.advance(400, { frameMs: 16 });
    const invalid: Record<string, unknown>[] = [{ gravity: 'down' }, { speed: { min: 5, max: -1 } }, { maxParticles: 10 }, { space: 'local' }, { look: 'spark' }, { rate: -1 }, { intensity: 99 }, { colors: ['not-a-color'] }, { speed: 10, drag: -1 }];
    for (const patch of invalid) {
      expect(() => {
        a.handles.fountain.update(patch);
      }).toThrow(InvalidOptionError);
    }
    a.handles.fountain.update({ drag: 0.5 });
    b.handles.fountain.update({ drag: 0.5 });
    a.clock.advance(600, { frameMs: 16 });
    b.clock.advance(600, { frameMs: 16 });
    expect(Array.from(ea.fountain.x)).toEqual(Array.from(eb.fountain.x));
    expect(Array.from(ea.fountain.vy)).toEqual(Array.from(eb.fountain.vy));

    const confetti = a.engine.play('confetti', { position: { x: 50, y: 50 } });
    expect(() => {
      confetti.update({ gravity: 10 });
    }).toThrow('confetti cannot change "gravity"');
    confetti.update({ intensity: 0.5 });
    a.engine.dispose();
    b.engine.dispose();
  });

  it('pauses, resumes and cancels one emitter while the others keep running', () => {
    const l = lab();
    const e = lookUp(l);
    l.clock.advance(300, { frameMs: 16 });
    l.handles.trail.pause();
    expect(l.handles.trail.status).toBe('paused');
    const born = e.trail.born;
    const x = Array.from(e.trail.x);
    const haloBorn = e.halo.born;
    l.clock.advance(500, { frameMs: 16 });
    // Frozen: no births, no motion. The halo keeps emitting.
    expect(e.trail.born).toBe(born);
    expect(Array.from(e.trail.x)).toEqual(x);
    expect(e.halo.born).toBeGreaterThan(haloBorn + 15);
    // Changes are accepted while paused and apply on resume.
    l.handles.trail.update({ rate: 100 });
    l.handles.trail.resume();
    expect(l.handles.trail.status).toBe('playing');
    l.clock.advance(500, { frameMs: 16 });
    // No catch-up burst for the paused time: 100/s for 0.5 s.
    expect(Math.abs(e.trail.born - born - 50)).toBeLessThanOrEqual(1);

    const idle = sharedParticlePool.stats.idle;
    l.handles.fountain.cancel();
    expect(l.handles.fountain.status).toBe('cancelled');
    expect(e.fountain.done).toBe(true);
    expect(sharedParticlePool.stats.idle).toBe(idle + 1);
    l.clock.advance(16);
    expect(emitters(l.engine.drawables)).toHaveLength(3);
    expect(l.engine.activeCount).toBe(3);
    l.engine.dispose();
  });

  it('ends the emitters of a removed target gracefully and returns their storage', async () => {
    const l = lab();
    const e = lookUp(l);
    l.clock.advance(500, { frameMs: 16 });
    const idle = sharedParticlePool.stats.idle;
    l.orb.destroy();
    l.clock.advance(16);
    // Nothing is drawn for the missing orb; the other two emitters carry on.
    expect(emitters(l.engine.drawables)).toEqual([e.fountain, e.snow]);
    expect(e.trail.emissionFinished).toBe(true);
    expect(e.halo.emissionFinished).toBe(true);
    // Live particles finish their life (at most 600 ms), then the effects complete.
    l.clock.advance(700, { frameMs: 16 });
    await expect(l.handles.trail.finished).resolves.toEqual({ status: 'completed' });
    await expect(l.handles.halo.finished).resolves.toEqual({ status: 'completed' });
    expect(l.engine.activeCount).toBe(2);
    expect(sharedParticlePool.stats.idle).toBe(idle + 2);
    // A new orb gets new emitters from the pool, not new allocations.
    const reused = sharedParticlePool.stats.reused;
    const orb = l.engine.scene.createNode({ parent: l.pivot, x: 80, y: 0 });
    l.engine.play('particles', { ...TRAIL, target: orb });
    expect(sharedParticlePool.stats.reused).toBe(reused + 1);
    // Starting on a removed node is refused.
    expect(() => l.engine.play('particles', { ...TRAIL, target: l.orb })).toThrow('destroyed');
    l.engine.dispose();
  });

  it('scales rates with the quality level, also for live rate changes', () => {
    const high = lab({ quality: 'high' });
    const low = lab({ quality: 'low' });
    const eh = lookUp(high);
    const el = lookUp(low);
    high.handles.snow.update({ rate: 100 });
    low.handles.snow.update({ rate: 100 });
    const hb = eh.snow.born;
    const lb = el.snow.born;
    high.clock.advance(1000, { frameMs: 16 });
    low.clock.advance(1000, { frameMs: 16 });
    expect(Math.abs(eh.snow.born - hb - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(el.snow.born - lb - 35)).toBeLessThanOrEqual(1);
    high.engine.dispose();
    low.engine.dispose();
  });

  it('is deterministic for the same seed and the same calls, and frees everything on dispose', () => {
    const run = () => {
      const l = lab({ seed: 11 });
      const e = lookUp(l);
      l.clock.advance(400, { frameMs: 16 });
      l.handles.halo.update({ speed: { min: 10, max: 40 }, colors: ['#FF0000', '#0000FF'] });
      l.handles.trail.pause();
      l.clock.advance(300, { frameMs: 16 });
      l.handles.trail.resume();
      l.handles.fountain.update({ gravity: { x: 80, y: 200 } });
      l.clock.advance(500, { frameMs: 16 });
      const snapshot = Object.values(e).map((em) => [em.born, living(em, em.x), living(em, em.y), living(em, em.red)]);
      const idle = sharedParticlePool.stats.idle;
      l.engine.dispose();
      expect(sharedParticlePool.stats.idle).toBe(idle + 4);
      expect(Object.values(e).every((em) => em.done)).toBe(true);
      return snapshot;
    };
    expect(run()).toEqual(run());
  });
});
