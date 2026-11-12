import { particleBurst } from '../effects/particleBurst';
import type { ParticleBurst } from '../particles/burst';
import { VirtualClock } from './clock';
import { defineEffect } from './effect';
import type { Drawable, EffectInstance } from './effect';
import { createEngine } from './engine';
import type { EffectResult } from './engine';
import { DisposedError, InvalidOptionError } from './errors';

function setup(options: { maxActiveEffects?: number } = {}) {
  const clock = new VirtualClock(1000);
  const errors: unknown[] = [];
  const engine = createEngine({
    clock,
    effects: [particleBurst],
    seed: 7,
    onError: (e) => errors.push(e),
    ...options,
  });
  return { clock, engine, errors };
}

const burstAt = (x: number, y: number, extra: object = {}) => ({
  position: { x, y },
  count: 20,
  duration: 500,
  ...extra,
});

/** A trivial effect used to observe lifecycle calls. */
function probeEffect(duration: number) {
  const log: string[] = [];
  const definition = defineEffect<{ tag: string }>({
    name: 'probe',
    create(params): EffectInstance {
      log.push(`create:${params.tag}`);
      let elapsed = 0;
      return {
        update: (ms) => {
          elapsed = ms;
          log.push(`update:${params.tag}:${String(ms)}`);
        },
        get done() {
          return elapsed >= duration;
        },
        drawables: [{ kind: 'probe' } satisfies Drawable],
        dispose: () => log.push(`dispose:${params.tag}`),
      };
    },
  });
  return { definition, log };
}

