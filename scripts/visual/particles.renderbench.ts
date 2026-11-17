/// <reference types="node" />
/**
 * Particle drawing cost with real Skia in Node (CanvasKit): how long the renderer takes to
 * record a frame of N particles into a picture (JavaScript + CanvasKit calls, the work the
 * overlay does on the JS thread every frame), and how long the CPU rasterizer takes to play
 * that picture back on a 1080 × 1920 surface (3× density).
 *
 *   npm run bench:render
 *
 * It is a proxy, not a device measurement: on a phone the recording calls cross JSI instead of
 * WebAssembly and playback runs on the GPU. It compares particle looks and drawing strategies
 * under identical conditions; absolute times do not transfer to devices.
 */
import { Skia } from '@shopify/react-native-skia';
import { builtInEffects } from '../../src/effects';
import { createEngine } from '../../src/engine/engine';
import { VirtualClock } from '../../src/runtime/clock';
import type { QualityLevel } from '../../src/runtime/quality';
import { ParticleEmitter } from '../../src/particles/emitter';
import type { EmitterConfig } from '../../src/particles/emitter';
import { SkiaEffectsRenderer } from '../../src/renderer/skia/SkiaEffectsRenderer';
import { createRandom } from '../../src/runtime/rng';
import { composeTransform } from '../../src/scene/matrix';

const ITERATIONS = 40;
// Whole frames with shaders raster slowly on the CPU (seconds each), so fewer iterations.
const ITER_FRAMES = Number(process.env.RENDERBENCH_FRAMES ?? 6);
// The React Native Jest preset rounds performance.now() to whole milliseconds; use hrtime.
const now = () => Number(process.hrtime.bigint()) / 1e6;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function emitter(count: number, config: Partial<EmitterConfig>): ParticleEmitter {
  const e = new ParticleEmitter(
    {
      bursts: [{ count }],
      maxParticles: count,
      speed: { min: 40, max: 160 },
      lifetime: 100_000,
      size: { min: 3, max: 9 },
      colors: ['#FFD54A', '#FF9100', '#FF3D00'],
      blendMode: 'plus',
      ...config,
    },
    createRandom(5),
    { transform: composeTransform(180, 320, 0, 1, 1) },
  );
  e.update(600);
  return e;
}

test('particle draw cost by look (CanvasKit, Node)', () => {
  const renderer = new SkiaEffectsRenderer(Skia);
  const surface = Skia.Surface.Make(1080, 1920);
  if (!surface) throw new Error('no surface');
  const rows: string[] = [];
  const cases: [string, Partial<EmitterConfig>][] = [
    ['circle', { look: 'circle' }],
    ['soft', { look: 'soft' }],
    ['soft (color over life)', { look: 'soft', colorOverLife: ['#FFFFFF', '#FF9100', '#FF3D0000'] }],
    ['spark', { look: 'spark' }],
    ['spark + glow 1', { look: 'spark', glow: 1 }],
    ['square', { look: 'square', rotation: { min: 0, max: 360 }, aspect: 0.5 }],
  ];
  for (const count of [200, 1000]) {
    for (const [name, config] of cases) {
      const e = emitter(count, config);
      const recordTimes: number[] = [];
      const playTimes: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = now();
        const picture = renderer.record([e]);
        const t1 = now();
        const canvas = surface.getCanvas();
        canvas.clear(Skia.Color('#000000'));
        canvas.save();
        canvas.scale(3, 3);
        canvas.drawPicture(picture);
        canvas.restore();
        surface.flush();
        const t2 = now();
        if (i >= 5) {
          recordTimes.push(t1 - t0);
          playTimes.push(t2 - t1);
        }
        picture.dispose();
      }
      rows.push(`| ${name} | ${String(count)} | ${median(recordTimes).toFixed(3)} ms | ${median(playTimes).toFixed(2)} ms |`);
      e.dispose();
    }
  }
  const table = ['| Look | Particles | Record (median) | CPU raster playback 1080×1920 (median) |', '| --- | --- | --- | --- |', ...rows].join('\n');
  // eslint-disable-next-line no-console
  console.log(`${table}\n\nNode ${process.version}, ${String(ITERATIONS - 5)} timed iterations after 5 warm-up.`);
  expect(rows.length).toBe(12);
});

