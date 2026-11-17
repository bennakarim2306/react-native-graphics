/**
 * Sharpness at device density (Phase 4.5). React Native Skia draws in points on a canvas that
 * is scaled to the screen density, so what the renderer records must be rasterized at the
 * device resolution: vector edges stay one to two device pixels wide at 1×, 2× and 3×, shaders
 * are evaluated per device pixel, and the layout is identical at every density. These tests
 * draw recorded pictures the way the overlay does (canvas scaled by the density) on real
 * CanvasKit surfaces and read the pixels back.
 */
import { AlphaType, ColorType, FilterMode, MipmapMode, Skia } from '@shopify/react-native-skia';
import type { SkImage, SkPicture } from '@shopify/react-native-skia';
import { builtInEffects } from '../../effects';
import { createEngine } from '../../engine/engine';
import { ParticleEmitter } from '../../particles/emitter';
import { VirtualClock } from '../../runtime/clock';
import { createRandom } from '../../runtime/rng';
import { composeTransform } from '../../scene/matrix';
import { SkiaEffectsRenderer } from './SkiaEffectsRenderer';

const SIZE = 120; // points

interface Raster {
  readonly width: number;
  readonly data: Uint8Array;
  readonly image: SkImage;
}

/** Draws a picture recorded in points onto a surface of SIZE × density pixels. */
function rasterize(picture: SkPicture, density: number): Raster {
  const width = SIZE * density;
  const surface = Skia.Surface.Make(width, width);
  if (!surface) throw new Error('surface');
  const canvas = surface.getCanvas();
  canvas.save();
  canvas.scale(density, density);
  canvas.drawPicture(picture);
  canvas.restore();
  surface.flush();
  const image = surface.makeImageSnapshot();
  const data = image.readPixels(0, 0, { width, height: width, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!data) throw new Error('readPixels');
  return { width, data: data as Uint8Array, image };
}

const alphaAt = (r: Raster, x: number, y: number): number => r.data[(y * r.width + x) * 4 + 3] ?? 0;

/** Partly covered pixels (anti-aliasing ramp) along a horizontal line. */
function rampPixels(r: Raster, y: number): number {
  let n = 0;
  for (let x = 0; x < r.width; x++) {
    const a = alphaAt(r, x, y);
    if (a > 10 && a < 245) n++;
  }
  return n;
}

/** Share of pixels with visible alpha. */
function coverage(r: Raster): number {
  let lit = 0;
  for (let i = 3; i < r.data.length; i += 4) if ((r.data[i] ?? 0) > 16) lit++;
  return lit / (r.data.length / 4);
}

/** Box-filters a density× raster down to 1×: the mean alpha of each density × density block. */
function downsampledAlpha(r: Raster, density: number): Float64Array {
  const out = new Float64Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let dy = 0; dy < density; dy++) for (let dx = 0; dx < density; dx++) sum += alphaAt(r, x * density + dx, y * density + dy);
      out[y * SIZE + x] = sum / (density * density);
    }
  }
  return out;
}

/** Mean standard deviation of the green channel inside each lit density × density block. */
function blockDetail(r: Raster, density: number): number {
  let sum = 0;
  let blocks = 0;
  for (let by = 0; by < SIZE; by++) {
    for (let bx = 0; bx < SIZE; bx++) {
      if (alphaAt(r, bx * density, by * density) < 40) continue;
      const values: number[] = [];
      for (let dy = 0; dy < density; dy++) for (let dx = 0; dx < density; dx++) values.push(r.data[((by * density + dy) * r.width + bx * density + dx) * 4 + 1] ?? 0);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      sum += Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
      blocks++;
    }
  }
  return blocks ? sum / blocks : 0;
}

function circlePicture(renderer: SkiaEffectsRenderer): SkPicture {
  const emitter = new ParticleEmitter(
    { bursts: [{ count: 1 }], speed: 0, lifetime: 10_000, size: 30, colors: ['#FFFFFF'], shape: { type: 'point' } },
    createRandom(1),
    { transform: composeTransform(SIZE / 2, SIZE / 2, 0, 1, 1) },
  );
  emitter.update(10);
  const picture = renderer.record([emitter]);
  emitter.dispose();
  return picture;
}

