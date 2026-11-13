import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { FakeLoader } from '../assets/__tests__/fakeLoader';
import type { Playback } from '../animation/playback';
import type { EffectHandle, Engine } from '../engine/engine';
import type { ThrowAndExplodeSequence } from '../engine/sequences';
import { VirtualClock } from '../runtime/clock';
import { GameFXOverlay } from './GameFXOverlay';
import { GameFXProvider } from './GameFXProvider';
import type { GameFXProviderProps } from './GameFXProvider';
import { GameFXTarget } from './GameFXTarget';
import { useGameFX, useGameFXEngine } from './useGameFX';
import type { GameFX } from './useGameFX';

/** Window rectangles reported by the mocked `measureInWindow`, by testID. */
const windowRects = new Map<string, [number, number, number, number]>();
let measureCalls = 0;

beforeAll(async () => {
  // React Native's Jest preset shares one `measureInWindow` mock between all host views.
  const ref = createRef<ComponentRef<typeof View>>();
  await render(<View ref={ref} />);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the shared mock is configured, not called
  const mock = ref.current?.measureInWindow as unknown as jest.Mock;
  mock.mockImplementation(function (this: { props?: { testID?: string } }, callback: (...r: number[]) => void) {
    measureCalls++;
    const rect = windowRects.get(this.props?.testID ?? '') ?? [0, 0, 0, 0];
    callback(...rect);
  });
});

beforeEach(() => {
  windowRects.clear();
  measureCalls = 0;
  windowRects.set('overlay', [0, 0, 400, 800]);
  windowRects.set('card-target', [100, 300, 80, 120]);
});

let api: GameFX | null = null;
function ApiSpy() {
  api = useGameFX();
  return null;
}
let engineRef: Engine | null = null;
function EngineSpy() {
  engineRef = useGameFXEngine();
  return null;
}

/** An ordinary app screen: a styled card view with a button inside. */
function Screen({ clock, card = true, tick = 0, provider = {} }: { clock: VirtualClock; card?: boolean; tick?: number; provider?: Partial<GameFXProviderProps> }) {
  const [pressed, setPressed] = useState(0);
  return (
    <GameFXProvider clock={clock} imageLoader={new FakeLoader()} {...provider}>
      <View>
        {card ? (
          <GameFXTarget id="card" testID="card-target" style={[styles.card, { borderWidth: tick % 2 }]}>
            <Pressable testID="card-button" onPress={() => { setPressed((n) => n + 1); }}>
              <Text>{`pressed ${String(pressed)}`}</Text>
            </Pressable>
          </GameFXTarget>
        ) : null}
      </View>
      <ApiSpy />
      <EngineSpy />
      <GameFXOverlay testID="overlay" />
    </GameFXProvider>
  );
}

const styles = StyleSheet.create({
  card: { width: 80, height: 120, backgroundColor: '#204060', opacity: 0.9, transform: [{ skewX: '5deg' }] },
});

const fx = (): GameFX => {
  if (!api) throw new Error('no api');
  return api;
};
const engine = (): Engine => {
  if (!engineRef) throw new Error('no engine');
  return engineRef;
};
const cardStyle = () => StyleSheet.flatten(screen.getByTestId('card-target').props.style as object) as {
  transform: Record<string, unknown>[];
  opacity: number;
};

