import { PathData } from '../graphics/path';
import { InvalidOptionError } from '../runtime/errors';
import type { Random } from '../runtime/rng';
import type { Point } from '../scene/matrix';

/**
 * Where particles are born, in the emitter's local coordinates (origin at the emitter
 * position). `edge: true` emits from the outline only.
 */
export type EmitterShape =
  | { readonly type: 'point' }
  | { readonly type: 'line'; readonly from: Point; readonly to: Point }
  | { readonly type: 'circle'; readonly radius: number; readonly edge?: boolean }
  | { readonly type: 'rect'; readonly width: number; readonly height: number; readonly edge?: boolean; readonly cornerRadius?: number }
  | { readonly type: 'path'; readonly path: PathData };

/** A sampled birth point and the outward normal there (radians; NaN when undefined). */
export interface ShapeSample {
  x: number;
  y: number;
  normal: number;
}

/** Compiled emitter shape: samples birth points without allocating. */
export interface ShapeSampler {
  sample(random: Random, out: ShapeSample): void;
  /** Length of the outline (or 0 for a point), used to scale emission along borders. */
  readonly perimeter: number;
}

const TAU = Math.PI * 2;

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new InvalidOptionError(`Emitter shape ${name} must be a finite number >= 0.`);
  return value;
}

/** Polyline sampler with uniform density along its length and outward normals. */
class PolylineSampler implements ShapeSampler {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly cumulative: number[] = [];
  private readonly normals: number[] = [];
  readonly perimeter: number;

  constructor(contours: readonly { points: ArrayLike<number>; closed: boolean }[]) {
    let total = 0;
    for (const contour of contours) {
      const p = contour.points;
      // Signed area decides which side is "outside" (screen coordinates, y down).
      let area = 0;
      for (let i = 0; i + 3 < p.length; i += 2) area += (p[i] ?? 0) * (p[i + 3] ?? 0) - (p[i + 2] ?? 0) * (p[i + 1] ?? 0);
      const sign = contour.closed && area < 0 ? -1 : 1;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i] ?? 0;
        const y0 = p[i + 1] ?? 0;
        const dx = (p[i + 2] ?? 0) - x0;
        const dy = (p[i + 3] ?? 0) - y0;
        const length = Math.hypot(dx, dy);
        if (length === 0) continue;
        this.xs.push(x0, x0 + dx);
        this.ys.push(y0, y0 + dy);
        total += length;
        this.cumulative.push(total);
        this.normals.push(Math.atan2(-dx * sign, dy * sign));
      }
    }
    this.perimeter = total;
  }

  sample(random: Random, out: ShapeSample): void {
    if (this.perimeter === 0) {
      out.x = this.xs[0] ?? 0;
      out.y = this.ys[0] ?? 0;
      out.normal = Number.NaN;
      return;
    }
    const target = random.next() * this.perimeter;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.cumulative[mid] ?? 0) < target) lo = mid + 1;
      else hi = mid;
    }
    const end = this.cumulative[lo] ?? 0;
    const start = lo === 0 ? 0 : (this.cumulative[lo - 1] ?? 0);
    const t = end > start ? (target - start) / (end - start) : 0;
    const x0 = this.xs[lo * 2] ?? 0;
    const y0 = this.ys[lo * 2] ?? 0;
    out.x = x0 + ((this.xs[lo * 2 + 1] ?? 0) - x0) * t;
    out.y = y0 + ((this.ys[lo * 2 + 1] ?? 0) - y0) * t;
    out.normal = this.normals[lo] ?? Number.NaN;
  }
}

/** Validates a shape and compiles it into a sampler. */
export function createShapeSampler(shape: EmitterShape): ShapeSampler {
  const raw: unknown = shape;
  if (typeof raw !== 'object' || raw === null) throw new InvalidOptionError('Emitter shape must be an object.');
  switch (shape.type) {
    case 'point':
      return {
        perimeter: 0,
        sample: (_r, out) => {
          out.x = 0;
          out.y = 0;
          out.normal = Number.NaN;
        },
      };
    case 'line': {
      const { from, to } = shape;
      if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) throw new InvalidOptionError('Emitter line points must be finite.');
      return new PolylineSampler([{ points: [from.x, from.y, to.x, to.y], closed: false }]);
    }
    case 'circle': {
      const radius = positive(shape.radius, 'radius');
      return {
        perimeter: TAU * radius,
        sample: (random, out) => {
          const a = random.next() * TAU;
          // sqrt keeps the area density uniform.
          const r = shape.edge ? radius : radius * Math.sqrt(random.next());
          out.x = Math.cos(a) * r;
          out.y = Math.sin(a) * r;
          out.normal = a;
        },
      };
    }
    case 'rect': {
      const w = positive(shape.width, 'width');
      const h = positive(shape.height, 'height');
      const radius = Math.min(positive(shape.cornerRadius ?? 0, 'cornerRadius'), w / 2, h / 2);
      if (shape.edge) {
        const path = new PathData();
        if (radius > 0) {
          const k = 0.5522847498 * radius;
          const x = -w / 2;
          const y = -h / 2;
          path
            .moveTo(x + radius, y)
            .lineTo(x + w - radius, y)
            .cubicTo(x + w - radius + k, y, x + w, y + radius - k, x + w, y + radius)
            .lineTo(x + w, y + h - radius)
            .cubicTo(x + w, y + h - radius + k, x + w - radius + k, y + h, x + w - radius, y + h)
            .lineTo(x + radius, y + h)
            .cubicTo(x + radius - k, y + h, x, y + h - radius + k, x, y + h - radius)
            .lineTo(x, y + radius)
            .cubicTo(x, y + radius - k, x + radius - k, y, x + radius, y)
            .close();
        } else {
          path.rect(-w / 2, -h / 2, w, h);
        }
        return new PolylineSampler(path.flatten(6));
      }
      return {
        perimeter: 2 * (w + h),
        sample: (random, out) => {
          out.x = (random.next() - 0.5) * w;
          out.y = (random.next() - 0.5) * h;
          out.normal = Math.atan2(out.y, out.x);
        },
      };
    }
    case 'path': {
      if (!(shape.path instanceof PathData) || shape.path.isEmpty) {
        throw new InvalidOptionError('Emitter path shape needs a non-empty PathData.');
      }
      return new PolylineSampler(shape.path.flatten());
    }
    default:
      throw new InvalidOptionError(`Unknown emitter shape "${String((shape as { type?: unknown }).type)}".`);
  }
}
