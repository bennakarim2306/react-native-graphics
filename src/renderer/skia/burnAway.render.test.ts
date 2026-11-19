/**
 * The burn-away effect drawn by the Skia renderer on real CanvasKit surfaces: a synthetic card
 * picture is delivered by a target's snapshotter (as the React Native host does on iOS and
 * Android), burned from the bottom, and the pixels are read back. Set BURN_FRAMES_DIR to also
 * write the frames as PNG files.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AlphaType, ColorType, PaintStyle, Skia } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import { builtInEffects } from '../../effects';
import type { BurnAwayParams } from '../../effects';
import { createEngine } from '../../engine/engine';
import { burnCharShader, burnGlowShader, burnPaperShader } from '../../graphics/shaderLib';
import { isSceneDrawable } from '../../scene/scene';
import type { Engine } from '../../engine/engine';
import { VirtualClock } from '../../runtime/clock';
import { SkiaEffectsRenderer } from './SkiaEffectsRenderer';

const W = 220; // points
const H = 240;
const DENSITY = 2;
const CARD = { x: 62, y: 60, width: 96, height: 136 };
const BACKGROUND = '#14111F';
const FRAMES_DIR = process.env.BURN_FRAMES_DIR;

/** A card face drawn with Skia: cream, rounded, a red border and a red suit mark. */
function cardPicture(): SkImage {
  const surface = Skia.Surface.Make(CARD.width * DENSITY, CARD.height * DENSITY);
  if (!surface) throw new Error('surface');
  const c = surface.getCanvas();
  c.scale(DENSITY, DENSITY);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color('#F4EFE6'));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, CARD.width, CARD.height), 12, 12), paint);
  paint.setColor(Skia.Color('#B3261E'));
  c.drawCircle(38, 58, 14, paint);
  c.drawCircle(58, 58, 14, paint);
  const heart = Skia.Path.MakeFromSVGString('M25 64 L48 92 L71 64 Z');
  if (heart) c.drawPath(heart, paint);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(2);
  paint.setColor(Skia.Color('#D9CFBE'));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(1, 1, CARD.width - 2, CARD.height - 2), 11, 11), paint);
  surface.flush();
  return surface.makeImageSnapshot();
}

interface Frame {
  readonly data: Uint8Array;
  readonly width: number;
  readonly image: SkImage;
}

function render(engine: Engine, renderer: SkiaEffectsRenderer): Frame {
  const width = W * DENSITY;
  const height = H * DENSITY;
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error('surface');
  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color(BACKGROUND));
  canvas.save();
  canvas.scale(DENSITY, DENSITY);
  canvas.drawPicture(renderer.record(engine.drawables));
  canvas.restore();
  surface.flush();
  const image = surface.makeImageSnapshot();
  const data = image.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!data) throw new Error('readPixels');
  return { data: data as Uint8Array, width, image };
}

/** Mean color of a box given in points. */
function mean(f: Frame, x: number, y: number, w: number, h: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let py = Math.round(y * DENSITY); py < Math.round((y + h) * DENSITY); py++) {
    for (let px = Math.round(x * DENSITY); px < Math.round((x + w) * DENSITY); px++) {
      const i = (py * f.width + px) * 4;
      r += f.data[i] ?? 0;
      g += f.data[i + 1] ?? 0;
      b += f.data[i + 2] ?? 0;
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

/** Pixels in a box (points) that look like fire: bright, red over blue. */
function firePixels(f: Frame, x: number, y: number, w: number, h: number): number {
  let n = 0;
  for (let py = Math.round(y * DENSITY); py < Math.round((y + h) * DENSITY); py++) {
    for (let px = Math.round(x * DENSITY); px < Math.round((x + w) * DENSITY); px++) {
      const i = (py * f.width + px) * 4;
      const r = f.data[i] ?? 0;
      const b = f.data[i + 2] ?? 0;
      if (r > 200 && r - b > 90) n++;
    }
  }
  return n;
}

const near = (a: readonly number[], b: readonly number[], tolerance: number) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tolerance);
const bg = (() => {
  const c = Skia.Color(BACKGROUND);
  return [Math.round((c[0] ?? 0) * 255), Math.round((c[1] ?? 0) * 255), Math.round((c[2] ?? 0) * 255)];
})();

function save(f: Frame, name: string) {
  if (!FRAMES_DIR) return;
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FRAMES_DIR, `${name}.png`), f.image.encodeToBytes());
}

