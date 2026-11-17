/**
 * Release lifecycle suite (Phase 5): the ten lifecycle scenarios of the release checklist,
 * run through the real provider, overlay, targets and engine (Reanimated's official mock, real
 * CanvasKit drawing). Every scenario ends by checking `engine.stats`: no effects, playbacks,
 * targets, local layers, scene nodes or frame-loop subscription may be left behind.
 */
import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';
import type { ComponentRef } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { FakeLoader } from '../assets/__tests__/fakeLoader';
import { builtInEffects } from '../effects';
import { createEngine } from '../engine/engine';
import type { Engine, EngineStats } from '../engine/engine';
import { isParticleDrawable } from '../particles/burst';
import { VirtualClock } from '../runtime/clock';
import { defineEffect } from '../runtime/effect';
import { DisposedError, InvalidOptionError, NotReadyError } from '../runtime/errors';
import { GameFXOverlay } from './GameFXOverlay';
import { GameFXProvider } from './GameFXProvider';
import type { GameFXProviderProps } from './GameFXProvider';
import { GameFXTarget } from './GameFXTarget';
import { useGameFX, useGameFXEngine } from './useGameFX';
import type { GameFX } from './useGameFX';

const windowRects = new Map<string, [number, number, number, number]>();

beforeAll(async () => {
  const ref = createRef<ComponentRef<typeof View>>();
  await render(<View ref={ref} />);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the shared mock is configured, not called
  const mock = ref.current?.measureInWindow as unknown as jest.Mock;
  mock.mockImplementation(function (this: { props?: { testID?: string } }, callback: (...r: number[]) => void) {
    callback(...(windowRects.get(this.props?.testID ?? '') ?? [0, 0, 0, 0]));
  });
});

beforeEach(() => {
  windowRects.clear();
  windowRects.set('overlay', [0, 0, 400, 800]);
  ['a1', 'a2', 'a3', 'b1'].forEach((id, i) => windowRects.set(`t-${id}`, [40 + i * 90, 200, 80, 120]));
});

let api: GameFX | null = null;
let engineRef: Engine | null = null;
function Spy() {
  api = useGameFX();
  engineRef = useGameFXEngine();
  return null;
}
const fx = (): GameFX => {
  if (!api) throw new Error('no api');
  return api;
};
const engine = (): Engine => {
  if (!engineRef) throw new Error('no engine');
  return engineRef;
};

const SCREENS = { a: ['a1', 'a2', 'a3'], b: ['b1'], none: [] } as const;
type ScreenName = keyof typeof SCREENS;

/** An app: a provider around one of three "screens" of card views, and the overlay. */
function App({ clock, screen = 'a', provider = {}, mounted = true }: { clock: VirtualClock; screen?: ScreenName; provider?: Partial<GameFXProviderProps>; mounted?: boolean }) {
  if (!mounted) return <Text>no effects here</Text>;
  return (
    <GameFXProvider clock={clock} imageLoader={new FakeLoader()} seed={7} {...provider}>
      <View key={screen}>
        {SCREENS[screen].map((id) => (
          <GameFXTarget key={id} id={id} testID={`t-${id}`} style={styles.card}>
            <Text>{id}</Text>
          </GameFXTarget>
        ))}
      </View>
      <Spy />
      <GameFXOverlay testID="overlay" />
    </GameFXProvider>
  );
}
const styles = StyleSheet.create({ card: { width: 80, height: 120 } });

const idle = (extra: Partial<EngineStats> = {}): Partial<EngineStats> => ({
  state: 'running',
  activeEffects: 0,
  playbacks: 0,
  localLayers: 0,
  frameLoop: false,
  ...extra,
});

async function advance(clock: VirtualClock, ms: number) {
  await act(() => {
    clock.advance(ms, { frameMs: 16 });
  });
}