describe('Engine lifecycle', () => {
  it('starts idle: no clock subscription until an effect plays', () => {
    const { clock, engine } = setup();
    expect(engine.state).toBe('running');
    expect(clock.subscriberCount).toBe(0);
    engine.play('particle-burst', burstAt(10, 10));
    expect(clock.subscriberCount).toBe(1);
  });

  it('unsubscribes from the clock when the last effect ends', async () => {
    const { clock, engine } = setup();
    const handle = engine.play('particle-burst', burstAt(10, 10));
    clock.advance(600, { frameMs: 16 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.activeCount).toBe(0);
    expect(clock.subscriberCount).toBe(0);
  });

  it('dispose cancels running effects, releases resources and is idempotent', async () => {
    const { clock, engine } = setup();
    const { definition, log } = probeEffect(10_000);
    const a = engine.play(definition, { tag: 'a' });
    const b = engine.play('particle-burst', burstAt(0, 0));
    engine.dispose();
    engine.dispose();
    await expect(a.finished).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    await expect(b.finished).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(log.filter((l) => l === 'dispose:a')).toHaveLength(1);
    expect(engine.state).toBe('disposed');
    expect(clock.subscriberCount).toBe(0);
    expect(() => engine.play('particle-burst', burstAt(0, 0))).toThrow(DisposedError);
    expect(() => {
      engine.cancelAll();
    }).toThrow(DisposedError);
  });

  it('validates engine options', () => {
    const clock = new VirtualClock();
    expect(() => createEngine({ clock, maxActiveEffects: 0 })).toThrow(InvalidOptionError);
    expect(() => createEngine({ clock, seed: Number.NaN })).toThrow(InvalidOptionError);
  });
});

describe('Engine effects', () => {
  it('updates effects with elapsed time since play, not per-frame deltas', () => {
    const { clock, engine } = setup();
    const { definition, log } = probeEffect(10_000);
    engine.play(definition, { tag: 'x' });
    clock.advance(16);
    clock.advance(500); // a long frame gap
    expect(log).toEqual(['create:x', 'update:x:0', 'update:x:16', 'update:x:516']);
  });

  it('runs multiple effects simultaneously and publishes drawables in play order', () => {
    const { clock, engine } = setup();
    const frames: number[] = [];
    engine.on('frame', (f) => frames.push(f.drawables.length));
    const a = engine.play('particle-burst', burstAt(10, 10));
    const b = engine.play('particle-burst', burstAt(300, 300));
    clock.advance(100);
    expect(engine.activeCount).toBe(2);
    expect(frames).toEqual([2]);
    const [first, second] = engine.drawables as ParticleBurst[];
    expect(first?.x[0]).toBeLessThan(150);
    expect(second?.x[0]).toBeGreaterThan(150);
    expect(a.id).not.toBe(b.id);
  });

  it('cancels one effect without affecting others; cancel is idempotent', async () => {
    const { clock, engine } = setup();
    const a = engine.play('particle-burst', burstAt(10, 10));
    const b = engine.play('particle-burst', burstAt(20, 20));
    a.cancel();
    a.cancel();
    await expect(a.finished).resolves.toEqual({ status: 'cancelled', reason: 'user' });
    expect(a.status).toBe('cancelled');
    expect(b.status).toBe('playing');
    clock.advance(16);
    expect(engine.drawables).toHaveLength(1);
  });

  it('cancelAll ends everything and the next frame is empty', async () => {
    const { engine } = setup();
    const frames: number[] = [];
    engine.on('frame', (f) => frames.push(f.activeCount));
    const handles = [engine.play('particle-burst', burstAt(1, 1)), engine.play('particle-burst', burstAt(2, 2))];
    engine.cancelAll();
    const results = await Promise.all(handles.map((h) => h.finished));
    expect(results.every((r: EffectResult) => r.status === 'cancelled' && r.reason === 'cancelAll')).toBe(true);
    expect(engine.drawables).toEqual([]);
    expect(frames).toEqual([0]);
  });

  it('enforces maxActiveEffects by cancelling the oldest effect', async () => {
    const { engine } = setup({ maxActiveEffects: 2 });
    const a = engine.play('particle-burst', burstAt(1, 1));
    engine.play('particle-burst', burstAt(2, 2));
    engine.play('particle-burst', burstAt(3, 3));
    await expect(a.finished).resolves.toEqual({ status: 'cancelled', reason: 'limit' });
    expect(engine.activeCount).toBe(2);
  });

  it('emits start and end events in order', async () => {
    const { clock, engine } = setup();
    const events: string[] = [];
    engine.on('effectStart', ({ handle }) => events.push(`start:${String(handle.id)}`));
    engine.on('effectEnd', ({ handle, result }) => events.push(`end:${String(handle.id)}:${result.status}`));
    const { definition } = probeEffect(100);
    const a = engine.play(definition, { tag: 'a' });
    clock.advance(50);
    const b = engine.play(definition, { tag: 'b' });
    clock.advance(60); // a reaches 110 ms, b only 60 ms
    clock.advance(60);
    await Promise.all([a.finished, b.finished]);
    expect(events).toEqual([`start:1`, `start:2`, `end:1:completed`, `end:2:completed`]);
  });

  it('is deterministic: same engine seed gives identical particles', () => {
    const run = () => {
      const { clock, engine } = setup();
      engine.play('particle-burst', burstAt(50, 50, { count: 30 }));
      clock.advance(200);
      return Array.from((engine.drawables[0] as ParticleBurst).x);
    };
    expect(run()).toEqual(run());
  });

  it('a per-play seed overrides the engine seed', () => {
    const { clock, engine } = setup();
    engine.play('particle-burst', burstAt(50, 50), { seed: 99 });
    engine.play('particle-burst', burstAt(50, 50), { seed: 99 });
    clock.advance(100);
    const [p, q] = engine.drawables as ParticleBurst[];
    expect(Array.from(p?.y ?? [])).toEqual(Array.from(q?.y ?? []));
  });

  it('rejects unknown effects and invalid params synchronously without leaking', () => {
    const { clock, engine } = setup();
    expect(() => engine.play('nope', {})).toThrow(InvalidOptionError);
    expect(() => engine.play('particle-burst', burstAt(Number.NaN, 0))).toThrow(InvalidOptionError);
    expect(() => engine.play('particle-burst', { position: { x: 0, y: 0 }, count: -3 })).toThrow(InvalidOptionError);
    expect(() => engine.play('particle-burst', { position: { x: 0, y: 0 }, duration: 0 })).toThrow(InvalidOptionError);
    expect(() => engine.play('particle-burst', burstAt(0, 0), { seed: Number.POSITIVE_INFINITY })).toThrow(
      InvalidOptionError,
    );
    expect(engine.activeCount).toBe(0);
    expect(clock.subscriberCount).toBe(0);
  });

  it('cancels an effect whose update throws and reports the error', async () => {
    const { clock, engine, errors } = setup();
    const broken = defineEffect<null>({
      name: 'broken',
      create: () => ({
        update: (ms) => {
          if (ms > 0) throw new Error('bad frame');
        },
        done: false,
        drawables: [],
        dispose: () => undefined,
      }),
    });
    const handle = engine.play(broken, null);
    clock.advance(16);
    await expect(handle.finished).resolves.toMatchObject({ status: 'cancelled' });
    expect(errors).toHaveLength(1);
  });

  it('keeps running when a frame listener throws', () => {
    const { clock, engine, errors } = setup();
    engine.on('frame', () => {
      throw new Error('listener');
    });
    engine.play('particle-burst', burstAt(1, 1));
    clock.advance(16);
    clock.advance(16);
    expect(errors).toHaveLength(2);
    expect(engine.activeCount).toBe(1);
  });

  it('supports registering custom effects by name', () => {
    const { clock, engine } = setup();
    const { definition, log } = probeEffect(50);
    engine.register(definition);
    expect(engine.hasEffect('probe')).toBe(true);
    engine.play('probe', { tag: 'named' });
    clock.advance(60);
    expect(log).toContain('dispose:named');
  });
});
