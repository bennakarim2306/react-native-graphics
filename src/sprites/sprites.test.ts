import { AssetManager } from '../assets/assets';
import type { ImageAsset } from '../assets/assets';
import { FakeLoader } from '../assets/__tests__/fakeLoader';
import type { MarkerEvent } from '../animation/playback';
import { createEngine } from '../engine/engine';
import { VirtualClock } from '../runtime/clock';
import { InvalidOptionError } from '../runtime/errors';
import { SpriteSheet } from './sheet';

/** 4 columns x 2 rows of 16x16 frames. */
function sheetImage(assets: AssetManager, id = 'sheet'): ImageAsset {
  return assets.addImage(id, { native: { id }, width: 64, height: 32 });
}

function setup() {
  const clock = new VirtualClock(0);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, onError: (e) => errors.push(e), assets: { loader: new FakeLoader() } });
  const image = sheetImage(engine.assets);
  const sheet = engine.createSpriteSheet({
    image,
    grid: { frameWidth: 16, frameHeight: 16 },
    animations: {
      walk: { frames: [0, 1, 2, 3], fps: 10, loop: true },
      once: { frames: { from: 4, to: 7 }, frameDuration: 50, events: [{ at: 2, name: 'hit' }] },
      back: { frames: [0, 1, 2], frameDuration: 100, direction: 'reverse' },
      bounce: { frames: [0, 1, 2, 3], frameDuration: 100, direction: 'alternate', loop: true },
    },
  });
  return { clock, engine, image, sheet, errors };
}

describe('SpriteSheet', () => {
  it('slices a grid left to right, top to bottom, with margin and spacing', () => {
    const assets = new AssetManager();
    const image = sheetImage(assets);
    const sheet = new SpriteSheet({ image, grid: { frameWidth: 16, frameHeight: 16 } });
    expect(sheet.frameCount).toBe(8);
    expect(sheet.frame(5)).toEqual({ x: 16, y: 16, width: 16, height: 16 });
    const spaced = new SpriteSheet({ image, grid: { frameWidth: 14, frameHeight: 14, margin: 1, spacing: 2, count: 6 } });
    expect(spaced.frameCount).toBe(6);
    expect(spaced.frame(1)).toEqual({ x: 17, y: 1, width: 14, height: 14 });
    expect(spaced.frame(4)).toEqual({ x: 1, y: 17, width: 14, height: 14 });
  });

  it('accepts explicit frames, defaults to the whole image, and validates', () => {
    const assets = new AssetManager();
    const image = sheetImage(assets);
    expect(new SpriteSheet({ image }).frames).toEqual([{ x: 0, y: 0, width: 64, height: 32 }]);
    expect(new SpriteSheet({ image, frames: [{ x: 10, y: 0, width: 20, height: 32 }] }).frame(0).x).toBe(10);
    expect(() => new SpriteSheet({ image, frames: [{ x: 50, y: 0, width: 20, height: 10 }] })).toThrow('outside image');
    expect(() => new SpriteSheet({ image, grid: { frameWidth: 16, frameHeight: 16, count: 9 } })).toThrow('fits 8 frames');
    expect(() => new SpriteSheet({ image, grid: { frameWidth: 0, frameHeight: 16 } })).toThrow(InvalidOptionError);
    expect(() => new SpriteSheet({ image, frames: [] })).toThrow(InvalidOptionError);
    expect(() => new SpriteSheet({ image: {} as ImageAsset })).toThrow('loaded image asset');
    expect(() => new SpriteSheet({ image, grid: { frameWidth: 16, frameHeight: 16 }, animations: { bad: { frames: [9] } } })).toThrow(
      'out of range',
    );
  });

  it('resolves directions, durations, loops and frame events', () => {
    const { sheet } = setup();
    expect(sheet.animation('walk')).toMatchObject({ frames: [0, 1, 2, 3], durations: [100, 100, 100, 100], repeat: Infinity });
    expect(sheet.animation('once')).toMatchObject({ frames: [4, 5, 6, 7], repeat: 0, events: [{ at: 2, name: 'hit' }] });
    expect(sheet.animation('back').frames).toEqual([2, 1, 0]);
    expect(sheet.animation('bounce').frames).toEqual([0, 1, 2, 3, 2, 1]);
    const ev = sheet.resolve('e', { frames: [0, 1, 2], frameDuration: [10, 20, 30], direction: 'alternate', events: [{ at: 1, name: 'mid' }] });
    expect(ev.durations).toEqual([10, 20, 30, 20]);
    expect(ev.events).toEqual([
      { at: 1, name: 'mid' },
      { at: 3, name: 'mid' },
    ]);
    expect(() => sheet.animation('missing')).toThrow('Known: walk, once, back, bounce');
    expect(() => sheet.resolve('x', { frames: [0, 1], frameDuration: [10] })).toThrow('one frameDuration per frame');
    expect(() => sheet.resolve('x', { frames: [0], fps: 0 })).toThrow('fps');
    expect(() => sheet.resolve('x', { frames: [0], loop: -1 })).toThrow('loop');
    expect(() => sheet.resolve('x', { frames: [0], events: [{ at: 3, name: 'n' }] })).toThrow('event');
  });
});

