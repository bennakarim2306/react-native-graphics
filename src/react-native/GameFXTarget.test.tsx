import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FakeLoader } from '../assets/__tests__/fakeLoader';
import type { EffectHandle, Engine } from '../engine/engine';
import { VirtualClock } from '../runtime/clock';
import type { SceneDrawable } from '../scene/scene';
import { GameFXOverlay } from './GameFXOverlay';
import { GameFXProvider } from './GameFXProvider';
import { GameFXTarget } from './GameFXTarget';
import { useGameFX, useGameFXEngine } from './useGameFX';

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
});

function EngineSpy({ onEngine }: { onEngine: (e: Engine) => void }) {
  const engine = useGameFXEngine();
  if (engine) onEngine(engine);
  return null;
}

function AttachButton({ onHandle }: { onHandle: (h: EffectHandle) => void }) {
  const fx = useGameFX();
  return (
    <Pressable testID="attach" onPress={() => { onHandle(fx.attach('card', 'glow-border', { color: '#0F0', pulse: 0, padding: 0 })); }}>
      <Text>Attach</Text>
    </Pressable>
  );
}

function App({ clock, showCard = true, onEngine, onHandle, track = false, onCardPress }: {
  clock: VirtualClock;
  onCardPress?: () => void;
  showCard?: boolean;
  onEngine: (e: Engine) => void;
  onHandle?: (h: EffectHandle) => void;
  track?: boolean;
}) {
  return (
    <GameFXProvider clock={clock} imageLoader={new FakeLoader()}>
      <View testID="screen">
        {showCard ? (
          <GameFXTarget id="card" testID="card-target" trackEveryFrame={track}>
            <Pressable testID="card-button" onPress={onCardPress}>
              <Text>Tap me</Text>
            </Pressable>
          </GameFXTarget>
        ) : null}
      </View>
      <AttachButton onHandle={onHandle ?? (() => undefined)} />
      <EngineSpy onEngine={onEngine} />
      <GameFXOverlay testID="overlay" />
    </GameFXProvider>
  );
}

function borderDrawable(engine: Engine): SceneDrawable | undefined {
  return engine.drawables.find((d): d is SceneDrawable => d.kind === 'scene' && (d as SceneDrawable).items[0]?.nodeId === -1);
}