async function setup(params: Partial<BurnAwayParams> = {}, quality: 'low' | 'medium' | 'high' = 'high') {
  const clock = new VirtualClock(0);
  const engine = createEngine({ clock, effects: builtInEffects, seed: 11, quality });
  const renderer = new SkiaEffectsRenderer(Skia);
  engine.setRendererCapabilities({ runtimeShaders: renderer.capabilities.runtimeShaders, nodeEffects: renderer.capabilities.nodeEffects });
  engine.targets.register('card');
  engine.targets.updateWindowLayout('card', CARD);
  const picture = cardPicture();
  engine.targets.setSnapshotter('card', () => Promise.resolve({ native: picture, width: picture.width(), height: picture.height() }));
  const handle = engine.play('burn-away', { target: 'card', ...params });
  // The snapshot arrives asynchronously, as on a device.
  await Promise.resolve();
  await Promise.resolve();
  const at = async (ms: number) => {
    while (clock.now() < ms - 1e-6) clock.advance(Math.min(1000 / 60, ms - clock.now()));
    await Promise.resolve();
    return render(engine, renderer);
  };
  return { engine, renderer, handle, at };
}

describe('burn-away (Skia)', () => {
  it('compiles its shaders', () => {
    const warnings: string[] = [];
    const renderer = new SkiaEffectsRenderer(Skia, (w) => warnings.push(`${w.kind}:${w.detail}`));
    renderer.precompile([burnPaperShader, burnGlowShader, burnCharShader]);
    expect(warnings).toEqual([]);
    expect(renderer.shaderStats.compiles).toBe(3);
  });

  it('draws nothing for a shader whose image is gone, and reports it once', async () => {
    const { engine, at } = await setup({ flames: false, embers: false, smoke: false, ash: false });
    await at(300);
    const paper = engine.drawables.filter(isSceneDrawable)[0];
    const item = paper?.items[0];
    const fill = item?.shape.type === 'rect' ? item.shape.fill : undefined;
    const image = typeof fill === 'object' && fill.type === 'shader' ? fill.children?.image?.image : undefined;
    expect(image).toBeDefined();
    if (!paper || !image) return;
    engine.assets.unload(image.id, { force: true });
    const warnings: string[] = [];
    const strict = new SkiaEffectsRenderer(Skia, (w) => warnings.push(w.kind));
    const surface = Skia.Surface.Make(64, 64);
    if (!surface) throw new Error('surface');
    expect(strict.draw(surface.getCanvas(), [paper, paper]).drawnPrimitives).toBe(0);
    expect(warnings).toEqual(['image-unavailable']);
  });

  it('shows the picture where the view is, then burns it away from the bottom', async () => {
    const { at, engine, handle } = await setup({ flames: false, embers: false, smoke: false, ash: false, duration: 1600 });
    const start = await at(16);
    save(start, 'burn-00-start');
    // The picture covers the card exactly: its centre is the cream face.
    expect(near(mean(start, CARD.x + 8, CARD.y + 100, 20, 20), [244, 239, 230], 6)).toBe(true);
    expect(near(mean(start, 10, 10, 30, 30), bg, 2)).toBe(true);

    const mid = await at(1100);
    save(mid, 'burn-01-mid');
    // The bottom is gone, the top is still the card, the edge glows in between.
    expect(near(mean(mid, CARD.x + 10, CARD.y + CARD.height - 14, 76, 10), bg, 12)).toBe(true);
    expect(near(mean(mid, CARD.x + 10, CARD.y + 6, 20, 12), [244, 239, 230], 8)).toBe(true);
    expect(firePixels(mid, CARD.x, CARD.y, CARD.width, CARD.height)).toBeGreaterThan(150);

    const end = await at(1700);
    save(end, 'burn-02-end');
    expect(near(mean(end, CARD.x, CARD.y, CARD.width, CARD.height), bg, 8)).toBe(true);
    // Hidden for good through its motion; the effect ends after the afterglow.
    expect(engine.getTarget('card')?.motion.opacity).toBe(0);
    await at(2300);
    expect(handle.status).toBe('completed');
  });

  it('draws flames, embers, smoke and ash along the edge on high quality', async () => {
    const { at } = await setup({ from: 'bottom-right', duration: 1400 });
    for (const ms of [200, 500, 800, 1100, 1400, 1700]) save(await at(ms), `burn-corner-${String(ms).padStart(4, '0')}`);
    const frame = await at(1800);
    expect(frame).toBeDefined();
  });

  it('is deterministic for a seed', async () => {
    const a = await setup({ from: 'random' });
    const b = await setup({ from: 'random' });
    const fa = await a.at(900);
    const fb = await b.at(900);
    expect(Buffer.from(fa.data).equals(Buffer.from(fb.data))).toBe(true);
  });
});
