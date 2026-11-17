import type { MarkerEvent, PlaybackResult } from '../animation/playback';
import { objectTarget } from '../animation/target';
import { tween } from '../animation/tween';
import { particleBurst } from '../effects/particleBurst';
import { VirtualClock } from '../runtime/clock';
import { DisposedError, InvalidOptionError } from '../runtime/errors';
import type { SceneDrawable } from '../scene/scene';
import { createEngine } from './engine';

function setup() {
  const clock = new VirtualClock(1000);
  const errors: unknown[] = [];
  const engine = createEngine({ clock, effects: [particleBurst], seed: 3, onError: (e) => errors.push(e) });
  return { clock, engine, errors };
}

describe('Engine animation lifecycle', () => {
  it('starts idle, runs a tween on the clock, completes and goes idle again', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode({ x: 0 });
    clock.advance(16); // scene change → one frame, then idle
    expect(clock.subscriberCount).toBe(0);
    const playback = engine.animate(node, { x: 100, duration: 100 }).play();
    expect(engine.playbackCount).toBe(1);
    expect(clock.subscriberCount).toBe(1);
    clock.advance(50);
    expect(node.x).toBe(50);
    expect(playback.time).toBe(50);
    clock.advance(70); // overshoot the end: clamps
    expect(node.x).toBe(100);
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
    expect(playback.status).toBe('completed');
    expect(engine.playbackCount).toBe(0);
    clock.advance(16); // the final frame after completion
    expect(clock.subscriberCount).toBe(0);
  });

  it('is frame-rate independent: the same times give the same values', () => {
    const values = (frameMs: number) => {
      const { clock, engine } = setup();
      const node = engine.scene.createNode();
      engine.sequence([
        engine.animate(node, { x: 300, rotation: 360, duration: 500, easing: 'easeOutQuad' }),
        engine.animate(node, { x: 0, duration: 700, easing: 'easeInQuad' }),
      ]).play();
      const samples: number[] = [];
      for (let t = 100; t <= 1200; t += 100) {
        clock.setTime(1000 + t - (t % frameMs === 0 ? 0 : 0));
        samples.push(node.x, node.rotation);
      }
      return samples;
    };
    const stepped = (() => {
      const { clock, engine } = setup();
      const node = engine.scene.createNode();
      engine.sequence([
        engine.animate(node, { x: 300, rotation: 360, duration: 500, easing: 'easeOutQuad' }),
        engine.animate(node, { x: 0, duration: 700, easing: 'easeInQuad' }),
      ]).play();
      const samples: number[] = [];
      for (let t = 100; t <= 1200; t += 100) {
        clock.advance(100, { frameMs: 7 });
        samples.push(node.x, node.rotation);
      }
      return samples;
    })();
    expect(values(16)).toEqual(stepped);
  });

  it('runs multiple playbacks simultaneously', async () => {
    const { clock, engine } = setup();
    const nodes = [0, 1, 2].map(() => engine.scene.createNode());
    const playbacks = nodes.map((n, i) => engine.animate(n, { y: 100 * (i + 1), duration: 100 * (i + 1) }).play());
    clock.advance(100);
    expect(nodes.map((n) => n.y)).toEqual([100, 100, 100]);
    expect(engine.playbackCount).toBe(2);
    clock.advance(200);
    expect(nodes.map((n) => n.y)).toEqual([100, 200, 300]);
    const results = await Promise.all(playbacks.map((p) => p.finished));
    expect(results.every((r) => r.status === 'completed')).toBe(true);
  });

  it('rejects invalid animations synchronously without side effects', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    clock.advance(16);
    expect(() => engine.animate(node, { x: Number.NaN })).toThrow(InvalidOptionError);
    expect(() => engine.animate(node, { duration: 10 })).toThrow(InvalidOptionError);
    expect(() => engine.animate(node, { ['width' as 'x']: 10 })).toThrow('no animatable property');
    expect(() => engine.run({} as never)).toThrow(InvalidOptionError);
    expect(() => tween(objectTarget({ v: 0 }), { v: 1 }).play()).toThrow('engine.run');
    expect(engine.playbackCount).toBe(0);
    expect(clock.subscriberCount).toBe(0);
  });

  it('completes zero-duration animations on the first frame', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const playback = engine.animate(node, { x: 42, duration: 0 }).play();
    expect(node.x).toBe(42); // initial state is applied immediately
    clock.advance(0);
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
  });

  it('refuses to run an animation twice at once or one that is inside a timeline', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const t = engine.animate(node, { x: 10, duration: 50 });
    t.play();
    expect(() => t.play()).toThrow('already playing');
    const inner = engine.animate(node, { y: 10 });
    engine.timeline().add(inner);
    expect(() => engine.run(inner)).toThrow('part of a timeline');
    clock.advance(60);
    node.x = 0;
    const again = t.play(); // allowed after it ended; start values are captured again
    clock.advance(25);
    expect(node.x).toBe(5);
    await expect(Promise.resolve(again.status)).resolves.toBe('playing');
  });
});