describe('GameFXTarget transform binding (engine-driven motion of a real view)', () => {
  it('applies the motion to the view, after the engine transform keeps the style transform and multiplies opacity', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    expect(cardStyle().transform).toEqual([
      { translateX: 0 },
      { translateY: 0 },
      { rotate: '0deg' },
      { scaleX: 1 },
      { scaleY: 1 },
      { skewX: '5deg' },
    ]);
    const motion = fx().getTarget('card')?.motion;
    if (!motion) throw new Error('no motion');
    await act(() => {
      motion.x = 30;
      motion.y = -12;
      motion.rotation = 45;
      motion.scale = 1.5;
      motion.opacity = 0.5;
    });
    // The mock re-evaluates animated styles on render; the shared values hold the new numbers.
    await view.rerender(<Screen clock={clock} tick={1} />);
    expect(cardStyle().transform.slice(0, 5)).toEqual([{ translateX: 30 }, { translateY: -12 }, { rotate: '45deg' }, { scaleX: 1.5 }, { scaleY: 1.5 }]);
    expect(cardStyle().opacity).toBeCloseTo(0.45, 9);
    // The proxy node (what effects follow) uses the same numbers on top of the measured layout.
    const node = fx().getTarget('card')?.node;
    expect([node?.x, node?.y, node?.rotation]).toEqual([170, 348, 45]);
  });

  it('defers measuring while the view is transformed, then measures its untransformed box', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} />);
    const motion = fx().getTarget('card')?.motion;
    if (!motion) throw new Error('no motion');
    await act(() => {
      motion.x = 50;
    });
    const before = measureCalls;
    windowRects.set('card-target', [100, 200, 80, 120]); // e.g. the list scrolled meanwhile
    await act(() => {
      fx().remeasure('card');
    });
    expect(measureCalls).toBe(before);
    await act(() => {
      motion.x = 0;
    });
    expect(measureCalls).toBe(before + 1);
    expect(engine().targets.layout('card')).toMatchObject({ x: 100, y: 200 });
  });

  it('throw & explode moves the real view, explodes at the impact, and leaves it where it was', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    let seq: ThrowAndExplodeSequence | null = null;
    const fired: EffectHandle[] = [];
    await act(() => {
      seq = fx().throwAndExplode('card', { throw: { height: 200, distance: 60, duration: 800 }, settleDelay: 300, returnDuration: 200 });
      seq.explosion?.onFire((h) => fired.push(h));
    });
    await act(() => {
      clock.advance(400, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={1} />);
    const midFlight = cardStyle().transform[1] as { translateY: number };
    expect(midFlight.translateY).toBeLessThan(-150);
    await act(() => {
      clock.advance(450, { frameMs: 16 });
    });
    expect(fired.map((h) => h.effect)).toEqual(['explosion']);
    await act(() => {
      clock.advance(3000, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={2} />);
    expect(cardStyle().transform.slice(0, 3)).toEqual([{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }]);
    expect(engine().activeCount).toBe(0);
    // The button inside the view still works after its flight.
    await fireEvent.press(screen.getByTestId('card-button'));
    expect(screen.getByText('pressed 1')).toBeTruthy();
  });

  it('unmounting the view mid-sequence cancels it cleanly; remounting starts untransformed', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    let seq: ThrowAndExplodeSequence | null = null;
    await act(() => {
      fx().attach('card', { effect: 'fire-border', intensity: 1 });
      seq = fx().throwAndExplode('card');
      clock.advance(300, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} card={false} />);
    await act(() => {
      clock.advance(2000, { frameMs: 16 });
    });
    await expect((seq as unknown as ThrowAndExplodeSequence).playback.finished).resolves.toMatchObject({ status: 'cancelled' });
    expect(engine().activeCount).toBe(0);
    expect(engine().scene.attachmentCount).toBe(0);
    expect(engine().camera).toEqual({ x: 0, y: 0, rotation: 0 });
    await view.rerender(<Screen clock={clock} />);
    expect(cardStyle().transform.slice(0, 3)).toEqual([{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }]);
  });

  it('shake scoped to a target moves only that view and restores it', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    await act(() => {
      fx().play('screen-shake', { scope: 'card', amplitude: 10, duration: 300 });
      clock.advance(100, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={1} />);
    const shaking = cardStyle().transform[0] as { translateX: number };
    expect(shaking.translateX).not.toBe(0);
    expect(engine().camera).toEqual({ x: 0, y: 0, rotation: 0 });
    await act(() => {
      clock.advance(300, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={2} />);
    expect(cardStyle().transform[0]).toEqual({ translateX: 0 });
    expect(engine().targets.layout('card')).toMatchObject({ x: 100, y: 300, width: 80, height: 120 });
  });
});

describe('Phase 4 API through useGameFX', () => {
  it('attach(target, { effect, ...params }) runs the fire border on an ordinary view; handles update and stop it', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} />);
    let fire: EffectHandle | null = null;
    await act(() => {
      fire = fx().attach('card', { effect: 'fire-border', intensity: 0.6, flameHeight: 20, color: '#FF5500', glow: true, sparks: true });
      clock.advance(100, { frameMs: 16 });
    });
    const handle = fire as unknown as EffectHandle;
    expect(handle.effect).toBe('fire-border');
    expect(engine().drawables.length).toBeGreaterThan(0);
    await act(() => {
      handle.setIntensity(1.4);
      handle.stop();
      clock.advance(2000, { frameMs: 16 });
    });
    await expect(handle.finished).resolves.toEqual({ status: 'completed' });
  });

  it('timeline, cue and throw are available on the hook and run on the engine clock', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} />);
    const started: string[] = [];
    await act(() => {
      const playback = fx()
        .timeline()
        .add(fx().throw('card', { height: 100, duration: 400 }))
        .add(fx().cue('golden-sparks', { target: 'card', follow: false }))
        .play();
      playback.onMarker('impact', () => started.push('impact'));
      engine().on('effectStart', ({ handle }) => started.push(handle.effect));
      clock.advance(500, { frameMs: 16 });
    });
    expect(started).toEqual(['impact', 'golden-sparks']);
  });

  it('exposes and changes quality; the provider prop sets it', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} provider={{ quality: 'low' }} />);
    expect(fx().quality).toBe('low');
    await view.rerender(<Screen clock={clock} provider={{ quality: 'medium' }} />);
    expect(engine().quality.level).toBe('medium');
    await act(() => {
      fx().setQuality('high');
    });
    expect(fx().quality).toBe('high');
  });

  it('reduced motion follows the system setting by default and can be forced', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValueOnce(true);
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fx().reducedMotion).toBe(true);
    await view.rerender(<Screen clock={clock} provider={{ reducedMotion: false }} />);
    expect(engine().reducedMotion).toBe(false);
  });

  it('the overlay reports renderer capabilities so effects pick a supported path', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    expect(engine().rendererCapabilities?.runtimeShaders).toBe(true);
    expect(engine().rendererCapabilities?.nodeEffects).toContain('distort');
    await view.unmount();
  });

  it('runs the composition example: getTarget, attach, animate, explosion, stop', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    const target = fx().getTarget('card');
    if (!target) throw new Error('no target');
    let fire: EffectHandle | null = null;
    let move: Playback | null = null;
    await act(() => {
      fire = fx().attach(target, { effect: 'fire-border', intensity: 0.8 });
      move = fx().animate(target, { x: 120, y: -80, rotation: 360, duration: 1000 });
      clock.advance(1000, { frameMs: 16 });
    });
    await expect((move as unknown as Playback).finished).resolves.toEqual({ status: 'completed' });
    await view.rerender(<Screen clock={clock} tick={1} />);
    expect(cardStyle().transform.slice(0, 3)).toEqual([{ translateX: 120 }, { translateY: -80 }, { rotate: '360deg' }]);
    // The fire followed the view: its proxy node is at the layout centre plus the motion.
    expect([target.node.x, target.node.y]).toEqual([140 + 120, 360 - 80]);
    let boom: EffectHandle | null = null;
    await act(() => {
      boom = fx().play('explosion', { target, intensity: 1 });
      (fire as unknown as EffectHandle).stop();
      clock.advance(3000, { frameMs: 16 });
    });
    await expect((boom as unknown as EffectHandle).finished).resolves.toEqual({ status: 'completed' });
    await expect((fire as unknown as EffectHandle).finished).resolves.toEqual({ status: 'completed' });
    expect(engine().activeCount).toBe(0);
    expect(() => fx().animate('nope', { x: 1 })).toThrow(/Unknown target "nope"/);
  });
});