describe('rendering at device density', () => {
  const renderer = new SkiaEffectsRenderer(Skia);

  it('vector edges stay one to two device pixels wide at 1×, 2× and 3× (no upscaled bitmap)', () => {
    const picture = circlePicture(renderer);
    for (const density of [1, 2, 3]) {
      const r = rasterize(picture, density);
      // The disc (radius 30 pt) spans 60 pt at every density.
      const row = (SIZE / 2) * density;
      let inside = 0;
      for (let x = 0; x < r.width; x++) if (alphaAt(r, x, row) >= 245) inside++;
      expect(inside / density).toBeGreaterThan(57);
      expect(inside / density).toBeLessThan(61);
      // Each of the two edges is an anti-aliasing ramp of at most two device pixels.
      expect(rampPixels(r, row)).toBeLessThanOrEqual(4);
    }
    // Control: the same disc drawn at 1× and then scaled up 3× (what double scaling or a
    // low-resolution layer would do) has edges three times as wide, which the check catches.
    const low = Skia.Surface.Make(SIZE, SIZE);
    if (!low) throw new Error('surface');
    low.getCanvas().drawPicture(picture);
    low.flush();
    const lowImage: SkImage = low.makeImageSnapshot();
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, SIZE, SIZE));
    canvas.drawImageRect(lowImage, Skia.XYWHRect(0, 0, SIZE, SIZE), Skia.XYWHRect(0, 0, SIZE, SIZE), Skia.Paint());
    const upscaled = rasterize(recorder.finishRecordingAsPicture(), 3);
    expect(rampPixels(upscaled, (SIZE / 2) * 3)).toBeGreaterThan(4);
    picture.dispose();
  });

  it('the fire shader is evaluated per device pixel and keeps the same layout at every density', () => {
    const clock = new VirtualClock(0);
    const engine = createEngine({ clock, effects: builtInEffects, seed: 7, quality: 'high' });
    engine.setRendererCapabilities(renderer.capabilities);
    const card = engine.scene.createNode({ x: SIZE / 2, y: SIZE / 2, size: { width: 50, height: 64 } });
    engine.play('fire-border', { target: card, flameHeight: 16, intensity: 1, sparks: false });
    clock.advance(800, { frameMs: 16 });
    const picture = renderer.record(engine.drawables);
    const one = rasterize(picture, 1);
    const reference = downsampledAlpha(one, 1);
    for (const density of [2, 3]) {
      const r = rasterize(picture, density);
      // Same share of the canvas covered by flames (layout and size do not depend on density).
      expect(Math.abs(coverage(r) - coverage(one))).toBeLessThan(0.02);
      // Averaged back to 1×, the high-density image matches the 1× image closely: same flames
      // in the same places, only sampled more finely.
      const down = downsampledAlpha(r, density);
      let diff = 0;
      for (let i = 0; i < down.length; i++) diff += Math.abs((down[i] ?? 0) - (reference[i] ?? 0));
      expect(diff / down.length).toBeLessThan(4);
      // Each device pixel is shaded on its own: within every lit density × density block the
      // colors vary, which a 1× image blown up to this size would not do.
      expect(blockDetail(r, density)).toBeGreaterThan(3);
    }
    // Control: the 1× image scaled up 3× has no detail inside a block.
    const recorder = Skia.PictureRecorder();
    recorder.beginRecording(Skia.XYWHRect(0, 0, SIZE, SIZE)).drawImageRect(one.image, Skia.XYWHRect(0, 0, SIZE, SIZE), Skia.XYWHRect(0, 0, SIZE, SIZE), Skia.Paint());
    expect(blockDetail(rasterize(recorder.finishRecordingAsPicture(), 3), 3)).toBeLessThan(0.5);
    picture.dispose();
    engine.dispose();
  });

  it('samples scaled images smoothly and asks Skia for mipmaps when they shrink', () => {
    // A 64 × 64 image of one-pixel checks, drawn at 13 × 13 points (about 5× smaller).
    const source = Skia.Surface.Make(64, 64);
    if (!source) throw new Error('surface');
    const paint = Skia.Paint();
    paint.setColor(Skia.Color('#FFFFFF'));
    const c = source.getCanvas();
    c.clear(Skia.Color('#000000'));
    for (let y = 0; y < 64; y++) for (let x = y % 2; x < 64; x += 2) c.drawRect(Skia.XYWHRect(x, y, 1, 1), paint);
    source.flush();
    const image = source.makeImageSnapshot();
    const engine = createEngine({ clock: new VirtualClock(0) });
    const asset = engine.assets.addImage('checks', { native: image, width: 64, height: 64 });
    const draw = (smoothing: 'linear' | 'nearest') => {
      const node = engine.scene.createNode({ x: 30, y: 30, shape: { type: 'image', image: asset, width: 13, height: 13, smoothing } });
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, SIZE, SIZE));
      const spy = jest.spyOn(canvas, 'drawImageRectOptions');
      renderer.draw(canvas, [engine.scene.drawable()]);
      const call = spy.mock.calls[0];
      const r = rasterize(recorder.finishRecordingAsPicture(), 1);
      node.destroy();
      const values: number[] = [];
      for (let y = 26; y < 34; y++) for (let x = 26; x < 34; x++) values.push(r.data[(y * r.width + x) * 4] ?? 0);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const deviation = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
      return { filter: call?.[3], mipmap: call?.[4], mean, deviation };
    };
    const smooth = draw('linear');
    const crisp = draw('nearest');
    // Default smoothing: linear filtering with linear mipmaps (on the GPU backends a shrinking
    // image is drawn from a mipmap level, so it does not shimmer); `nearest`: hard texels.
    expect([smooth.filter, smooth.mipmap]).toEqual([FilterMode.Linear, MipmapMode.Linear]);
    expect([crisp.filter, crisp.mipmap]).toEqual([FilterMode.Nearest, MipmapMode.None]);
    // Pixels: linear filtering already blends the checks towards grey; nearest aliases to pure
    // black and white. (CanvasKit draws without mipmaps here: RN Skia's API offers no way to give
    // an image mipmaps on the web backend, so the mipmapped result itself is not visible in Node.)
    expect(smooth.mean).toBeGreaterThan(100);
    expect(smooth.mean).toBeLessThan(156);
    expect(smooth.deviation).toBeLessThan(crisp.deviation * 0.6);
    expect(crisp.deviation).toBeGreaterThan(100);
    engine.dispose();
  });

  it('image particles are drawn with the same smooth sampling', () => {
    const source = Skia.Surface.Make(8, 8);
    if (!source) throw new Error('surface');
    source.getCanvas().clear(Skia.Color('#FFFFFF'));
    source.flush();
    const engine = createEngine({ clock: new VirtualClock(0) });
    const asset = engine.assets.addImage('dot', { native: source.makeImageSnapshot(), width: 8, height: 8 });
    const emitter = new ParticleEmitter(
      { bursts: [{ count: 3 }], speed: 0, lifetime: 10_000, size: 4, look: { type: 'image', image: asset }, shape: { type: 'point' } },
      createRandom(1),
      { transform: composeTransform(60, 60, 0, 1, 1) },
    );
    emitter.update(10);
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, SIZE, SIZE));
    const spy = jest.spyOn(canvas, 'drawAtlas');
    renderer.draw(canvas, [emitter]);
    recorder.finishRecordingAsPicture().dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[6]).toEqual({ filter: FilterMode.Linear, mipmap: MipmapMode.Linear });
    emitter.dispose();
    engine.dispose();
  });
});

