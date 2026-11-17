/**
 * Runs the renderer against real Skia (CanvasKit, CPU raster) provided by
 * `@shopify/react-native-skia/jestEnv.js`. Pixels are read back from a real surface.
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import type { SkImage, SkSurface } from '@shopify/react-native-skia';
import { AssetManager } from '../../assets/assets';
import type { ImageAsset } from '../../assets/assets';
import { glowBorder } from '../../effects/border';
import { createEngine } from '../../engine/engine';
import { grayscale } from '../../graphics/effects';
import { PathData } from '../../graphics/path';
import { defineShader, energyShader, fireShader } from '../../graphics/shader';
import { VirtualClock } from '../../runtime/clock';
import { particleBurst } from '../../effects/particleBurst';
import type { ParticleBurstParams } from '../../effects/particleBurst';
import { createRandom } from '../../runtime/rng';
import type { Drawable } from '../../runtime/effect';
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

function pixelAt(surface: SkSurface, x: number, y: number): number[] {
  surface.flush();
  const image = surface.makeImageSnapshot();
  const pixels = image.readPixels(x, y, {
    width: 1,
    height: 1,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul
  });
  if (!pixels) throw new Error('readPixels failed');
  return Array.from(pixels);
}

function burstDrawables(params: Partial<ParticleBurstParams>, elapsed = 0): readonly Drawable[] {
  const instance = particleBurst.create(
    { position: { x: 100, y: 100 }, count: 1, speed: 0, gravity: 0, size: 10, colors: ['#FF0000'], ...params },
    { random: createRandom(1) },
  );
  instance.update(elapsed);
  return instance.drawables;
}

describe('SkiaEffectsRenderer (real Skia via CanvasKit)', () => {
  it('draws a live particle at its position with its color', () => {
    const surface = makeSurface();
    const renderer = new SkiaEffectsRenderer(Skia);
    const stats = renderer.draw(surface.getCanvas(), burstDrawables({}));
    expect(stats).toEqual({ drawnPrimitives: 1, skippedDrawables: 0 });
    const [r, g, b, a] = pixelAt(surface, 100, 100);
    expect([r, g, b]).toEqual([255, 0, 0]);
    expect(a).toBe(255);
    // Outside the 10 pt radius stays transparent.
    expect(pixelAt(surface, 150, 150)[3]).toBe(0);
  });

  it('applies particle opacity', () => {
    const surface = makeSurface();
    const renderer = new SkiaEffectsRenderer(Skia);
    // Opacity goes 1 -> 0 over the lifetime; at half the lifetime it is 0.5.
    renderer.draw(
      surface.getCanvas(),
      burstDrawables({ duration: 1000, minLifetimeRatio: 1, scale: { from: 1, to: 1 } }, 500),
    );
    const alpha = pixelAt(surface, 100, 100)[3] ?? 0;
    expect(alpha).toBeGreaterThan(120);
    expect(alpha).toBeLessThan(135);
  });

  it('draws nothing for expired particles', () => {
    const surface = makeSurface();
    const renderer = new SkiaEffectsRenderer(Skia);
    const stats = renderer.draw(surface.getCanvas(), burstDrawables({ duration: 100 }, 200));
    expect(stats.drawnPrimitives).toBe(0);
    expect(pixelAt(surface, 100, 100)[3]).toBe(0);
  });

  it('records a picture that reproduces the same pixels', () => {
    const surface = makeSurface();
    const renderer = new SkiaEffectsRenderer(Skia);
    const picture = renderer.record(burstDrawables({ position: { x: 40, y: 60 }, colors: ['#00FF00'] }));
    surface.getCanvas().drawPicture(picture);
    expect(pixelAt(surface, 40, 60).slice(0, 3)).toEqual([0, 255, 0]);
  });

  it('skips unsupported drawable kinds and reports each kind once', () => {
    const surface = makeSurface();
    const reported: string[] = [];
    const renderer = new SkiaEffectsRenderer(Skia, (warning) => reported.push(warning.detail));
    const stats = renderer.draw(surface.getCanvas(), [{ kind: 'shader' }, { kind: 'shader' }, ...burstDrawables({})]);
    expect(stats).toEqual({ drawnPrimitives: 1, skippedDrawables: 2 });
    expect(reported).toEqual(['shader']);
    expect(renderer.capabilities.kinds).toEqual(['scene', 'particles']);
  });

  it('draws nothing after dispose', () => {
    const surface = makeSurface();
    const renderer = new SkiaEffectsRenderer(Skia);
    renderer.dispose();
    expect(renderer.draw(surface.getCanvas(), burstDrawables({})).drawnPrimitives).toBe(0);
  });

  it('draws scene shapes under their hierarchical world transforms', () => {
    const scene = new Scene();
    const parent = scene.createNode({ x: 100, y: 100, rotation: 90 });
    // A 60x10 bar along the child's x axis; the parent's 90° rotation makes it vertical.
    scene.createNode({ parent, x: 0, y: 0, shape: { type: 'rect', width: 60, height: 10, color: '#00FF00' } });
    scene.createNode({ x: 30, y: 30, opacity: 0.5, shape: { type: 'circle', radius: 8, color: '#0000FF' } });
    scene.createNode({ x: 170, y: 170, shape: { type: 'rect', width: 20, height: 20, color: '#FF0000', cornerRadius: 4 } });
    const surface = makeSurface();
    const renderer = new SkiaEffectsRenderer(Skia);
    const stats = renderer.draw(surface.getCanvas(), [scene.drawable()]);
    expect(stats).toEqual({ drawnPrimitives: 3, skippedDrawables: 0 });
    expect(pixelAt(surface, 100, 125).slice(0, 3)).toEqual([0, 255, 0]); // inside the rotated bar
    expect(pixelAt(surface, 125, 100)[3]).toBe(0); // where the unrotated bar would be
    const [, , blue, alpha] = pixelAt(surface, 30, 30);
    expect(blue).toBe(255);
    expect(alpha).toBeGreaterThan(120);
    expect(alpha).toBeLessThan(135);
    expect(pixelAt(surface, 170, 170).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixelAt(surface, 160, 160)[3]).toBe(0); // rounded corner cut off
  });

  describe('Phase 3 graphics', () => {
    /** A 4x2 image: left half red, right half blue, as a fake two-frame sprite sheet. */
    function twoFrameImage(): SkImage {
      const surface = Skia.Surface.Make(4, 2);
      if (!surface) throw new Error('surface');
      const canvas = surface.getCanvas();
      const paint = Skia.Paint();
      paint.setColor(Skia.Color('#FF0000'));
      canvas.drawRect(Skia.XYWHRect(0, 0, 2, 2), paint);
      paint.setColor(Skia.Color('#0000FF'));
      canvas.drawRect(Skia.XYWHRect(2, 0, 2, 2), paint);
      surface.flush();
      return surface.makeImageSnapshot();
    }

    function sheetAsset(assets: AssetManager): ImageAsset {
      const image = twoFrameImage();
      return assets.addImage('sheet', { native: image, width: image.width(), height: image.height() });
    }

    it('draws sprite frames (image source rects) scaled to the sprite size', () => {
      const engine = createEngine({ clock: new VirtualClock() });
      const image = sheetAsset(engine.assets);
      const sheet = engine.createSpriteSheet({ image, grid: { frameWidth: 2, frameHeight: 2 } });
      const sprite = engine.createSprite({ sheet, x: 50, y: 50, width: 40, height: 40, smoothing: 'nearest' });
      const surface = makeSurface();
      const renderer = new SkiaEffectsRenderer(Skia);
      renderer.draw(surface.getCanvas(), [engine.scene.drawable()]);
      expect(pixelAt(surface, 50, 50).slice(0, 3)).toEqual([255, 0, 0]);
      sprite.frame = 1;
      renderer.draw(surface.getCanvas(), [engine.scene.drawable()]);
      expect(pixelAt(surface, 50, 50).slice(0, 3)).toEqual([0, 0, 255]);
      expect(pixelAt(surface, 75, 50)[3]).toBe(0); // outside the 40x40 sprite
      // Default (linear) sampling draws the same frame smoothly scaled.
      engine.createSprite({ sheet, x: 150, y: 150, width: 40, height: 40 });
      renderer.draw(surface.getCanvas(), [engine.scene.drawable()]);
      const [r, , b, a] = pixelAt(surface, 140, 150);
      expect(r).toBeGreaterThan(200);
      expect(b).toBeLessThan(60);
      expect(a).toBe(255);
      engine.dispose();
    });

    it('skips images that were unloaded and reports them once', () => {
      const assets = new AssetManager({ loader: { load: () => Promise.reject(new Error('n/a')), release: () => undefined } });
      const image = sheetAsset(assets);
      const scene = new Scene();
      scene.createNode({ x: 50, y: 50, shape: { type: 'image', image } });
      const drawable = scene.drawable();
      assets.unload('sheet', { force: true });
      const warnings: RendererWarning[] = [];
      const renderer = new SkiaEffectsRenderer(Skia, (w) => warnings.push(w));
      const surface = makeSurface();
      expect(renderer.draw(surface.getCanvas(), [drawable]).drawnPrimitives).toBe(0);
      renderer.draw(surface.getCanvas(), [drawable]);
      expect(warnings).toEqual([{ kind: 'image-unavailable', detail: 'sheet' }]);
    });

    it('draws linear gradients in the shape’s local coordinates', () => {
      const scene = new Scene();
      scene.createNode({
        x: 100,
        y: 100,
        shape: {
          type: 'rect',
          width: 100,
          height: 20,
          fill: { type: 'linear-gradient', start: { x: -50, y: 0 }, end: { x: 50, y: 0 }, colors: ['#FF0000', '#0000FF'] },
        },
      });
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia).draw(surface.getCanvas(), [scene.drawable()]);
      const [lr, , lb] = pixelAt(surface, 52, 100);
      const [rr, , rb] = pixelAt(surface, 148, 100);
      expect(lr).toBeGreaterThan(240);
      expect(lb).toBeLessThan(15);
      expect(rb).toBeGreaterThan(240);
      expect(rr).toBeLessThan(15);
    });

    it('fills and strokes vector paths, ellipses and radial gradients', () => {
      const scene = new Scene();
      const triangle = new PathData().moveTo(0, -30).lineTo(30, 30).lineTo(-30, 30).close();
      scene.createNode({ x: 60, y: 60, shape: { type: 'path', path: triangle, color: '#00FF00' } });
      scene.createNode({ x: 150, y: 50, shape: { type: 'ellipse', width: 60, height: 20, stroke: { fill: '#FF0000', width: 4 } } });
      scene.createNode({
        x: 150,
        y: 150,
        shape: {
          type: 'circle',
          radius: 30,
          fill: { type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 30, colors: ['#FFFFFF', '#000000'] },
        },
      });
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia).draw(surface.getCanvas(), [scene.drawable()]);
      expect(pixelAt(surface, 60, 70).slice(0, 3)).toEqual([0, 255, 0]); // inside the triangle
      expect(pixelAt(surface, 35, 40)[3]).toBe(0); // outside its slanted edge
      expect(pixelAt(surface, 180, 50).slice(0, 3)).toEqual([255, 0, 0]); // on the ellipse outline
      expect(pixelAt(surface, 150, 50)[3]).toBe(0); // stroke only: centre is empty
      expect(pixelAt(surface, 150, 150)[0]).toBeGreaterThan(240); // white centre
      expect(pixelAt(surface, 150, 177)[0]).toBeLessThan(60); // dark rim
    });

    it('clips children to a rotated parent outline', () => {
      const scene = new Scene();
      const window = scene.createNode({ x: 100, y: 100, rotation: 45, clipChildren: true, shape: { type: 'rect', width: 40, height: 40, color: '#000000' } });
      scene.createNode({ parent: window, rotation: -45, shape: { type: 'rect', width: 200, height: 200, color: '#00FF00' } });
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia).draw(surface.getCanvas(), [scene.drawable()]);
      expect(pixelAt(surface, 100, 100).slice(0, 3)).toEqual([0, 255, 0]);
      expect(pixelAt(surface, 100, 125).slice(0, 3)).toEqual([0, 255, 0]); // inside the diamond
      expect(pixelAt(surface, 120, 120)[3]).toBe(0); // the diamond's empty corner region
      expect(pixelAt(surface, 10, 10)[3]).toBe(0);
    });

    it('masks a group with a dst-in child', () => {
      const scene = new Scene();
      const group = scene.createNode({ x: 100, y: 100, group: true, shape: { type: 'rect', width: 100, height: 100, color: '#FF0000' } });
      // The mask covers the whole group: opaque in the middle, transparent from radius 20 on.
      scene.createNode({
        parent: group,
        blendMode: 'dst-in',
        shape: {
          type: 'rect',
          width: 100,
          height: 100,
          fill: { type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 25, colors: ['#000000', '#000000', '#00000000'], positions: [0, 0.8, 1] },
        },
      });
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia).draw(surface.getCanvas(), [scene.drawable()]);
      expect(pixelAt(surface, 100, 100).slice(0, 3)).toEqual([255, 0, 0]); // kept by the mask
      expect(pixelAt(surface, 60, 60)[3]).toBe(0); // masked away
    });

    it('applies blend modes against what is below', () => {
      const scene = new Scene();
      scene.createNode({ x: 100, y: 100, shape: { type: 'rect', width: 50, height: 50, color: '#FF0000' } });
      scene.createNode({ x: 100, y: 100, blendMode: 'plus', shape: { type: 'rect', width: 50, height: 50, color: '#0000FF' } });
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia).draw(surface.getCanvas(), [scene.drawable()]);
      expect(pixelAt(surface, 100, 100).slice(0, 3)).toEqual([255, 0, 255]);
    });

    it('draws a glow outside the node and blurs, shadows and recolors subtrees', () => {
      const scene = new Scene();
      scene.createNode({ x: 50, y: 50, effects: [{ type: 'glow', color: '#00FF00', radius: 12 }], shape: { type: 'rect', width: 20, height: 20, color: '#FF0000' } });
      scene.createNode({ x: 150, y: 50, effects: [grayscale(1)], shape: { type: 'rect', width: 20, height: 20, color: '#FF0000' } });
      scene.createNode({ x: 50, y: 150, effects: [{ type: 'drop-shadow', dx: 20, dy: 0, radius: 0, color: '#0000FF' }], shape: { type: 'rect', width: 10, height: 10, color: '#FF0000' } });
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia).draw(surface.getCanvas(), [scene.drawable()]);
      expect(pixelAt(surface, 50, 50).slice(0, 3)).toEqual([255, 0, 0]); // node on top of its glow
      const glow = pixelAt(surface, 64, 50);
      expect(glow[1]).toBeGreaterThan(200); // green halo just outside the 20x20 rect
      expect(glow[3]).toBeGreaterThan(20);
      const [gr, gg, gb] = pixelAt(surface, 150, 50);
      expect(gr).toBe(gg);
      expect(gg).toBe(gb); // gray
      expect(pixelAt(surface, 70, 150).slice(0, 3)).toEqual([0, 0, 255]); // shadow offset by 20
    });

    it('runs runtime shaders with time and size uniforms, and falls back when compilation fails', () => {
      const gradient = defineShader({
        name: 'uv-test',
        uniforms: { time: 0, size: [1, 1] },
        source: `uniform float time; uniform float2 size;
half4 main(float2 p) { return half4(p.x / size.x, time, 0.0, 1.0); }`,
      });
      const broken = defineShader({ name: 'broken', source: 'half4 main(float2 p) { return nope; }', fallback: '#0000FF' });
      const scene = new Scene();
      scene.createNode({ x: 100, y: 50, shape: { type: 'rect', width: 100, height: 20, fill: { type: 'shader', shader: gradient } } });
      scene.createNode({ x: 100, y: 150, shape: { type: 'rect', width: 20, height: 20, fill: { type: 'shader', shader: broken } } });
      const warnings: RendererWarning[] = [];
      const renderer = new SkiaEffectsRenderer(Skia, (w) => warnings.push(w));
      expect(renderer.capabilities.runtimeShaders).toBe(true);
      const surface = makeSurface();
      renderer.draw(surface.getCanvas(), [scene.drawable(500)]);
      expect(pixelAt(surface, 52, 50)[0]).toBeLessThan(20); // u ≈ 0 at the left edge
      expect(pixelAt(surface, 148, 50)[0]).toBeGreaterThan(235); // u ≈ 1 at the right edge
      const green = pixelAt(surface, 100, 50)[1] ?? 0;
      expect(green).toBeGreaterThan(120); // time = 0.5 s
      expect(green).toBeLessThan(135);
      expect(pixelAt(surface, 100, 150).slice(0, 3)).toEqual([0, 0, 255]); // fallback color
      expect(warnings).toEqual([{ kind: 'shader-compile-failed', detail: 'broken' }]);
      expect(scene.hasAnimatedContent).toBe(true);
    });

    it('compiles the built-in energy and fire shaders', () => {
      const scene = new Scene();
      scene.createNode({ x: 50, y: 50, shape: { type: 'rect', width: 40, height: 40, fill: { type: 'shader', shader: energyShader } } });
      scene.createNode({ x: 150, y: 50, shape: { type: 'rect', width: 40, height: 40, fill: { type: 'shader', shader: fireShader } } });
      const warnings: RendererWarning[] = [];
      const surface = makeSurface();
      new SkiaEffectsRenderer(Skia, (w) => warnings.push(w)).draw(surface.getCanvas(), [scene.drawable(1234)]);
      expect(warnings).toEqual([]);
      expect(pixelAt(surface, 50, 50)[3]).toBe(255);
      expect(pixelAt(surface, 150, 50)[3]).toBe(255);
    });

    it('draws the glow-border effect around a moving, rotating target', () => {
      const clock = new VirtualClock();
      const engine = createEngine({ clock, effects: [glowBorder] });
      const card = engine.scene.createNode({ x: 60, y: 100, size: { width: 40, height: 60 } });
      engine.play('glow-border', { target: card, color: '#00FF00', padding: 0, cornerRadius: 0, width: 4, pulse: 0 });
      clock.advance(16);
      const renderer = new SkiaEffectsRenderer(Skia);
      let surface = makeSurface();
      renderer.draw(surface.getCanvas(), engine.drawables);
      expect(pixelAt(surface, 80, 100)[1]).toBeGreaterThan(200); // right edge of the outline
      expect(pixelAt(surface, 60, 100)[3]).toBe(0); // inside stays empty
      card.x = 140;
      card.rotation = 90; // now 60 wide, 40 tall
      clock.advance(16);
      surface = makeSurface();
      renderer.draw(surface.getCanvas(), engine.drawables);
      expect(pixelAt(surface, 170, 100)[1]).toBeGreaterThan(200); // rotated: right edge at x + 30
      expect(pixelAt(surface, 80, 100)[3]).toBe(0); // old position cleared
      engine.dispose();
    });
  });
});