describe('Sprite', () => {
  it('draws the current frame as an image shape with its size and anchor', () => {
    const { engine, sheet, image } = setup();
    const sprite = engine.createSprite({ sheet, x: 100, y: 50, frame: 2, width: 32, height: 32, anchor: { x: 0.5, y: 1 } });
    expect(sprite.shape).toMatchObject({ type: 'image', image, source: { x: 32, y: 0, width: 16, height: 16 }, width: 32, height: 32 });
    expect(sprite.getLocalBounds()).toEqual({ x: -16, y: -32, width: 32, height: 32 });
    expect(image.refCount).toBe(1);
    sprite.frame = 3;
    expect(image.refCount).toBe(1); // same image: no retain churn
    expect(() => (sprite.frame = 8)).toThrow('out of range');
    expect(engine.scene.drawItems()).toHaveLength(1);
  });

  it('plays frames on the engine clock and completes', async () => {
    const { clock, engine, sheet } = setup();
    const sprite = engine.createSprite({ sheet });
    const playback = sprite.play('once');
    expect(sprite.frame).toBe(4);
    expect(sprite.animationName).toBe('once');
    clock.advance(49);
    expect(sprite.frame).toBe(4);
    clock.advance(1);
    expect(sprite.frame).toBe(5);
    clock.advance(100);
    expect(sprite.frame).toBe(7);
    clock.advance(100);
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
    expect(sprite.frame).toBe(7); // holds the last frame
    expect(sprite.playback).toBeNull();
  });

  it('delivers frame events as markers, even when a frame lands late', () => {
    const { clock, engine, sheet } = setup();
    const sprite = engine.createSprite({ sheet });
    const hits: { time: number; frame: number }[] = [];
    sprite.play('once').onMarker('hit', (e: MarkerEvent) => hits.push({ time: e.time, frame: sprite.frame }));
    clock.advance(180); // jumps over the event at 100 ms
    expect(hits).toEqual([{ time: 100, frame: 6 }]);
  });

  it('loops, reverses and ping-pongs', () => {
    const { clock, engine, sheet } = setup();
    const walker = engine.createSprite({ sheet });
    const back = engine.createSprite({ sheet });
    const bouncer = engine.createSprite({ sheet });
    const loops: number[] = [];
    walker.play('walk').on('loop', (e) => loops.push(e.iteration));
    back.play('back');
    bouncer.play('bounce');
    const seen: number[][] = [];
    for (let i = 0; i < 7; i++) {
      seen.push([walker.frame, back.frame, bouncer.frame]);
      clock.advance(100);
    }
    expect(seen.map((s) => s[0])).toEqual([0, 1, 2, 3, 0, 1, 2]);
    expect(seen.map((s) => s[1])).toEqual([2, 1, 0, 0, 0, 0, 0]);
    expect(seen.map((s) => s[2])).toEqual([0, 1, 2, 3, 2, 1, 0]);
    expect(loops).toEqual([1]);
  });

  it('supports speed changes without jumps, pause and resume', () => {
    const { clock, engine, sheet } = setup();
    const sprite = engine.createSprite({ sheet });
    const playback = sprite.play('walk', { speed: 2 });
    clock.advance(100); // 200 ms of animation time
    expect(sprite.frame).toBe(2);
    playback.speed = 0.5;
    expect(playback.time).toBe(200);
    clock.advance(100); // +50 ms
    expect(playback.time).toBe(250);
    expect(sprite.frame).toBe(2);
    playback.pause();
    clock.advance(1000);
    expect(sprite.frame).toBe(2);
    playback.resume();
    playback.speed = 1;
    clock.advance(50);
    expect(sprite.frame).toBe(3);
    playback.speed = 0; // frozen but still playing
    clock.advance(500);
    expect(playback.status).toBe('playing');
    expect(sprite.frame).toBe(3);
    expect(() => (playback.speed = -1)).toThrow(InvalidOptionError);
  });

  it('stop returns to the first frame; play replaces the running animation', () => {
    const { clock, engine, sheet } = setup();
    const sprite = engine.createSprite({ sheet });
    const first = sprite.play('walk');
    clock.advance(250);
    const second = sprite.play('once');
    expect(first.status).toBe('cancelled');
    expect(sprite.frame).toBe(4);
    clock.advance(60);
    second.stop();
    expect(sprite.frame).toBe(4);
    expect(sprite.playback).toBeNull();
    sprite.play('walk');
    sprite.stopAnimation();
    expect(engine.playbackCount).toBe(0);
  });

  it('animates while moving, rotating and scaling as a child of a moving parent', () => {
    const { clock, engine, sheet } = setup();
    const ship = engine.scene.createNode({ x: 0, y: 100 });
    const sprite = engine.createSprite({ sheet, parent: ship, x: 20 });
    sprite.play('walk');
    engine.animate(ship, { x: 200, rotation: 90, duration: 400 }).play();
    engine.animate(sprite, { scale: 2, duration: 400 }).play();
    clock.advance(200, { frameMs: 16 });
    expect(sprite.frame).toBe(2);
    const pos = sprite.getWorldPosition();
    // Ship at x=100 rotated 45°: the child's 20 pt offset rotates with it.
    expect(pos.x).toBeCloseTo(100 + 20 * Math.SQRT1_2, 6);
    expect(pos.y).toBeCloseTo(100 + 20 * Math.SQRT1_2, 6);
    expect(sprite.getWorldRotation()).toBeCloseTo(45, 6);
    expect(sprite.getWorldScale().scaleX).toBeCloseTo(1.5, 6);
    const item = engine.scene.drawItems()[0];
    expect(item?.matrix).toEqual(sprite.worldMatrix);
  });

  it('can be placed on timelines next to tweens', () => {
    const { clock, engine, sheet } = setup();
    const sprite = engine.createSprite({ sheet });
    const markers: string[] = [];
    const tl = engine.timeline();
    tl.add(engine.animate(sprite, { x: 100, duration: 200 }));
    tl.add(sprite.animation('once'), '<');
    tl.mark('done');
    const playback = tl.play();
    playback.on('marker', (e) => markers.push(e.name));
    clock.advance(100);
    expect([sprite.x, sprite.frame]).toEqual([50, 6]);
    clock.advance(100);
    expect(markers).toEqual(['hit', 'done']);
  });

  it('destroy cancels its animation and releases the image', () => {
    const { clock, engine, sheet, image } = setup();
    const sprite = engine.createSprite({ sheet });
    const playback = sprite.play('walk');
    sprite.destroy();
    expect(playback.status).toBe('cancelled');
    expect(image.refCount).toBe(0);
    clock.advance(100);
    expect(() => sprite.play('walk')).toThrow('destroyed sprite');
  });

  it('requires an engine to play and a sheet to exist', () => {
    const { engine } = setup();
    expect(() => engine.createSprite({ sheet: {} as SpriteSheet })).toThrow('sprite sheet');
    expect(() => engine.createSpriteSheet({ image: 'missing' })).toThrow('not loaded');
  });

  it('stress: 100 animated sprites share one image and one clock', () => {
    const { clock, engine, sheet, image } = setup();
    const sprites = Array.from({ length: 100 }, (_, i) =>
      engine.createSprite({ sheet, x: (i % 10) * 20, y: Math.floor(i / 10) * 20, zIndex: 100 - i }),
    );
    sprites.forEach((s, i) => s.play('walk', { speed: 1 + (i % 4) * 0.5 }));
    expect(image.refCount).toBe(100);
    expect(clock.subscriberCount).toBe(1);
    clock.advance(1000, { frameMs: 16 });
    expect(sprites[0]?.frame).toBe(2); // 1000 ms at speed 1 → frame 10 → 10 mod 4
    expect(sprites[1]?.frame).toBe(3); // 1500 ms → frame 15 → 3
    const items = engine.scene.drawItems();
    expect(items).toHaveLength(100);
    // Higher zIndex draws later: the first sprite (zIndex 100) is on top.
    expect(items.at(-1)?.nodeId).toBe(sprites[0]?.id);
    for (const s of sprites) s.destroy();
    expect(image.refCount).toBe(0);
    expect(engine.playbackCount).toBe(0);
  });

  it('stress: repeated create/destroy leaks no references or playbacks', () => {
    const { clock, engine, sheet, image } = setup();
    for (let i = 0; i < 300; i++) {
      const sprite = engine.createSprite({ sheet });
      sprite.play('walk');
      clock.advance(5);
      sprite.destroy();
    }
    expect(image.refCount).toBe(0);
    expect(engine.playbackCount).toBe(0);
    expect(engine.scene.nodeCount).toBe(0);
    clock.advance(16);
    expect(clock.subscriberCount).toBe(0);
  });

  it('engine disposal destroys sprites and frees owned assets', () => {
    const { engine, sheet, image } = setup();
    engine.createSprite({ sheet }).play('walk');
    engine.dispose();
    expect(image.refCount).toBe(0);
    expect(image.disposed).toBe(true);
  });

  it('a shared asset manager is not disposed with the engine', async () => {
    const assets = new AssetManager({ loader: new FakeLoader() });
    const { a } = await assets.load({ a: 'a.png' });
    const engine = createEngine({ clock: new VirtualClock(), assets });
    const sheet = engine.createSpriteSheet({ image: 'a' });
    engine.createSprite({ sheet });
    expect(a.refCount).toBe(1);
    engine.dispose();
    expect(a.refCount).toBe(0);
    expect(a.disposed).toBe(false);
    assets.dispose();
  });
});
