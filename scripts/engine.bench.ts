/**
 * Engine-side frame cost in Node (no rendering, no device). Run: npm run bench
 *
 * Measures what the JS thread does per frame before Skia draws: advancing playbacks (sprite
 * frame animations and tweens), updating attachments and building the scene display list.
 * It says nothing about native rendering cost or device frame rates.
 */
import { AssetManager } from '../src/assets/assets';
import { createEngine } from '../src/engine/engine';
import { glowBorder } from '../src/effects/border';
import { VirtualClock } from '../src/runtime/clock';

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function run(spriteCount: number, frames = 600) {
  const clock = new VirtualClock();
  const assets = new AssetManager();
  const engine = createEngine({ clock, assets, effects: [glowBorder] });
  const image = assets.addImage('sheet', { native: {}, width: 512, height: 64 });
  const sheet = engine.createSpriteSheet({
    image,
    grid: { frameWidth: 64, frameHeight: 64 },
    animations: { spin: { frames: { from: 0, to: 7 }, fps: 12, loop: true } },
  });
  const group = engine.scene.createNode();
  for (let i = 0; i < spriteCount; i++) {
    const s = engine.createSprite({ sheet, parent: group, x: (i % 20) * 20, y: Math.floor(i / 20) * 20, zIndex: i % 7 });
    s.play('spin', { speed: 0.5 + (i % 5) * 0.25 });
    if (i % 10 === 0) engine.animate(s, { rotation: 360, duration: 2000, repeat: Infinity }).play();
  }
  engine.attach(group, glowBorder, {});
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    const start = performance.now();
    clock.advance(1000 / 60);
    times.push(performance.now() - start);
  }
  engine.dispose();
  const warm = times.slice(60).sort((a, b) => a - b);
  const avg = warm.reduce((a, b) => a + b, 0) / warm.length;
  return { spriteCount, avg, p95: percentile(warm, 0.95), max: warm.at(-1) ?? 0 };
}

it('engine frame cost', () => {
  const rows = [10, 100, 500].map((n) => run(n));
  const lines = rows.map(
    (r) => `${String(r.spriteCount).padStart(4)} sprites: avg ${r.avg.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms, max ${r.max.toFixed(3)} ms`,
  );
  const runtime = (globalThis as { process?: { version: string; platform: string; arch: string } }).process;
  console.log(`Node ${runtime?.version ?? '?'}, ${runtime?.platform ?? '?'}/${runtime?.arch ?? '?'}\n${lines.join('\n')}`);
  expect(rows).toHaveLength(3);
});
