import { builtInEffects } from '../effects';
import { VirtualClock } from '../runtime/clock';
import { defineEffect } from '../runtime/effect';
import { isSceneDrawable } from '../scene/scene';
import { createEngine } from './engine';
import type { EffectHandle } from './engine';
import { throwAndExplode } from './sequences';

function setup() {
  const clock = new VirtualClock(0);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: builtInEffects, seed: 3, onError: (e) => errors.push(e) });
  return { clock, engine, errors };
}

function withCard(engine: ReturnType<typeof createEngine>) {
  engine.targets.register('card');
  engine.targets.updateWindowLayout('card', { x: 160, y: 500, width: 80, height: 120 });
  return engine.targets.node('card');
}

/** An effect that records where (and when) it was started. */
function spotEffect() {
  const starts: { time: number; x: number; y: number }[] = [];
  const definition = defineEffect<{ x: number; y: number; time: number }>({
    name: 'spot',
    create(params) {
      starts.push(params);
      let elapsed = 0;
      return {
        drawables: [],
        get done() {
          return elapsed >= 200;
        },
        update: (ms) => {
          elapsed = ms;
        },
        dispose: () => undefined,
      };
    },
  });
  return { definition, starts };
}

describe('effect cues on timelines', () => {
  it('start an effect at the exact timeline time, with parameters computed at that moment', () => {
    const { clock, engine } = setup();
    const ball = engine.scene.createNode({ x: 0, y: 0 });
    const { definition, starts } = spotEffect();
    engine
      .timeline()
      .add(engine.animate(ball, { x: 100, duration: 300 }))
      .mark('hit')
      .add(engine.cue(definition, (info) => ({ x: ball.x, y: ball.y, time: info.time })), 'hit')
      .play();
    // A single big frame still fires the cue with the state at 300 ms, not at 1000 ms.
    clock.advance(1000);
    expect(starts).toEqual([{ x: 100, y: 0, time: 300 }]);
  });

  it('effects started by a cue are cancelled with the playback, unless detached', async () => {
    const { clock, engine } = setup();
    const owned: EffectHandle[] = [];
    const free: EffectHandle[] = [];
    const ownedCue = engine.cue('particles', { position: { x: 0, y: 0 }, rate: 20 });
    const freeCue = engine.cue('particles', { position: { x: 0, y: 0 }, rate: 20 }, { detached: true });
    ownedCue.onFire((h) => owned.push(h));
    freeCue.onFire((h) => free.push(h));
    const playback = engine.timeline().add(ownedCue).add(freeCue).add(engine.wait(1000)).play();
    clock.advance(100, { frameMs: 16 });
    expect(ownedCue.handles).toHaveLength(1);
    playback.cancel();
    await expect(owned[0]?.finished).resolves.toEqual({ status: 'cancelled', reason: 'user' });
    expect(free[0]?.status).toBe('playing');
    expect(ownedCue.handles).toHaveLength(0);
  });

  it('finish() skips cues unless playWhenSkipped; hold delays later items', () => {
    const { clock, engine } = setup();
    const { definition, starts } = spotEffect();
    const skippedCue = engine.cue(definition, { x: 1, y: 0, time: 0 });
    const keptCue = engine.cue(definition, { x: 2, y: 0, time: 0 }, { playWhenSkipped: true });
    const tl = engine.timeline().add(engine.wait(500)).add(skippedCue).add(keptCue);
    expect(tl.duration).toBe(500);
    tl.play().finish();
    expect(starts.map((s) => s.x)).toEqual([2]);

    const held = engine.timeline().add(engine.cue(definition, { x: 3, y: 0, time: 0 }, { hold: 250 })).mark('after');
    expect(held.markerTime('after')).toBe(250);
    clock.advance(16);
  });

  it('rejects unknown effects and invalid holds', () => {
    const { engine } = setup();
    expect(() => engine.cue('nope', {})).toThrow('Unknown effect "nope"');
    expect(() => engine.cue('flash', { position: { x: 0, y: 0 } }, { hold: -1 })).toThrow('hold');
  });
});

