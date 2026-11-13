/**
 * Phase 4 effects drawn by the real Skia renderer (CanvasKit, CPU raster, provided by
 * `@shopify/react-native-skia/jestEnv.js`). Pixels are read back from a real surface.
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import type { SkSurface } from '@shopify/react-native-skia';
import { builtInEffects } from '../../effects';
import { createEngine } from '../../engine/engine';
import type { Engine } from '../../engine/engine';
import { displacementShader, flameBorderShader } from '../../graphics/shaderLib';
import { ParticleEmitter } from '../../particles/emitter';
import type { EmitterConfig } from '../../particles/emitter';
import { VirtualClock } from '../../runtime/clock';
import { createRandom } from '../../runtime/rng';
import { composeTransform } from '../../scene/matrix';
import { Scene } from '../../scene/scene';
import { SkiaEffectsRenderer } from './SkiaEffectsRenderer';
import type { RendererWarning } from './SkiaEffectsRenderer';

const W = 200;
const H = 200;

function makeSurface(): SkSurface {
  const surface = Skia.Surface.Make(W, H);
  if (!surface) throw new Error('Could not create a CanvasKit surface');
  return surface;
}

function pixels(surface: SkSurface): Uint8Array {
  surface.flush();
  const out = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!out) throw new Error('readPixels failed');
  return out as Uint8Array;
}

const at = (data: Uint8Array, x: number, y: number): number[] => Array.from(data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
const coverage = (data: Uint8Array): number => {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 8) n++;
  return n;
};

/** One particle, standing still at (100, 100) unless the config moves it. */
function single(config: Partial<EmitterConfig>, elapsed = 10): ParticleEmitter {
  const emitter = new ParticleEmitter(
    { bursts: [{ count: 1 }], speed: 0, lifetime: 10_000, size: 12, colors: ['#FF0000'], shape: { type: 'point' }, ...config },
    createRandom(3),
    { transform: composeTransform(100, 100, 0, 1, 1) },
  );
  emitter.update(elapsed);
  return emitter;
}

function draw(renderer: SkiaEffectsRenderer, drawables: Parameters<SkiaEffectsRenderer['draw']>[1]): Uint8Array {
  const surface = makeSurface();
  renderer.draw(surface.getCanvas(), drawables);
  return pixels(surface);
}

