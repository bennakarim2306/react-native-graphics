import { createEngine } from '../engine/engine';
import type { Engine } from '../engine/engine';
import type { ParticleEmitter } from '../particles/emitter';
import { VirtualClock } from '../runtime/clock';
import { defineEffect } from '../runtime/effect';
import type { EffectContext, EffectDefinition, EffectInstance } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import { QUALITY_PROFILES } from '../runtime/quality';
import type { QualityLevel } from '../runtime/quality';
import { createRandom } from '../runtime/rng';
import { isSceneDrawable } from '../scene/scene';
import type { SceneDrawable } from '../scene/scene';
import { CompositeInstance, defineComposite } from './composite';
import { builtInEffects } from './index';
import { explosion, victory } from './presets';

function setup(quality: QualityLevel = 'high') {
  const clock = new VirtualClock(0);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: builtInEffects, seed: 5, quality, onError: (e) => errors.push(e) });
  return { clock, engine, errors };
}

const emitters = (engine: Engine): ParticleEmitter[] => engine.drawables.filter((d) => d.kind === 'particles') as ParticleEmitter[];
const shapes = (engine: Engine): SceneDrawable[] => engine.drawables.filter(isSceneDrawable).filter((d) => d.items[0]?.nodeId === -1);

const context = (level: QualityLevel = 'high', seed = 1): EffectContext => ({ random: createRandom(seed), quality: QUALITY_PROFILES[level] });