describe('GameFXTarget', () => {
  it('measures the view relative to the overlay and keeps a proxy node in sync', async () => {
    windowRects.set('overlay', [0, 50, 400, 800]); // e.g. below a header
    windowRects.set('card-target', [100, 250, 80, 120]);
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    await render(<App clock={clock} onEngine={(e) => (engine = e)} />);
    const e = engine as unknown as Engine;
    expect(e.targets.ids).toEqual(['card']);
    expect(e.targets.layout('card')).toEqual({ x: 100, y: 200, width: 80, height: 120 });
    const node = e.targets.node('card');
    expect(node?.getWorldPosition()).toEqual({ x: 140, y: 260 }); // centre of the view
    expect(node?.getLocalBounds()).toEqual({ x: -40, y: -60, width: 80, height: 120 });
    // A layout change moves the proxy.
    windowRects.set('card-target', [20, 450, 80, 120]);
    await fireEvent(screen.getByTestId('card-target'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 80, height: 120 } } });
    expect(node?.getWorldPosition()).toEqual({ x: 60, y: 460 });
  });

  it('re-syncs every target when the overlay moves', async () => {
    windowRects.set('overlay', [0, 0, 400, 800]);
    windowRects.set('card-target', [100, 100, 50, 50]);
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    await render(<App clock={clock} onEngine={(e) => (engine = e)} />);
    const e = engine as unknown as Engine;
    expect(e.targets.layout('card')?.y).toBe(100);
    windowRects.set('overlay', [0, 30, 400, 770]);
    await fireEvent(screen.getByTestId('overlay'), 'layout', { nativeEvent: { layout: { x: 0, y: 30, width: 400, height: 770 } } });
    expect(e.targets.origin).toEqual({ x: 0, y: 30 });
    expect(e.targets.layout('card')?.y).toBe(70);
  });

  it('attaches an effect around the component without blocking its touches, and ends it on unmount', async () => {
    windowRects.set('card-target', [100, 100, 60, 40]);
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    const handles: EffectHandle[] = [];
    let pressed = 0;
    const view = await render(
      <App clock={clock} onEngine={(e) => (engine = e)} onHandle={(h) => handles.push(h)} onCardPress={() => pressed++} />,
    );
    const e = engine as unknown as Engine;
    await fireEvent.press(screen.getByTestId('attach'));
    await act(() => {
      clock.advance(16);
    });
    const border = borderDrawable(e);
    expect(border?.items[0]?.shape).toMatchObject({ type: 'rect', width: 60, height: 40 });
    expect(border?.items[0]?.matrix.slice(4)).toEqual([130, 120]);
    // The overlay never takes touches; the wrapped button still works.
    expect(screen.getByTestId('overlay').props.pointerEvents).toBe('none');
    await fireEvent.press(screen.getByTestId('card-button'));
    expect(pressed).toBe(1);
    // Unmounting the target ends the attached effect.
    await view.rerender(<App clock={clock} showCard={false} onEngine={(en) => (engine = en)} onHandle={(h) => handles.push(h)} />);
    await act(() => {
      clock.advance(16);
    });
    await expect(handles[0]?.finished).resolves.toEqual({ status: 'completed' });
    expect(e.targets.ids).toEqual([]);
    expect(e.scene.attachmentCount).toBe(0);
    expect(borderDrawable(e)).toBeUndefined();
  });

  it('throws a clear error when attaching to an unknown target', async () => {
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    await render(<App clock={clock} showCard={false} onEngine={(e) => (engine = e)} />);
    expect(() => engine?.attach('card', 'glow-border', {})).toThrow('Mount <GameFXTarget id="card"> first');
  });

  it('can follow views that move without layout events by measuring every frame', async () => {
    windowRects.set('card-target', [0, 0, 10, 10]);
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    await render(<App clock={clock} track onEngine={(e) => (engine = e)} />);
    const e = engine as unknown as Engine;
    await fireEvent.press(screen.getByTestId('attach'));
    windowRects.set('card-target', [200, 0, 10, 10]); // e.g. a transform animation
    await act(() => {
      clock.advance(16);
    });
    await act(() => {
      clock.advance(16);
    });
    expect(e.targets.node('card')?.x).toBe(205);
  });

  it('remeasures on request (after scrolling)', async () => {
    windowRects.set('card-target', [0, 300, 10, 10]);
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    function Remeasure() {
      const fx = useGameFX();
      return <Pressable testID="remeasure" onPress={() => { fx.remeasure('card'); }} />;
    }
    await render(
      <GameFXProvider clock={clock} imageLoader={new FakeLoader()}>
        <GameFXTarget id="card" testID="card-target" />
        <Remeasure />
        <EngineSpy onEngine={(e) => (engine = e)} />
      </GameFXProvider>,
    );
    windowRects.set('card-target', [0, 120, 10, 10]);
    const before = measureCalls;
    await fireEvent.press(screen.getByTestId('remeasure'));
    expect(measureCalls).toBe(before + 1);
    expect(engine?.targets.node('card')?.y).toBe(125);
  });

  it('stress: 50 mount/unmount cycles leave no targets, nodes or attachments behind', async () => {
    windowRects.set('card-target', [10, 10, 20, 20]);
    const clock = new VirtualClock();
    let engine: Engine | undefined;
    function Toggle() {
      const [on, setOn] = useState(true);
      const fx = useGameFX();
      return (
        <>
          {on ? <GameFXTarget id="card" testID="card-target" /> : null}
          <Pressable
            testID="toggle"
            onPress={() => {
              if (on) fx.attach('card', 'energy-border', {});
              setOn(!on);
            }}
          />
        </>
      );
    }
    await render(
      <GameFXProvider clock={clock} imageLoader={new FakeLoader()}>
        <Toggle />
        <EngineSpy onEngine={(e) => (engine = e)} />
      </GameFXProvider>,
    );
    for (let i = 0; i < 100; i++) await fireEvent.press(screen.getByTestId('toggle'));
    await act(() => {
      clock.advance(16);
    });
    const e = engine as unknown as Engine;
    expect(e.targets.ids).toEqual(['card']); // mounted again after an even number of toggles
    expect(e.scene.nodeCount).toBe(1);
    expect(e.scene.attachmentCount).toBe(0);
    expect(e.activeCount).toBe(0);
  });
});

describe('GameFXProvider assets', () => {
  it('registers assets from props and loads them with the configured loader', async () => {
    const clock = new VirtualClock();
    const loader = new FakeLoader();
    let engine: Engine | undefined;
    const view = await render(
      <GameFXProvider clock={clock} imageLoader={loader} assets={{ hero: 'hero.png', coin: 'coin.png' }}>
        <EngineSpy onEngine={(e) => (engine = e)} />
      </GameFXProvider>,
    );
    const e = engine as unknown as Engine;
    expect(e.assets.state('hero')).toBe('registered');
    const { hero } = await e.assets.load(['hero', 'coin']);
    expect(hero.width).toBe(8);
    expect(loader.loads).toBe(2);
    const sheet = e.createSpriteSheet({ image: 'hero' });
    e.createSprite({ sheet });
    await view.unmount();
    expect(loader.live.size).toBe(0); // unmount disposes the engine and frees decoded images
  });
});
