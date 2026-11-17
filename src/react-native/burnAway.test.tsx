import { act, render, screen } from '@testing-library/react-native';
import { createRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FakeLoader } from '../assets/__tests__/fakeLoader';
import type { Engine } from '../engine/engine';
import { VirtualClock } from '../runtime/clock';
import { GameFXOverlay } from './GameFXOverlay';
import { GameFXProvider } from './GameFXProvider';
import { GameFXTarget } from './GameFXTarget';
import { useGameFX, useGameFXEngine } from './useGameFX';
import type { GameFX } from './useGameFX';

/** The native capture (React Native Skia's makeImageFromView) is not available in Jest. */
const mockState = { canSnapshot: true };
// A new Skia image per capture (the overlay draws it with real CanvasKit; the loader frees each once).
const mockSnapshotView = jest.fn(() => {
  // The Jest setup backs this module with CanvasKit.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Skia } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
  const surface = Skia.Surface.Make(160, 240);
  if (!surface) throw new Error('surface');
  surface.getCanvas().drawColor(Skia.Color('#F4EFE6'));
  return Promise.resolve({ native: surface.makeImageSnapshot(), width: 160, height: 240 });
});
jest.mock('./viewSnapshot', () => ({
  canSnapshotViews: () => mockState.canSnapshot,
  snapshotView: () => mockSnapshotView(),
}));

/** Lets the capture's promise chain settle (React Native's Jest promises resolve on setImmediate). */
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};

const windowRects = new Map<string, [number, number, number, number]>();

beforeAll(async () => {
  const ref = createRef<ComponentRef<typeof View>>();
  await render(<View ref={ref} />);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the shared mock is configured, not called
  const mock = ref.current?.measureInWindow as unknown as jest.Mock;
  mock.mockImplementation(function (this: { props?: { testID?: string } }, callback: (...r: number[]) => void) {
    const rect = windowRects.get(this.props?.testID ?? '') ?? [0, 0, 0, 0];
    callback(...rect);
  });
});

beforeEach(() => {
  mockState.canSnapshot = true;
  mockSnapshotView.mockClear();
  windowRects.clear();
  windowRects.set('overlay', [0, 0, 400, 800]);
  windowRects.set('card-target', [100, 300, 80, 120]);
});

let api: GameFX | null = null;
let engineRef: Engine | null = null;
function Spies() {
  api = useGameFX();
  engineRef = useGameFXEngine();
  return null;
}

function Screen({ clock, tick = 0 }: { clock: VirtualClock; tick?: number }) {
  const [label] = useState('card');
  return (
    <GameFXProvider clock={clock} imageLoader={new FakeLoader()}>
      <GameFXTarget id="card" testID="card-target" style={[styles.card, { borderWidth: tick % 2 }]}>
        <Text>{label}</Text>
      </GameFXTarget>
      <Spies />
      <GameFXOverlay testID="overlay" />
    </GameFXProvider>
  );
}

const styles = StyleSheet.create({ card: { width: 80, height: 120, backgroundColor: '#F4EFE6' } });
const fx = (): GameFX => {
  if (!api) throw new Error('no api');
  return api;
};
const engine = (): Engine => {
  if (!engineRef) throw new Error('no engine');
  return engineRef;
};
const cardOpacity = () => (StyleSheet.flatten(screen.getByTestId('card-target').props.style as object) as { opacity: number }).opacity;

describe('burn-away on a GameFXTarget', () => {
  it('takes a picture of the view, hides the view while the picture burns, keeps it hidden after', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    expect(engine().targets.canSnapshot('card')).toBe(true);
    const handle = fx().play('burn-away', { target: 'card', duration: 600 });
    expect(mockSnapshotView).toHaveBeenCalledTimes(1);
    await act(async () => {
      await flush();
      clock.advance(64, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={1} />);
    // Concealed: the engine draws the picture where the view is.
    expect(cardOpacity()).toBe(0);
    expect(engine().targets.concealOpacity('card')).toBe(0);
    await act(() => {
      clock.advance(3000, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={2} />);
    expect(handle.status).toBe('completed');
    // Burned away: hidden through its motion, which the app resets to show it again.
    expect(cardOpacity()).toBe(0);
    expect(fx().getTarget('card')?.motion.opacity).toBe(0);
    await act(() => {
      const motion = fx().getTarget('card')?.motion;
      if (motion) motion.opacity = 1;
    });
    await view.rerender(<Screen clock={clock} tick={3} />);
    expect(cardOpacity()).toBe(1);
    expect(engine().assets.stats.loaded).toBe(0);
  });

  it('shows the view again when the burn is cancelled', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    const handle = fx().play('burn-away', { target: 'card' });
    await act(async () => {
      await flush();
      clock.advance(300, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={1} />);
    expect(cardOpacity()).toBe(0);
    await act(() => {
      handle.cancel();
    });
    await view.rerender(<Screen clock={clock} tick={2} />);
    expect(cardOpacity()).toBe(1);
  });

  it('chars and fades the view where views cannot be captured (web)', async () => {
    mockState.canSnapshot = false;
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    expect(engine().targets.canSnapshot('card')).toBe(false);
    fx().play('burn-away', { target: 'card', duration: 1000 });
    await act(() => {
      clock.advance(820, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={1} />);
    expect(mockSnapshotView).not.toHaveBeenCalled();
    const fading = cardOpacity();
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    await act(() => {
      clock.advance(400, { frameMs: 16 });
    });
    await view.rerender(<Screen clock={clock} tick={2} />);
    expect(cardOpacity()).toBe(0);
  });
});
