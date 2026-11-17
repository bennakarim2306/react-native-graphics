import { builtInEffects } from '../effects';
import { sharedParticlePool } from '../particles/pool';
import { VirtualClock } from '../runtime/clock';
import { createEngine } from './engine';
import type { EffectHandle } from './engine';
import { throwAndExplode } from './sequences';

/**
 * Stress scenarios from the Phase 4 brief, on the deterministic virtual clock. They check
 * correctness and cleanup under load (counts, state, leaks), not speed: speed is measured by
 * `npm run bench` and on devices (see docs/PERFORMANCE.md).
 */
function setup(maxActiveEffects = 64) {
  const clock = new VirtualClock(0);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: builtInEffects, maxActiveEffects, seed: 1, onError: (e) => errors.push(e) });
  return { clock, engine, errors };
}

const idle = (engine: ReturnType<typeof createEngine>) => ({
  active: engine.activeCount,
  playbacks: engine.playbackCount,
  attachments: engine.scene.attachmentCount,
  camera: engine.camera,
});
const IDLE = { active: 0, playbacks: 0, attachments: 0, camera: { x: 0, y: 0, rotation: 0 } };

describe('stress', () => {
  it('100 explosions in a row: all complete, nothing leaks, pool buffers are reused', async () => {
    const { clock, engine, errors } = setup();
    const before = { ...sharedParticlePool.stats };
    const handles: EffectHandle[] = [];
    for (let i = 0; i < 100; i++) {
      handles.push(engine.play('explosion', { position: { x: (i * 37) % 400, y: (i * 53) % 700 }, particles: 150 }));
      clock.advance(50, { frameMs: 16 });
    }
    clock.advance(3000, { frameMs: 16 });
    const results = await Promise.all(handles.map((h) => h.finished));
    expect(results.every((r) => r.status === 'completed')).toBe(true);
    expect(idle(engine)).toEqual(IDLE);
    // Buffers come back to the pool: most emitters (about 40 explosions overlap at any time,
    // each with 3 to 4 emitters) reuse a buffer instead of allocating one.
    const allocated = sharedParticlePool.stats.allocated - before.allocated;
    const reused = sharedParticlePool.stats.reused - before.reused;
    expect(allocated + reused).toBeGreaterThanOrEqual(300);
    expect(reused).toBeGreaterThan(allocated);
    expect(errors).toEqual([]);
  });

  it('1000 consecutive short effects of every kind complete and leave the engine idle', async () => {
    const { clock, engine, errors } = setup();
    const names = ['particle-burst', 'particles', 'flash', 'shockwave', 'confetti', 'golden-sparks', 'smoke', 'glow-pulse', 'explosion', 'victory'];
    const params: Record<string, object> = {
      'particle-burst': { count: 20, duration: 300 },
      particles: { bursts: [{ count: 20 }], lifetime: 300 },
      smoke: { rate: 0, burst: 4, lifetime: 300 },
      'glow-pulse': { pulses: 1, frequency: 4 },
      confetti: { count: 20, duration: 300 },
    };
    let last: EffectHandle | null = null;
    for (let i = 0; i < 1000; i++) {
      const name = names[i % names.length] ?? 'flash';
      last = engine.play(name, { position: { x: 100, y: 100 }, ...params[name] });
      clock.advance(20, { frameMs: 20 });
    }
    clock.advance(5000, { frameMs: 32 });
    await last?.finished;
    expect(idle(engine)).toEqual(IDLE);
    expect(errors).toEqual([]);
  });

  it('rapid triggering in one frame respects the effect limit and cancels the oldest', () => {
    const { clock, engine } = setup(32);
    const handles = Array.from({ length: 200 }, (_, i) => engine.play('golden-sparks', { position: { x: i, y: 0 } }));
    expect(engine.activeCount).toBe(32);
    expect(handles.filter((h) => h.status === 'cancelled')).toHaveLength(168);
    clock.advance(2000, { frameMs: 16 });
    expect(engine.activeCount).toBe(0);
  });

  it('many continuous emitters run together for a simulated minute and stop cleanly', async () => {
    const { clock, engine } = setup();
    const handles = Array.from({ length: 12 }, (_, i) => engine.play('smoke', { position: { x: i * 30, y: 500 }, rate: 20 }));
    for (let s = 0; s < 60; s++) clock.advance(1000, { frameMs: 100 });
    const alive = engine.drawables.filter((d) => d.kind === 'particles').length;
    expect(alive).toBe(12);
    for (const h of handles) h.stop();
    clock.advance(4000, { frameMs: 50 });
    await Promise.all(handles.map((h) => h.finished));
    expect(idle(engine)).toEqual(IDLE);
  });

  it('repeated target mount and unmount with effects attached never leaks', () => {
    const { clock, engine, errors } = setup();
    for (let i = 0; i < 200; i++) {
      engine.targets.register('card');
      engine.targets.updateWindowLayout('card', { x: 10, y: 10, width: 50, height: 70 });
      engine.attach('card', { effect: 'fire-border', mode: i % 2 ? 'shader' : 'particles' });
      engine.attach('card', 'glow-pulse', {});
      clock.advance(32, { frameMs: 16 });
      engine.targets.unregister('card');
      clock.advance(16);
    }
    clock.advance(2000, { frameMs: 16 });
    expect(idle(engine)).toEqual(IDLE);
    expect(engine.targets.ids).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('cancelling complex sequences at every stage leaves a consistent state', async () => {
    for (let stopAt = 0; stopAt <= 2400; stopAt += 160) {
      const { clock, engine, errors } = setup();
      engine.targets.register('card');
      engine.targets.updateWindowLayout('card', { x: 100, y: 400, width: 60, height: 90 });
      const running: EffectHandle[] = [];
      engine.on('effectStart', ({ handle }) => running.push(handle));
      engine.attach('card', { effect: 'fire-border' }, { key: 'fire' });
      const seq = throwAndExplode(engine, 'card', { afterImpact: stopAt % 320 === 0 ? 'vanish' : 'return' });
      clock.advance(stopAt, { frameMs: 16 });
      seq.playback.cancel();
      const result = await seq.playback.finished;
      // A sequence that already completed leaves its last particles to finish on their own.
      if (result.status === 'completed') clock.advance(3000, { frameMs: 32 });
      expect(engine.targets.viewTransform('card')).toEqual({ translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
      expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
      // Only the fire border (owned by the app, not by the sequence) is left running.
      expect({ stopAt, running: running.filter((h) => h.status === 'playing' || h.status === 'paused').map((h) => h.effect) }).toEqual({ stopAt, running: ['fire-border'] });
      engine.cancelAll();
      expect(idle(engine)).toEqual(IDLE);
      expect(errors).toEqual([]);
    }
  });

  it('five concurrent explosions plus a sequence and borders, then dispose: everything ends', async () => {
    const { clock, engine } = setup();
    engine.targets.register('card');
    engine.targets.updateWindowLayout('card', { x: 100, y: 400, width: 60, height: 90 });
    const fire = engine.attach('card', { effect: 'fire-border' });
    const booms = Array.from({ length: 5 }, (_, i) => engine.play('explosion', { position: { x: 60 * i, y: 200 }, screenShake: true }));
    const seq = throwAndExplode(engine, 'card');
    clock.advance(500, { frameMs: 16 });
    engine.dispose();
    const results = await Promise.all([fire.finished, ...booms.map((b) => b.finished), seq.playback.finished]);
    expect(results.every((r) => r.status === 'cancelled')).toBe(true);
    expect(engine.state).toBe('disposed');
  });
});
