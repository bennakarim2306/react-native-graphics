import { createEngine } from '../engine/engine';
import type { Engine, EngineOptions } from '../engine/engine';
import { PathData } from '../graphics/path';
import { flameBorderShader } from '../graphics/shaderLib';
import type { ParticleEmitter } from '../particles/emitter';
import { VirtualClock } from '../runtime/clock';
import { QUALITY_PROFILES } from '../runtime/quality';
import type { QualityLevel } from '../runtime/quality';
import { createRandom } from '../runtime/rng';
import { isSceneDrawable } from '../scene/scene';
import type { SceneDrawable } from '../scene/scene';
import type { ShaderFill } from '../graphics/paint';
import { FireBorderInstance, fireBorder } from './fireBorder';
import { builtInEffects } from './index';

function setup(options: Partial<EngineOptions> = {}) {
  const clock = new VirtualClock(0);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: builtInEffects, seed: 9, onError: (e) => errors.push(e), ...options });
  const card = engine.scene.createNode({ x: 200, y: 300, size: { width: 100, height: 140 } });
  return { clock, engine, card, errors };
}

const flameRect = (engine: Engine): SceneDrawable | undefined =>
  engine.drawables.filter(isSceneDrawable).find((d) => d.items[0]?.shape.type === 'rect' && (d.items[0].shape.fill as ShaderFill | undefined)?.type === 'shader');
const uniformsOf = (d: SceneDrawable | undefined): Record<string, number | readonly number[]> => {
  const shape = d?.items[0]?.shape as { fill?: ShaderFill } | undefined;
  return (shape?.fill?.uniforms ?? {});
};
const emitters = (engine: Engine) => engine.drawables.filter((d) => d.kind === 'particles') as ParticleEmitter[];

