import { builtInEffects } from '../effects';
import type { ParticleEmitter } from '../particles/emitter';
import { VirtualClock } from '../runtime/clock';
import type { Drawable } from '../runtime/effect';
import { applyToPoint, multiply } from '../scene/matrix';
import type { Matrix2D } from '../scene/matrix';
import type { SceneNode } from '../scene/node';
import { isSceneDrawable } from '../scene/scene';
import { createEngine } from './engine';
import type { EngineOptions } from './engine';
import { anchoredTo, localLayerMatrix, localOverflow, overlayDrawables } from './localLayers';

function setup(options: Partial<EngineOptions> = {}) {
  const clock = new VirtualClock(0);
  const engine = createEngine({ clock, effects: builtInEffects, seed: 4, ...options });
  const node = engine.targets.register('card');
  engine.targets.updateWindowLayout('card', { x: 100, y: 200, width: 80, height: 120 });
  return { clock, engine, node };
}

const shaderFlames = (ds: readonly Drawable[]) => ds.filter(isSceneDrawable).filter((d) => d.items[0]?.shape.type === 'rect');
const particles = (ds: readonly Drawable[]) => ds.filter((d) => d.kind === 'particles') as ParticleEmitter[];
const round = (m: Matrix2D | null) => m?.map((v) => Math.round(v * 1e6) / 1e6 + 0);

describe('anchored drawables (what moves rigidly with a target)', () => {
  it('fire-border: shader and particle flames are anchored to the target, sparks are not', () => {
    const { clock, engine, node } = setup();
    engine.attach('card', { effect: 'fire-border', sparks: true });
    clock.advance(400, { frameMs: 16 });
    expect(shaderFlames(engine.drawables)).toHaveLength(1);
    expect(shaderFlames(engine.drawables)[0]?.anchor).toBe(node);
    const sparks = particles(engine.drawables);
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks.every((p) => p.anchor === undefined && p.matrix === undefined)).toBe(true);

    const low = setup({ quality: 'low' });
    low.engine.attach('card', { effect: 'fire-border', sparks: true });
    low.clock.advance(400, { frameMs: 16 });
    const flames = particles(low.engine.drawables).filter((p) => p.matrix !== undefined);
    expect(flames.length).toBe(1);
    expect(flames[0]?.anchor).toBe(low.node);
  });

  it('glow-pulse, glow-border and energy-border following a target are anchored; fixed placements are not', () => {
    const { clock, engine, node } = setup();
    engine.attach('card', 'glow-pulse', {});
    engine.attach('card', 'glow-border', {});
    engine.attach('card', 'energy-border', {});
    engine.play('glow-pulse', { target: 'card', follow: false });
    engine.play('glow-pulse', { position: { x: 10, y: 10 } });
    clock.advance(50, { frameMs: 16 });
    const anchored = anchoredTo(engine.drawables, node);
    // Two shapes per pulse (outline and inner line), one per border.
    expect(anchored).toHaveLength(4);
    expect(engine.drawables.filter((d) => d.anchor === undefined && d.kind === 'scene')).toHaveLength(4);
  });

  it('particles that follow a target are anchored in local space only', () => {
    const { clock, engine, node } = setup();
    engine.play('particles', { target: 'card', space: 'local', rate: 50, lifetime: 1000 });
    engine.play('particles', { target: 'card', space: 'world', rate: 50, lifetime: 1000 });
    engine.play('particles', { target: 'card', space: 'local', follow: false, rate: 50, lifetime: 1000 });
    clock.advance(200, { frameMs: 16 });
    const emitters = particles(engine.drawables);
    expect(emitters.map((e) => e.anchor === node)).toEqual([true, false, false]);
  });

  it('an anchor is dropped when the target goes, so nothing is drawn for a missing view', () => {
    const { clock, engine, node } = setup({ quality: 'low' });
    engine.attach('card', { effect: 'fire-border', sparks: false });
    clock.advance(200, { frameMs: 16 });
    expect(anchoredTo(engine.drawables, node).length).toBe(1);
    engine.targets.unregister('card');
    clock.advance(16);
    expect(engine.drawables.some((d) => d.anchor === node)).toBe(false);
  });
});

