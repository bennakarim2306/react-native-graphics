import type { Random } from './rng';

/**
 * Renderer-independent description of something an effect wants drawn this frame.
 * Each renderer declares which `kind`s it supports.
 */
export interface Drawable {
  readonly kind: string;
}

/** Services the engine gives to an effect when it is created. */
export interface EffectContext {
  /** Seeded RNG owned by this effect instance. */
  readonly random: Random;
}

/**
 * A running effect. The engine calls `update` with the time elapsed since the effect
 * started, never with a per-frame delta, so results do not depend on the frame rate.
 */
export interface EffectInstance {
  update(elapsedMs: number): void;
  /** True once the effect has nothing left to show. The engine then removes it. */
  readonly done: boolean;
  /** What to draw for the current state. Must stay valid until the next `update`. */
  readonly drawables: readonly Drawable[];
  /** Releases resources. Called exactly once, on completion or cancellation. */
  dispose(): void;
}

/**
 * Describes an effect type. `create` validates `params` and must throw
 * `InvalidOptionError` for invalid input, before any resources are allocated.
 */
export interface EffectDefinition<Params> {
  readonly name: string;
  create(params: Params, context: EffectContext): EffectInstance;
}

/** Helper that keeps the `Params` type attached to a definition. */
export function defineEffect<Params>(definition: EffectDefinition<Params>): EffectDefinition<Params> {
  return definition;
}