describe('fire-border', () => {
  it('chooses shader flames when shaders are allowed and particle flames otherwise', () => {
    const mode = (level: QualityLevel, runtimeShaders: boolean, params: object = {}) => {
      const { engine, card } = setup();
      const instance = fireBorder.create(
        { target: card, ...params },
        { random: createRandom(1), quality: QUALITY_PROFILES[level], services: { ...servicesOf(engine), capabilities: { runtimeShaders, nodeEffects: [] } } },
      ) as FireBorderInstance;
      return instance.mode;
    };
    expect(mode('high', true)).toBe('shader');
    expect(mode('medium', true)).toBe('shader');
    expect(mode('low', true)).toBe('particles');
    expect(mode('high', false)).toBe('particles');
    expect(mode('high', true, { mode: 'particles' })).toBe('particles');
    expect(mode('low', true, { mode: 'shader' })).toBe('shader');
    expect(mode('high', true, { shape: new PathData().ellipse(0, 0, 50, 50) })).toBe('particles');
  });

  it('shader flames surround the target, follow its position and rotation, and fit its scaled size', () => {
    const { clock, engine, card } = setup();
    engine.play('fire-border', { target: card, flameHeight: 20, padding: 0, cornerRadius: 10 });
    clock.advance(16);
    let rect = flameRect(engine);
    expect(rect).toBeDefined();
    const margin = 20 * 1.8 + 4;
    expect(rect?.items[0]?.shape).toMatchObject({ type: 'rect', width: 100 + margin * 2, height: 140 + margin * 2 });
    expect(uniformsOf(rect)).toMatchObject({ box: [50, 70], radius: 10, flameHeight: 20, shape: 0 });
    // Additive: with a glow the whole layer is added to what is below it.
    expect(rect?.commands[0]).toMatchObject({ op: 'begin-group', blendMode: 'plus' });
    expect(rect?.items[0]?.matrix).toEqual([1, 0, -0, 1, 200, 300]);
    expect((rect?.items[0]?.shape as { fill: ShaderFill }).fill.shader).toBe(flameBorderShader);

    card.x = 260;
    card.rotation = 30;
    card.scale = 1.5;
    clock.advance(16);
    rect = flameRect(engine);
    const m = rect?.items[0]?.matrix ?? [];
    expect(m[4]).toBe(260);
    expect(Math.atan2(m[1] ?? 0, m[0] ?? 1) * (180 / Math.PI)).toBeCloseTo(30, 9);
    // Scale enlarges the outline, not the flames.
    expect(uniformsOf(rect).box).toEqual([75, 105]);
    expect(Math.hypot(m[0] ?? 0, m[1] ?? 0)).toBeCloseTo(1, 9);
    expect(uniformsOf(rect).flameHeight).toBe(20);
  });

  it('animates continuously from engine time', () => {
    const { clock, engine, card } = setup();
    engine.play('fire-border', { target: card });
    clock.advance(16);
    const t1 = flameRect(engine)?.time;
    clock.advance(500, { frameMs: 16 });
    expect((flameRect(engine)?.time ?? 0) - (t1 ?? 0)).toBe(500);
  });

  it('adds glow, sparks and heat haze by option and quality', () => {
    const { clock, engine, card } = setup();
    engine.play('fire-border', { target: card, heatHaze: true });
    clock.advance(16);
    const group = flameRect(engine)?.commands[0];
    expect(group).toMatchObject({ op: 'begin-group', effects: [{ type: 'glow' }, { type: 'distort' }] });
    clock.advance(300, { frameMs: 16 });
    expect(emitters(engine).some((e) => e.look === 'spark')).toBe(true);

    const plain = setup();
    plain.engine.play('fire-border', { target: plain.card, glow: false, sparks: false });
    plain.clock.advance(300, { frameMs: 16 });
    expect(flameRect(plain.engine)?.commands.map((c) => c.op)).toEqual(['draw']);
    expect(emitters(plain.engine)).toHaveLength(0);

    const medium = setup({ quality: 'medium' });
    medium.engine.play('fire-border', { target: medium.card, heatHaze: true });
    medium.clock.advance(16);
    expect(flameRect(medium.engine)?.commands.map((c) => c.op)).toEqual(['draw']);
  });

  it('particle flames are born on the outline, rise outward along its normals and move with the target', () => {
    const { clock, engine, card } = setup();
    engine.play('fire-border', { target: card, mode: 'particles', sparks: false, padding: 0, shape: 'rect', flameHeight: 20 });
    clock.advance(200, { frameMs: 16 });
    const flames = emitters(engine)[0];
    expect(flames?.space).toBe('local');
    expect(flames?.look).toBe('soft');
    expect(flames?.blendMode).toBe('plus');
    // Rate ~ perimeter (480) × 1.4 × intensity 0.8 per second.
    expect(flames?.born).toBeGreaterThan(80);
    expect(flames?.born).toBeLessThan(130);
    // Local space: every particle sits around the outline, outside or on it.
    let outside = 0;
    let alive = 0;
    for (let i = 0; i < (flames?.count ?? 0); i++) {
      if (flames?.alive[i] !== 1) continue;
      alive++;
      const x = Math.abs(flames.x[i] ?? 0);
      const y = Math.abs(flames.y[i] ?? 0);
      if (x >= 49.9 || y >= 69.9) outside++;
    }
    expect(outside / alive).toBeGreaterThan(0.95);
    card.x = 400;
    clock.advance(16);
    expect(flames?.matrix?.[4]).toBe(400);
  });

  it('follows a path outline with particle flames', () => {
    const { clock, engine, card } = setup();
    const heart = new PathData().moveTo(0, -20).cubicTo(40, -60, 60, 0, 0, 40).cubicTo(-60, 0, -40, -60, 0, -20).close();
    engine.play('fire-border', { target: card, shape: heart, sparks: false });
    clock.advance(200, { frameMs: 16 });
    expect(emitters(engine)[0]?.born).toBeGreaterThan(20);
    expect(() => engine.play('fire-border', { target: card, shape: new PathData() })).toThrow('path must not be empty');
  });

  it('adapts to target size changes', () => {
    const { clock, engine, card } = setup();
    engine.play('fire-border', { target: card, padding: 0 });
    clock.advance(16);
    card.size = { width: 200, height: 50 };
    clock.advance(16);
    expect(uniformsOf(flameRect(engine)).box).toEqual([100, 25]);
  });

  it('changes intensity, flame height and color while running; rejects other changes', () => {
    const { clock, engine, card } = setup();
    const handle = engine.play('fire-border', { target: card });
    handle.setIntensity(1.6);
    handle.update({ flameHeight: 40, color: '#3D7BFF' });
    clock.advance(16);
    const u = uniformsOf(flameRect(engine));
    expect(u.intensity).toBe(1.6);
    expect(u.flameHeight).toBe(40);
    expect((u.color as number[]).map((c) => Math.round(c * 255))).toEqual([0x3d, 0x7b, 0xff]);
    expect(() => {
      handle.setIntensity(3);
    }).toThrow('intensity');
    expect(() => {
      handle.update({ shape: 'ellipse' });
    }).toThrow('cannot change "shape"');
    expect(() => {
      handle.update({ color: 'nope' });
    }).toThrow('color');
  });

  it('stop() fades the flames out, lets particles burn out, then completes', async () => {
    const { clock, engine, card } = setup();
    const handle = engine.play('fire-border', { target: card });
    clock.advance(500, { frameMs: 16 });
    const before = flameRect(engine)?.items[0]?.opacity ?? 0;
    handle.stop();
    clock.advance(150, { frameMs: 16 });
    const mid = flameRect(engine)?.items[0]?.opacity ?? 0;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(before);
    clock.advance(200, { frameMs: 16 });
    expect(flameRect(engine)).toBeUndefined();
    clock.advance(1200, { frameMs: 16 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.drawables).toEqual([]);
  });

  it('ends when the target is destroyed, hides while it is hidden, and honours duration', async () => {
    const { clock, engine, card } = setup();
    const handle = engine.play('fire-border', { target: card, sparks: false });
    clock.advance(16);
    card.visible = false;
    clock.advance(16);
    expect(flameRect(engine)).toBeUndefined();
    card.visible = true;
    clock.advance(16);
    expect(flameRect(engine)).toBeDefined();
    card.destroy();
    clock.advance(1500, { frameMs: 16 });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });

    const timed = setup();
    const t = timed.engine.play('fire-border', { target: timed.card, duration: 400, sparks: false });
    timed.clock.advance(2000, { frameMs: 16 });
    await expect(t.finished).resolves.toEqual({ status: 'completed' });
  });

  it('validates its parameters', () => {
    const { engine, card } = setup();
    expect(() => engine.play('fire-border', { target: card, intensity: 2.5 })).toThrow('intensity');
    expect(() => engine.play('fire-border', { target: card, flameHeight: 0 })).toThrow('flameHeight');
    expect(() => engine.play('fire-border', { target: card, shape: 'star' as 'rect' })).toThrow('shape');
    expect(() => engine.play('fire-border', { target: card, mode: 'gpu' as 'auto' })).toThrow('mode');
    expect(() => engine.play('fire-border', { target: card, glow: 'yes' as unknown as boolean })).toThrow('booleans');
    expect(() => engine.play('fire-border', { target: card, duration: 0 })).toThrow('duration');
    expect(() => engine.play('fire-border', { target: 'nope' })).toThrow('Unknown target');
    expect(engine.activeCount).toBe(0);
  });

  it('ten borders on ten targets run together and clean up', async () => {
    const { clock, engine } = setup();
    const handles = Array.from({ length: 10 }, (_, i) => {
      const node = engine.scene.createNode({ x: 40 + i * 30, y: 100, size: { width: 24, height: 36 } });
      return engine.play('fire-border', { target: node, mode: i % 2 === 0 ? 'shader' : 'particles' });
    });
    clock.advance(1000, { frameMs: 16 });
    expect(engine.activeCount).toBe(10);
    for (const h of handles) h.stop();
    clock.advance(2000, { frameMs: 16 });
    const results = await Promise.all(handles.map((h) => h.finished));
    expect(results.every((r) => r.status === 'completed')).toBe(true);
    expect(engine.activeCount).toBe(0);
  });
});

/** The engine's effect services, for creating instances directly with a custom context. */
function servicesOf(engine: Engine) {
  return {
    resolveTarget: (t: string | import('../scene/node').SceneNode) => engine.resolveTarget(t),
    addCameraOffset: () => ({ x: 0, y: 0, rotation: 0, remove: () => undefined }),
    addTargetOffset: () => null,
    capabilities: null,
  };
}