describe('overlay vs local layer', () => {
  it('the overlay leaves out exactly the drawables of targets with an active local layer', () => {
    const { clock, engine, node } = setup();
    const other = engine.targets.register('other');
    engine.targets.updateWindowLayout('other', { x: 0, y: 0, width: 40, height: 40 });
    engine.attach('card', { effect: 'fire-border' });
    engine.attach('other', 'glow-pulse', {});
    engine.play('confetti', { position: { x: 50, y: 50 } });
    clock.advance(100, { frameMs: 16 });
    const all = engine.drawables;
    expect(overlayDrawables(all, engine.targets)).toBe(all);
    engine.targets.setLocalLayer('card', true);
    expect(engine.targets.drawsLocally(node)).toBe(true);
    expect(engine.targets.localLayerCount).toBe(1);
    const overlay = overlayDrawables(all, engine.targets);
    expect(overlay.some((d) => d.anchor === node)).toBe(false);
    expect(overlay.filter((d) => d.anchor === other)).toHaveLength(2);
    // Sparks and confetti stay in the overlay.
    expect(overlay.length).toBe(all.length - anchoredTo(all, node).length);
    engine.targets.setLocalLayer('card', false);
    expect(overlayDrawables(all, engine.targets)).toBe(all);
    engine.targets.setLocalLayer('card', true);
    engine.targets.unregister('card');
    expect(engine.targets.localLayerCount).toBe(0);
    engine.targets.setLocalLayer('missing', true);
    expect(engine.targets.localLayerCount).toBe(0);
  });
});

describe('localLayerMatrix', () => {
  it("maps the target's box to the layer's coordinates whatever the motion, rotation and scale", () => {
    const { engine, node } = setup();
    const corner = (n: SceneNode, x: number, y: number) => n.localToWorld({ x, y });
    const check = () => {
      const m = localLayerMatrix(node, -24, -30);
      if (!m) throw new Error('not invertible');
      // Top-left and bottom-right of the 80 × 120 view, in a layer starting 24/30 pt outside it.
      const tl = applyToPoint(m, corner(node, -40, -60));
      const br = applyToPoint(m, corner(node, 40, 60));
      expect([tl.x, tl.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([24, 30]);
      expect([br.x, br.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([104, 150]);
      return round(multiply(m, node.worldMatrix));
    };
    const still = check();
    const motion = engine.targets.motion('card');
    if (!motion) throw new Error('no motion');
    motion.x = 60;
    motion.y = -35;
    motion.rotation = 137;
    motion.scale = 1.4;
    // The layer content does not depend on the transform: the platform applies it to the view.
    expect(check()).toEqual(still);
    motion.scale = 0;
    expect(localLayerMatrix(node, 0, 0)).toBeNull();
  });
});

describe('localOverflow', () => {
  it('measures how far fire reaches beyond the view, in its local units, independent of rotation', () => {
    const { clock, engine, node } = setup();
    engine.attach('card', { effect: 'fire-border', flameHeight: 20, padding: 2, sparks: false });
    clock.advance(100, { frameMs: 16 });
    const anchored = anchoredTo(engine.drawables, node);
    // The flame shader rect reaches padding + 1.8 × flameHeight + 4, plus the glow (1.5 × 0.6 × 20).
    const expected = 2 + 20 * 1.8 + 4 + 1.5 * 12;
    expect(localOverflow(anchored, node)).toBeCloseTo(expected, 6);
    const motion = engine.targets.motion('card');
    if (!motion) throw new Error('no motion');
    motion.rotation = 33;
    motion.x = 50;
    clock.advance(16);
    expect(localOverflow(anchoredTo(engine.drawables, node), node)).toBeCloseTo(expected, 6);
    expect(localOverflow([], node)).toBe(0);
  });

  it('includes local particles with their size', () => {
    const { clock, engine, node } = setup({ quality: 'low' });
    engine.attach('card', { effect: 'fire-border', flameHeight: 30, sparks: false });
    clock.advance(300, { frameMs: 16 });
    const overflow = localOverflow(anchoredTo(engine.drawables, node), node);
    // Particle flames rise up to about speed × lifetime beyond the outline (66 pt/s × 0.52 s ≈ 34 pt).
    expect(overflow).toBeGreaterThan(5);
    expect(overflow).toBeLessThan(80);
  });
});