/**
 * Whole effect frames per quality profile, recorded with the renderer and played back with
 * CanvasKit's CPU rasterizer:
 * - one fire border (60 × 90 pt card, 1 s in) on a 360 × 640 surface at 1× density. The fire is a
 *   per-pixel shader; CanvasKit runs it on the CPU at about a second per frame, so this frame is
 *   kept small. The numbers compare profiles and versions; a GPU runs shaders in parallel and is
 *   not measured here.
 * - five explosions of 150 particles at 120 ms (near their busiest frame) on 1080 × 1920 (3×).
 */
test('effect frames by quality profile (CanvasKit, Node)', () => {
  const renderer = new SkiaEffectsRenderer(Skia);
  const rows: string[] = [];
  const frame = (quality: QualityLevel, scene: 'fire' | 'explosions') => {
    const clock = new VirtualClock(0);
    const engine = createEngine({ clock, effects: builtInEffects, quality, seed: 7, maxActiveEffects: 64 });
    engine.setRendererCapabilities(renderer.capabilities);
    const density = scene === 'fire' ? 1 : 3;
    if (scene === 'fire') {
      const card = engine.scene.createNode({ x: 180, y: 320, size: { width: 60, height: 90 } });
      engine.play('fire-border', { target: card, glow: true, sparks: true });
      clock.advance(1000, { frameMs: 1000 / 60 });
    } else {
      for (let i = 0; i < 5; i++) engine.play('explosion', { position: { x: 60 + i * 60, y: 320 }, particles: 150, debris: true });
      clock.advance(120, { frameMs: 1000 / 60 });
    }
    const surface = Skia.Surface.Make(360 * density, 640 * density);
    if (!surface) throw new Error('no surface');
    const recordTimes: number[] = [];
    const playTimes: number[] = [];
    for (let i = 0; i < ITER_FRAMES; i++) {
      const t0 = now();
      const picture = renderer.record(engine.drawables);
      const t1 = now();
      const canvas = surface.getCanvas();
      canvas.clear(Skia.Color('#000000'));
      canvas.save();
      canvas.scale(density, density);
      canvas.drawPicture(picture);
      canvas.restore();
      surface.flush();
      const t2 = now();
      if (i >= 1) {
        recordTimes.push(t1 - t0);
        playTimes.push(t2 - t1);
      }
      picture.dispose();
    }
    const counter = Skia.PictureRecorder();
    const primitives = renderer.draw(counter.beginRecording(), engine.drawables).drawnPrimitives;
    counter.finishRecordingAsPicture().dispose();
    engine.dispose();
    const name = scene === 'fire' ? '1 fire border, 1 s (360×640, 1×)' : '5 explosions, 120 ms (1080×1920, 3×)';
    const row = `| ${name} | ${quality} | ${String(primitives)} | ${median(recordTimes).toFixed(3)} ms | ${median(playTimes).toFixed(1)} ms |`;
    rows.push(row);
    // Written at once: CPU shader raster is slow, so show progress.
    process.stdout.write(`${row}\n`);
  };
  for (const scene of ['fire', 'explosions'] as const) for (const q of ['high', 'medium', 'low'] as const) frame(q, scene);
  const table = ['| Frame | Profile | Primitives | Record (median) | CPU raster playback (median) |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
  // eslint-disable-next-line no-console
  console.log(`${table}\n\nNode ${process.version}, ${String(ITER_FRAMES - 1)} timed iterations after 1 warm-up.`);
  expect(rows.length).toBe(6);
});
