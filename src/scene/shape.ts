import type { ImageAsset } from '../assets/assets';
import { validateFill, validateStroke } from '../graphics/paint';
import type { Fill, Stroke } from '../graphics/paint';
import { PathData } from '../graphics/path';
import type { Rect } from '../graphics/path';
import { InvalidOptionError } from '../runtime/errors';
import type { Point } from './matrix';

interface Paintable {
  /** Solid color (kept for compatibility); `fill` takes precedence. */
  readonly color?: string;
  readonly fill?: Fill;
  readonly stroke?: Stroke;
}

/** Rectangle centred on the node's origin. */
export interface RectShape extends Paintable {
  readonly type: 'rect';
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: number;
}

/** Circle centred on the node's origin. */
export interface CircleShape extends Paintable {
  readonly type: 'circle';
  readonly radius: number;
}

/** Ellipse centred on the node's origin. */
export interface EllipseShape extends Paintable {
  readonly type: 'ellipse';
  readonly width: number;
  readonly height: number;
}

/** Vector path in the node's local coordinates. */
export interface PathShape extends Paintable {
  readonly type: 'path';
  readonly path: PathData;
}

/**
 * An image (or a region of one, for sprite-sheet frames). The node's origin sits at
 * `anchor` within the drawn rectangle: (0.5, 0.5) is the centre, (0, 0) the top-left.
 */
export interface ImageShape {
  readonly type: 'image';
  readonly image: ImageAsset;
  /** Region of the image to draw, in image pixels. Default: the whole image. */
  readonly source?: Rect;
  /** Drawn size in points. Default: the source size. */
  readonly width?: number;
  readonly height?: number;
  readonly anchor?: Point;
  /** Sampling when scaled: `linear` (smooth, default) or `nearest` (crisp pixel art). */
  readonly smoothing?: 'linear' | 'nearest';
}

/** Built-in visuals a node can draw. */
export type NodeShape = RectShape | CircleShape | EllipseShape | PathShape | ImageShape;

const finiteNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function validatePaint(shape: Paintable, what: string): void {
  if (shape.fill !== undefined) validateFill(shape.fill, `${what} fill`);
  else if (shape.color !== undefined) validateFill(shape.color, `${what} color`);
  if (shape.stroke !== undefined) validateStroke(shape.stroke, `${what} stroke`);
  if (shape.fill === undefined && shape.color === undefined && shape.stroke === undefined) {
    throw new InvalidOptionError(`A ${what} shape needs a color, fill or stroke.`);
  }
}

export function validateShape(shape: NodeShape | undefined): NodeShape | undefined {
  if (shape === undefined) return undefined;
  const type: unknown = (shape as { type?: unknown }).type;
  switch (type) {
    case 'rect': {
      const s = shape as RectShape;
      if (!finiteNonNegative(s.width) || !finiteNonNegative(s.height)) {
        throw new InvalidOptionError('A rect shape needs finite width and height >= 0.');
      }
      if (s.cornerRadius !== undefined && !finiteNonNegative(s.cornerRadius)) {
        throw new InvalidOptionError('cornerRadius must be a finite number >= 0.');
      }
      validatePaint(s, 'rect');
      break;
    }
    case 'circle': {
      const s = shape as CircleShape;
      if (!finiteNonNegative(s.radius)) throw new InvalidOptionError('A circle shape needs a finite radius >= 0.');
      validatePaint(s, 'circle');
      break;
    }
    case 'ellipse': {
      const s = shape as EllipseShape;
      if (!finiteNonNegative(s.width) || !finiteNonNegative(s.height)) {
        throw new InvalidOptionError('An ellipse shape needs finite width and height >= 0.');
      }
      validatePaint(s, 'ellipse');
      break;
    }
    case 'path': {
      const s = shape as PathShape;
      if (!(s.path instanceof PathData)) throw new InvalidOptionError('A path shape needs a PathData.');
      validatePaint(s, 'path');
      break;
    }
    case 'image': {
      const s = shape as ImageShape;
      if (typeof s.image !== 'object' || (s.image as { kind?: unknown }).kind !== 'image') {
        throw new InvalidOptionError('An image shape needs a loaded image asset.');
      }
      if (s.image.disposed) throw new InvalidOptionError(`Image asset "${s.image.id}" has been unloaded.`);
      if (s.source) {
        const r = s.source;
        if (![r.x, r.y, r.width, r.height].every(finiteNonNegative) || r.width === 0 || r.height === 0) {
          throw new InvalidOptionError('Image source rect needs finite, non-negative values and a size > 0.');
        }
        if (r.x + r.width > s.image.width || r.y + r.height > s.image.height) {
          throw new InvalidOptionError(`Image source rect is outside the image "${s.image.id}".`);
        }
      }
      if (s.width !== undefined && !finiteNonNegative(s.width)) throw new InvalidOptionError('Image width must be >= 0.');
      if (s.height !== undefined && !finiteNonNegative(s.height)) throw new InvalidOptionError('Image height must be >= 0.');
      if (s.anchor && (!Number.isFinite(s.anchor.x) || !Number.isFinite(s.anchor.y))) {
        throw new InvalidOptionError('Image anchor must be finite.');
      }
      const smoothing: unknown = s.smoothing;
      if (smoothing !== undefined && smoothing !== 'linear' && smoothing !== 'nearest') {
        throw new InvalidOptionError('Image smoothing must be "linear" or "nearest".');
      }
      break;
    }
    default:
      throw new InvalidOptionError(`Unknown shape type "${String(type)}".`);
  }
  return shape;
}

/** Local-space rectangle covered by a shape (strokes excluded). */
export function shapeBounds(shape: NodeShape): Rect {
  switch (shape.type) {
    case 'circle':
      return { x: -shape.radius, y: -shape.radius, width: shape.radius * 2, height: shape.radius * 2 };
    case 'path':
      return shape.path.getBounds();
    case 'image': {
      const { width, height } = imageSize(shape);
      const anchor = shape.anchor ?? { x: 0.5, y: 0.5 };
      return { x: 0 - anchor.x * width, y: 0 - anchor.y * height, width, height };
    }
    default:
      return { x: -shape.width / 2, y: -shape.height / 2, width: shape.width, height: shape.height };
  }
}

/** Drawn size of an image shape. */
export function imageSize(shape: ImageShape): { width: number; height: number } {
  const sourceWidth = shape.source?.width ?? shape.image.width;
  const sourceHeight = shape.source?.height ?? shape.image.height;
  return { width: shape.width ?? sourceWidth, height: shape.height ?? sourceHeight };
}
