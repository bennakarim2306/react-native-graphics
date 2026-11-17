import { createEngine } from '../engine/engine';
import type { Engine, EngineOptions } from '../engine/engine';
import { PathData } from '../graphics/path';
import { flameBorderLiteShader, flameBorderShader } from '../graphics/shaderLib';
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
  const engine = createEngine({ clock, effects: builtInEffects, seed: 9, quality: 'high', onError: (e) => errors.push(e), ...options });
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
    // Low uses the cheaper shader variant (see the next test); particles only without shaders.
    expect(mode('low', true)).toBe('shader');
    expect(mode('low', false)).toBe('particles');
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
    // Reach of the tallest tongues (2 × the intensity-scaled height) plus the halo (glow 1).
    const margin = 20 * (0.6 + 0.4 * 0.8) * (2 + 0.9) + 4;
    expect(rect?.items[0]?.shape).toMatchObject({ type: 'rect', width: 100 + margin * 2, height: 140 + margin * 2 });
    expect(uniformsOf(rect)).toMatchObject({ box: [50, 70], radius: 10, flameHeight: 20, shape: 0, up: [-0, -1], speed: 1, glow: 1 });
    // Additive and drawn directly: the halo is part of the shader, no offscreen layer.
    expect(rect?.items[0]?.blendMode).toBe('plus');
    expect(rect?.commands.map((c) => c.op)).toEqual(['draw']);
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
    // Flames rise on screen: "up" in the frame turned by 30° is (-sin 30°, -cos 30°).
    const up = uniformsOf(rect).up as number[];
    expect(up[0]).toBeCloseTo(-0.5, 9);
    expect(up[1]).toBeCloseTo(-Math.sqrt(3) / 2, 9);
  });

  it('uses the lite shader without halo on low quality and the full one otherwise', () => {
    const shaderOf = (quality: QualityLevel) => {
      const { clock, engine, card } = setup({ quality });
      engine.play('fire-border', { target: card });
      clock.advance(16);
      const rect = flameRect(engine);
      return { shader: (rect?.items[0]?.shape as { fill: ShaderFill }).fill.shader, glow: uniformsOf(rect).glow };
    };
    expect(shaderOf('low')).toEqual({ shader: flameBorderLiteShader, glow: 0 });
    expect(shaderOf('medium')).toEqual({ shader: flameBorderShader, glow: 1 });
    expect(shaderOf('high')).toEqual({ shader: flameBorderShader, glow: 1 });
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
    engine.play('fire-border', { target: card, heatHaze: true, glowStrength: 1.5 });
    clock.advance(16);
    const group = flameRect(engine)?.commands[0];
    expect(group).toMatchObject({ op: 'begin-group', effects: [{ type: 'distort' }] });
    expect(uniformsOf(flameRect(engine)).glow).toBe(1.5);
    clock.advance(300, { frameMs: 16 });
    expect(emitters(engine).some((e) => e.look === 'spark')).toBe(true);

    const plain = setup();
    plain.engine.play('fire-border', { target: plain.card, glow: false, sparks: false });
    plain.clock.advance(300, { frameMs: 16 });
    expect(flameRect(plain.engine)?.commands.map((c) => c.op)).toEqual(['draw']);
    expect(uniformsOf(flameRect(plain.engine)).glow).toBe(0);
    expect(emitters(plain.engine)).toHaveLength(0);

    // sparkDensity 0 means no spark emitter; 2 doubles the rate of the default.
    const sparkCount = (density: number) => {
      const run = setup();
      run.engine.play('fire-border', { target: run.card, sparkDensity: density });
      run.clock.advance(1000, { frameMs: 16 });
      return emitters(run.engine).find((e) => e.look === 'spark')?.born ?? 0;
    };
    expect(sparkCount(0)).toBe(0);
    const one = sparkCount(1);
    expect(one).toBeGreaterThan(5);
    expect(sparkCount(2)).toBeGreaterThan(one * 1.6);

    const medium = setup({ quality: 'medium' });
    medium.engine.play('fire-border', { target: medium.card, heatHaze: true });
    medium.clock.advance(16);
    expect(flameRect(medium.engine)?.commands.map((c) => c.op)).toEqual(['draw']);
  });

  it('particle flames are born on the outline, rise on screen whatever the rotation and move with the target', () => {
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
    // Local space: particles start on the outline and move up (negative y), not outward.
    const motion = () => {
      let up = 0;
      let alive = 0;
      let nearOutline = 0;
      for (let i = 0; i < (flames?.count ?? 0); i++) {
        if (flames?.alive[i] !== 1) continue;
        alive++;
        if ((flames.vy[i] ?? 0) < 0) up++;
        const x = Math.abs(flames.x[i] ?? 0);
        const y = Math.abs(flames.y[i] ?? 0);
        if (x >= 40 || y >= 60) nearOutline++;
      }
      return { up: up / alive, nearOutline: nearOutline / alive };
    };
    const upright = motion();
    expect(upright.up).toBeGreaterThan(0.95);
    expect(upright.nearOutline).toBeGreaterThan(0.9);
    card.x = 400;
    clock.advance(16);
    expect(flames?.matrix?.[4]).toBe(400);
    // Turned upside down, screen-up is local +y: new particles move toward local +y.
    card.rotation = 180;
    clock.advance(800, { frameMs: 16 });
    let down = 0;
    let alive = 0;
    for (let i = 0; i < (flames?.count ?? 0); i++) {
      if (flames?.alive[i] !== 1) continue;
      alive++;
      if ((flames.vy[i] ?? 0) > 0) down++;
    }
    expect(down / alive).toBeGreaterThan(0.95);
  });

  it('reconfigures its emitters in place while the target scales, so particles never pile up', () => {
    const liveSparks = (engine: Engine) => emitters(engine).filter((e) => e.look === 'spark').reduce((n, e) => n + e.aliveCount, 0);
    const steady = setup();
    steady.engine.play('fire-border', { target: steady.card, sparkDensity: 2 });
    steady.clock.advance(1500, { frameMs: 16 });
    const baseline = liveSparks(steady.engine);
    expect(baseline).toBeGreaterThan(5);

    const scaling = setup();
    scaling.engine.play('fire-border', { target: scaling.card, sparkDensity: 2 });
    scaling.clock.advance(1000, { frameMs: 16 });
    let peak = 0;
    for (let i = 0; i < 31; i++) {
      scaling.card.scale = 1 + i * 0.012;
      scaling.clock.advance(16);
      peak = Math.max(peak, liveSparks(scaling.engine));
      // Still one spark emitter: nothing is recreated or left draining.
      expect(emitters(scaling.engine).filter((e) => e.look === 'spark').length).toBeLessThanOrEqual(1);
    }
    // A bigger outline emits proportionally more (perimeter × 1.36 at most), never a pile-up.
    expect(peak).toBeLessThan(baseline * 1.36 * 1.6);
    // And the sparks are now born on the scaled outline (half width 50 × 1.36 = 68).
    scaling.clock.advance(1200, { frameMs: 16 });
    const sparks = emitters(scaling.engine).find((e) => e.look === 'spark');
    let far = 0;
    for (let i = 0; i < (sparks?.count ?? 0); i++) if (sparks?.alive[i] === 1 && Math.abs((sparks.x[i] ?? 0) - 200) > 58) far++;
    expect(far).toBeGreaterThan(0);
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
