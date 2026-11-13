/**
 * Phase 4 effect scenarios: engine-side frame cost in Node (no rendering, no device).
 * Run: npm run bench
 *
 * For each scenario a virtual clock advances 60 FPS frames and `performance.now()` is taken
 * around each frame. That covers what the JS thread does before Skia draws: playbacks, effect
 * updates (particle simulation, shader uniforms), attachments and the display list. It does
 * not cover recording the Skia picture, GPU work, or a phone CPU. The same scenarios exist as
 * buttons in the example app (Effects tab, section F) to measure on a device.
 */
import { AssetManager } from '../src/assets/assets';
import { builtInEffects } from '../src/effects';
import { createEngine } from '../src/engine/engine';
import type { Engine } from '../src/engine/engine';
import { sharedParticlePool } from '../src/particles/pool';
import { VirtualClock } from '../src/runtime/clock';
import type { QualityLevel } from '../src/runtime/quality';

const FRAME = 1000 / 60;

interface Row {
  readonly name: string;
  readonly frames: number;
  readonly avg: number;
  readonly p95: number;
  readonly max: number;
  readonly particles: number;
  readonly note?: string;
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function liveParticles(engine: Engine): number {
  let n = 0;
  for (const d of engine.drawables) if (d.kind === 'particles') n += (d as unknown as { aliveCount: number }).aliveCount;
  return n;
}

function setup(quality: QualityLevel = 'high') {
  const clock = new VirtualClock(0);
  const assets = new AssetManager();
  const engine = createEngine({ clock, assets, effects: builtInEffects, quality, maxActiveEffects: 64, seed: 7 });
  return { clock, engine, assets };
}

/** Card-sized host targets laid out like the device scenario (5 × 2 grid). */
function cards(engine: Engine, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `card-${String(i)}`;
    engine.targets.register(id);
    engine.targets.updateWindowLayout(id, { x: 20 + (i % 5) * 76, y: 300 + Math.floor(i / 5) * 110, width: 60, height: 90 });
    ids.push(id);
  }
  return ids;
}

/** Advances `frames` frames, timing each; `each` runs before frame `f` (to trigger effects). */
function measure(name: string, engine: Engine, clock: VirtualClock, frames: number, each?: (f: number) => void, warmup = 30): Row {
  const times: number[] = [];
  let particles = 0;
  for (let f = 0; f < frames; f++) {
    each?.(f);
    const start = performance.now();
    clock.advance(FRAME);
    const t = performance.now() - start;
    if (f >= warmup) times.push(t);
    particles = Math.max(particles, liveParticles(engine));
  }
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  return { name, frames, avg, p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0, particles };
}

function fireBorders(count: number, quality: QualityLevel): Row {
  const { clock, engine } = setup(quality);
  for (const id of cards(engine, count)) engine.attach(id, { effect: 'fire-border', glow: true, sparks: true });
  const row = measure(`${String(count)} fire border${count > 1 ? 's' : ''} (${quality})`, engine, clock, 600);
  engine.dispose();
  return row;
}

function explosions(count: number, quality: QualityLevel): Row {
  const { clock, engine } = setup(quality);
  // Each explosion lasts about 2 s; frames are measured from the trigger until all have ended.
  for (let i = 0; i < count; i++) {
    engine.play('explosion', { position: { x: 60 + i * 70, y: 400 }, particles: 150, debris: true, screenShake: i === 0 });
  }
  const row = measure(`${String(count)} explosion${count > 1 ? 's' : ''} of 150 particles (${quality})`, engine, clock, 150, undefined, 0);
  const note = engine.activeCount === 0 ? 'all ended within 2.5 s' : `${String(engine.activeCount)} still running after 2.5 s`;
  engine.dispose();
  return { ...row, note };
}

function spritesWithEffects(): Row {
  const { clock, engine, assets } = setup();
  const image = assets.addImage('sheet', { native: {}, width: 512, height: 64 });
  const sheet = engine.createSpriteSheet({ image, grid: { frameWidth: 64, frameHeight: 64 }, animations: { spin: { frames: { from: 0, to: 7 }, fps: 12, loop: true } } });
  const root = engine.scene.createNode({ x: 200, y: 400 });
  for (let i = 0; i < 50; i++) {
    const sprite = engine.createSprite({ sheet, parent: root, x: ((i % 10) - 4.5) * 34, y: (Math.floor(i / 10) - 2) * 40, scale: 0.5, zIndex: i % 5 });
    sprite.play('spin', { speed: 0.5 + (i % 4) * 0.25 });
    engine.animate(sprite, { rotation: 360, duration: 1500 + (i % 7) * 200, repeat: Infinity }).play();
    // Every fifth sprite flies a loop with a trail; every fifth (offset) pulses a glow.
    if (i % 5 === 0) {
      engine
        .keyframes(sprite, { duration: 2000, repeat: Infinity, keyframes: [{ at: 0, y: sprite.y }, { at: 0.5, y: sprite.y - 60, easing: 'easeInOutSine' }, { at: 1, y: sprite.y, easing: 'easeInOutSine' }] })
        .play();
      engine.attach(sprite, 'trail', { rate: 60 });
    }
    if (i % 5 === 2) engine.attach(sprite, 'glow-pulse', { shape: 'circle' });
  }
  const row = measure('50 sprites, 10 trails, 10 glow pulses', engine, clock, 600);
  engine.dispose();
  return row;
}

