import type { LoadedImage } from '../assets/assets';
import { createEngine } from '../engine/engine';
import type { Engine } from '../engine/engine';
import { ParticleEmitter } from '../particles/emitter';
import { VirtualClock } from '../runtime/clock';
import type { Drawable } from '../runtime/effect';
import { isSceneDrawable } from '../scene/scene';
import type { SceneDrawable } from '../scene/scene';
import { builtInEffects } from './index';
import { BurnAwayInstance, burnField, burnFront, burnGeometry, burnNoise, burnProgress, burnRange } from './burnAway';
import type { BurnAwayParams } from './burnAway';

const CARD = { x: 100, y: 200, width: 96, height: 136 };
const PICTURE: LoadedImage = { native: { picture: true }, width: 192, height: 272 };

/** Lets promise callbacks (the snapshot) run. */
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function setup(options: { snapshot?: 'ok' | 'none' | 'reject' | 'never'; quality?: 'low' | 'medium' | 'high'; reducedMotion?: boolean; seed?: number } = {}) {
  const clock = new VirtualClock(0);
  const released: unknown[] = [];
  const engine = createEngine({
    clock,
    effects: builtInEffects,
    seed: options.seed ?? 3,
    quality: options.quality ?? 'high',
    reducedMotion: options.reducedMotion ?? false,
    assets: { loader: { load: () => Promise.reject(new Error('unused')), release: (n) => released.push(n) } },
  });
  engine.targets.register('card');
  engine.targets.updateWindowLayout('card', CARD);
  const snapshot = options.snapshot ?? 'ok';
  let calls = 0;
  if (snapshot !== 'none') {
    engine.targets.setSnapshotter('card', () => {
      calls++;
      if (snapshot === 'reject') return Promise.reject(new Error('no picture'));
      if (snapshot === 'never') return new Promise<LoadedImage>(() => undefined);
      return Promise.resolve(PICTURE);
    });
  }
  const step = (ms: number) => {
    clock.advance(ms, { frameMs: 16 });
  };
  return { clock, engine, released, step, snapshotCalls: () => calls };
}

const scenes = (engine: Engine): SceneDrawable[] => engine.drawables.filter(isSceneDrawable);
const shaderNames = (engine: Engine): string[] =>
  scenes(engine).flatMap((d) => d.items.map((i) => (i.shape.type === 'rect' && typeof i.shape.fill === 'object' && i.shape.fill.type === 'shader' ? i.shape.fill.shader.name : i.shape.type)));
const particles = (engine: Engine): ParticleEmitter[] => engine.drawables.filter((d: Drawable): d is ParticleEmitter => d instanceof ParticleEmitter);
const instanceOf = (engine: Engine): BurnAwayInstance => {
  const found = (engine as unknown as { active: { instance: unknown }[] }).active.find((a) => a.instance instanceof BurnAwayInstance);
  if (!found) throw new Error('no burn-away instance');
  return found.instance as BurnAwayInstance;
};

