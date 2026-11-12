import { createEngine } from '../engine/engine';
import { energyShader, fireShader } from '../graphics/shader';
import { VirtualClock } from '../runtime/clock';
import type { SceneNode } from '../scene/node';
import type { SceneDrawable } from '../scene/scene';
import { energyBorder, fireBorder, glowBorder } from './border';

function setup() {
  const clock = new VirtualClock();
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: [glowBorder, energyBorder, fireBorder], onError: (e) => errors.push(e) });
  const target = engine.scene.createNode({ x: 100, y: 100, size: { width: 60, height: 40 } });
  return { clock, engine, target, errors };
}

function borderOf(engine: ReturnType<typeof createEngine>): SceneDrawable | undefined {
  return engine.drawables.find((d): d is SceneDrawable => d.kind === 'scene' && (d as SceneDrawable).items[0]?.nodeId === -1);
}

describe('border effects', () => {
  it('outlines the target and follows its position, rotation and scale every frame', () => {
    const { clock, engine, target } = setup();
    engine.play('glow-border', { target, padding: 5, pulse: 0 });
    clock.advance(16);
    let border = borderOf(engine);
    expect(border?.commands.map((c) => c.op)).toEqual(['begin-group', 'draw', 'end-group']);
    expect(border?.items[0]?.shape).toMatchObject({ type: 'rect', width: 70, height: 50 });
    expect(border?.items[0]?.matrix).toEqual([1, 0, -0, 1, 100, 100]);
    target.x = 200;
    target.rotation = 90;
    target.scale = 2;
    clock.advance(16);
    border = borderOf(engine);
    // Scale enlarges the outline but not its line width.
    expect(border?.items[0]?.shape).toMatchObject({ type: 'rect', width: 130, height: 90, stroke: { width: 3 } });
    const m = border?.items[0]?.matrix ?? [];
    expect(m[4]).toBe(200);
    expect(m[0]).toBeCloseTo(0, 10);
    expect(m[1]).toBeCloseTo(1, 10);
  });

  it('pulses the glow with engine time', () => {
    const { clock, engine, target } = setup();
    engine.play('glow-border', { target, pulse: 1, radius: 10 });
    const radii: number[] = [];
    for (let i = 0; i < 4; i++) {
      clock.advance(250);
      const group = borderOf(engine)?.commands[0];
      if (group?.op === 'begin-group' && group.effects[0]?.type === 'glow') radii.push(Math.round(group.effects[0].radius * 10) / 10);
    }
    expect(radii).toEqual([10, 8, 6, 8]);
  });

  it('hides while the target is hidden or out of the scene, and ends when it is destroyed', async () => {
    const { clock, engine, target } = setup();
    const handle = engine.play('energy-border', { target });
    clock.advance(16);
    expect(borderOf(engine)).toBeDefined();
    target.visible = false;
    clock.advance(16);
    expect(borderOf(engine)).toBeUndefined();
    target.visible = true;
    target.removeFromParent();
    clock.advance(16);
    expect(borderOf(engine)).toBeUndefined();
    engine.scene.root.addChild(target);
    clock.advance(16);
    expect(borderOf(engine)).toBeDefined();
    target.destroy();
    clock.advance(16);
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.scene.attachmentCount).toBe(0);
  });

  it('stops after its duration and detaches when cancelled', async () => {
    const { clock, engine, target } = setup();
    const timed = engine.play('glow-border', { target, duration: 100 });
    const cancelled = engine.play('fire-border', { target, intensity: 2 });
    expect(engine.scene.attachmentCount).toBe(2);
    clock.advance(120);
    await expect(timed.finished).resolves.toEqual({ status: 'completed' });
    cancelled.cancel();
    expect(engine.scene.attachmentCount).toBe(0);
  });

  it('fills the line with the chosen shader and maps intensity to its uniform', () => {
    const { clock, engine, target } = setup();
    engine.play('fire-border', { target, intensity: 1.5, glowColor: '#FF8800' });
    engine.play('energy-border', { target, intensity: 3 });
    clock.advance(16);
    const borders = engine.drawables.filter((d): d is SceneDrawable => d.kind === 'scene' && (d as SceneDrawable).items[0]?.nodeId === -1);
    const [fire, energy] = borders.map((b) => b.items[0]?.shape);
    expect(fire).toMatchObject({ stroke: { fill: { type: 'shader', shader: fireShader, uniforms: { intensity: 1.5 } } } });
    expect(energy).toMatchObject({ stroke: { fill: { type: 'shader', shader: energyShader, uniforms: { speed: 3 } } } });
    expect(borders[0]?.commands[0]).toMatchObject({ op: 'begin-group', effects: [{ type: 'glow', color: '#FF8800' }] });
    expect(borders[1]?.commands.map((c) => c.op)).toEqual(['draw']);
  });

  it('validates parameters before attaching', () => {
    const { engine, target } = setup();
    expect(() => engine.play('glow-border', { target: {} as SceneNode })).toThrow('target scene node');
    expect(() => engine.play('glow-border', { target, padding: -1 })).toThrow('padding');
    expect(() => engine.play('glow-border', { target, width: 0 })).toThrow('width');
    expect(() => engine.play('energy-border', { target, uniforms: { nope: 1 } })).toThrow('no uniform');
    expect(() => engine.play('glow-border', { target, duration: 0 })).toThrow('duration');
    target.destroy();
    expect(() => engine.play('glow-border', { target })).toThrow('destroyed');
    expect(engine.scene.attachmentCount).toBe(0);
  });
});
