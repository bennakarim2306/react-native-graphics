/**
 * Renders the deterministic visual scenes to PNG files with real Skia (CanvasKit, CPU raster).
 *
 *   npm run visual                         -> visual-out/
 *   VISUAL_OUT=some/dir npm run visual     -> some/dir
 *   VISUAL_ONLY=fire npm run visual        -> only scenes whose name contains "fire"
 *
 * For each scene and density the engine starts at time 0 (seed 7), the virtual clock steps in
 * 60 FPS frames up to each capture time (landing exactly on it), and the frame is recorded
 * with the renderer (camera offset included, as the overlay does) and drawn onto a surface of
 * width × density by height × density pixels with the canvas scaled by the density, which is
 * what React Native Skia does on a device. Files: `<scene>@<density>x-<time>ms.png`, plus
 * `manifest.json` with the parameters and simple image statistics.
 *
 * This is the engine's real output, not a device screenshot: CanvasKit's CPU rasterizer can
 * differ slightly from the GPU backends (blur and anti-aliasing details).
 */
/// <reference types="node" />
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { SkiaEffectsRenderer } from '../../src/renderer/skia/SkiaEffectsRenderer';
import { BACKGROUND, createScenes, FRAME_MS, sceneEngine } from './scenes';

const OUT = process.env.VISUAL_OUT ?? 'visual-out';
const ONLY = process.env.VISUAL_ONLY;

interface Entry {
  readonly file: string;
  readonly scene: string;
  readonly time: number;
  readonly density: number;
  readonly width: number;
  readonly height: number;
  readonly drawnPrimitives: number;
  /** Share of pixels that differ from the background. */
  readonly changed: number;
  /** Mean luminance (0..1) of the changed pixels. */
  readonly meanLuma: number;
}

function stats(bytes: Uint8Array, bg: readonly number[]): { changed: number; meanLuma: number } {
  let changed = 0;
  let luma = 0;
  const n = bytes.length / 4;
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i] ?? 0;
    const g = bytes[i + 1] ?? 0;
    const b = bytes[i + 2] ?? 0;
    if (Math.abs(r - (bg[0] ?? 0)) + Math.abs(g - (bg[1] ?? 0)) + Math.abs(b - (bg[2] ?? 0)) > 12) {
      changed++;
      luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
  }
  return { changed: changed / n, meanLuma: changed ? luma / changed : 0 };
}

test('render visual scenes', () => {
  mkdirSync(OUT, { recursive: true });
  const renderer = new SkiaEffectsRenderer(Skia);
  const capabilities = { runtimeShaders: renderer.capabilities.runtimeShaders, nodeEffects: renderer.capabilities.nodeEffects };
  const bgColor = Skia.Color(BACKGROUND);
  const bg = [Math.round((bgColor[0] ?? 0) * 255), Math.round((bgColor[1] ?? 0) * 255), Math.round((bgColor[2] ?? 0) * 255)];
  const entries: Entry[] = [];
  const scenes = createScenes().filter((s) => !ONLY || ONLY.split(',').some((part: string) => s.name.includes(part)));
  for (const scene of scenes) {
    for (const density of scene.densities ?? [2]) {
      const { engine, clock } = sceneEngine(scene, capabilities);
      scene.setup(engine, clock);
      for (const time of scene.times) {
        while (clock.now() < time - 1e-6) {
          scene.onFrame?.(engine, clock.now());
          clock.advance(Math.min(FRAME_MS, time - clock.now()));
        }
        const w = Math.round(scene.width * density);
        const h = Math.round(scene.height * density);
        const surface = Skia.Surface.Make(w, h);
        if (!surface) throw new Error('Could not create a surface');
        const canvas = surface.getCanvas();
        canvas.clear(bgColor);
        canvas.save();
        canvas.scale(density, density);
        const picture = renderer.record(engine.drawables, undefined, { ...engine.camera, pivotX: scene.width / 2, pivotY: scene.height / 2 });
        canvas.drawPicture(picture);
        canvas.restore();
        surface.flush();
        const image = surface.makeImageSnapshot();
        const png = image.encodeToBytes();
        const pixels = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
        const file = `${scene.name}@${String(density)}x-${String(Math.round(time))}ms.png`;
        writeFileSync(join(OUT, file), png);
        // Count the primitives with a throwaway recording (the drawables are unchanged).
        const counter = Skia.PictureRecorder();
        const summary = renderer.draw(counter.beginRecording(), engine.drawables);
        counter.finishRecordingAsPicture();
        entries.push({ file, scene: scene.name, time: Math.round(time), density, width: w, height: h, drawnPrimitives: summary.drawnPrimitives, ...stats(pixels, bg) });
      }
      engine.dispose();
    }
  }
  const manifest = {
    note: 'Real engine output rendered by Skia (CanvasKit CPU raster) from deterministic scenes; see scripts/visual.',
    seed: 7,
    frameMs: FRAME_MS,
    background: BACKGROUND,
    scenes: scenes.map((s) => ({ name: s.name, description: s.description, quality: s.quality, width: s.width, height: s.height, times: s.times, densities: s.densities ?? [2] })),
    images: entries,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  expect(entries.length).toBeGreaterThan(0);
});
