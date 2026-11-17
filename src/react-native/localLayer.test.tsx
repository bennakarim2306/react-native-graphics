import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import type { ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FakeLoader } from '../assets/__tests__/fakeLoader';
import type { Engine } from '../engine/engine';
import { SkiaEffectsRenderer } from '../renderer/skia/SkiaEffectsRenderer';
import { VirtualClock } from '../runtime/clock';
import type { Drawable } from '../runtime/effect';
import { multiply } from '../scene/matrix';
import type { Matrix2D } from '../scene/matrix';
import { GameFXOverlay } from './GameFXOverlay';
import { GameFXProvider } from './GameFXProvider';
import { GameFXTarget } from './GameFXTarget';
import { useGameFXEngine } from './useGameFX';

const windowRects = new Map<string, [number, number, number, number]>();

beforeAll(async () => {
  // React Native's Jest preset shares one `measureInWindow` mock between all host views.
  const ref = createRef<ComponentRef<typeof View>>();
  await render(<View ref={ref} />);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the shared mock is configured, not called
  const mock = ref.current?.measureInWindow as unknown as jest.Mock;
  mock.mockImplementation(function (this: { props?: { testID?: string } }, callback: (...r: number[]) => void) {
    callback(...(windowRects.get(this.props?.testID ?? '') ?? [0, 0, 0, 0]));
  });
});

interface RecordCall {
  readonly drawables: readonly Drawable[];
  readonly transform: Matrix2D | undefined;
}
let calls: RecordCall[] = [];
let recordSpy: jest.SpyInstance | null = null;

beforeEach(() => {
  windowRects.clear();
  windowRects.set('overlay', [0, 0, 400, 800]);
  windowRects.set('card', [100, 300, 80, 120]);
  calls = [];
  // Records what each picture contains, then records it for real.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the renderer as `this`
  const original = SkiaEffectsRenderer.prototype.record;
  recordSpy = jest.spyOn(SkiaEffectsRenderer.prototype, 'record').mockImplementation(function (this: SkiaEffectsRenderer, drawables, bounds, camera, transform) {
    calls.push({ drawables: [...drawables], transform });
    return original.call(this, drawables, bounds, camera, transform);
  });
});

afterEach(() => {
  recordSpy?.mockRestore();
});

let engineRef: Engine | null = null;
function EngineSpy() {
  engineRef = useGameFXEngine();
  return null;
}
const engine = (): Engine => {
  if (!engineRef) throw new Error('no engine');
  return engineRef;
};

function Screen({ clock, card = true, layer }: { clock: VirtualClock; card?: boolean; layer?: 'local' | 'overlay' }) {
  return (
    <GameFXProvider clock={clock} imageLoader={new FakeLoader()}>
      <View>
        {card ? (
          <GameFXTarget id="card" testID="card" style={styles.card} {...(layer ? { effectsLayer: layer } : {})}>
            <Text>K♥</Text>
          </GameFXTarget>
        ) : null}
      </View>
      <EngineSpy />
      <GameFXOverlay testID="overlay" />
    </GameFXProvider>
  );
}

const styles = StyleSheet.create({ card: { width: 80, height: 120, backgroundColor: '#F4EFE6' } });

const node = () => {
  const n = engine().targets.node('card');
  if (!n) throw new Error('no node');
  return n;
};
const localCalls = () => calls.filter((c) => c.transform !== undefined);
const overlayCalls = () => calls.filter((c) => c.transform === undefined);
const layerStyle = () => StyleSheet.flatten(screen.getByTestId('card-effects', { includeHiddenElements: true }).props.style as object) as { position: string; top: number; left: number; right: number; bottom: number };

/** Lays out the layer view as React Native would: `margin` beyond the view on each side. */
async function layOut(margin: number) {
  await fireEvent(screen.getByTestId('card-effects', { includeHiddenElements: true }), 'layout', { nativeEvent: { layout: { x: -margin, y: -margin, width: 80 + margin * 2, height: 120 + margin * 2 } } });
}

/** Lays out the layer and runs the frames of the overlay-to-layer handoff. */
async function layOutAndHandOver(clock: VirtualClock, margin: number) {
  await layOut(margin);
  await act(() => {
    clock.advance(32, { frameMs: 16 });
  });
}