describe('particle looks', () => {
  const renderer = new SkiaEffectsRenderer(Skia);

  it('circle and square (rotated, with aspect)', () => {
    const circle = draw(renderer, [single({})]);
    expect(at(circle, 100, 100)).toEqual([255, 0, 0, 255]);
    expect(at(circle, 100 + 9, 100 + 9)[3]).toBe(0); // outside the radius-12 disc diagonal
    // A 6 × 24 strip (aspect 0.25) rotated by 90°: wide and flat.
    const upright = draw(renderer, [single({ look: 'square', aspect: 0.25 })]);
    expect(at(upright, 100, 110)[0]).toBe(255);
    expect(at(upright, 110, 100)[3]).toBe(0);
    const square = draw(renderer, [single({ look: 'square', aspect: 0.25, rotation: 90 })]);
    expect(at(square, 110, 100)[0]).toBe(255);
    expect(at(square, 100, 110)[3]).toBe(0);
  });

  it('spark: a streak along the velocity, ring: an outline with an empty centre', () => {
    const spark = draw(renderer, [single({ look: 'spark', speed: 400, direction: 0, spread: 0, stretch: 0.05, size: 3 }, 1)]);
    // Moving right at 400 pt/s: the streak reaches back 20 pt behind the head.
    const head = 100 + 0.4;
    expect(at(spark, Math.round(head - 10), 100)[3]).toBeGreaterThan(200);
    expect(at(spark, 100, 110)[3]).toBe(0);
    const ring = draw(renderer, [single({ look: 'ring', size: 20 })]);
    expect(at(ring, 100, 100)[3]).toBe(0);
    expect(at(ring, 120, 100)[3]).toBeGreaterThan(100);
  });

  it('soft: a blurred disc (bright centre, soft edge)', () => {
    const soft = draw(renderer, [single({ look: 'soft', size: 20 })]);
    const centre = at(soft, 100, 100)[3] ?? 0;
    const edge = at(soft, 114, 100)[3] ?? 0;
    expect(centre).toBeGreaterThan(200);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(centre);
  });

  it('per-particle colors over life and additive blending', () => {
    const fading = draw(renderer, [single({ colorOverLife: ['#00FF00', '#0000FF'], lifetime: 1000 }, 500)]);
    const [r, g, b] = at(fading, 100, 100);
    expect(r).toBe(0);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
    const plus = draw(renderer, [single({ colors: ['#800000'] }), single({ colors: ['#800000'], blendMode: 'plus' })]);
    expect(at(plus, 100, 100)[0]).toBeGreaterThan(250);
  });

  it('local-space emitters draw under their transform', () => {
    const emitter = new ParticleEmitter({ bursts: [{ count: 1 }], speed: 0, lifetime: 1000, size: 6, colors: ['#00FF00'], space: 'local' }, createRandom(1), {
      transform: composeTransform(40, 160, 0, 1, 1),
    });
    emitter.update(10);
    const data = draw(renderer, [emitter]);
    expect(at(data, 40, 160)[1]).toBe(255);
    emitter.setTransform(composeTransform(150, 30, 0, 1, 1));
    emitter.update(20);
    const moved = draw(renderer, [emitter]);
    expect(at(moved, 150, 30)[1]).toBe(255);
    expect(at(moved, 40, 160)[3]).toBe(0);
  });

  it('image particles draw through one drawAtlas call', () => {
    const surface = Skia.Surface.Make(2, 2);
    if (!surface) throw new Error('surface');
    const paint = Skia.Paint();
    paint.setColor(Skia.Color('#0000FF'));
    surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 2, 2), paint);
    surface.flush();
    const native = surface.makeImageSnapshot();
    const engine = createEngine({ clock: new VirtualClock() });
    const image = engine.assets.addImage('dot', { native, width: 2, height: 2 });
    const emitter = single({ look: { type: 'image', image }, size: 8, colors: ['#FFFFFF'] });
    const data = draw(new SkiaEffectsRenderer(Skia), [emitter]);
    expect(at(data, 100, 100).slice(0, 3)).toEqual([0, 0, 255]);
    expect(at(data, 120, 100)[3]).toBe(0);
    engine.dispose();
  });
});

