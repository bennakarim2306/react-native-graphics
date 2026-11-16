import { Canvas, Picture } from '@shopify/react-native-skia';
import { useCallback, useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { overlayDrawables } from '../engine/localLayers';
import { acquireRenderer, blankPicture, releaseRenderer } from './sharedRenderer';
import { useGameFXEngine } from './useGameFX';

export interface GameFXOverlayProps {
  /** Extra styles for the overlay container. It always fills its parent absolutely. */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * Transparent, full-size drawing surface for the provider's effects. Place it last inside the
 * provider (or inside any absolutely positioned container) so it draws above your UI.
 *
 * It never receives touches (`pointerEvents="none"`), so the UI underneath stays interactive.
 * Positions passed to effects are relative to this overlay's top-left corner; `GameFXTarget`
 * measurements are converted to the same space using the overlay's measured window origin.
 *
 * Frames are recorded into a Skia picture on the JS thread and handed to the canvas through a
 * Reanimated shared value, so React does not re-render per frame. Screen-shake offsets of the
 * `overlay` scope are applied while recording, so they move only what the engine draws.
 *
 * On mount it reports the renderer's capabilities to the engine (runtime shaders, node
 * effects), so effects such as `fire-border` choose a supported path.
 *
 * Effects that stay fixed to a `GameFXTarget` (fire and other borders, glow pulses) are drawn
 * by that target's own local layer when it has one, not here; see `GameFXTarget`.
 */
export function GameFXOverlay({ style, testID }: GameFXOverlayProps): ReactNode {
  const engine = useGameFXEngine();
  const viewRef = useRef<ComponentRef<typeof View>>(null);
  const picture = useSharedValue(blankPicture());

  const size = useRef({ width: 0, height: 0 });

  useEffect(() => {
    if (!engine || engine.state === 'disposed') return undefined;
    const renderer = acquireRenderer(engine);
    // Effects pick shader or fallback paths from what this renderer supports.
    engine.setRendererCapabilities({ runtimeShaders: renderer.capabilities.runtimeShaders, nodeEffects: renderer.capabilities.nodeEffects });
    const record = (drawables: Parameters<typeof renderer.record>[0], camera: { x: number; y: number; rotation: number }) =>
      renderer.record(overlayDrawables(drawables, engine.targets), undefined, { ...camera, pivotX: size.current.width / 2, pivotY: size.current.height / 2 });
    picture.value = record(engine.drawables, engine.camera);
    const off = engine.on('frame', ({ drawables, camera }) => {
      picture.value = record(drawables, camera);
    });
    return () => {
      off();
      picture.value = blankPicture();
      if (engine.state !== 'disposed') engine.setRendererCapabilities(null);
      releaseRenderer(engine);
    };
  }, [engine, picture]);

  // Targets are measured in window coordinates; the overlay's own window origin converts them.
  const measureOrigin = useCallback(() => {
    if (!engine || engine.state === 'disposed') return;
    viewRef.current?.measureInWindow((x, y, width, height) => {
      if (engine.state === 'disposed') return;
      // Size for the camera pivot (screen-shake rotation turns around the overlay centre).
      if (Number.isFinite(width) && Number.isFinite(height)) size.current = { width, height };
      engine.targets.setOrigin({ x, y });
      engine.targets.requestRemeasure();
    });
  }, [engine]);

  useEffect(() => {
    measureOrigin();
  }, [measureOrigin]);

  return (
    <View
      ref={viewRef}
      collapsable={false}
      onLayout={measureOrigin}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      testID={testID}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}
