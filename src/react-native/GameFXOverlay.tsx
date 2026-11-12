import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { SkiaEffectsRenderer } from '../renderer/skia/SkiaEffectsRenderer';
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
 * Reanimated shared value, so React does not re-render per frame.
 */
export function GameFXOverlay({ style, testID }: GameFXOverlayProps): ReactNode {
  const engine = useGameFXEngine();
  const renderer = useMemo(
    () =>
      new SkiaEffectsRenderer(Skia, (warning) => {
        if (__DEV__) console.warn(`[GameFX] ${warning.kind}: ${warning.detail}`);
      }),
    [],
  );
  const viewRef = useRef<ComponentRef<typeof View>>(null);
  const emptyPicture = useMemo(() => renderer.record([]), [renderer]);
  const picture = useSharedValue(emptyPicture);

  useEffect(() => {
    if (!engine || engine.state === 'disposed') return undefined;
    picture.value = renderer.record(engine.drawables);
    const off = engine.on('frame', ({ drawables }) => {
      picture.value = renderer.record(drawables);
    });
    return () => {
      off();
      picture.value = emptyPicture;
    };
  }, [engine, renderer, picture, emptyPicture]);

  useEffect(
    () => () => {
      renderer.dispose();
    },
    [renderer],
  );

  // Targets are measured in window coordinates; the overlay's own window origin converts them.
  const measureOrigin = useCallback(() => {
    if (!engine || engine.state === 'disposed') return;
    viewRef.current?.measureInWindow((x, y) => {
      if (engine.state === 'disposed') return;
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