describe('Playback control', () => {
  it('pauses and resumes without losing time', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const playback = engine.animate(node, { x: 100, duration: 100 }).play();
    clock.advance(30);
    playback.pause();
    expect(playback.status).toBe('paused');
    clock.advance(500);
    expect(node.x).toBe(30);
    expect(clock.subscriberCount).toBe(0); // nothing to animate while paused
    playback.resume();
    clock.advance(20);
    expect(node.x).toBe(50);
  });

  it('cancel leaves values where they are; stop restores the initial state', async () => {
    const { clock, engine } = setup();
    const a = engine.scene.createNode({ x: 0 });
    const b = engine.scene.createNode({ x: 0 });
    const pa = engine.animate(a, { x: 100, duration: 100 }).play();
    const pb = engine.animate(b, { x: 100, duration: 100 }).play();
    clock.advance(40);
    pa.cancel();
    pb.stop();
    pa.cancel();
    pb.stop();
    expect(a.x).toBe(40);
    expect(b.x).toBe(0);
    await expect(pa.finished).resolves.toEqual({ status: 'cancelled', reason: 'user' });
    await expect(pb.finished).resolves.toEqual({ status: 'stopped', reason: 'user' });
    clock.advance(100);
    expect(a.x).toBe(40);
  });

  it('seeks forwards and backwards without emitting markers', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const markers: string[] = [];
    const tl = engine.timeline().add(engine.animate(node, { x: 100, duration: 100 })).mark('half', 50);
    const playback = tl.play();
    playback.on('marker', (m) => markers.push(m.name));
    playback.seek(80);
    expect(node.x).toBe(80);
    playback.seek(10);
    expect(node.x).toBe(10);
    clock.advance(20);
    expect(node.x).toBe(30);
    expect(markers).toEqual([]);
    clock.advance(30);
    expect(markers).toEqual(['half']);
    expect(() => {
      playback.seek(-1);
    }).toThrow(InvalidOptionError);
  });

  it('seeks while paused and stays paused', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const playback = engine.animate(node, { x: 100, duration: 100 }).play();
    playback.pause();
    playback.seek(75);
    clock.advance(100);
    expect(node.x).toBe(75);
    expect(playback.status).toBe('paused');
  });

  it('finish jumps to the end and delivers skipped markers flagged as skipped', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const seen: MarkerEvent[] = [];
    const calls: boolean[] = [];
    const tl = engine
      .timeline()
      .add(engine.animate(node, { x: 100, duration: 100 }))
      .mark('a', 20)
      .mark('b', 80)
      .call((info) => calls.push(info.skipped), 90);
    const playback = tl.play();
    playback.on('marker', (m) => seen.push(m));
    clock.advance(30);
    playback.finish();
    expect(node.x).toBe(100);
    expect(seen.map((m) => [m.name, m.skipped])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    expect(calls).toEqual([true]);
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
  });

  it('finishes an endless loop at the end of the current iteration', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const playback = engine.animate(node, { x: 100, duration: 100, repeat: Infinity }).play();
    clock.advance(250);
    expect(node.x).toBe(50);
    playback.finish();
    expect(node.x).toBe(100);
    expect(playback.time).toBe(300);
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
  });

  it('emits loop events and keeps going forever with repeat: Infinity', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const loops: number[] = [];
    const playback = engine.animate(node, { x: 10, duration: 100, repeat: Infinity }).play();
    playback.on('loop', (e) => loops.push(e.iteration));
    clock.advance(350, { frameMs: 16 });
    expect(loops).toEqual([1, 2, 3]);
    expect(playback.status).toBe('playing');
    expect(playback.duration).toBe(Infinity);
  });
});

