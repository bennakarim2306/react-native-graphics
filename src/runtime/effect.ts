import type { ImageAsset } from '../assets/assets';
import type { SceneNode } from '../scene/node';
import type { TargetRef } from '../scene/targets';
import type { QualityProfile } from './quality';
import { QUALITY_PROFILES } from './quality';
import type { Random } from './rng';

/**
 * Renderer-independent description of something an effect wants drawn this frame.
 * Each renderer declares which `kind`s it supports.
 */
export interface Drawable {
  readonly kind: string;
  /**
   * The node this drawable is rigidly attached to (it moves, rotates and scales with it), when
   * there is one: fire, glow and energy borders, glow pulses, and local-space particles that
   * follow a target. A host that draws a target's view natively (a `GameFXTarget` with a local
   * effects layer) may draw such drawables inside the view instead of the overlay, so the
   * platform moves them together with the view in the same frame.
   */
  readonly anchor?: SceneNode | undefined;
}

/** An additive offset that an effect (for example a shake) applies while it runs. */
export interface TransformOffset {
  x: number;
  y: number;
  /** Degrees. */
  rotation: number;
  /** Removes the offset; the transform returns exactly to what it was without it. Idempotent. */
  remove(): void;
}

/**
 * Hides what an effect replaces while it draws it itself (for example a card that burns away).
 * The target keeps its node, layout and motion, so effects stay attached. One concealment per
 * caller: the view's opacity is multiplied by every active concealment's `opacity`.
 */
export interface TargetConcealment {
  /** View opacity while concealed, 0 to 1. Default 0 (hidden). */
  opacity: number;
  /** False after `reveal` or `vanish`. */
  readonly active: boolean;
  /** Ends the concealment and shows the view as before. Idempotent. */
  reveal(): void;
  /**
   * Ends the concealment but leaves the view hidden the normal way: a host target through its
   * motion (`motion.opacity = 0`), a scene node with `visible = false`. The app shows it again
   * by resetting those. Idempotent.
   */
  vanish(): void;
}

/** A picture of a host target's view, taken by its host. */
export interface TargetSnapshot {
  /** The picture, in physical pixels of the view's untransformed box. Held until `release`. */
  readonly image: ImageAsset;
  /** Frees the picture. Idempotent. */
  release(): void;
}

/** What the active renderer can do, when known (the React Native overlay reports it). */
export interface EffectCapabilities {
  readonly runtimeShaders: boolean;
  readonly nodeEffects: readonly string[];
}

/** Engine services available to effects. */
export interface EffectServices {
  /**
   * Resolves the id of a mounted host target (`<GameFXTarget id>`), its handle or a scene node
   * to a node. Throws `InvalidOptionError` for unknown ids.
   */
  resolveTarget(target: TargetRef): SceneNode;
  /** An offset of the whole overlay (camera), for screen shake. */
  addCameraOffset(): TransformOffset;
  /**
   * An offset of a host target's transform, so the React Native view itself moves (shake).
   * Null when `target` is not a host target.
   */
  addTargetOffset(target: string | SceneNode): TransformOffset | null;
  /** Renderer capabilities, or null when no renderer reported them yet. */
  readonly capabilities: EffectCapabilities | null;
  /**
   * Conceals a host target's view (or hides a scene node) until revealed. Null when the node
   * is destroyed. Optional so custom service objects (tests) can leave it out.
   */
  concealTarget?(target: SceneNode, opacity?: number): TargetConcealment | null;
  /**
   * Asks the host of a target to take a picture of its view. Null when the node is not a host
   * target or its host cannot take pictures (React Native Web, tests without a host).
   */
  snapshotTarget?(target: SceneNode): Promise<TargetSnapshot> | null;
}

/** Services the engine gives to an effect when it is created. */
export interface EffectContext {
  /** Seeded RNG owned by this effect instance. */
  readonly random: Random;
  /** Detail level to produce. Defaults to `high` when absent. */
  readonly quality?: QualityProfile;
  /** The user asked to reduce motion: skip shakes, flashes and large movements. */
  readonly reducedMotion?: boolean;
  /** Present when the effect runs in an engine. */
  readonly services?: EffectServices;
}

/** Quality of a context, `high` when it has none. */
export function contextQuality(context: EffectContext): QualityProfile {
  return context.quality ?? QUALITY_PROFILES.high;
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
  /**
   * Optional graceful stop: stop producing new content (emission, loops) and let what is on
   * screen finish, then report `done`. Effects without it are cancelled by `handle.stop()`.
   */
  stop?(): void;
  /**
   * Optional runtime parameter update with a partial set of parameters. Must validate and
   * throw `InvalidOptionError` without changing anything when invalid.
   */
  setParams?(patch: Readonly<Record<string, unknown>>): void;
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
