import { useContext, useMemo } from 'react';
import type { BuiltInEffects } from '../effects';
import type { EffectDefinition } from '../runtime/effect';
import type { EffectHandle, Engine } from '../runtime/engine';
import { GameFXContext } from './context';

export interface PlayOptions {
  /** Seed for this effect instance, for reproducible results. */
  readonly seed?: number;
}

/** The API returned by `useGameFX`. */
export interface GameFX {
  /** False until the provider has mounted its engine (only during the very first render). */
  readonly ready: boolean;
  /** Starts a built-in effect by name. */
  play<K extends keyof BuiltInEffects>(name: K, params: BuiltInEffects[K], options?: PlayOptions): EffectHandle;
  /** Starts an effect from its definition (registered or not). */
  play<Params>(effect: EffectDefinition<Params>, params: Params, options?: PlayOptions): EffectHandle;
  /** Starts a custom effect registered on the provider by name. Params are validated at runtime. */
  play(name: string, params: unknown, options?: PlayOptions): EffectHandle;
  /** Cancels every running effect of this provider. */
  cancelAll(): void;
  /** Number of running effects. */
  readonly activeCount: number;
}

class NotReadyError extends Error {
  constructor() {
    super('GameFX is not ready yet. Call play() from an event handler or effect, not during the first render.');
    this.name = 'NotReadyError';
  }
}

function createApi(engine: Engine | null): GameFX {
  const requireEngine = (): Engine => {
    if (!engine) throw new NotReadyError();
    return engine;
  };
  return {
    ready: engine !== null,
    play: (effect: EffectDefinition<unknown> | string, params: unknown, options?: PlayOptions): EffectHandle =>
      requireEngine().play(effect, params, options ?? {}),
    cancelAll: () => {
      requireEngine().cancelAll();
    },
    get activeCount() {
      return engine?.activeCount ?? 0;
    },
  };
}

/** Returns the effects API of the nearest `GameFXProvider`. */
export function useGameFX(): GameFX {
  const engine = useContext(GameFXContext);
  if (engine === undefined) {
    throw new Error('useGameFX must be used inside a <GameFXProvider>.');
  }
  return useMemo(() => createApi(engine), [engine]);
}

/** Low-level access to the provider's engine (null during the first render). */
export function useGameFXEngine(): Engine | null {
  const engine = useContext(GameFXContext);
  if (engine === undefined) {
    throw new Error('useGameFXEngine must be used inside a <GameFXProvider>.');
  }
  return engine;
}