describe('Timeline events and timing', () => {
  it('fires an impact marker with objects at the exact impact position, even between frames', () => {
    const { clock, engine } = setup();
    const card = engine.scene.createNode({ x: 0, y: 500 });
    const tl = engine
      .timeline()
      .add(engine.animate(card, { y: 200, rotation: 360, duration: 500, easing: 'easeOutQuad' }))
      .add(engine.animate(card, { y: 500, duration: 700, easing: 'easeInQuad' }))
      .mark('impact');
    const impacts: { time: number; y: number; frameTime: number }[] = [];
    const playback = tl.play();
    playback.onMarker('impact', (e) => impacts.push({ time: e.time, y: card.y, frameTime: engine.now() }));
    clock.advance(1199);
    expect(impacts).toEqual([]);
    clock.advance(40); // the frame lands 39 ms after the impact
    expect(impacts).toEqual([{ time: 1200, y: 500, frameTime: 1239 }]);
  });

  it('delivers events in time order, then start/loop/end in lifecycle order', async () => {
    const { clock, engine } = setup();
    const log: string[] = [];
    engine.on('playbackStart', () => log.push('engine:start'));
    engine.on('playbackEnd', ({ result }) => log.push(`engine:end:${result.status}`));
    const tl = engine
      .timeline({ repeat: 1 })
      .add(engine.wait(100))
      .mark('m1', 10)
      .call(() => log.push('call@50'), 50)
      .mark('m2', 50)
      .mark('m0', 0);
    const playback = tl.play();
    playback.on('start', () => log.push('start')); // added after play: start was already emitted
    playback.on('marker', (m) => log.push(`${m.name}@${String(m.time)}`));
    playback.on('loop', (e) => log.push(`loop${String(e.iteration)}`));
    playback.on('end', (e) => log.push(`end:${e.result.status}`));
    clock.advance(1000); // one big frame covering both iterations
    await playback.finished;
    expect(log).toEqual([
      'engine:start',
      'm0@0',
      'm1@10',
      'call@50',
      'm2@50',
      'm0@100',
      'm1@110',
      'call@50',
      'm2@150',
      'loop1',
      'engine:end:completed',
      'end:completed',
    ]);
  });

  it('pausing from a marker listener freezes exactly at the marker', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const tl = engine.timeline().add(engine.animate(node, { x: 100, duration: 100 })).mark('stop', 40);
    const playback = tl.play();
    playback.onMarker('stop', () => {
      playback.pause();
    });
    clock.advance(90);
    expect(node.x).toBe(40);
    expect(playback.time).toBe(40);
    playback.resume();
    clock.advance(10);
    expect(node.x).toBe(50);
  });

  it('cancelling from a marker listener stops further events and rendering', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const seen: string[] = [];
    const tl = engine.timeline().add(engine.animate(node, { x: 100, duration: 100 })).mark('a', 20).mark('b', 60);
    const playback = tl.play();
    playback.on('marker', (m) => {
      seen.push(m.name);
      playback.cancel();
    });
    clock.advance(100);
    expect(seen).toEqual(['a']);
    expect(node.x).toBe(20);
    await expect(playback.finished).resolves.toEqual({ status: 'cancelled', reason: 'user' });
  });

  it('reports listener and callback errors without breaking playback', async () => {
    const { clock, engine, errors } = setup();
    const node = engine.scene.createNode();
    const tl = engine
      .timeline()
      .add(engine.animate(node, { x: 100, duration: 100 }))
      .call(() => {
        throw new Error('callback');
      }, 10);
    const playback = tl.play();
    playback.on('marker', () => undefined);
    playback.onMarker('x', () => undefined);
    clock.advance(200);
    expect(errors).toHaveLength(1);
    await expect(playback.finished).resolves.toEqual({ status: 'completed' });
  });

  it('starts an effect at the impact marker at the node world position (motion → impact → explosion)', () => {
    const { clock, engine } = setup();
    const table = engine.scene.createNode({ x: 200, y: 300 });
    const card = engine.scene.createNode({ parent: table, shape: { type: 'rect', width: 40, height: 60, color: '#fff' } });
    const tl = engine
      .timeline()
      .add(engine.animate(card, { y: -200, rotation: 180, duration: 300, easing: 'easeOutQuad' }))
      .add(engine.animate(card, { y: 0, rotation: 360, duration: 400, easing: 'easeInQuad' }))
      .mark('impact')
      .add(engine.animate(card, { scale: 1.2, duration: 100, yoyo: true, repeat: 1 }));
    const playback = tl.play();
    const positions: { x: number; y: number }[] = [];
    playback.onMarker('impact', () => {
      const position = card.getWorldPosition();
      positions.push(position);
      engine.play('particle-burst', { position, count: 10, duration: 300 });
    });
    clock.advance(1000, { frameMs: 16 });
    expect(positions).toEqual([{ x: 200, y: 300 }]);
    expect(engine.activeCount).toBe(1);
    const [scene] = engine.drawables as [SceneDrawable];
    expect(scene.kind).toBe('scene');
    expect(card.scale).toBe(1);
  });
});

