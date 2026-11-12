/**
 * Runs the renderer against real Skia (CanvasKit, CPU raster) provided by
 * `@shopify/react-native-skia/jestEnv.js`. Pixels are read back from a real surface.
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import type { SkSurface } from '@shopify/react-native-skia';
import { particleBurst } from '../../effects/particleBurst';
import type { ParticleBurstParams } from '../../effects/particleBurst';
import { createRandom } from '../../runtime/rng';
import type { Drawable } from '../../runtime/effect';
import { Scene } from '../../scene/scene';
import { SkiaEffectsRenderer } from './SkiaEffectsRenderer';

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
    const renderer = new SkiaEffectsRenderer(Skia, (kind) => reported.push(kind));
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
});