describe('every built-in preset', () => {
  const finite: [string, object, number][] = [
    ['particles', { bursts: [{ count: 30 }], lifetime: 300 }, 400],
    ['flash', {}, 300],
    ['shockwave', {}, 800],
    ['confetti', { count: 40 }, 3000],
    ['golden-sparks', {}, 1000],
    ['smoke', { rate: 0, burst: 8 }, 2400],
    ['glow-pulse', { pulses: 2 }, 1800],
    ['explosion', {}, 2200],
    ['victory', {}, 4000],
  ];

  it.each(finite)('%s plays at a position, completes on its own and releases everything', async (name, params, ms) => {
    const { clock, engine, errors } = setup();
    const handle = engine.play(name, { position: { x: 100, y: 100 }, ...params });
    clock.advance(32, { frameMs: 16 });
    expect(engine.drawables.length).toBeGreaterThan(0);
    clock.advance(ms, { frameMs: 16 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.activeCount).toBe(0);
    clock.advance(16);
    expect(engine.drawables).toEqual([]);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(errors).toEqual([]);
  });

  it.each(['smoke', 'golden-sparks', 'particles'])('%s with a rate runs until stopped, then drains', async (name) => {
    const { clock, engine } = setup();
    const handle = engine.play(name, { position: { x: 0, y: 0 }, rate: 30, lifetime: 400 });
    clock.advance(5000, { frameMs: 50 });
    expect(handle.status).toBe('playing');
    handle.stop();
    clock.advance(3000, { frameMs: 50 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
  });

  it('rejects invalid parameters before anything is drawn', () => {
    const { engine } = setup();
    const at = { position: { x: 0, y: 0 } };
    const cases: [string, object, string][] = [
      ['confetti', { count: 0 }, 'count'],
      ['confetti', { colors: [] }, 'colors'],
      ['golden-sparks', { power: -1 }, 'power'],
      ['smoke', { size: 0 }, 'size'],
      ['flash', { color: 'nope' }, 'color'],
      ['shockwave', { echoes: 9 }, 'echoes'],
      ['glow-pulse', { pulses: 0 }, 'pulses'],
      ['explosion', { intensity: 0 }, 'intensity'],
      ['explosion', { colors: ['#FFF', 'bad'] }, 'color'],
      ['victory', { width: 0 }, 'width'],
      ['screen-shake', { amplitude: -1 }, 'amplitude'],
    ];
    for (const [name, params, message] of cases) {
      expect(() => engine.play(name, { ...at, ...params })).toThrow(message);
    }
    expect(() => engine.play('trail', at)).toThrow('trail needs a target');
    expect(() => engine.play('flash', {})).toThrow('position');
    expect(engine.activeCount).toBe(0);
  });
});

describe('preset behavior', () => {
  it('confetti: paper pieces launch upwards, then fall and tumble', () => {
    const { clock, engine } = setup();
    engine.play('confetti', { position: { x: 200, y: 400 }, count: 60 });
    clock.advance(100, { frameMs: 16 });
    const e = emitters(engine)[0];
    expect(e?.look).toBe('square');
    expect(e?.aspect).toBe(0.5);
    const meanY = () => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < (e?.count ?? 0); i++) {
        if (e?.alive[i] === 1) {
          sum += e.y[i] ?? 0;
          n++;
        }
      }
      return sum / n;
    };
    const early = meanY();
    expect(early).toBeLessThan(400);
    clock.advance(1500, { frameMs: 16 });
    expect(meanY()).toBeGreaterThan(early);
    expect(e?.aliveCount).toBe(60);
  });

  it('golden sparks are additive streaks; smoke rises and grows', () => {
    const { clock, engine } = setup();
    engine.play('golden-sparks', { position: { x: 0, y: 0 } });
    engine.play('smoke', { position: { x: 0, y: 0 }, rate: 0, burst: 10, wind: 0 });
    clock.advance(16);
    const [sparks, smoke] = emitters(engine);
    expect(sparks?.look).toBe('spark');
    expect(sparks?.blendMode).toBe('plus');
    expect(smoke?.look).toBe('soft');
    const r0 = smoke?.radius[0] ?? 0;
    const y0 = smoke?.y[0] ?? 0;
    clock.advance(800, { frameMs: 16 });
    expect(smoke?.radius[0]).toBeGreaterThan(r0);
    expect(smoke?.y[0]).toBeLessThan(y0);
  });

  it('trail leaves world-space particles behind a moving target, without gaps on fast motion', () => {
    const { clock, engine } = setup();
    const ball = engine.scene.createNode({ x: 0, y: 0 });
    engine.play('trail', { target: ball, rate: 100, lifetime: 2000 });
    // One 500 ms frame while the ball moves 500 pt: births are spread along the path.
    clock.advance(16);
    ball.x = 500;
    clock.advance(500);
    const e = emitters(engine)[0];
    const xs: number[] = [];
    for (let i = 0; i < (e?.count ?? 0); i++) if (e?.alive[i] === 1) xs.push(e.x[i] ?? 0);
    xs.sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(45);
    // Without interpolation all births of the frame would sit at x = 500. They are spread along
    // the path instead (with a little drift from their own speed and inherited velocity).
    expect(xs[0]).toBeLessThan(60);
    expect(xs.at(-1)).toBeGreaterThan(440);
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] ?? 0));
    expect(Math.max(...gaps)).toBeLessThan(70);
  });

  it('flash grows and fades; reduced motion makes it dimmer', () => {
    const peak = (reduced: boolean) => {
      const clock = new VirtualClock(0);
      const engine = createEngine({ clock, effects: builtInEffects, reducedMotion: reduced });
      engine.play('flash', { position: { x: 10, y: 10 }, radius: 100, duration: 200 });
      clock.advance(20);
      const first = shapes(engine)[0]?.items[0];
      clock.advance(120);
      const later = shapes(engine)[0]?.items[0];
      return { first, later };
    };
    const normal = peak(false);
    expect(normal.later?.matrix[0]).toBeGreaterThan(normal.first?.matrix[0] ?? 0);
    expect(normal.later?.opacity).toBeLessThan(normal.first?.opacity ?? 0);
    expect(peak(true).first?.opacity).toBeCloseTo((normal.first?.opacity ?? 0) * 0.4, 9);
  });

  it('shockwave rings expand and thin; echoes and glow depend on quality', () => {
    const { clock, engine } = setup('high');
    engine.play('shockwave', { position: { x: 0, y: 0 }, radius: 100, duration: 400, echoes: 1 });
    clock.advance(150);
    const rings = shapes(engine);
    expect(rings).toHaveLength(2);
    expect(rings[0]?.commands[0]).toMatchObject({ op: 'begin-group', effects: [{ type: 'glow' }] });
    const low = setup('low');
    low.engine.play('shockwave', { position: { x: 0, y: 0 }, radius: 100, duration: 400, echoes: 1 });
    low.clock.advance(150);
    const lowRings = shapes(low.engine);
    expect(lowRings).toHaveLength(1);
    expect(lowRings[0]?.commands.map((c) => c.op)).toEqual(['draw']);
    const shape = (d: SceneDrawable | undefined) => d?.items[0]?.shape as { radius: number; stroke: { width: number } } | undefined;
    const before = shape(lowRings[0]);
    low.clock.advance(150);
    const after = shape(shapes(low.engine)[0]);
    expect(after?.radius).toBeGreaterThan(before?.radius ?? 0);
    expect(after?.stroke.width).toBeLessThan(before?.stroke.width ?? 0);
  });

  it('glow pulse fits and follows its target and stops immediately', async () => {
    const { clock, engine } = setup();
    const card = engine.scene.createNode({ x: 50, y: 60, size: { width: 40, height: 20 } });
    const handle = engine.play('glow-pulse', { target: card, padding: 0, expand: 0 });
    clock.advance(16);
    const outline = shapes(engine)[0]?.items[0];
    expect(outline?.shape).toMatchObject({ type: 'rect', width: 40, height: 20 });
    card.x = 80;
    clock.advance(16);
    expect(shapes(engine)[0]?.items[0]?.matrix[4]).toBe(80);
    handle.stop();
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
  });
});