describe('Interruption', () => {
  it('a new animation takes over overlapping properties of a running one (overwrite auto)', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const first = engine.animate(node, { x: 100, y: 100, duration: 100 }).play();
    const interrupted: string[][] = [];
    first.on('interrupted', (e) => interrupted.push([...e.properties]));
    clock.advance(50);
    engine.animate(node, { x: -100, duration: 100 }).play();
    clock.advance(50);
    expect(interrupted).toEqual([['x']]);
    expect(node.x).toBe(-25); // from 50 to -100, halfway
    expect(node.y).toBe(100); // y still driven by the first animation
  });

  it('treats scale as overlapping with scaleX/scaleY', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const first = engine.animate(node, { scale: 2, duration: 100 }).play();
    const seen: string[][] = [];
    first.on('interrupted', (e) => seen.push([...e.properties]));
    engine.animate(node, { scaleX: 3, duration: 100 }).play();
    clock.advance(100);
    expect(seen).toEqual([['scale']]);
    expect(node.scaleX).toBe(3);
    expect(node.scaleY).toBe(1); // the scale tween stopped writing both axes
  });

  it('overwrite none lets both write (the newest runs last and wins)', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const first = engine.animate(node, { x: 100, duration: 100 }).play();
    const seen = jest.fn();
    first.on('interrupted', seen);
    engine.animate(node, { x: 0, from: { x: 0 }, duration: 100, overwrite: 'none' }).play();
    clock.advance(50);
    expect(seen).not.toHaveBeenCalled();
    expect(node.x).toBe(0);
  });
});

describe('Scene nodes during animation', () => {
  it('removing a node keeps it animating; destroying it makes animations skip it safely', async () => {
    const { clock, engine } = setup();
    const a = engine.scene.createNode();
    const b = engine.scene.createNode();
    const pa = engine.animate(a, { x: 100, duration: 100 }).play();
    const pb = engine.animate(b, { x: 100, duration: 100 }).play();
    clock.advance(30);
    a.removeFromParent();
    b.destroy();
    clock.advance(30);
    expect(a.x).toBe(60);
    expect(b.x).toBe(30);
    clock.advance(100);
    await expect(Promise.all([pa.finished, pb.finished])).resolves.toEqual([
      { status: 'completed' },
      { status: 'completed' },
    ]);
  });

  it('animates children through their parent (hierarchical transforms)', () => {
    const { clock, engine } = setup();
    const arm = engine.scene.createNode({ x: 100, y: 100 });
    const hand = engine.scene.createNode({ parent: arm, x: 50 });
    engine.animate(arm, { rotation: 90, duration: 100 }).play();
    clock.advance(100);
    const p = hand.getWorldPosition();
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(150, 9);
  });

  it('updates attachments after animations each frame', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const ys: number[] = [];
    node.attach({ update: (s) => ys.push(s.y) });
    engine.animate(node, { y: 100, duration: 100 }).play();
    clock.advance(50);
    clock.advance(50);
    expect(ys.slice(-2)).toEqual([50, 100]);
  });

  it('publishes scene shapes below effects', () => {
    const { clock, engine } = setup();
    engine.scene.createNode({ shape: { type: 'circle', radius: 5, color: 'red' } });
    engine.play('particle-burst', { position: { x: 0, y: 0 }, count: 5 });
    clock.advance(16);
    expect(engine.drawables.map((d) => d.kind)).toEqual(['scene', 'particles']);
  });
});