describe('burn-away edge geometry', () => {
  it('raggedness stays within ±0.5 and repeats for a seed', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < 300; x += 7) {
      for (let y = 0; y < 300; y += 5) {
        const n = burnNoise(x, y, 4.2);
        min = Math.min(min, n);
        max = Math.max(max, n);
      }
    }
    expect(min).toBeGreaterThanOrEqual(-0.5);
    expect(max).toBeLessThanOrEqual(0.5);
    expect(max - min).toBeGreaterThan(0.5);
    expect(burnNoise(13, 27, 4.2)).toBe(burnNoise(13, 27, 4.2));
    expect(burnNoise(13, 27, 4.2)).not.toBe(burnNoise(13, 27, 1.3));
  });

  it('places the start on the requested edge, corner, centre or point', () => {
    const at = (from: Parameters<typeof burnGeometry>[2]) => burnGeometry(100, 140, from, 0.5, 1);
    expect(at('bottom')).toMatchObject({ radial: false, origin: { x: 0, y: 140 }, dir: { x: 0, y: -1 }, extent: 140 });
    expect(at('left')).toMatchObject({ radial: false, dir: { x: 1, y: 0 }, extent: 100 });
    expect(at('center')).toMatchObject({ radial: true, origin: { x: 50, y: 70 } });
    expect(at('top-right').origin).toEqual({ x: 100, y: 0 });
    expect(at('top-right').extent).toBeCloseTo(Math.hypot(100, 140));
    expect(at({ x: 0.25, y: 1 }).origin).toEqual({ x: 25, y: 140 });
    expect(at('bottom').amp).toBeGreaterThan(0);
    expect(burnGeometry(100, 140, 'bottom', 0, 1).amp).toBe(0);
    // `random` starts somewhere on the outline.
    let seed = 0.1;
    for (let i = 0; i < 20; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280;
      const g = burnGeometry(100, 140, 'random', 0.5, 1, { next: () => r, int: () => 0, range: () => 0, pick: () => undefined } as never);
      const { x, y } = g.origin;
      const onOutline = x === 0 || x === 100 || y === 0 || y === 140;
      expect(onOutline && x >= 0 && x <= 100 && y >= 0 && y <= 140).toBe(true);
    }
  });

  it('moves the edge from before the target to past it, slowly at first', () => {
    const g = burnGeometry(96, 136, 'bottom', 0.6, 2);
    const { start, end } = burnRange(g, 14);
    expect(start).toBeLessThan(-14);
    expect(end).toBeGreaterThan(136);
    expect(burnProgress(0, start, end)).toBe(start);
    expect(burnProgress(1, start, end)).toBe(end);
    expect(burnProgress(2, start, end)).toBe(end);
    let last = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const p = burnProgress(t, start, end);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    // Catching: a quarter of the time covers well under a quarter of the way.
    expect((burnProgress(0.25, start, end) - start) / (end - start)).toBeLessThan(0.12);
  });

  it('finds the ragged edge the shader draws, inside the target', () => {
    for (const from of ['bottom', 'right', 'center', 'top-left'] as const) {
      const g = burnGeometry(96, 136, from, 0.8, 5);
      const progress = g.extent * 0.45;
      const runs = burnFront(g, progress);
      const points = runs.flat();
      expect(points.length).toBeGreaterThan(5);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(96);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(136);
        // On the edge: the field equals the progress there (to a fraction of a point).
        expect(Math.abs(burnField(g, p.x, p.y) - progress)).toBeLessThan(0.05);
      }
    }
    // Before the fire reaches the target there is no edge inside it.
    const g = burnGeometry(96, 136, 'bottom', 0.6, 5);
    expect(burnFront(g, burnRange(g, 14).start)).toEqual([]);
  });
});