function createDestroy(cycles: number): Row & { readonly idle: boolean } {
  const { clock, engine } = setup();
  const before = { ...sharedParticlePool.stats };
  const times: number[] = [];
  for (let i = 0; i < cycles; i++) {
    const start = performance.now();
    const node = engine.scene.createNode({ x: 100 + (i % 5) * 40, y: 300, shape: { type: 'rect', width: 60, height: 90, color: '#F4EFE6' } });
    engine.attach(node, { effect: 'fire-border' });
    engine.attach(node, 'glow-pulse', {});
    engine.play('golden-sparks', { target: node, count: 30 });
    clock.advance(FRAME);
    clock.advance(FRAME);
    node.destroy();
    clock.advance(FRAME);
    times.push(performance.now() - start);
  }
  clock.advance(3000, { frameMs: FRAME });
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const idle = engine.activeCount === 0 && engine.scene.attachmentCount === 0 && engine.playbackCount === 0;
  const reused = sharedParticlePool.stats.reused - before.reused;
  const allocated = sharedParticlePool.stats.allocated - before.allocated;
  engine.dispose();
  return {
    name: `${String(cycles)} create/destroy cycles (3 frames each)`,
    frames: cycles * 3,
    avg: avg / 3,
    p95: percentile(sorted, 0.95) / 3,
    max: (sorted.at(-1) ?? 0) / 3,
    particles: 0,
    note: `idle afterwards: ${String(idle)}; particle buffers allocated ${String(allocated)}, reused ${String(reused)}`,
    idle,
  };
}

function continuous(minutes: number): Row[] {
  const { clock, engine } = setup();
  for (const id of cards(engine, 3)) engine.attach(id, { effect: 'fire-border' });
  engine.play('smoke', { position: { x: 200, y: 600 } });
  const framesPerMinute = 60 * 60;
  const rows: Row[] = [];
  // Process heap after each minute (includes Jest itself; no forced GC, so only a trend).
  const heapMiB = () => Math.round(((globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process?.memoryUsage?.().heapUsed ?? 0) / 1048576);
  for (let m = 0; m < minutes; m++) {
    const row = measure(`continuous, minute ${String(m + 1)}`, engine, clock, framesPerMinute, (f) => {
      if (f % 120 === 0) engine.play('explosion', { position: { x: 80 + ((f / 120) % 4) * 80, y: 420 }, particles: 120 });
      if (f % 300 === 0) engine.play('confetti', { position: { x: 200, y: 200 } });
    });
    rows.push({ ...row, note: `process heap ${String(heapMiB())} MiB; active effects ${String(engine.activeCount)}` });
  }
  engine.dispose();
  return rows;
}

it('Phase 4 effect scenarios: engine frame cost in Node', () => {
  const rows: Row[] = [
    fireBorders(1, 'high'),
    fireBorders(10, 'high'),
    fireBorders(10, 'low'),
    explosions(1, 'high'),
    explosions(5, 'high'),
    explosions(5, 'low'),
    spritesWithEffects(),
    createDestroy(500),
    ...continuous(3),
  ];
  const ms = (v: number) => `${v.toFixed(3)} ms`;
  const runtime = (globalThis as { process?: { version: string; platform: string; arch: string } }).process;
  const table = [
    '| Scenario | Frames | Average | p95 | Max | Peak live particles | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${String(r.frames)} | ${ms(r.avg)} | ${ms(r.p95)} | ${ms(r.max)} | ${String(r.particles)} | ${r.note ?? ''} |`),
  ];
  console.log(`Node ${runtime?.version ?? '?'}, ${runtime?.platform ?? '?'}/${runtime?.arch ?? '?'}\n${table.join('\n')}`);
  expect(rows.every((r) => Number.isFinite(r.avg))).toBe(true);
});
