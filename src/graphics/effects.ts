import { InvalidOptionError } from '../runtime/errors';
import type { Color } from './paint';

/**
 * A visual effect applied to a node and its subtree. The node is drawn into an offscreen
 * layer and the effect filters that layer. Implemented by the Skia renderer with image and
 * color filters; renderers report support through their capabilities and skip what they
 * cannot draw.
 */
export type NodeEffect =
  /** Soft colored light around the node's opaque pixels (drawn under the node). */
  | { readonly type: 'glow'; readonly color: Color; readonly radius: number; readonly strength?: number }
  /** Gaussian blur of the whole node. */
  | { readonly type: 'blur'; readonly radius: number }
  /** Offset shadow. */
  | { readonly type: 'drop-shadow'; readonly dx: number; readonly dy: number; readonly radius: number; readonly color: Color }
  /** 4x5 row-major color matrix (20 numbers), as in CSS/SVG `feColorMatrix`. */
  | { readonly type: 'color-matrix'; readonly matrix: readonly number[] };

export function validateNodeEffect(effect: NodeEffect): void {
  const nonNegative = (v: number, name: string) => {
    if (!Number.isFinite(v) || v < 0) throw new InvalidOptionError(`${effect.type} ${name} must be a finite number >= 0.`);
  };
  switch (effect.type) {
    case 'glow':
      nonNegative(effect.radius, 'radius');
      if (effect.strength !== undefined) nonNegative(effect.strength, 'strength');
      if (typeof effect.color !== 'string') throw new InvalidOptionError('glow color must be a string.');
      return;
    case 'blur':
      nonNegative(effect.radius, 'radius');
      return;
    case 'drop-shadow':
      nonNegative(effect.radius, 'radius');
      if (!Number.isFinite(effect.dx) || !Number.isFinite(effect.dy)) throw new InvalidOptionError('drop-shadow offset must be finite.');
      return;
    case 'color-matrix':
      if (effect.matrix.length !== 20 || effect.matrix.some((v) => !Number.isFinite(v))) {
        throw new InvalidOptionError('color-matrix needs 20 finite numbers.');
      }
      return;
    default:
      throw new InvalidOptionError(`Unknown node effect "${String((effect as { type: unknown }).type)}".`);
  }
}

/** Color matrix that desaturates by `amount` (0 = unchanged, 1 = gray). */
export function grayscale(amount = 1): NodeEffect {
  const a = 1 - amount;
  const r = 0.2126;
  const g = 0.7152;
  const b = 0.0722;
  return {
    type: 'color-matrix',
    matrix: [
      r + a * (1 - r), g - a * g, b - a * b, 0, 0,
      r - a * r, g + a * (1 - g), b - a * b, 0, 0,
      r - a * r, g - a * g, b + a * (1 - b), 0, 0,
      0, 0, 0, 1, 0,
    ],
  };
}

/** Color matrix that scales RGB by `factor` (1 = unchanged). */
export function brightness(factor: number): NodeEffect {
  return {
    type: 'color-matrix',
    matrix: [factor, 0, 0, 0, 0, 0, factor, 0, 0, 0, 0, 0, factor, 0, 0, 0, 0, 0, 1, 0],
  };
}
