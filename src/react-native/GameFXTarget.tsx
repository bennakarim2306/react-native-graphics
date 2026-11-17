import { Canvas, Picture } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { anchoredTo, localLayerMatrix, localOverflow } from '../engine/localLayers';
import type { Drawable } from '../runtime/effect';
import type { TargetViewTransform } from '../scene/targets';
import { acquireRenderer, blankPicture, releaseRenderer } from './sharedRenderer';
import { useGameFXEngine } from './useGameFX';
import { canSnapshotViews, snapshotView } from './viewSnapshot';

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
  /**
   * Where effects that stay fixed to this target are drawn: fire, glow and energy borders, glow
   * pulses, and local-space particles that follow it.
   *
   * `local` (default): in a canvas inside this view, extending beyond its edges as far as the
   * effects reach. The platform moves the view and these effects together in the same frame,
   * so they never lag behind the transform binding, scrolling, or animations of parent views
   * (even ones the engine does not know about). They draw above this view's children and below
   * later siblings, and an ancestor with `overflow: 'hidden'` clips them.
   *
   * `overlay`: in the provider's overlay above the whole app, positioned from measurements on
   * each engine frame. Never clipped, but can trail a fast-moving or scrolling view by a frame
   * or more.
   *
   * World-space particles (sparks, trails, smoke, explosions) are always drawn by the overlay.
   */
  readonly effectsLayer?: 'local' | 'overlay';
  readonly testID?: string;
}

/** Engine frames without anchored effects before the local layer's canvas is unmounted. */
const LAYER_IDLE_FRAMES = 90;
/**
 * Frames the overlay keeps drawing after a new layer is laid out, while the layer already
 * draws too: a native canvas can need a frame or two before it first shows a picture, and a
 * short overlap is invisible where a gap would flicker.
 */
const LAYER_HANDOFF_FRAMES = 3;
const LAYER_STEP = 24;
const LAYER_MAX = 480;

/** Margin around the view for effects that reach `overflow` points beyond it (grows in steps). */
const layerMarginFor = (overflow: number): number => Math.min(LAYER_MAX, Math.max(LAYER_STEP, Math.ceil((overflow + 4) / LAYER_STEP) * LAYER_STEP));

interface LayerState {
  /** Margin asked for (React state follows); null while no layer is wanted. */
  requested: number | null;
  /** The mounted layer's top-left corner in the view's coordinates; null until laid out. */
  origin: { x: number; y: number } | null;
  idleFrames: number;
  drawn: boolean;
  /** Frames left before the overlay stops drawing this target's anchored effects; -1 when it has. */
  handoff: number;
}

/** Resolves after `count` animation frames (the UI has applied pending style changes). */
const nextFrames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => { step(left - 1); });
    };
    step(count);
  });

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
 * The children are rendered by React Native as usual: the engine draws effects *around* them; it
 * does not render the component itself. Effects that stay fixed to the target are drawn in a
 * local layer inside this view (see `effectsLayer`), everything else by the overlay.
 */