describe('deterministic frames (what the visual regression scenes rely on)', () => {
  const renderer = new SkiaEffectsRenderer(Skia);

  /** Fire around a card and an explosion beside it, rendered at `time` ms at 2×. */
  function frame(time: number): Raster {
    const clock = new VirtualClock(0);
    const engine = createEngine({ clock, effects: builtInEffects, seed: 7, quality: 'high' });
    engine.setRendererCapabilities(renderer.capabilities);
    const card = engine.scene.createNode({ x: 40, y: 60, size: { width: 36, height: 50 } });
    engine.play('fire-border', { target: card, flameHeight: 12 });
    engine.play('explosion', { position: { x: 88, y: 60 }, radius: 28, particles: 60 });
    while (clock.now() < time - 1e-6) clock.advance(Math.min(1000 / 60, time - clock.now()));
    const picture = renderer.record(engine.drawables);
    const raster = rasterize(picture, 2);
    picture.dispose();
    engine.dispose();
    return raster;
  }
  const meanDiff = (a: Raster, b: Raster): number => {
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) sum += Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
    return sum / a.data.length;
  };

  it('the same seed and time give identical pixels; one frame later changes little, half a second a lot', () => {
    const a = frame(300);
    expect(meanDiff(a, frame(300))).toBe(0);
    const next = meanDiff(a, frame(300 + 1000 / 60));
    const later = meanDiff(a, frame(800));
    expect(next).toBeGreaterThan(0); // animated
    // Motion is continuous: a single frame step is a small part of the change over 500 ms.
    expect(next * 3).toBeLessThan(later);
  });
});
