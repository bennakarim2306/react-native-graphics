import { useContext, useMemo } from 'react';
import type { BuiltInEffects } from '../effects';
import type { EffectDefinition } from '../runtime/effect';
import type { EffectHandle, Engine } from '../engine/engine';
import type { AssetManager } from '../assets/assets';
import type { SceneNode } from '../scene/node';

/** Built-in effects that follow a target (they take a `target` parameter). */
export type AttachableEffect = 'glow-border' | 'energy-border' | 'fire-border';
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
  /**
   * Starts an effect that follows a target: the id of a mounted `<GameFXTarget>` or a scene
   * node. The effect ends when cancelled, when it completes, or when the target unmounts.
   */
  attach<K extends AttachableEffect>(
    target: string | SceneNode,
    name: K,
    params?: Omit<BuiltInEffects[K], 'target'>,
    options?: PlayOptions,
  ): EffectHandle;
  attach<Params extends { readonly target: SceneNode }>(
    target: string | SceneNode,
    effect: EffectDefinition<Params> | string,
    params: Omit<Params, 'target'>,
    options?: PlayOptions,
  ): EffectHandle;
  /**
   * Converts a window point (for example a touch's `pageX`/`pageY`) to overlay coordinates,
   * using the overlay's measured position. Identity until the overlay has been measured.
   */
  fromWindow(point: { readonly x: number; readonly y: number }): { x: number; y: number };
  /** Asks `GameFXTarget`s to measure again (all, or one id), for example after scrolling. */
  remeasure(id?: string): void;
  /** The provider's image cache. Null until `ready`. */
  readonly assets: AssetManager | null;
  /** Cancels every running effect of this provider. */
  cancelAll(): void;
  /** Number of running effects. */
  readonly activeCount: number;
  /**
   * The provider's engine for scene nodes, animations and timelines
   * (`engine.scene.createNode`, `engine.animate`, `engine.timeline`). Null until `ready`.
   */
  readonly engine: Engine | null;
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
    attach: (target: string | SceneNode, effect: EffectDefinition<{ target: SceneNode }> | string, params?: object, options?: PlayOptions) =>
      requireEngine().attach(target, effect, params ?? {}, options ?? {}),
    fromWindow: (point) => {
      const origin = engine?.targets.origin ?? { x: 0, y: 0 };
      return { x: point.x - origin.x, y: point.y - origin.y };
    },
    remeasure: (id?: string) => {
      requireEngine().targets.requestRemeasure(id);
    },
    assets: engine?.assets ?? null,
    cancelAll: () => {
      requireEngine().cancelAll();
    },
    get activeCount() {
      return engine?.activeCount ?? 0;
    },
    engine,
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
