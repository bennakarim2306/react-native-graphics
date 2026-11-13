import { useContext, useMemo } from 'react';
import type { PlayableOptions } from '../animation/playable';
import type { Playback } from '../animation/playback';
import type { AnimationTarget } from '../animation/target';
import type { TweenVars } from '../animation/tween';
import type { Timeline } from '../animation/timeline';
import type { AssetManager } from '../assets/assets';
import type { BuiltInEffects } from '../effects';
import type { CueOptions, CueParams, EffectCue } from '../engine/cue';
import type { AttachSpec, EffectHandle, Engine, PlayOptions, TargetParams } from '../engine/engine';
import { throwAndExplode } from '../engine/sequences';
import type { ThrowAndExplodeOptions, ThrowAndExplodeSequence } from '../engine/sequences';
import type { ThrowMotion, ThrowOptions } from '../motion/throw';
import type { EffectDefinition } from '../runtime/effect';
import type { QualityLevel, QualityProfile } from '../runtime/quality';
import { isTargetHandle } from '../scene/targets';
import type { TargetHandle, TargetMotionProperty, TargetRef } from '../scene/targets';
import { InvalidOptionError } from '../runtime/errors';
import { GameFXContext } from './context';

/** Built-in effects that can follow a target (they take a `target` parameter). */
export type AttachableEffect =
  | 'glow-border'
  | 'energy-border'
  | 'fire-border'
  | 'glow-pulse'
  | 'trail'
  | 'smoke'
  | 'golden-sparks'
  | 'confetti'
  | 'particles'
  | 'flash'
  | 'shockwave'
  | 'explosion'
  | 'victory';

/** `fx.attach(target, { effect: 'fire-border', intensity: 1 })`. */
export type AttachEffectSpec<K extends AttachableEffect> = { readonly effect: K } & Omit<BuiltInEffects[K], 'target'>;

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
   * Starts an effect that follows a target: the id of a mounted `<GameFXTarget>`, its handle
   * (`getTarget(id)`) or a scene node. The effect ends when cancelled, when it completes, or
   * when the target unmounts.
   * `fx.attach('card', 'fire-border', { intensity: 1 })` or
   * `fx.attach('card', { effect: 'fire-border', intensity: 1 })`.
   */
  attach<K extends AttachableEffect>(
    target: TargetRef,
    name: K,
    params?: Omit<BuiltInEffects[K], 'target'>,
    options?: PlayOptions,
  ): EffectHandle;
  attach<K extends AttachableEffect>(target: TargetRef, spec: AttachEffectSpec<K>, options?: PlayOptions): EffectHandle;
  attach<Params extends TargetParams>(
    target: TargetRef,
    effect: EffectDefinition<Params> | string,
    params: Omit<Params, 'target'>,
    options?: PlayOptions,
  ): EffectHandle;
  attach(target: TargetRef, spec: AttachSpec, options?: PlayOptions): EffectHandle;
  /**
   * A mounted `<GameFXTarget>`: its proxy node (for effects and coordinates) and its `motion`
   * (the transform binding: animate `x`, `y`, `rotation`, `scale`, `opacity` of the real view).
   */
  getTarget(id: string): TargetHandle | undefined;
  /**
   * Tweens a target and starts it: a `<GameFXTarget>` id or handle animates the real view
   * through its transform binding (`x`, `y`, `rotation`, `scale`, `scaleX`, `scaleY`,
   * `opacity`); a scene node or sprite animates its own properties. Await `.finished`.
   * Throws `InvalidOptionError` for unknown ids.
   */
  animate(target: string | TargetHandle, vars: TweenVars<TargetMotionProperty>): Playback;
  animate<P extends string>(target: AnimationTarget<P>, vars: TweenVars<P>): Playback;
  /** A new timeline on the engine clock (add animations, throws, cues, then `.play()`). */
  timeline(options?: PlayableOptions): Timeline;
  /** A timeline item that starts an effect when the playback reaches it (see `engine.cue`). */
  cue<K extends keyof BuiltInEffects>(name: K, params: CueParams<BuiltInEffects[K]>, options?: CueOptions): EffectCue<BuiltInEffects[K]>;
  cue<Params>(effect: EffectDefinition<Params> | string, params: CueParams<Params>, options?: CueOptions): EffectCue<Params>;
  /** A ballistic throw of a target id or node, for timelines (markers `launch`, `peak`, `impact`). */
  throw(target: TargetRef, options?: ThrowOptions): ThrowMotion;
  /** Plays the reusable throw, impact, explosion, shake and settle sequence. */
  throwAndExplode(target: TargetRef, options?: ThrowAndExplodeOptions): ThrowAndExplodeSequence;
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
  /** Current quality level (effects started from now on use it). */
  readonly quality: QualityLevel;
  /** Changes the quality for effects started from now on. */
  setQuality(quality: QualityLevel | QualityProfile): void;
  /** True when effects run in reduced-motion mode (no shakes, smaller flashes, fewer particles). */
  readonly reducedMotion: boolean;
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
    attach: (target: TargetRef, effect: EffectDefinition<TargetParams> | string | AttachSpec, params?: object, options?: PlayOptions) =>
      typeof effect === 'object' && 'effect' in effect
        ? requireEngine().attach(target, effect, params as PlayOptions | undefined)
        : requireEngine().attach(target, effect, params ?? {}, options ?? {}),
    getTarget: (id: string) => engine?.getTarget(id),
    animate: (target: string | TargetHandle | AnimationTarget, vars: TweenVars<string>): Playback => {
      const eng = requireEngine();
      let animated: AnimationTarget | undefined;
      if (typeof target === 'string') animated = eng.getTarget(target)?.motion;
      else if (isTargetHandle(target)) animated = target.motion;
      else animated = target;
      if (!animated) {
        const id = typeof target === 'string' ? target : isTargetHandle(target) ? target.id : '?';
        throw new InvalidOptionError(`Unknown target "${id}". Mount <GameFXTarget id="${id}"> first.`);
      }
      return eng.animate(animated, vars).play();
    },
    timeline: (options?: PlayableOptions) => requireEngine().timeline(options ?? {}),
    cue: (effect: EffectDefinition<unknown> | string, params: CueParams<unknown>, options?: CueOptions) =>
      requireEngine().cue(effect, params, options ?? {}),
    throw: (target: TargetRef, options?: ThrowOptions) => requireEngine().motion.throw(target, options ?? {}),
    throwAndExplode: (target: TargetRef, options?: ThrowAndExplodeOptions) => throwAndExplode(requireEngine(), target, options ?? {}),
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
    get quality() {
      return engine?.quality.level ?? 'high';
    },
    setQuality: (quality) => {
      requireEngine().quality = quality;
    },
    get reducedMotion() {
      return engine?.reducedMotion ?? false;
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
