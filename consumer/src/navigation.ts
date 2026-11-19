import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { useGameFX } from 'react-native-graphics';

export type RootStackParamList = {
  Home: undefined;
  FireBorder: undefined;
  Throw: undefined;
  Particles: undefined;
  Composition: undefined;
  Lifecycle: undefined;
  Busy: { readonly auto?: boolean } | undefined;
  Quality: undefined;
  Benchmark: undefined;
};

export type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * A screen pushed by a native stack slides in: its views are measured while they still move.
 * Measuring again when the transition ends puts overlay-drawn effects (explosions, sparks) at
 * the views' final positions. Effects drawn inside a view (fire, glow) never need this.
 */
export function useRemeasureAfterTransition(): void {
  const navigation = useNavigation<Navigation>();
  const fx = useGameFX();
  useEffect(
    () =>
      navigation.addListener('transitionEnd', () => {
        if (fx.ready) fx.remeasure();
      }),
    [navigation, fx],
  );
}