describe('burn-away effect', () => {
  it('waits for the snapshot, draws it over the view, then conceals the view', async () => {
    const { engine, step, snapshotCalls } = setup();
    const handle = engine.play('burn-away', { target: 'card', duration: 1000 });
    expect(snapshotCalls()).toBe(1);
    expect(instanceOf(engine).kind).toBe('waiting');
    step(16);
    expect(engine.drawables).toHaveLength(0);
    expect(engine.targets.concealOpacity('card')).toBe(1);
    await flush();
    expect(instanceOf(engine).kind).toBe('image');
    step(16);
    expect(shaderNames(engine)).toEqual(['burn-paper', 'burn-glow']);
    // The picture is the snapshot, stretched over the view's box.
    const paper = scenes(engine)[0]?.items[0];
    const fill = paper?.shape.type === 'rect' ? paper.shape.fill : undefined;
    expect(typeof fill === 'object' && fill.type === 'shader' ? fill.children?.image?.image.native : null).toBe(PICTURE.native);
    // Two frames of overlap, then the real view is hidden (the picture stands in for it).
    expect(engine.targets.concealOpacity('card')).toBe(1);
    step(16);
    step(16);
    expect(engine.targets.concealOpacity('card')).toBe(0);
    expect(engine.getTarget('card')?.motion.opacity).toBe(1);
    expect(handle.status).toBe('playing');
  });

  it('ends with the view hidden by its motion and frees the snapshot', async () => {
    const { engine, step, released } = setup();
    const handle = engine.play('burn-away', { target: 'card', duration: 800 });
    await flush();
    step(400);
    expect(engine.assets.stats.loaded).toBe(1);
    step(450);
    // Burned: hidden for good, no longer concealed.
    const motion = engine.getTarget('card')?.motion;
    expect(motion?.opacity).toBe(0);
    expect(engine.targets.concealOpacity('card')).toBe(1);
    expect(shaderNames(engine)).toEqual(['burn-glow']);
    step(3000);
    const result = await handle.finished;
    expect(result.status).toBe('completed');
    expect(engine.activeCount).toBe(0);
    expect(engine.assets.stats.loaded).toBe(0);
    expect(released).toEqual([PICTURE.native]);
    // The app brings the view back the usual way.
    if (motion) motion.opacity = 1;
    expect(engine.targets.viewTransform('card')?.opacity).toBe(1);
  });

  it('cancel and stop show the view again, unchanged, at any moment', async () => {
    for (const end of ['cancel', 'stop'] as const) {
      const { engine, step, released } = setup();
      const handle = engine.play('burn-away', { target: 'card' });
      await flush();
      step(600);
      expect(engine.targets.concealOpacity('card')).toBe(0);
      handle[end]();
      expect(engine.targets.concealOpacity('card')).toBe(1);
      expect(engine.getTarget('card')?.motion.opacity).toBe(1);
      expect((await handle.finished).status).toBe('cancelled');
      expect(engine.drawables).toHaveLength(0);
      expect(released).toEqual([PICTURE.native]);
    }
  });

  it('cancelled while waiting for the snapshot frees it when it arrives', async () => {
    const { engine, released } = setup();
    const handle = engine.play('burn-away', { target: 'card' });
    handle.cancel();
    await flush();
    expect(released).toEqual([PICTURE.native]);
    expect(engine.assets.stats.loaded).toBe(0);
    expect(engine.targets.concealOpacity('card')).toBe(1);
  });

  it('chars and fades the view when no picture can be taken', async () => {
    for (const snapshot of ['none', 'reject', 'never'] as const) {
      const { engine, step } = setup({ snapshot });
      engine.play('burn-away', { target: 'card', duration: 1000 });
      await flush();
      step(snapshot === 'never' ? 820 : 16);
      expect(instanceOf(engine).kind).toBe('char');
      expect(shaderNames(engine)).toEqual(['burn-char', 'burn-glow']);
      // Drawn over the visible view: anchored, so a local layer draws it inside the view.
      expect(scenes(engine)[0]?.anchor).toBe(engine.targets.node('card'));
      expect(engine.targets.concealOpacity('card')).toBe(1);
      step(800);
      const fading = engine.targets.concealOpacity('card');
      expect(fading).toBeGreaterThan(0);
      expect(fading).toBeLessThan(1);
      step(400);
      expect(engine.getTarget('card')?.motion.opacity).toBe(0);
      expect(engine.targets.concealOpacity('card')).toBe(1);
    }
  });

  it('burns a scene node’s image and leaves the node invisible', () => {
    const clock = new VirtualClock(0);
    const engine = createEngine({ clock, effects: builtInEffects, seed: 1 });
    const image = engine.assets.addImage('face', { native: { face: true }, width: 64, height: 90 });
    const node = engine.scene.createNode({ x: 100, y: 100, shape: { type: 'image', image, width: 64, height: 90 } });
    const handle = engine.play('burn-away', { target: node, duration: 500 });
    clock.advance(16);
    // The node itself (drawn by the scene), then the effect's passes over it.
    expect(shaderNames(engine)).toEqual(['image', 'burn-paper', 'burn-glow']);
    expect(image.refCount).toBe(2);
    clock.advance(64, { frameMs: 16 });
    // Concealed through its own opacity while the effect draws it.
    expect(node.opacity).toBe(0);
    clock.advance(500, { frameMs: 16 });
    expect(node.visible).toBe(false);
    expect(node.opacity).toBe(1);
    clock.advance(3000, { frameMs: 16 });
    expect(handle.status).toBe('completed');
    expect(image.refCount).toBe(1);
    // Cancelling restores the node exactly.
    node.visible = true;
    const again = engine.play('burn-away', { target: node, duration: 500 });
    clock.advance(200, { frameMs: 16 });
    expect(node.opacity).toBe(0);
    again.cancel();
    expect(node.opacity).toBe(1);
    expect(node.visible).toBe(true);
  });

  it('emits flames, embers, smoke and ash along the edge, scaled by quality', async () => {
    const alive = async (quality: 'low' | 'medium' | 'high', reducedMotion = false) => {
      const { engine, step } = setup({ quality, reducedMotion });
      const handle = engine.play('burn-away', { target: 'card', duration: 1200 });
      await flush();
      step(900);
      const counts = particles(engine).map((p) => p.aliveCount);
      step(4000);
      expect(handle.status).toBe('completed');
      return counts;
    };
    const high = await alive('high');
    const medium = await alive('medium');
    const low = await alive('low');
    const reduced = await alive('high', true);
    expect(high).toHaveLength(4);
    expect(high.every((n) => n > 0)).toBe(true);
    expect(medium).toHaveLength(4);
    // Low and reduced motion: flames and embers only.
    expect(low).toHaveLength(2);
    expect(reduced).toHaveLength(2);
    const total = (c: number[]) => c.reduce((a, b) => a + b, 0);
    expect(total(high)).toBeGreaterThan(total(medium));
    expect(total(medium)).toBeGreaterThan(total(low));
  });

  it('particles are born on the burning edge', async () => {
    const { engine, step } = setup({ quality: 'high' });
    engine.play('burn-away', { target: 'card', duration: 1200, from: 'bottom', smoke: false, ash: false, embers: false });
    await flush();
    step(700);
    const instance = instanceOf(engine);
    const flames = particles(engine)[0];
    expect(flames).toBeDefined();
    if (!flames || !instance.edge) return;
    // Newborn flames sit on the edge of the card (between its sides), not ahead of it.
    let checked = 0;
    for (let i = 0; i < flames.count; i++) {
      if (flames.alive[i] !== 1) continue;
      const x = flames.x[i] ?? 0;
      expect(x).toBeGreaterThan(CARD.x - 25);
      expect(x).toBeLessThan(CARD.x + CARD.width + 25);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('is deterministic for a seed', async () => {
    const run = async () => {
      const { engine, step } = setup({ seed: 9 });
      engine.play('burn-away', { target: 'card', from: 'random' });
      await flush();
      step(700);
      // Live particles only: dead slots of pooled buffers keep stale values.
      return particles(engine).map((p) => Array.from(p.x).filter((_, i) => p.alive[i] === 1).join(','));
    };
    expect(await run()).toEqual(await run());
  });

  it('ends cleanly when the view unmounts mid-burn', async () => {
    const { engine, step } = setup();
    const handle = engine.play('burn-away', { target: 'card' });
    await flush();
    step(500);
    engine.targets.unregister('card');
    step(3000);
    expect(['completed', 'cancelled']).toContain(handle.status);
    expect(engine.activeCount).toBe(0);
  });

  it('runs inside timelines (cue) and follows a moving, rotating target', async () => {
    const { engine, step } = setup();
    const motion = engine.getTarget('card')?.motion;
    if (!motion) throw new Error('motion');
    const tl = engine.timeline().add(engine.cue('burn-away', { target: 'card', duration: 600 }));
    const playback = tl.play();
    step(16);
    await flush();
    step(200);
    motion.x = 40;
    motion.rotation = 30;
    step(16);
    const paper = scenes(engine)[0]?.items[0];
    // The picture is drawn at the moved and rotated view.
    expect(paper?.matrix[4]).toBeCloseTo(CARD.x + CARD.width / 2 + 40);
    expect(Math.atan2(paper?.matrix[1] ?? 0, paper?.matrix[0] ?? 1) * (180 / Math.PI)).toBeCloseTo(30);
    step(3000);
    expect((await playback.finished).status).toBe('completed');
  });

  it('rejects invalid parameters before doing anything', () => {
    const { engine, snapshotCalls } = setup();
    const bad: Partial<BurnAwayParams>[] = [
      { duration: 0 },
      { roughness: 2 },
      { from: 'middle' as never },
      { from: { x: 2, y: 0 } },
      { charWidth: 0 },
      { edgeWidth: 100 },
      { intensity: -1 },
      { color: '' },
      { smoke: 'yes' as never },
      { image: {} as never },
    ];
    for (const params of bad) expect(() => engine.play('burn-away', { target: 'card', ...params })).toThrow('burn-away');
    expect(() => engine.play('burn-away', { target: 'nope' })).toThrow('Unknown target');
    expect(snapshotCalls()).toBe(0);
    expect(engine.activeCount).toBe(0);
  });
});
