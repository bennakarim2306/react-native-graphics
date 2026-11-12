import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Pressable, Text } from 'react-native';
import { VirtualClock } from '../runtime/clock';
import type { EffectHandle, Engine } from '../engine/engine';
import { GameFXOverlay } from './GameFXOverlay';
import { GameFXProvider } from './GameFXProvider';
import { useGameFX, useGameFXEngine } from './useGameFX';

function BurstButton({ onHandle }: { onHandle: (h: EffectHandle) => void }) {
  const fx = useGameFX();
  return (
    <Pressable
      testID="burst"
      onPress={() => {
        onHandle(fx.play('particle-burst', { position: { x: 120, y: 240 }, count: 25, duration: 400 }));
      }}
    >
      <Text>Burst</Text>
    </Pressable>
  );
}

function EngineSpy({ onEngine }: { onEngine: (e: Engine | null) => void }) {
  onEngine(useGameFXEngine());
  return null;
}

function App({ clock, onHandle, onEngine }: {
  clock: VirtualClock;
  onHandle: (h: EffectHandle) => void;
  onEngine: (e: Engine | null) => void;
}) {
  return (
    <GameFXProvider clock={clock} seed={1}>
      <BurstButton onHandle={onHandle} />
      <EngineSpy onEngine={onEngine} />
      <GameFXOverlay testID="overlay" />
    </GameFXProvider>
  );
}

describe('GameFXProvider + GameFXOverlay + useGameFX', () => {
  it('renders a non-touch-blocking overlay', async () => {
    const clock = new VirtualClock();
    await render(<App clock={clock} onHandle={() => undefined} onEngine={() => undefined} />);
    expect(screen.getByTestId('overlay').props.pointerEvents).toBe('none');
  });

  it('plays effects through the public hook, runs several at once, and completes them', async () => {
    const clock = new VirtualClock();
    const handles: EffectHandle[] = [];
    let engine: Engine | null = null;
    await render(<App clock={clock} onHandle={(h) => handles.push(h)} onEngine={(e) => (engine = e)} />);
    await fireEvent.press(screen.getByTestId('burst'));
    await fireEvent.press(screen.getByTestId('burst'));
    expect(handles).toHaveLength(2);
    expect(engine).not.toBeNull();
    const e = engine as unknown as Engine;
    expect(e.activeCount).toBe(2);
    await act(() => {
      clock.advance(100, { frameMs: 16 });
    });
    expect(e.drawables).toHaveLength(2);
    await act(() => {
      clock.advance(400, { frameMs: 16 });
    });
    await expect(Promise.all(handles.map((h) => h.finished))).resolves.toEqual([
      { status: 'completed' },
      { status: 'completed' },
    ]);
    expect(e.activeCount).toBe(0);
    expect(clock.subscriberCount).toBe(0);
  });

  it('disposes the engine and cancels running effects on unmount', async () => {
    const clock = new VirtualClock();
    const handles: EffectHandle[] = [];
    let engine: Engine | null = null;
    const view = await render(<App clock={clock} onHandle={(h) => handles.push(h)} onEngine={(e) => (engine = e ?? engine)} />);
    await fireEvent.press(screen.getByTestId('burst'));
    expect(clock.subscriberCount).toBe(1);
    await view.unmount();
    await expect(handles[0]?.finished).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    expect((engine as unknown as Engine).state).toBe('disposed');
    expect(clock.subscriberCount).toBe(0);
  });

  it('works under StrictMode (double-mounted effects) with a live engine', async () => {
    const clock = new VirtualClock();
    const handles: EffectHandle[] = [];
    await render(
      <StrictMode>
        <App clock={clock} onHandle={(h) => handles.push(h)} onEngine={() => undefined} />
      </StrictMode>,
    );
    await fireEvent.press(screen.getByTestId('burst'));
    expect(handles[0]?.status).toBe('playing');
    await act(() => {
      clock.advance(500, { frameMs: 16 });
    });
    await expect(handles[0]?.finished).resolves.toEqual({ status: 'completed' });
  });

  it('throws a clear error outside a provider', async () => {
    let caught: unknown = null;
    function Orphan() {
      try {
        useGameFX();
      } catch (error) {
        caught = error;
      }
      return null;
    }
    await render(<Orphan />);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('useGameFX must be used inside a <GameFXProvider>.');
  });

  it('rejects invalid parameters synchronously through the hook', async () => {
    const clock = new VirtualClock();
    let api: ReturnType<typeof useGameFX> | null = null;
    function Grab() {
      api = useGameFX();
      return null;
    }
    await render(
      <GameFXProvider clock={clock}>
        <Grab />
      </GameFXProvider>,
    );
    const fx = api as unknown as ReturnType<typeof useGameFX>;
    expect(fx.ready).toBe(true);
    expect(() => fx.play('particle-burst', { position: { x: 0, y: 0 }, count: 0 })).toThrow('count must be');
    expect(fx.activeCount).toBe(0);
  });
});

describe('Scene and animations through the provider', () => {
  it('animates scene nodes from the hook and cancels them on unmount', async () => {
    const clock = new VirtualClock();
    let api: ReturnType<typeof useGameFX> | null = null;
    function Grab() {
      api = useGameFX();
      return null;
    }
    const view = await render(
      <GameFXProvider clock={clock} layers={['cards']}>
        <Grab />
        <GameFXOverlay />
      </GameFXProvider>,
    );
    const engine = (api as unknown as ReturnType<typeof useGameFX>).engine;
    expect(engine).not.toBeNull();
    const e = engine as Engine;
    expect(e.scene.layers).toEqual(['default', 'cards']);
    const node = e.scene.createNode({ layer: 'cards', shape: { type: 'circle', radius: 10, color: '#fff' } });
    const playback = e.animate(node, { x: 100, duration: 200 }).play();
    await act(() => {
      clock.advance(100, { frameMs: 16 });
    });
    expect(node.x).toBe(50);
    expect(e.drawables.map((d) => d.kind)).toEqual(['scene']);
    await view.unmount();
    await expect(playback.finished).resolves.toEqual({ status: 'cancelled', reason: 'disposed' });
    expect(node.destroyed).toBe(true);
    expect(clock.subscriberCount).toBe(0);
  });
});