describe('throwAndExplode (motion-triggered orchestration on a host view)', () => {
  it('explodes exactly at the impact point, shakes, then returns the view to its layout', async () => {
    const { clock, engine, errors } = setup();
    const node = withCard(engine);
    const seq = throwAndExplode(engine, 'card', { throw: { height: 220, distance: 90, duration: 900 }, settleDelay: 500, returnDuration: 300 });
    const fired: EffectHandle[] = [];
    seq.explosion?.onFire((h) => fired.push(h));
    const impacts: { x: number; y: number }[] = [];
    seq.playback.onMarker('impact', () => impacts.push({ x: node?.x ?? 0, y: node?.y ?? 0 }));

    clock.advance(450, { frameMs: 16 });
    expect(engine.targets.viewTransform('card')?.translateY).toBeLessThan(-150);
    expect(fired).toHaveLength(0);

    clock.advance(470, { frameMs: 16 });
    // Impact: centre of the layout (200, 560) moved by the landing offset (90, 0).
    expect(impacts).toEqual([{ x: 290, y: 560 }]);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.effect).toBe('explosion');
    expect(engine.drawables.length).toBeGreaterThan(0);
    // The shake runs on the overlay (and on the card itself).
    expect(engine.camera.x !== 0 || engine.camera.y !== 0).toBe(true);

    clock.advance(1500, { frameMs: 16 });
    await expect(seq.playback.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.targets.viewTransform('card')).toEqual({ translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    expect(node?.x).toBe(200);
    expect(node?.y).toBe(560);
    clock.advance(2500, { frameMs: 16 });
    expect(engine.activeCount).toBe(0);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(errors).toEqual([]);
  });

  it('places the explosion where the object landed and leaves it there with afterImpact stay', () => {
    const { clock, engine } = setup();
    withCard(engine);
    const seq = throwAndExplode(engine, 'card', { throw: { height: 100, distance: -60, drop: 40, duration: 600 }, shake: false, afterImpact: 'stay' });
    let started: EffectHandle | null = null;
    seq.explosion?.onFire((h) => (started = h));
    clock.advance(700, { frameMs: 16 });
    expect(started).not.toBeNull();
    const flash = engine.drawables.filter(isSceneDrawable).find((d) => d.items[0]?.nodeId === -1);
    // Landing: (200 - 60, 560 + 40).
    expect(flash?.items[0]?.matrix[4]).toBeCloseTo(140, 6);
    expect(flash?.items[0]?.matrix[5]).toBeCloseTo(600, 6);
    expect(engine.targets.viewTransform('card')?.translateX).toBeCloseTo(-60, 9);
    expect(engine.targets.viewTransform('card')?.translateY).toBeCloseTo(40, 9);
  });

  it('cancelling mid-flight restores the view and starts no explosion', async () => {
    const { clock, engine } = setup();
    withCard(engine);
    const seq = throwAndExplode(engine, 'card');
    clock.advance(300, { frameMs: 16 });
    seq.playback.cancel();
    await expect(seq.playback.finished).resolves.toMatchObject({ status: 'cancelled' });
    expect(engine.targets.viewTransform('card')).toEqual({ translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    clock.advance(16);
    expect(engine.activeCount).toBe(0);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it('cancelling after the impact cancels the explosion and shake and restores the view', async () => {
    const { clock, engine } = setup();
    withCard(engine);
    const seq = throwAndExplode(engine, 'card', { afterImpact: 'vanish', throw: { duration: 500 } });
    // Impact at 500 ms; the view fades out over 90 ms.
    clock.advance(620, { frameMs: 16 });
    expect(engine.activeCount).toBe(2);
    expect(engine.targets.viewTransform('card')?.opacity).toBe(0);
    seq.playback.cancel();
    // Restored synchronously: no await needed before the next sequence starts.
    expect(engine.activeCount).toBe(0);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(engine.targets.viewTransform('card')).toEqual({ translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
    await expect(seq.playback.finished).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('a replay right after cancel() starts from the restored view, in every phase', () => {
    const IDENTITY = { translateX: 0, translateY: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
    for (const afterImpact of ['return', 'vanish'] as const) {
      for (const at of [200, 560, 900, 1250]) {
        const { clock, engine, errors } = setup();
        withCard(engine);
        const first = throwAndExplode(engine, 'card', { afterImpact, throw: { duration: 500 } });
        clock.advance(at, { frameMs: 16 });
        // What a "Replay" button does: cancel the running sequence, start a new one.
        first.playback.cancel();
        const second = throwAndExplode(engine, 'card', { afterImpact, throw: { duration: 500 } });
        clock.advance(3000, { frameMs: 16 });
        expect({ afterImpact, at, status: second.playback.status, view: engine.targets.viewTransform('card') }).toEqual({ afterImpact, at, status: 'completed', view: IDENTITY });
        expect(errors).toEqual([]);
      }
    }
  });

  it('finish() jumps to the consistent end state without an explosion', async () => {
    const { engine } = setup();
    withCard(engine);
    const seq = throwAndExplode(engine, 'card');
    seq.playback.finish();
    await expect(seq.playback.finished).resolves.toEqual({ status: 'completed' });
    expect(engine.activeCount).toBe(0);
    expect(engine.targets.viewTransform('card')).toMatchObject({ translateX: 0, translateY: 0, rotation: 0 });
  });

  it('survives the target unmounting mid-flight', async () => {
    const { clock, engine, errors } = setup();
    withCard(engine);
    const seq = throwAndExplode(engine, 'card');
    clock.advance(300, { frameMs: 16 });
    engine.targets.unregister('card');
    await expect(seq.playback.finished).resolves.toMatchObject({ status: 'cancelled' });
    clock.advance(4000, { frameMs: 16 });
    clock.advance(3000, { frameMs: 16 });
    expect(engine.activeCount).toBe(0);
    expect(engine.camera).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(errors).toEqual([]);
  });

  it('works on scene nodes and validates its options', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode({ x: 50, y: 50, shape: { type: 'rect', width: 10, height: 10, fill: '#FFF' } });
    const seq = throwAndExplode(engine, node, { afterImpact: 'return', throw: { duration: 400 }, settleDelay: 0, returnDuration: 0 });
    clock.advance(600, { frameMs: 16 });
    expect(seq.playback.status).toBe('completed');
    expect([node.x, node.y, node.rotation]).toEqual([50, 50, 0]);
    expect(() => throwAndExplode(engine, 'missing')).toThrow('Unknown target');
    expect(() => throwAndExplode(engine, node, { afterImpact: 'fly' as 'stay' })).toThrow('afterImpact');
    expect(() => throwAndExplode(engine, node, { settleDelay: -1 })).toThrow('settleDelay');
  });
});
