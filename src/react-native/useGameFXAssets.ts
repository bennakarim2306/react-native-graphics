import { useEffect, useMemo, useState } from 'react';
import type { ImageAsset } from '../assets/assets';
import { useGameFXEngine } from './useGameFX';

export type AssetsStatus = 'loading' | 'ready' | 'error';

export interface GameFXAssetsState<K extends string> {
  readonly status: AssetsStatus;
  /** The loaded assets by id, once `status` is `ready`. */
  readonly assets: Readonly<Record<K, ImageAsset>> | null;
  readonly error: Error | null;
}

/**
 * Loads registered image assets (see `GameFXProvider`'s `assets` prop) and re-renders once
 * when they are ready or failed. Loading is shared and cached by the provider's asset manager,
 * so several components can ask for the same ids.
 */
export function useGameFXAssets<K extends string>(ids: readonly K[]): GameFXAssetsState<K> {
  const engine = useGameFXEngine();
  const key = ids.join('\u0000');
  // Re-run only when the list of ids changes, not on every new array literal.
  const stableIds = useMemo(() => key.split('\u0000').filter(Boolean) as K[], [key]);
  const [state, setState] = useState<GameFXAssetsState<K>>({ status: 'loading', assets: null, error: null });

  useEffect(() => {
    if (!engine || engine.state === 'disposed') return undefined;
    let active = true;
    setState({ status: 'loading', assets: null, error: null });
    engine.assets.load(stableIds).then(
      (assets) => {
        if (active) setState({ status: 'ready', assets, error: null });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', assets: null, error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => {
      active = false;
    };
  }, [engine, stableIds]);

  return state;
}
