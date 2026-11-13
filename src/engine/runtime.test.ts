import { builtInEffects } from '../effects';
import type { ParticleEmitter } from '../particles/emitter';
import { VirtualClock } from '../runtime/clock';
import { defineEffect } from '../runtime/effect';
import type { EffectContext, EffectInstance } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import { isSceneDrawable } from '../scene/scene';
import { createEngine } from './engine';
import type { EffectHandle, EffectResult, EngineOptions, FrameEvent } from './engine';

function setup(options: Partial<EngineOptions> = {}) {
  const clock = new VirtualClock(1000);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: builtInEffects, seed: 11, onError: (e) => errors.push(e), ...options });
  return { clock, engine, errors };
}

/** Records the context each instance is created with. */
function contextProbe() {
  const contexts: EffectContext[] = [];
  const definition = defineEffect<object>({
    name: 'context-probe',
    create(_params, context): EffectInstance {
      contexts.push(context);
      return { drawables: [], done: false, update: () => undefined, dispose: () => undefined };
    },
  });
  return { definition, contexts };
}

const emitterOf = (engine: ReturnType<typeof createEngine>, index = 0): ParticleEmitter =>
  engine.drawables.filter((d) => d.kind === 'particles')[index] as ParticleEmitter;

describe('effect handles: graceful stop, live parameters, end listeners', () => {
  it('stop() ends emission and completes once the particles on screen have died', async () => {
    const { clock, engine } = setup();
    const handle = engine.play('particles', { position: { x: 0, y: 0 }, rate: 100, lifetime: 400, speed: 0 });
    clock.advance(1000, { frameMs: 16 });
    const emitter = emitterOf(engine);
    expect(emitter.aliveCount).toBeGreaterThan(30);
    const bornAtStop = emitter.born;
    handle.stop();
    expect(handle.status).toBe('playing');
    clock.advance(200, { frameMs: 16 });
    expect(emitter.born).toBe(bornAtStop);
    expect(emitter.aliveCount).toBeGreaterThan(0);
    clock.advance(300, { frameMs: 16 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.activeCount).toBe(0);
  });

  it('stop() on an effect without a graceful stop cancels it; stop() on a paused effect drains it', async () => {
    const { clock, engine } = setup();
    const { definition } = contextProbe();
    const plain = engine.play(definition, {});
    plain.stop();
    await expect(plain.finished).resolves.toEqual({ status: 'cancelled', reason: 'user' });

    const paused = engine.play('particles', { position: { x: 0, y: 0 }, rate: 50, lifetime: 100 });
    clock.advance(100, { frameMs: 16 });
    paused.pause();
    paused.stop();
    expect(paused.status).toBe('playing');
    clock.advance(200, { frameMs: 16 });
    await expect(paused.finished).resolves.toEqual({ status: 'completed' });
  });

  it('update() and setIntensity() change running effects; unsupported or invalid updates throw', () => {
    const { clock, engine } = setup();
    const handle = engine.play('particles', { position: { x: 0, y: 0 }, rate: 10, lifetime: 5000, speed: 0 });
    expect(handle.updatable).toBe(true);
    clock.advance(1000, { frameMs: 10 });
    const emitter = emitterOf(engine);
    const before = emitter.born;
    // Intensity multiplies the rate: 10/s becomes 30/s from now on (no burst of catch-up births).
    handle.setIntensity(3);
    clock.advance(1020, { frameMs: 10 });
    expect(emitter.born - before).toBe(30);
    // A new base rate keeps the intensity: 5/s x 3.
    handle.update({ rate: 5 });
    const mid = emitter.born;
    clock.advance(1020, { frameMs: 10 });
    expect(emitter.born - mid).toBe(15);
    expect(() => {
      handle.setIntensity(-1);
    }).toThrow(InvalidOptionError);
    expect(() => {
      handle.update({ speed: 10 });
    }).toThrow('only intensity and rate');
    expect(() => {
      handle.update(null as unknown as Record<string, unknown>);
    }).toThrow('object');

    const { definition } = contextProbe();
    const fixed = engine.play(definition, {});
    expect(fixed.updatable).toBe(false);
    expect(() => {
      fixed.setIntensity(1);
    }).toThrow('does not support parameter updates');
  });

  it('onEnd listeners run exactly once, also when added after the end', () => {
    const { engine } = setup();
    const results: EffectResult[] = [];
    const handle = engine.play('flash', { position: { x: 0, y: 0 } });
    handle.onEnd((r) => results.push(r));
    const off = handle.onEnd(() => results.push({ status: 'completed' }));
    off();
    handle.cancel();
    handle.cancel();
    handle.onEnd((r) => results.push(r));
    expect(results).toEqual([
      { status: 'cancelled', reason: 'user' },
      { status: 'cancelled', reason: 'user' },
    ]);
  });
});

describe('composition rules: draw order, replacement keys, errors', () => {
  it('draws effects by zIndex (stable for equal values); negative zIndex draws below the scene', () => {
    const { clock, engine } = setup();
    engine.scene.createNode({ shape: { type: 'rect', width: 10, height: 10, fill: '#FFF' } });
    const a = engine.play('flash', { position: { x: 1, y: 0 }, duration: 1000 });
    engine.play('flash', { position: { x: 2, y: 0 }, duration: 1000 }, { zIndex: 5 });
    engine.play('flash', { position: { x: 3, y: 0 }, duration: 1000 });
    engine.play('flash', { position: { x: 4, y: 0 }, duration: 1000 }, { zIndex: -1 });
    clock.advance(16);
    const order = () =>
      engine.drawables.map((d) => {
        if (!isSceneDrawable(d)) return d.kind;
        const item = d.items[0];
        return item?.nodeId === -1 ? `fx${String(item.matrix[4])}` : 'scene';
      });
    expect(order()).toEqual(['fx4', 'scene', 'fx1', 'fx3', 'fx2']);
    a.zIndex = 10;
    clock.advance(16);
    expect(order()).toEqual(['fx4', 'scene', 'fx3', 'fx2', 'fx1']);
    expect(() => {
      a.zIndex = Number.NaN;
    }).toThrow('zIndex');
    expect(() => engine.play('flash', { position: { x: 0, y: 0 } }, { zIndex: Infinity })).toThrow('zIndex');
  });

  it('a replacement key cancels the running effect with the same key (reason replaced)', async () => {
    const { engine } = setup();
    const first = engine.play('flash', { position: { x: 0, y: 0 } }, { key: 'card-1' });
    const other = engine.play('flash', { position: { x: 0, y: 0 } }, { key: 'card-2' });
    const second = engine.play('flash', { position: { x: 0, y: 0 } }, { key: 'card-1' });
    await expect(first.finished).resolves.toEqual({ status: 'cancelled', reason: 'replaced' });
    expect(other.status).toBe('playing');
    expect(second.status).toBe('playing');
    expect(second.key).toBe('card-1');
    expect(() => engine.play('flash', { position: { x: 0, y: 0 } }, { key: '' })).toThrow('key');
    // Invalid parameters fail before anything is replaced.
    expect(() => engine.play('flash', { position: { x: 0, y: 0 }, radius: -1 }, { key: 'card-1' })).toThrow('radius');
    expect(second.status).toBe('playing');
  });

  it('an effect that throws while updating ends with reason error and is disposed', async () => {
    const { clock, engine, errors } = setup();
    let disposed = 0;
    let calls = 0;
    const faulty = defineEffect<object>({
      name: 'faulty',
      create: () => ({
        drawables: [],
        done: false,
        update: () => {
          if (++calls > 1) throw new Error('boom');
        },
        dispose: () => {
          disposed++;
        },
      }),
    });
    const handle = engine.play(faulty, {});
    clock.advance(16);
    await expect(handle.finished).resolves.toEqual({ status: 'cancelled', reason: 'error' });
    expect(disposed).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('an effect whose first update throws is disposed and the error reaches the caller', () => {
    const { engine } = setup();
    let disposed = 0;
    const broken = defineEffect<object>({
      name: 'broken',
      create: () => ({
        drawables: [],
        done: false,
        update: () => {
          throw new InvalidOptionError('bad start');
        },
        dispose: () => {
          disposed++;
        },
      }),
    });
    expect(() => engine.play(broken, {})).toThrow('bad start');
    expect(disposed).toBe(1);
    expect(engine.activeCount).toBe(0);
  });

  it('attach accepts (target, name, params) and (target, { effect, ...params }); unknown ids throw', async () => {
    const { clock, engine } = setup();
    engine.targets.register('card');
    engine.targets.updateWindowLayout('card', { x: 100, y: 200, width: 80, height: 120 });
    const a = engine.attach('card', 'glow-border', { pulse: 0 });
    const b = engine.attach('card', { effect: 'fire-border', intensity: 1.2, mode: 'particles' });
    clock.advance(16);
    expect(a.effect).toBe('glow-border');
    expect(b.effect).toBe('fire-border');
    expect(() => engine.attach('nope', { effect: 'fire-border' })).toThrow('Unknown target "nope"');
    // Ids also work as `target` in play().
    const c = engine.play('fire-border', { target: 'card', mode: 'particles' });
    // Unmounting the target ends every effect on it: the border at once, the fire after its
    // flames fade and its particles burn out.
    engine.targets.unregister('card');
    clock.advance(1500, { frameMs: 16 });
    const results = await Promise.all([a.finished, b.finished, c.finished]);
    expect(results.map((r) => r.status)).toEqual(['completed', 'completed', 'completed']);
    expect(engine.scene.attachmentCount).toBe(0);
  });
});

describe('quality profiles, adaptive quality and reduced motion', () => {
  it('passes the engine quality, a per-instance override and reduced motion to effects', () => {
    const { engine } = setup({ quality: 'medium', reducedMotion: true });
    const { definition, contexts } = contextProbe();
    engine.play(definition, {});
    engine.play(definition, {}, { quality: 'low' });
    engine.quality = 'high';
    engine.reducedMotion = false;
    engine.play(definition, {});
    expect(contexts.map((c) => [c.quality?.level, c.reducedMotion])).toEqual([
      ['medium', true],
      ['low', true],
      ['high', false],
    ]);
    expect(() => {
      engine.quality = 'ultra' as 'high';
    }).toThrow('Unknown quality');
  });

  it('scales particle counts with the quality profile', () => {
    const counts: number[] = [];
    for (const quality of ['low', 'medium', 'high'] as const) {
      const { clock, engine } = setup({ quality });
      engine.play('particles', { position: { x: 0, y: 0 }, bursts: [{ count: 100 }], lifetime: 1000 });
      clock.advance(16);
      counts.push(emitterOf(engine).born);
    }
    expect(counts).toEqual([35, 65, 100]);
  });

  it('adaptive quality steps down on slow frames and back up on fast frames', () => {
    const { clock, engine } = setup({ adaptiveQuality: { window: 10 } });
    engine.play('particles', { position: { x: 0, y: 0 }, rate: 1, lifetime: 100 });
    const levels: string[] = [];
    clock.advance(30 * 12, { frameMs: 30 });
    levels.push(engine.quality.level);
    clock.advance(30 * 10, { frameMs: 30 });
    levels.push(engine.quality.level);
    clock.advance(30 * 30, { frameMs: 30 });
    levels.push(engine.quality.level);
    clock.advance(8 * 22, { frameMs: 8 });
    levels.push(engine.quality.level);
    // 10-frame windows: 30 ms frames step high -> medium -> low; 8 ms frames step back up twice
    // (the first fast window still holds two slow frames from before).
    expect(levels).toEqual(['medium', 'low', 'low', 'high']);
  });

  it('reduced motion turns screen shake into a no-op and halves particle counts', () => {
    const { clock, engine } = setup({ reducedMotion: true });
    const shake = engine.play('screen-shake', { amplitude: 20 });
    engine.play('particles', { position: { x: 0, y: 0 }, bursts: [{ count: 100 }], lifetime: 1000 });
    clock.advance(16);
    expect(shake.status).toBe('completed');
    expect(emitterOf(engine).born).toBe(50);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
  });
});

describe('screen shake (camera and target offsets)', () => {
  it('moves the overlay camera while running and restores it exactly at the end', async () => {
    const { clock, engine } = setup();
    const frames: FrameEvent['camera'][] = [];
    engine.on('frame', (e) => frames.push(e.camera));
    const handle = engine.play('screen-shake', { amplitude: 10, rotation: 2, duration: 300 });
    clock.advance(300, { frameMs: 16 });
    const moving = frames.filter((c) => c.x !== 0 || c.y !== 0);
    expect(moving.length).toBeGreaterThan(10);
    for (const c of moving) {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(c.y)).toBeLessThanOrEqual(10);
      expect(Math.abs(c.rotation)).toBeLessThanOrEqual(2);
    }
    clock.advance(32, { frameMs: 16 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(frames.at(-1)).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it('shakes a host target through its transform binding and never changes its layout', () => {
    const { clock, engine } = setup();
    engine.targets.register('board');
    engine.targets.updateWindowLayout('board', { x: 0, y: 0, width: 200, height: 100 });
    const node = engine.targets.node('board');
    const transforms: number[] = [];
    engine.targets.on('transform', (e) => transforms.push(e.transform.translateX));
    const handle = engine.play('screen-shake', { scope: ['board', 'overlay'], amplitude: 6, duration: 200 });
    clock.advance(100, { frameMs: 16 });
    expect(transforms.some((x) => x !== 0)).toBe(true);
    expect(node?.x).not.toBe(100);
    expect(engine.camera.x).not.toBe(0);
    handle.cancel();
    expect(engine.targets.viewTransform('board')).toEqual({ translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    expect(node?.x).toBe(100);
    expect(node?.y).toBe(50);
    expect(engine.targets.layout('board')).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(() => engine.play('screen-shake', { scope: 'missing' })).toThrow('scope');
  });

  it('two overlapping shakes add up and each removes only its own offset', () => {
    const { clock, engine } = setup();
    const a = engine.play('screen-shake', { amplitude: 5, duration: 1000 });
    clock.advance(50, { frameMs: 16 });
    const b = engine.play('screen-shake', { amplitude: 5, duration: 1000 });
    clock.advance(50, { frameMs: 16 });
    a.cancel();
    clock.advance(16);
    expect(engine.camera.x).not.toBe(0);
    b.cancel();
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
  });
});

describe('many effects', () => {
  it('keeps the oldest-first limit with composites and frees everything on cancelAll', () => {
    const { clock, engine } = setup({ maxActiveEffects: 4 });
    const handles: EffectHandle[] = [];
    for (let i = 0; i < 6; i++) handles.push(engine.play('explosion', { position: { x: i * 10, y: 0 } }));
    expect(engine.activeCount).toBe(4);
    expect(handles.slice(0, 2).map((h) => h.status)).toEqual(['cancelled', 'cancelled']);
    clock.advance(100, { frameMs: 16 });
    engine.cancelAll();
    expect(engine.activeCount).toBe(0);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
  });
});
