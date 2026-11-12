import { useCallback, useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useGameFXEngine } from './useGameFX';

export interface GameFXTargetProps {
  /** Stable name used by `fx.attach(id, ...)`. Must be unique within the provider. */
  readonly id: string;
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  /**
   * Measure the view on every engine frame while the engine is drawing. Use it for views that
   * move without a layout change (transform animations, scrolling). Default false: measured on
   * layout changes and on `fx.remeasure()`.
   */
  readonly trackEveryFrame?: boolean;
  /**
   * Rotation (degrees) and scale of the view, when you know them. Measurement only reports an
   * axis-aligned box, so effects cannot see a view's rotation otherwise.
   */
  readonly rotation?: number;
  readonly scale?: number;
  readonly testID?: string;
}

/**
 * Marks an ordinary React Native view as an anchor for effects. It wraps its children in a
 * `View`, measures it in window coordinates and keeps a proxy scene node in sync, positioned
 * relative to the `GameFXOverlay`. Effects attached with `fx.attach(id, ...)` follow it and end
 * when it unmounts.
 *
 * The children are rendered by React Native as usual: the engine draws effects *around* them
 * on the overlay; it does not render the component itself.
 */
export function GameFXTarget({ id, children, style, trackEveryFrame = false, rotation, scale, testID }: GameFXTargetProps): ReactNode {
  const engine = useGameFXEngine();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const measuring = useRef(false);
  const transform = useRef({ rotation, scale });
  transform.current = { rotation, scale };

  const measure = useCallback(() => {
    const view = ref.current;
    if (!engine || engine.state === 'disposed' || !view || measuring.current) return;
    measuring.current = true;
    view.measureInWindow((x, y, width, height) => {
      measuring.current = false;
      if (engine.state === 'disposed') return;
      const t = transform.current;
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
    const offFrame = trackEveryFrame ? engine.on('frame', measure) : undefined;
    return () => {
      offRemeasure();
      offFrame?.();
      if (engine.state !== 'disposed') engine.targets.unregister(id);
    };
  }, [engine, id, trackEveryFrame, measure]);

  // Rotation and scale props apply without waiting for a layout change.
  useEffect(() => {
    measure();
  }, [rotation, scale, measure]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style} testID={testID}>
      {children}
    </View>
  );
}