describe('Engine control', () => {
  it('pause freezes every playback and effect; resume continues without a jump', () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    engine.animate(node, { x: 100, duration: 100 }).play();
    const effect = engine.play('particle-burst', { position: { x: 0, y: 0 }, count: 5, duration: 200 });
    clock.advance(40);
    engine.pause();
    expect(engine.state).toBe('paused');
    clock.advance(1000);
    expect(node.x).toBe(40);
    expect(effect.status).toBe('playing');
    engine.resume();
    clock.advance(10);
    expect(node.x).toBe(50);
    expect(engine.now()).toBe(50);
  });

  it('pauses and resumes a single effect', async () => {
    const { clock, engine } = setup();
    const effect = engine.play('particle-burst', { position: { x: 0, y: 0 }, count: 5, duration: 100 });
    clock.advance(50);
    effect.pause();
    expect(effect.status).toBe('paused');
    clock.advance(500);
    expect(engine.activeCount).toBe(1);
    effect.resume();
    clock.advance(60);
    await expect(effect.finished).resolves.toEqual({ status: 'completed' });
  });

  it('reset stops playbacks back to their initial state and cancels effects', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode({ x: 5 });
    const tl = engine.sequence([engine.animate(node, { x: 50, duration: 50 }), engine.animate(node, { x: 100, duration: 50 })]);
    const playback = tl.play();
    const effect = engine.play('particle-burst', { position: { x: 0, y: 0 } });
    clock.advance(75);
    engine.reset();
    expect(node.x).toBe(5);
    await expect(playback.finished).resolves.toEqual({ status: 'stopped', reason: 'reset' });
    await expect(effect.finished).resolves.toEqual({ status: 'cancelled', reason: 'reset' });
    expect(engine.state).toBe('running');
  });

  it('cancelAll cancels playbacks too', async () => {
    const { engine } = setup();
    const node = engine.scene.createNode();
    const playback = engine.animate(node, { x: 1 }).play();
    engine.cancelAll();
    await expect(playback.finished).resolves.toEqual<PlaybackResult>({ status: 'cancelled', reason: 'cancelAll' });
  });

  it('dispose cancels playbacks, ends attachments, destroys nodes and stops the clock', async () => {
    const { clock, engine } = setup();
    const node = engine.scene.createNode();
    const reasons: string[] = [];
    node.attach({ update: () => undefined, onDetach: (r) => reasons.push(r) });
    const playback = engine.animate(node, { x: 100 }).play();
    engine.dispose();
    engine.dispose();
    await expect(playback.finished).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(reasons).toEqual(['engineDisposed']);
    expect(node.destroyed).toBe(true);
    expect(clock.subscriberCount).toBe(0);
    expect(() => engine.animate(node, { x: 1 })).toThrow(DisposedError);
    expect(() => {
      engine.pause();
    }).toThrow(DisposedError);
  });

  it('is deterministic across runs', () => {
    const run = () => {
      const { clock, engine } = setup();
      const nodes = [0, 1, 2, 3].map((i) => engine.scene.createNode({ x: i * 10 }));
      engine
        .stagger(
          nodes.map((n) => engine.keyframes(n, { duration: 300, keyframes: [{ at: 0.5, y: -100, easing: 'easeOutCubic' }, { at: 1, y: 0, easing: 'easeInCubic' }] })),
          37,
        )
        .play();
      engine.play('particle-burst', { position: { x: 1, y: 2 }, count: 8 });
      const out: number[] = [];
      for (let i = 0; i < 30; i++) {
        clock.advance(13);
        out.push(...nodes.map((n) => n.y));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