let errors: jest.SpyInstance;
beforeEach(() => {
  api = null;
  engineRef = null;
  errors = jest.spyOn(console, 'error');
});
afterEach(() => {
  // No React warnings (state updates after unmount, act warnings, key warnings).
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

describe('release lifecycle scenarios', () => {
  it('1. mounts and unmounts the provider 25 times with effects running, leaving nothing behind', async () => {
    const clock = new VirtualClock();
    const engines: Engine[] = [];
    const view = await render(<App clock={clock} />);
    for (let i = 0; i < 25; i++) {
      await view.rerender(<App clock={clock} />);
      engines.push(engine());
      fx().attach('a1', 'fire-border', { intensity: 1 });
      fx().play('explosion', { position: { x: 200, y: 300 } });
      fx().throwAndExplode('a2');
      await advance(clock, 100);
      expect(engine().stats.activeEffects).toBeGreaterThan(0);
      await view.rerender(<App clock={clock} mounted={false} />);
    }
    expect(new Set(engines).size).toBe(25);
    for (const e of engines) {
      expect(e.stats).toMatchObject({ state: 'disposed', activeEffects: 0, playbacks: 0, targets: 0, frameLoop: false });
      expect(e.assets.stats.loaded).toBe(0);
    }
    expect(clock.subscriberCount).toBe(0);
    await view.unmount();
  });

  it('2. navigates between screens 20 times while effects run: effects of the left screen end, the rest finish', async () => {
    const clock = new VirtualClock();
    const view = await render(<App clock={clock} screen="a" />);
    const first = engine();
    for (let i = 0; i < 20; i++) {
      const fixed = [fx().attach('a1', 'fire-border', {}), fx().attach('a2', 'glow-pulse', {}), fx().attach('a3', 'smoke', { duration: 60_000 })];
      fx().play('confetti', { position: { x: 100, y: 100 } });
      await advance(clock, 50);
      await view.rerender(<App clock={clock} screen="b" />);
      expect(engine().stats).toMatchObject({ targets: 1, localLayers: 0 });
      // Effects fixed to the unmounted cards stop at once and let their last particles fade
      // (at most about two seconds); free confetti keeps falling.
      await advance(clock, 2500);
      expect(fixed.map((h) => h.status)).toEqual(['completed', 'completed', 'completed']);
      await view.rerender(<App clock={clock} screen="a" />);
    }
    await advance(clock, 6000);
    expect(engine()).toBe(first);
    expect(engine().stats).toMatchObject(idle({ targets: 3, sceneNodes: 3 }));
    await view.rerender(<App clock={clock} screen="none" />);
    // One frame publishes the now empty scene, then the frame loop stops.
    await advance(clock, 16);
    expect(engine().stats).toMatchObject(idle({ targets: 0, sceneNodes: 0 }));
  });

  it('3. cancels effects and sequences during execution and restores the views', async () => {
    const clock = new VirtualClock();
    await render(<App clock={clock} />);
    const fire = fx().attach('a1', 'fire-border', {});
    const blast = fx().play('explosion', { position: { x: 100, y: 100 } });
    const seq = fx().throwAndExplode('a2', { afterImpact: 'vanish' });
    const burn = fx().play('burn-away', { target: 'a3' });
    await advance(clock, 700);
    const motion = fx().getTarget('a2')?.motion;
    expect(motion?.y).not.toBe(0);
    fire.cancel();
    blast.cancel();
    seq.playback.cancel();
    burn.cancel();
    expect(await fire.finished).toMatchObject({ status: 'cancelled' });
    expect(await seq.playback.finished).toMatchObject({ status: 'cancelled' });
    expect(motion).toMatchObject({ x: 0, y: 0, rotation: 0, opacity: 1 });
    expect(fx().getTarget('a3')?.motion.opacity).toBe(1);
    expect(engine().targets.concealOpacity('a3')).toBe(1);
    await advance(clock, 16);
    expect(engine().stats).toMatchObject(idle({ targets: 3 }));
  });

  it('4. cancels and immediately replays Throw & Explode 50 times: one sequence runs, then nothing', async () => {
    const clock = new VirtualClock();
    await render(<App clock={clock} />);
    let seq = fx().throwAndExplode('a2');
    for (let i = 0; i < 50; i++) {
      await advance(clock, 37);
      seq.playback.cancel();
      seq = fx().throwAndExplode('a2');
      expect(engine().stats.playbacks).toBe(1);
    }
    expect(await Promise.race([seq.playback.finished, (async () => { await advance(clock, 8000); return seq.playback.finished; })()])).toMatchObject({ status: 'completed' });
    await advance(clock, 3000);
    expect(engine().stats).toMatchObject(idle({ targets: 3 }));
    expect(fx().getTarget('a2')?.motion).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });

  it('5. removes targets while effects run on them', async () => {
    const clock = new VirtualClock();
    const view = await render(<App clock={clock} screen="a" />);
    const handles = [
      fx().attach('a1', 'fire-border', {}),
      fx().attach('a1', 'smoke', { duration: 5000 }),
      fx().play('burn-away', { target: 'a2' }),
      fx().attach('a3', 'trail', {}),
    ];
    const seq = fx().throwAndExplode('a3');
    // An endless animation of a view that the app forgets to cancel.
    const spin = fx().animate('a2', { rotation: 360, duration: 800, repeat: Infinity });
    await advance(clock, 300);
    await view.rerender(<App clock={clock} screen="none" />);
    expect(engine().stats).toMatchObject({ targets: 0, localLayers: 0 });
    // The sequence on a removed view is cancelled at once; effects bound to removed views stop
    // emitting and complete once their last particles faded.
    expect((await seq.playback.finished).status).toBe('cancelled');
    await advance(clock, 16);
    expect(await spin.finished).toEqual({ status: 'cancelled', reason: 'targetDestroyed' });
    await advance(clock, 3000);
    const results = await Promise.all(handles.map((h) => h.finished));
    for (const r of results) expect(r.status).toBe('completed');
    expect(engine().stats).toMatchObject(idle({ targets: 0, sceneNodes: 0 }));
  });

  it('6. runs several effects on one target at once and ends each independently', async () => {
    const clock = new VirtualClock();
    const view = await render(<App clock={clock} />);
    const fire = fx().attach('a1', 'fire-border', {});
    const pulse = fx().attach('a1', 'glow-pulse', {});
    const trail = fx().attach('a1', 'trail', {});
    const sparks = fx().attach('a1', 'golden-sparks', {});
    fx().animate('a1', { x: 80, rotation: 90, duration: 500 });
    await advance(clock, 250);
    expect(engine().stats.activeEffects).toBe(4);
    pulse.cancel();
    await advance(clock, 16);
    expect(fire.status).toBe('playing');
    expect(trail.status).toBe('playing');
    expect(engine().stats.activeEffects).toBeLessThanOrEqual(3);
    await view.rerender(<App clock={clock} screen="b" />);
    await advance(clock, 3000);
    expect([fire.status, trail.status, sparks.status].every((s) => s !== 'playing')).toBe(true);
    expect(engine().stats).toMatchObject(idle({ targets: 1 }));
  });

  it('7. changes the quality while effects run: running effects continue, new ones use the new level', async () => {
    const clock = new VirtualClock();
    const view = await render(<App clock={clock} provider={{ quality: 'high' }} />);
    const particles = () => engine().drawables.filter(isParticleDrawable).reduce((n, d) => n + d.aliveCount, 0);
    const glow = fx().attach('a1', 'glow-border', {});
    const confetti = fx().play('confetti', { position: { x: 100, y: 100 } });
    await advance(clock, 50);
    const highCount = particles();
    expect(highCount).toBeGreaterThan(0);
    await view.rerender(<App clock={clock} provider={{ quality: 'low' }} />);
    expect(fx().quality).toBe('low');
    await advance(clock, 16);
    // Running effects keep going with the detail they started with.
    expect(glow.status).toBe('playing');
    expect(confetti.status).toBe('playing');
    confetti.cancel();
    const lowConfetti = fx().play('confetti', { position: { x: 100, y: 100 } });
    await advance(clock, 50);
    expect(particles()).toBeGreaterThan(0);
    expect(particles()).toBeLessThan(highCount);
    fx().setQuality('medium');
    expect(fx().quality).toBe('medium');
    glow.cancel();
    lowConfetti.cancel();
    await advance(clock, 3000);
    expect(engine().stats).toMatchObject(idle({ targets: 3 }));
  });

  it('8. pauses while the app is in the background and continues where it was', async () => {
    const listeners: ((s: AppStateStatus) => void)[] = [];
    const fake = (type: string, listener: (s: AppStateStatus) => void) => {
      if (type === 'change') listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
    };
    const spy = jest.spyOn(AppState, 'addEventListener');
    const original = spy.getMockImplementation();
    spy.mockImplementation(fake);
    const clock = new VirtualClock();
    const view = await render(<App clock={clock} />);
    const seq = fx().throwAndExplode('a2');
    await advance(clock, 300);
    const y = fx().getTarget('a2')?.motion.y;
    await act(() => {
      listeners.forEach((l) => { l('background'); });
    });
    expect(engine().stats).toMatchObject({ state: 'paused', frameLoop: false });
    await advance(clock, 60_000);
    expect(fx().getTarget('a2')?.motion.y).toBe(y);
    await act(() => {
      listeners.forEach((l) => { l('active'); });
    });
    expect(engine().stats.state).toBe('running');
    await advance(clock, 16);
    expect(seq.playback.status).toBe('playing');
    // An engine the app paused itself stays paused across background and foreground.
    engine().pause();
    await act(() => {
      listeners.forEach((l) => { l('background'); });
      listeners.forEach((l) => { l('active'); });
    });
    expect(engine().stats.state).toBe('paused');
    engine().resume();
    // pauseInBackground={false}: the app handles it.
    await view.rerender(<App clock={clock} provider={{ pauseInBackground: false }} />);
    await act(() => {
      listeners.forEach((l) => { l('background'); });
    });
    expect(engine().stats.state).toBe('running');
    await view.unmount();
    expect(listeners).toHaveLength(0);
    if (original) spy.mockImplementation(original);
    else spy.mockRestore();
  });

  it('9. initializes and shuts down 200 engines without leaking clock subscriptions or images', () => {
    const clock = new VirtualClock();
    for (let i = 0; i < 200; i++) {
      const e = createEngine({ clock, effects: builtInEffects, seed: i });
      const node = e.scene.createNode({ x: 10, y: 10, shape: { type: 'rect', width: 20, height: 20, fill: '#fff' } });
      e.play('explosion', { position: { x: 50, y: 50 } });
      e.attach(node, 'fire-border', {});
      e.animate(node, { x: 100, duration: 500 }).play();
      clock.advance(32, { frameMs: 16 });
      e.dispose();
      expect(e.stats).toMatchObject({ state: 'disposed', activeEffects: 0, playbacks: 0, sceneNodes: 0, frameLoop: false });
      expect(() => e.play('explosion', { position: { x: 0, y: 0 } })).toThrow(DisposedError);
    }
    expect(clock.subscriberCount).toBe(0);
  });

  it('10. recovers from invalid parameters and failing custom effects', async () => {
    const clock = new VirtualClock();
    const onError = jest.fn();
    const broken = defineEffect<{ at: number }>({
      name: 'broken',
      create: ({ at }) => ({
        drawables: [],
        done: false,
        update: (ms) => {
          if (ms > at) throw new Error('custom effect failed');
        },
        dispose: () => undefined,
      }),
    });
    await render(<App clock={clock} provider={{ onError, effects: [broken] }} />);
    expect(() => fx().play('explosion', { position: { x: Number.NaN, y: 0 } })).toThrow(InvalidOptionError);
    expect(() => fx().play('fire-border', { target: 'a1', intensity: -1 })).toThrow(InvalidOptionError);
    expect(() => fx().play('no-such-effect', {})).toThrow(InvalidOptionError);
    expect(() => fx().attach('missing', 'fire-border', {})).toThrow(InvalidOptionError);
    expect(() => fx().animate('missing', { x: 1 })).toThrow(InvalidOptionError);
    const failing = fx().play(broken, { at: 100 });
    const ok = fx().play('particle-burst', { position: { x: 50, y: 50 }, count: 10, duration: 300 });
    await advance(clock, 500);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((await failing.finished).status).toBe('cancelled');
    expect((await ok.finished).status).toBe('completed');
    expect(engine().stats).toMatchObject(idle({ targets: 3 }));
    // The engine is still fully usable.
    const again = fx().attach('a1', 'fire-border', {});
    expect(again.status).toBe('playing');
    again.cancel();
  });

  it('reports NotReadyError (not a crash) when effects are started during the very first render', async () => {
    let caught: unknown = null;
    function Early() {
      const early = useGameFX();
      if (!early.ready) {
        try {
          early.play('confetti', { position: { x: 0, y: 0 } });
        } catch (error) {
          caught = error;
        }
      }
      return null;
    }
    await render(
      <GameFXProvider clock={new VirtualClock()} imageLoader={new FakeLoader()}>
        <Early />
      </GameFXProvider>,
    );
    expect(caught).toBeInstanceOf(NotReadyError);
  });
});