describe('GameFXTarget local effects layer', () => {
  it('draws fire inside the view once its layer is laid out, and the overlay leaves it out', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} />);
    expect(screen.queryByTestId('card-effects', { includeHiddenElements: true })).toBeNull();
    await act(() => {
      engine().attach('card', { effect: 'fire-border', flameHeight: 20, sparks: true });
      clock.advance(200, { frameMs: 16 });
    });
    // The layer reaches as far as the flames and their glow (about 60 pt), in 24 pt steps.
    const margin = -layerStyle().top;
    expect(margin).toBe(72);
    expect(layerStyle()).toMatchObject({ position: 'absolute', left: -72, right: -72, bottom: -72 });
    // Not laid out yet: the overlay still draws the flames, nothing is recorded locally.
    expect(engine().targets.drawsLocally(node())).toBe(false);
    expect(localCalls()).toHaveLength(0);
    expect(overlayCalls().at(-1)?.drawables.some((d) => d.anchor === node())).toBe(true);

    await layOut(margin);
    // The layer draws at once; the overlay keeps drawing for a short handoff (no gap while the
    // native canvas shows its first picture), then leaves the flames to the layer.
    expect(localCalls()).toHaveLength(1);
    expect(engine().targets.drawsLocally(node())).toBe(false);
    await act(() => {
      clock.advance(16);
    });
    expect(engine().targets.drawsLocally(node())).toBe(false);
    expect(overlayCalls().at(-1)?.drawables.some((d) => d.anchor === node())).toBe(true);
    await act(() => {
      clock.advance(16);
    });
    expect(engine().targets.drawsLocally(node())).toBe(true);
    calls = [];
    await act(() => {
      clock.advance(48, { frameMs: 16 });
    });
    expect(localCalls()).toHaveLength(3);
    expect(localCalls().every((c) => c.drawables.length > 0 && c.drawables.every((d) => d.anchor === node()))).toBe(true);
    const overlay = overlayCalls();
    expect(overlay).toHaveLength(3);
    expect(overlay.every((c) => !c.drawables.some((d) => d.anchor === node()))).toBe(true);
    // Sparks (world space) stay in the overlay.
    expect(overlay.at(-1)?.drawables.some((d) => d.kind === 'particles')).toBe(true);
  });

  it('records the same local geometry while the view moves, rotates and scales', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} />);
    await act(() => {
      engine().attach('card', { effect: 'glow-pulse', pulses: Infinity });
      clock.advance(50, { frameMs: 16 });
    });
    await layOut(-layerStyle().top);
    const motion = engine().targets.motion('card');
    if (!motion) throw new Error('no motion');
    const layerFromNode = () => {
      const transform = localCalls().at(-1)?.transform;
      if (!transform) throw new Error('no local recording');
      return multiply(transform, node().worldMatrix).map((v) => Math.round(v * 1e6) / 1e6 + 0);
    };
    await act(() => {
      clock.advance(16);
    });
    const still = layerFromNode();
    await act(() => {
      motion.x = 90;
      motion.y = -60;
      motion.rotation = 200;
      motion.scale = 1.25;
      clock.advance(16);
    });
    expect(layerFromNode()).toEqual(still);
    // The node's centre lands on the view's centre inside the layer: margin + half the size.
    const margin = -layerStyle().top;
    expect(still).toEqual([1, 0, 0, 1, margin + 40, margin + 60]);
  });

  it('effectsLayer="overlay" keeps every effect in the overlay', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} layer="overlay" />);
    await act(() => {
      engine().attach('card', { effect: 'fire-border' });
      clock.advance(200, { frameMs: 16 });
    });
    expect(screen.queryByTestId('card-effects', { includeHiddenElements: true })).toBeNull();
    expect(localCalls()).toHaveLength(0);
    expect(engine().targets.drawsLocally(node())).toBe(false);
    expect(overlayCalls().at(-1)?.drawables.some((d) => d.anchor === node())).toBe(true);
  });

  it('unmounts the layer when its effects are gone and hands drawing back to the overlay', async () => {
    const clock = new VirtualClock();
    await render(<Screen clock={clock} />);
    const handle = engine().attach('card', 'glow-pulse', { pulses: 1, frequency: 4 });
    await act(() => {
      clock.advance(32, { frameMs: 16 });
    });
    await layOutAndHandOver(clock, -layerStyle().top);
    expect(engine().targets.drawsLocally(node())).toBe(true);
    await act(() => {
      clock.advance(300, { frameMs: 16 });
    });
    expect(handle.status).toBe('completed');
    // Still mounted for a short while (cheap to reuse), then removed.
    expect(screen.queryByTestId('card-effects', { includeHiddenElements: true })).not.toBeNull();
    await act(() => {
      engine().play('confetti', { position: { x: 10, y: 10 } }); // keeps frames coming
      clock.advance(2000, { frameMs: 16 });
    });
    expect(screen.queryByTestId('card-effects', { includeHiddenElements: true })).toBeNull();
    expect(engine().targets.drawsLocally(node())).toBe(false);
    // A new effect brings the layer back.
    await act(() => {
      engine().attach('card', { effect: 'fire-border' });
      clock.advance(32, { frameMs: 16 });
    });
    expect(screen.queryByTestId('card-effects', { includeHiddenElements: true })).not.toBeNull();
  });

  it('a target that unmounts takes its layer with it', async () => {
    const clock = new VirtualClock();
    const view = await render(<Screen clock={clock} />);
    await act(() => {
      engine().attach('card', { effect: 'fire-border' });
      clock.advance(32, { frameMs: 16 });
    });
    await layOutAndHandOver(clock, -layerStyle().top);
    expect(engine().targets.localLayerCount).toBe(1);
    await view.rerender(<Screen clock={clock} card={false} />);
    expect(engine().targets.localLayerCount).toBe(0);
    calls = [];
    await act(() => {
      clock.advance(32, { frameMs: 16 });
    });
    expect(localCalls()).toHaveLength(0);
  });
});