export function GameFXTarget({ id, children, style, trackEveryFrame = false, rotation, scale, effectsLayer = 'local', testID }: GameFXTargetProps): ReactNode {
  const engine = useGameFXEngine();
  const [layerMargin, setLayerMargin] = useState<number | null>(null);
  const layerPicture = useSharedValue(blankPicture());
  const layer = useRef<LayerState>({ requested: null, origin: null, idleFrames: 0, drawn: false, handoff: LAYER_HANDOFF_FRAMES });
  const drawLayer = useRef<((drawables: readonly Drawable[]) => void) | null>(null);
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
  /** Opacity factor while an effect conceals the view (burn-away draws a picture instead). */
  const concealed = useSharedValue(1);
  /** 0 while the view is captured, so effects drawn in its local layer stay out of the picture. */
  const layerOpacity = useSharedValue(1);

  const flat = useMemo(() => StyleSheet.flatten(style) as ViewStyle | undefined, [style]);
  const styleTransform = useMemo(() => (Array.isArray(flat?.transform) ? flat.transform : []) as NonNullable<ViewStyle['transform']>, [flat]);
  const styleOpacity = typeof flat?.opacity === 'number' ? flat.opacity : 1;

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: styleOpacity * opacity.value * concealed.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${String(rotate.value)}deg` },
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
      ...(styleTransform as object[]),
    ] as NonNullable<ViewStyle['transform']>,
  }));

  const layerStyle = useAnimatedStyle(() => ({ opacity: layerOpacity.value }));

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
    const offConceal = engine.targets.on('conceal', (e) => {
      if (e.id === id) concealed.value = e.opacity;
    });
    if (canSnapshotViews()) {
      engine.targets.setSnapshotter(id, async () => {
        // Effects in the local layer (a fire border) must not end up in the picture.
        const hideLayer = layer.current.drawn;
        if (hideLayer) {
          layerOpacity.value = 0;
          await nextFrames(2);
        }
        try {
          return await snapshotView(ref);
        } finally {
          if (hideLayer) layerOpacity.value = 1;
        }
      });
    }
    const offFrame = trackEveryFrame ? engine.on('frame', measure) : undefined;
    return () => {
      offRemeasure();
      offTransform();
      offConceal();
      offFrame?.();
      if (engine.state !== 'disposed') engine.targets.unregister(id);
      // A remounted target starts untransformed and visible.
      transformed.current = false;
      pendingMeasure.current = false;
      translateX.value = 0;
      translateY.value = 0;
      rotate.value = 0;
      scaleX.value = 1;
      scaleY.value = 1;
      opacity.value = 1;
      concealed.value = 1;
      layerOpacity.value = 1;
    };
  }, [engine, id, trackEveryFrame, measure, translateX, translateY, rotate, scaleX, scaleY, opacity, concealed, layerOpacity]);

  // Rotation and scale props apply without waiting for a layout change.
  useEffect(() => {
    measure();
  }, [rotation, scale, measure]);

  // Local effects layer: records this target's anchored drawables in the view's own coordinates.
  useEffect(() => {
    if (!engine || engine.state === 'disposed' || effectsLayer !== 'local') return undefined;
    const renderer = acquireRenderer(engine);
    const state = layer.current;
    const draw = (drawables: readonly Drawable[]) => {
      const node = engine.targets.node(id);
      if (!node || node.destroyed) return;
      const anchored = anchoredTo(drawables, node);
      if (anchored.length === 0) {
        if (state.drawn) {
          layerPicture.value = blankPicture();
          state.drawn = false;
        }
        if (state.requested !== null && ++state.idleFrames > LAYER_IDLE_FRAMES) {
          state.requested = null;
          setLayerMargin(null);
        }
        return;
      }
      state.idleFrames = 0;
      const margin = layerMarginFor(localOverflow(anchored, node));
      if (state.requested === null || margin > state.requested) {
        state.requested = margin;
        setLayerMargin(margin);
      }
      // Until the layer is laid out, the overlay keeps drawing these effects.
      if (!state.origin) return;
      const matrix = localLayerMatrix(node, state.origin.x, state.origin.y);
      if (!matrix) return;
      layerPicture.value = renderer.record(anchored, undefined, undefined, matrix);
      state.drawn = true;
      if (state.handoff > 0 && --state.handoff === 0) {
        state.handoff = -1;
        engine.targets.setLocalLayer(id, true);
      }
    };
    drawLayer.current = draw;
    const off = engine.on('frame', (e) => {
      draw(e.drawables);
    });
    return () => {
      off();
      drawLayer.current = null;
      if (engine.state !== 'disposed') engine.targets.setLocalLayer(id, false);
      layer.current = { requested: null, origin: null, idleFrames: 0, drawn: false, handoff: LAYER_HANDOFF_FRAMES };
      layerPicture.value = blankPicture();
      setLayerMargin(null);
      releaseRenderer(engine);
    };
  }, [engine, id, effectsLayer, layerPicture]);

  // The layer was unmounted (idle): the overlay draws this target's effects again until it returns.
  useEffect(() => {
    if (layerMargin !== null || !engine || engine.state === 'disposed') return;
    layer.current.origin = null;
    layer.current.handoff = LAYER_HANDOFF_FRAMES;
    engine.targets.setLocalLayer(id, false);
  }, [layerMargin, engine, id]);

  const onLayerLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!engine || engine.state === 'disposed') return;
      const { x, y } = e.nativeEvent.layout;
      layer.current.origin = { x, y };
      // Draw into the layer now; the overlay hands over after a few frames (see LAYER_HANDOFF_FRAMES).
      drawLayer.current?.(engine.drawables);
    },
    [engine, id],
  );

  return (
    <Animated.View ref={ref} collapsable={false} onLayout={measure} style={[style, animatedStyle]} testID={testID}>
      {children}
      {layerMargin !== null ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={onLayerLayout}
          style={[styles.layer, { top: -layerMargin, left: -layerMargin, right: -layerMargin, bottom: -layerMargin }, layerStyle]}
          testID={testID !== undefined ? `${testID}-effects` : undefined}
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={layerPicture} />
          </Canvas>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});