describe('composite effects', () => {
  /** A probe layer that logs its lifecycle. */
  function probe(log: string[], length: number, options: { stoppable?: boolean; failOnCreate?: boolean } = {}): EffectDefinition<{ tag: string }> {
    return defineEffect<{ tag: string }>({
      name: 'probe',
      create(params): EffectInstance {
        if (options.failOnCreate) throw new InvalidOptionError(`bad ${params.tag}`);
        let elapsed = 0;
        let stopped = false;
        log.push(`create ${params.tag}`);
        return {
          drawables: [],
          get done() {
            return stopped || elapsed >= length;
          },
          update(ms) {
            elapsed = ms;
            log.push(`update ${params.tag} ${String(ms)}`);
          },
          ...(options.stoppable ? { stop: () => { stopped = true; log.push(`stop ${params.tag}`); } } : {}),
          setParams(patch) {
            log.push(`params ${params.tag} ${JSON.stringify(patch)}`);
          },
          dispose() {
            log.push(`dispose ${params.tag}`);
          },
        };
      },
    });
  }

  it('starts layers at their delays on one clock and completes when all are done', () => {
    const log: string[] = [];
    const def = defineComposite<object>({
      name: 'combo',
      layers: () => [
        { name: 'a', effect: probe(log, 100), params: { tag: 'a' } },
        { name: 'b', effect: probe(log, 100), params: { tag: 'b' }, delay: 150 },
      ],
    });
    const instance = def.create({}, context()) as CompositeInstance;
    expect(instance.layerNames).toEqual(['a', 'b']);
    instance.update(0);
    instance.update(120);
    expect(instance.done).toBe(false);
    instance.update(200);
    instance.update(260);
    expect(instance.done).toBe(true);
    expect(log.filter((l) => l.startsWith('update'))).toEqual(['update a 0', 'update a 120', 'update b 50', 'update b 110']);
  });

  it('stop() stops started layers gracefully and skips layers that have not started', () => {
    const log: string[] = [];
    const def = defineComposite<object>({
      name: 'combo',
      layers: () => [
        { name: 'a', effect: probe(log, 1e9, { stoppable: true }), params: { tag: 'a' } },
        { name: 'b', effect: probe(log, 1e9), params: { tag: 'b' } },
        { name: 'c', effect: probe(log, 1e9), params: { tag: 'c' }, delay: 1000 },
      ],
    });
    const instance = def.create({}, context()) as CompositeInstance;
    instance.update(10);
    instance.stop();
    instance.update(20);
    expect(instance.done).toBe(true);
    expect(log).toContain('stop a');
    expect(log.some((l) => l.startsWith('update c'))).toBe(false);
  });

  it('routes parameter updates per layer, or broadcasts them', () => {
    const log: string[] = [];
    const layers = () => [
      { name: 'a', effect: probe(log, 1e9) as EffectDefinition<never>, params: { tag: 'a' } },
      { name: 'b', effect: probe(log, 1e9) as EffectDefinition<never>, params: { tag: 'b' } },
    ];
    const broadcast = defineComposite<object>({ name: 'x', layers }).create({}, context());
    broadcast.setParams?.({ intensity: 2 });
    const routed = defineComposite<object>({ name: 'y', layers, route: (patch) => ({ b: { level: patch.intensity } }) }).create({}, context());
    routed.setParams?.({ intensity: 3 });
    expect(log.filter((l) => l.startsWith('params'))).toEqual(['params a {"intensity":2}', 'params b {"intensity":2}', 'params b {"level":3}']);
  });

  it('disposes the layers already created when a later layer is invalid', () => {
    const log: string[] = [];
    const def = defineComposite<object>({
      name: 'combo',
      layers: () => [
        { name: 'a', effect: probe(log, 1), params: { tag: 'a' } },
        { name: 'b', effect: probe(log, 1, { failOnCreate: true }), params: { tag: 'b' } },
      ],
    });
    expect(() => def.create({}, context())).toThrow('bad b');
    expect(log).toEqual(['create a', 'dispose a']);
    const delayed = defineComposite<object>({ name: 'd', layers: () => [{ name: 'a', effect: probe(log, 1), params: { tag: 'z' }, delay: -5 }] });
    expect(() => delayed.create({}, context())).toThrow('delay');
  });

  it('explosion is built from primitives; quality drops the secondary parts', () => {
    const layersAt = (level: QualityLevel, params: object = {}) =>
      (explosion.create({ position: { x: 0, y: 0 }, ...params }, context(level)) as CompositeInstance).layerNames;
    expect(layersAt('high')).toEqual(['smoke', 'flash', 'shockwave', 'sparks', 'embers']);
    expect(layersAt('low')).toEqual(['flash', 'shockwave', 'sparks']);
    expect(layersAt('high', { smoke: false, flash: false, debris: true })).toEqual(['shockwave', 'sparks', 'embers', 'debris']);
  });

  it('explosion: spark count follows particles × intensity; shake only when asked', () => {
    const { clock, engine } = setup();
    const handle = engine.play('explosion', { position: { x: 0, y: 0 }, particles: 100, intensity: 1.5, smoke: false, screenShake: true });
    clock.advance(16);
    const sparks = emitters(engine).find((e) => e.look === 'spark');
    expect(sparks?.born).toBe(150);
    expect(engine.camera.x !== 0 || engine.camera.y !== 0).toBe(true);
    handle.cancel();
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(engine.activeCount).toBe(0);
  });

  it('explosion is deterministic for a seed', () => {
    const snapshot = (seed: number) => {
      const { clock, engine } = setup();
      engine.play('explosion', { position: { x: 50, y: 50 } }, { seed });
      clock.advance(300, { frameMs: 16 });
      return emitters(engine)
        .map((e) => Array.from(e.x.slice(0, e.count)).map((v) => v.toFixed(4)).join(','))
        .join('|');
    };
    expect(snapshot(42)).toBe(snapshot(42));
    expect(snapshot(42)).not.toBe(snapshot(43));
  });

  it('victory adds a glow pulse only when it has a target', () => {
    const plain = victory.create({ position: { x: 0, y: 0 } }, context()) as CompositeInstance;
    expect(plain.layerNames).not.toContain('glow');
    const { engine } = setup();
    const node = engine.scene.createNode({ size: { width: 10, height: 10 } });
    const targeted = victory.create({ target: node }, context()) as CompositeInstance;
    expect(targeted.layerNames).toContain('glow');
  });
});
