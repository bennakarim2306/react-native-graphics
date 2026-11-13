import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { TargetViewTransform } from '../scene/targets';
import { useGameFXEngine } from './useGameFX';

export interface GameFXTargetProps {
  /** Stable name used by `fx.attach(id, ...)`. Must be unique within the provider. */
  readonly id: string;
  readonly children?: ReactNode;
  /**
   * Style of the target view. A `transform` here is kept and applied inside the engine's own
   * transform (see "transform binding" below).
   */
  readonly style?: StyleProp<ViewStyle>;
  /**
   * Measure the view on every engine frame while the engine is drawing. Use it for views that
   * move without a layout change (your own transform animations, scrolling). Default false:
   * measured on layout changes and on `fx.remeasure()`.
   */
  readonly trackEveryFrame?: boolean;
  /**
   * Rotation (degrees) and scale that your own code applies to the view, when you know them.
   * Measurement only reports an axis-aligned box, so effects cannot see them otherwise.
   * Motion driven by the engine (`fx.getTarget(id).motion`, throws, shakes) needs no props.
   */
  readonly rotation?: number;
  readonly scale?: number;
  readonly testID?: string;
}

const isIdentity = (t: TargetViewTransform): boolean =>
  t.translateX === 0 && t.translateY === 0 && t.rotation === 0 && t.scaleX === 1 && t.scaleY === 1;

/**
 * Marks an ordinary React Native view as an anchor for effects. It renders its children in an
 * `Animated.View`, measures it in window coordinates and keeps a proxy scene node in sync,
 * positioned relative to the `GameFXOverlay`. Effects attached with `fx.attach(id, ...)` follow
 * it and end when it unmounts.
 *
 * Transform binding: React Native does not report a view's transform to JavaScript, so the
 * engine owns it instead. `fx.getTarget(id).motion` (and throws and shakes built on it) holds
 * translate, rotation, scale and opacity; this component applies them to the real view on the
 * UI thread through Reanimated shared values, and the proxy node uses the same numbers, so
 * effects stay exactly on the view while it flies, spins or shakes. Layout is never changed:
 * the transform is applied on top of the measured layout box, and measurement is deferred
 * while a transform is active so the box is always measured untransformed.
 *
 * The children are rendered by React Native as usual: the engine draws effects *around* them
 * on the overlay; it does not render the component itself.
 */
export function GameFXTarget({ id, children, style, trackEveryFrame = false, rotation, scale, testID }: GameFXTargetProps): ReactNode {
  const engine = useGameFXEngine();
  const ref = useRef<ComponentRef<typeof Animated.View>>(null);
  const measuring = useRef(false);
  const transformed = useRef(false);
  const pendingMeasure = useRef(false);
  const ownTransform = useRef({ rotation, scale });
  ownTransform.current = { rotation, scale };

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const opacity = useSharedValue(1);

  const flat = useMemo(() => StyleSheet.flatten(style) as ViewStyle | undefined, [style]);
  const styleTransform = useMemo(() => (Array.isArray(flat?.transform) ? flat.transform : []) as NonNullable<ViewStyle['transform']>, [flat]);
  const styleOpacity = typeof flat?.opacity === 'number' ? flat.opacity : 1;

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: styleOpacity * opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${String(rotate.value)}deg` },
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
      ...(styleTransform as object[]),
    ] as NonNullable<ViewStyle['transform']>,
  }));

  const measure = useCallback(() => {
    const view = ref.current;
    if (!engine || engine.state === 'disposed' || !view || measuring.current) return;
    if (transformed.current) {
      // The view is moved by the engine: measure its untransformed box once it is back.
      pendingMeasure.current = true;
      return;
    }
    measuring.current = true;
    view.measureInWindow((x, y, width, height) => {
      measuring.current = false;
      if (engine.state === 'disposed') return;
      if (transformed.current) {
        pendingMeasure.current = true;
        return;
      }
      const t = ownTransform.current;
      engine.targets.updateWindowLayout(
        id,
        { x, y, width, height },
        {
          ...(t.rotation !== undefined ? { rotation: t.rotation } : {}),
          ...(t.scale !== undefined ? { scaleX: t.scale, scaleY: t.scale } : {}),
        },
      );
    });
  }, [engine, id]);

  useEffect(() => {
    if (!engine || engine.state === 'disposed') return undefined;
    engine.targets.register(id);
    measure();
    const offRemeasure = engine.targets.on('remeasure', (e) => {
      if (e.id === null || e.id === id) measure();
    });
    const offTransform = engine.targets.on('transform', (e) => {
      if (e.id !== id) return;
      const t = e.transform;
      translateX.value = t.translateX;
      translateY.value = t.translateY;
      rotate.value = t.rotation;
      scaleX.value = t.scaleX;
      scaleY.value = t.scaleY;
      opacity.value = t.opacity;
      transformed.current = !isIdentity(t);
      if (!transformed.current && pendingMeasure.current) {
        pendingMeasure.current = false;
        measure();
      }
    });
    const offFrame = trackEveryFrame ? engine.on('frame', measure) : undefined;
    return () => {
      offRemeasure();
      offTransform();
      offFrame?.();
      if (engine.state !== 'disposed') engine.targets.unregister(id);
      // A remounted target starts untransformed.
      transformed.current = false;
      pendingMeasure.current = false;
      translateX.value = 0;
      translateY.value = 0;
      rotate.value = 0;
      scaleX.value = 1;
      scaleY.value = 1;
      opacity.value = 1;
    };
  }, [engine, id, trackEveryFrame, measure, translateX, translateY, rotate, scaleX, scaleY, opacity]);

  // Rotation and scale props apply without waiting for a layout change.
  useEffect(() => {
    measure();
  }, [rotation, scale, measure]);

  return (
    <Animated.View ref={ref} collapsable={false} onLayout={measure} style={[style, animatedStyle]} testID={testID}>
      {children}
    </Animated.View>
  );
}
