import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { builtInEffects } from '../effects';
import type { Clock } from '../runtime/clock';
import type { EffectDefinition } from '../runtime/effect';
import type { ErrorReporter } from '../runtime/emitter';
import { createEngine } from '../engine/engine';
import type { Engine } from '../engine/engine';
import { GameFXContext } from './context';
import { createDefaultClock } from './defaultClock';
import { createSkiaImageLoader } from './skiaImageLoader';
import type { AssetManager, ImageLoader } from '../assets/assets';

export interface GameFXProviderProps {
  readonly children?: ReactNode;
  /** Extra effect types to register in addition to the built-in ones. */
  readonly effects?: readonly EffectDefinition<never>[];
  /** Seed for effects that don't pass their own. */
  readonly seed?: number;
  /** Maximum simultaneous effects; the oldest is cancelled beyond it. Default 32. */
  readonly maxActiveEffects?: number;
  /** Scene layer names from bottom to top (`default` is always included). */
  readonly layers?: readonly string[];
  /** Clock override, mainly for tests. Defaults to a `requestAnimationFrame` clock. */
  readonly clock?: Clock;
  readonly onError?: ErrorReporter;
  /**
   * Images to register by id (`{ hero: require('./hero.png') }`). Load them with
   * `fx.assets.load([...])` or `fx.engine.assets.loadImage(id)`.
   */
  readonly assets?: Readonly<Record<string, unknown>>;
  /** Soft budget for decoded images in bytes. Default 64 MiB. */
  readonly assetBudget?: number;
  /** Share an asset manager between providers instead of one per provider. */
  readonly assetManager?: AssetManager;
  /** Image loader override (tests, custom sources). Defaults to the Skia loader. */
  readonly imageLoader?: ImageLoader;
}

/**
 * Owns one engine (scene, animations, effects) for its subtree. The engine is created when the
 * provider mounts and disposed (playbacks and effects cancelled, scene destroyed, frame loop
 * stopped) when it unmounts.
 *
 * Options are read once at mount; changing them later has no effect.
 */
export function GameFXProvider({
  children,
  effects,
  seed,
  maxActiveEffects,
  layers,
  clock,
  onError,
  assets,
  assetBudget,
  assetManager,
  imageLoader,
}: GameFXProviderProps): ReactNode {
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const created = createEngine({
      clock: clock ?? createDefaultClock(),
      effects: [...builtInEffects, ...(effects ?? [])],
      ...(seed !== undefined ? { seed } : {}),
      ...(maxActiveEffects !== undefined ? { maxActiveEffects } : {}),
      ...(layers !== undefined ? { layers } : {}),
      ...(onError !== undefined ? { onError } : {}),
      assets: assetManager ?? (assetBudget !== undefined ? { maxBytes: assetBudget } : {}),
    });
    if (!assetManager) created.assets.setLoader(imageLoader ?? createSkiaImageLoader());
    for (const [id, source] of Object.entries(assets ?? {})) created.assets.register(id, source);
    setEngine(created);
    return () => {
      created.dispose();
      setEngine((current) => (current === created ? null : current));
    };
  }, []);

  return <GameFXContext.Provider value={engine}>{children}</GameFXContext.Provider>;
}
