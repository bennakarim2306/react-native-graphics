import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
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
 * Positions passed to effects are relative to this overlay's top-left corner.
 *
 * Frames are recorded into a Skia picture on the JS thread and handed to the canvas through a
 * Reanimated shared value, so React does not re-render per frame.
 */
export function GameFXOverlay({ style, testID }: GameFXOverlayProps): ReactNode {
  const engine = useGameFXEngine();
  const renderer = useMemo(() => new SkiaEffectsRenderer(Skia), []);
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

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} testID={testID}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}
