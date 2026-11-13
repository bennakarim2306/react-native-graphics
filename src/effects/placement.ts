import type { NodeEffect } from '../graphics/effects';
import type { BlendMode } from '../graphics/paint';
import type { EffectContext } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import { composeTransform, multiply } from '../scene/matrix';
import type { Matrix2D, Point } from '../scene/matrix';
import { SceneNode } from '../scene/node';
import type { SceneCommand, SceneDrawable, SceneDrawItem } from '../scene/scene';
import type { NodeShape } from '../scene/shape';
import { isTargetHandle } from '../scene/targets';
import type { TargetRef } from '../scene/targets';

/**
 * Where an effect plays: a fixed `position` in overlay coordinates, or a `target` (scene node
 * or host target id) it follows. Effects that take these parameters behave the same on engine
 * objects and on React Native views.
 */
export interface PlacementParams {
  /** Overlay coordinates (points from the overlay's top-left corner). */
  readonly position?: Point;
  /** Scene node or `<GameFXTarget>` id. */
  readonly target?: TargetRef;
  /** Point in the target's local coordinates (rotates and scales with it). Default its origin. */
  readonly offset?: Point;
  /**
   * Keep following the target while the effect runs (default true). False captures the
   * target's position when the effect starts.
   */
  readonly follow?: boolean;
}

/** Resolves placement parameters and tracks the target every frame. */
export class Placement {
  readonly node: SceneNode | null;
  private readonly follow: boolean;
  private readonly offset: Point;
  private fixed: Matrix2D;

  constructor(params: PlacementParams, context: EffectContext, effect: string) {
    let node: SceneNode | null = null;
    const target = params.target;
    if (target !== undefined) {
      if (typeof target === 'string') {
        if (!context.services) throw new InvalidOptionError(`${effect}: target ids need an engine; pass a scene node.`);
        node = context.services.resolveTarget(target);
      } else if (isTargetHandle(target)) {
        if (target.node.destroyed) throw new InvalidOptionError(`${effect} target has been destroyed.`);
        node = target.node;
      } else if (target instanceof SceneNode) {
        if (target.destroyed) throw new InvalidOptionError(`${effect} target has been destroyed.`);
        node = target;
      } else {
        throw new InvalidOptionError(`${effect} target must be a scene node, a target id or a target handle.`);
      }
    } else if (!params.position || !Number.isFinite(params.position.x) || !Number.isFinite(params.position.y)) {
      throw new InvalidOptionError(`${effect} needs a \`position\` with finite x and y, or a \`target\`.`);
    }
    const offset = params.offset ?? { x: 0, y: 0 };
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new InvalidOptionError(`${effect} offset must be finite.`);
    this.node = node;
    this.offset = offset;
    this.follow = params.follow ?? true;
    this.fixed = node ? this.nodeMatrix(node) : composeTransform(params.position?.x ?? 0, params.position?.y ?? 0, 0, 1, 1);
  }

  /** True when the effect follows a target that has since been destroyed. */
  get targetGone(): boolean {
    return this.node !== null && this.follow && this.node.destroyed;
  }

  /** False while a followed target is hidden or out of the scene. */
  get visible(): boolean {
    if (!this.node || !this.follow) return true;
    return !this.node.destroyed && this.node.inScene && this.node.worldVisible;
  }

  /** Opacity of a followed target (1 otherwise). */
  get opacity(): number {
    return this.node && this.follow && !this.node.destroyed ? this.node.worldOpacity : 1;
  }

  /** Full transform at the placement point (target rotation and scale included). */
  matrix(): Matrix2D {
    if (this.node && this.follow && !this.node.destroyed) this.fixed = this.nodeMatrix(this.node);
    return this.fixed;
  }

  /** World position of the placement point. */
  position(): Point {
    const m = this.matrix();
    return { x: m[4], y: m[5] };
  }

  /** Size of a target in its local units (shape bounds or explicit size), else 0 × 0. */
  targetSize(): { width: number; height: number } {
    if (!this.node || this.node.destroyed) return { width: 0, height: 0 };
    const bounds = this.node.getLocalBounds();
    return bounds ? { width: bounds.width, height: bounds.height } : { width: 0, height: 0 };
  }

  private nodeMatrix(node: SceneNode): Matrix2D {
    const world = node.worldMatrix;
    return this.offset.x === 0 && this.offset.y === 0 ? world : multiply(world, composeTransform(this.offset.x, this.offset.y, 0, 1, 1));
  }
}

/** Matrix with only the translation of `m`. */
export function translationOf(m: Matrix2D): Matrix2D {
  return [1, 0, 0, 1, m[4], m[5]];
}

/** One shape as a scene drawable, optionally inside a filtered layer. */
export function shapeDrawable(
  time: number,
  shape: NodeShape,
  matrix: Matrix2D,
  opacity: number,
  options: { blendMode?: BlendMode; effects?: readonly NodeEffect[] } = {},
): SceneDrawable {
  const blendMode = options.blendMode ?? 'normal';
  const effects = options.effects ?? [];
  const layered = effects.length > 0;
  const item: SceneDrawItem = { nodeId: -1, matrix, opacity, shape, blendMode: layered ? 'normal' : blendMode };
  const commands: SceneCommand[] = layered
    ? [
        { op: 'begin-group', nodeId: -1, clip: null, clipMatrix: matrix, layer: true, effects, blendMode },
        { op: 'draw', item },
        { op: 'end-group', nodeId: -1 },
      ]
    : [{ op: 'draw', item }];
  return { kind: 'scene', time, items: [item], commands };
}

export function checkNumber(value: unknown, name: string, effect: string, range: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidOptionError(`${effect} ${name} must be a finite number.`);
  if (range.min !== undefined && value < range.min) throw new InvalidOptionError(`${effect} ${name} must be >= ${String(range.min)}.`);
  if (range.max !== undefined && value > range.max) throw new InvalidOptionError(`${effect} ${name} must be <= ${String(range.max)}.`);
  return value;
}