describe('Phase 4 effects through the engine', () => {
  function engineWith(): { engine: Engine; clock: VirtualClock } {
    const clock = new VirtualClock(0);
    const engine = createEngine({ clock, effects: builtInEffects, seed: 4 });
    return { engine, clock };
  }

  it('fire-border (shader): flames around the outline, transparent inside, orange-yellow colors', () => {
    const { engine, clock } = engineWith();
    const warnings: RendererWarning[] = [];
    const renderer = new SkiaEffectsRenderer(Skia, (w) => warnings.push(w));
    engine.setRendererCapabilities(renderer.capabilities);
    const card = engine.scene.createNode({ x: 100, y: 100, size: { width: 80, height: 100 } });
    const handle = engine.play('fire-border', { target: card, flameHeight: 22, intensity: 1.2, sparks: false, glow: false, padding: 0 });
    clock.advance(500, { frameMs: 16 });
    const data = draw(renderer, engine.drawables);
    expect(warnings).toEqual([]);
    // Inside the card: nothing (the host view shows through).
    expect(at(data, 100, 100)[3]).toBe(0);
    // A band just outside the outline is lit on every side.
    const band = (x0: number, y0: number, dx: number, dy: number) => {
      let lit = 0;
      for (let i = 0; i < 20; i++) if ((at(data, x0 + dx * i, y0 + dy * i)[3] ?? 0) > 20) lit++;
      return lit;
    };
    expect(band(70, 47, 3, 0)).toBeGreaterThan(5); // top edge
    expect(band(70, 152, 3, 0)).toBeGreaterThan(5); // bottom edge
    expect(band(57, 70, 0, 3)).toBeGreaterThan(5); // left edge
    expect(band(143, 70, 0, 3)).toBeGreaterThan(5); // right edge
    // Far away: dark.
    expect(at(data, 5, 5)[3]).toBe(0);
    // Warm colors: red ≥ green ≥ blue where lit.
    let warm = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 40) continue;
      lit++;
      if ((data[i] ?? 0) >= (data[i + 1] ?? 0) && (data[i + 1] ?? 0) >= (data[i + 2] ?? 0)) warm++;
    }
    expect(warm / lit).toBeGreaterThan(0.95);
    handle.cancel();
    engine.dispose();
  });

  it('fire-border flames change over time (animated) and with intensity', () => {
    const { engine, clock } = engineWith();
    const renderer = new SkiaEffectsRenderer(Skia);
    const card = engine.scene.createNode({ x: 100, y: 100, size: { width: 80, height: 80 } });
    const handle = engine.play('fire-border', { target: card, sparks: false, glow: false, intensity: 0.5 });
    clock.advance(100, { frameMs: 16 });
    const a = draw(renderer, engine.drawables);
    clock.advance(400, { frameMs: 16 });
    const b = draw(renderer, engine.drawables);
    let changed = 0;
    for (let i = 3; i < a.length; i += 4) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 30) changed++;
    expect(changed).toBeGreaterThan(200);
    handle.setIntensity(1.8);
    clock.advance(16);
    expect(coverage(draw(renderer, engine.drawables))).toBeGreaterThan(coverage(b) * 1.2);
    engine.dispose();
  });

  it('compiles each shader source once, however many borders and frames', () => {
    const { engine, clock } = engineWith();
    const renderer = new SkiaEffectsRenderer(Skia);
    renderer.precompile([flameBorderShader, displacementShader]);
    expect(renderer.shaderStats).toEqual({ compiles: 2, cached: 2 });
    for (let i = 0; i < 5; i++) {
      const node = engine.scene.createNode({ x: 30 + i * 35, y: 100, size: { width: 20, height: 30 } });
      engine.play('fire-border', { target: node, heatHaze: true, sparks: false });
    }
    for (let f = 0; f < 10; f++) {
      clock.advance(16);
      draw(renderer, engine.drawables);
    }
    expect(renderer.shaderStats).toEqual({ compiles: 2, cached: 2 });
    engine.dispose();
  });

  it('distort node effect displaces a layer with the noise shader', () => {
    const scene = new Scene();
    const warnings: RendererWarning[] = [];
    const renderer = new SkiaEffectsRenderer(Skia, (w) => warnings.push(w));
    const stripes = scene.createNode({ x: 100, y: 100 });
    for (let i = 0; i < 10; i++) scene.createNode({ parent: stripes, x: -90 + i * 20, y: 0, shape: { type: 'rect', width: 10, height: 180, color: '#FFFFFF' } });
    const plain = draw(renderer, [scene.drawable(0)]);
    stripes.effects = [{ type: 'distort', amount: 8, frequency: 0.08 }];
    const wavy = draw(renderer, [scene.drawable(300)]);
    expect(warnings).toEqual([]);
    let differ = 0;
    for (let i = 3; i < plain.length; i += 4) if (Math.abs((plain[i] ?? 0) - (wavy[i] ?? 0)) > 100) differ++;
    expect(differ).toBeGreaterThan(500);
  });

  it('explosion draws flash, ring and sparks; the camera offset moves the recorded picture', () => {
    const { engine, clock } = engineWith();
    const renderer = new SkiaEffectsRenderer(Skia);
    engine.play('explosion', { position: { x: 100, y: 100 }, radius: 60 });
    clock.advance(80, { frameMs: 16 });
    const data = draw(renderer, engine.drawables);
    expect(coverage(data)).toBeGreaterThan(2000);
    const [r, g] = at(data, 100, 100);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);

    const scene = new Scene();
    scene.createNode({ x: 50, y: 50, shape: { type: 'rect', width: 10, height: 10, color: '#00FF00' } });
    const picture = renderer.record([scene.drawable()], undefined, { x: 30, y: 0, rotation: 0 });
    const surface = makeSurface();
    surface.getCanvas().drawPicture(picture);
    const shifted = pixels(surface);
    expect(at(shifted, 80, 50)[1]).toBe(255);
    expect(at(shifted, 50, 50)[3]).toBe(0);
    engine.dispose();
  });
});
