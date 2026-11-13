import { InvalidOptionError } from '../runtime/errors';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One contour of a flattened path: x, y pairs. */
export interface FlatContour {
  readonly points: Float64Array;
  readonly closed: boolean;
}

type Command =
  | readonly ['M' | 'L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];

function finite(values: readonly number[]): void {
  if (values.some((v) => !Number.isFinite(v))) {
    throw new InvalidOptionError('Path coordinates must be finite numbers.');
  }
}

/**
 * A renderer-independent vector path built from lines and Bézier curves, in the local
 * coordinates of the node that draws it. Renderers convert it once and cache the result per
 * `version`.
 *
 * ```ts
 * const star = new PathData().moveTo(0, -20).lineTo(6, -6).lineTo(20, -6)... .close();
 * ```
 */
export class PathData {
  private readonly commands: Command[] = [];
  private svgCache: string | null = null;
  private boundsCache: Rect | null = null;
  private flatCache: { version: number; segments: number; contours: readonly FlatContour[] } | null = null;
  /** Increments on every change; renderers use it to invalidate cached native paths. */
  version = 0;

  moveTo(x: number, y: number): this {
    return this.push(['M', x, y]);
  }

  lineTo(x: number, y: number): this {
    this.ensureStarted();
    return this.push(['L', x, y]);
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    this.ensureStarted();
    return this.push(['Q', cx, cy, x, y]);
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.ensureStarted();
    return this.push(['C', c1x, c1y, c2x, c2y, x, y]);
  }

  close(): this {
    return this.push(['Z']);
  }

  /** Adds a closed rectangle. */
  rect(x: number, y: number, width: number, height: number): this {
    return this.moveTo(x, y).lineTo(x + width, y).lineTo(x + width, y + height).lineTo(x, y + height).close();
  }

  /** Adds a closed ellipse made of four cubic Béziers. */
  ellipse(cx: number, cy: number, rx: number, ry: number): this {
    const k = 0.5522847498;
    return this.moveTo(cx + rx, cy)
      .cubicTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)
      .cubicTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)
      .cubicTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)
      .cubicTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy)
      .close();
  }

  /** Adds a closed regular polygon or star (`innerRadius` makes a star). */
  polygon(cx: number, cy: number, points: number, radius: number, innerRadius?: number): this {
    if (!Number.isInteger(points) || points < 3) throw new InvalidOptionError('polygon needs at least 3 points.');
    const steps = innerRadius === undefined ? points : points * 2;
    for (let i = 0; i < steps; i++) {
      const r = innerRadius !== undefined && i % 2 === 1 ? innerRadius : radius;
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) this.moveTo(x, y);
      else this.lineTo(x, y);
    }
    return this.close();
  }

  get isEmpty(): boolean {
    return this.commands.length === 0;
  }

  /** SVG path data (`M`, `L`, `Q`, `C`, `Z`). */
  toSvg(): string {
    if (this.svgCache === null) {
      this.svgCache = this.commands.map((c) => c.join(' ')).join(' ');
    }
    return this.svgCache;
  }

  /** Bounds of all points including control points (a safe over-approximation for curves). */
  getBounds(): Rect {
    if (!this.boundsCache) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of this.commands) {
        for (let i = 1; i + 1 < c.length; i += 2) {
          const x = c[i] as number;
          const y = c[i + 1] as number;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      this.boundsCache = Number.isFinite(minX)
        ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
        : { x: 0, y: 0, width: 0, height: 0 };
    }
    return this.boundsCache;
  }

  /**
   * Approximates the path with straight segments: one polyline per contour, curves split
   * into `segments` pieces. Used to emit particles along a path and to measure it. Cached per
   * `version`.
   */
  flatten(segments = 12): readonly FlatContour[] {
    if (this.flatCache && this.flatCache.version === this.version && this.flatCache.segments === segments) {
      return this.flatCache.contours;
    }
    const contours: FlatContour[] = [];
    let points: number[] = [];
    let closed = false;
    let startX = 0;
    let startY = 0;
    let x = 0;
    let y = 0;
    const finish = () => {
      if (points.length >= 4) contours.push({ points: Float64Array.from(points), closed });
      points = [];
      closed = false;
    };
    for (const c of this.commands) {
      switch (c[0]) {
        case 'M':
          finish();
          [, x, y] = c;
          startX = x;
          startY = y;
          points.push(x, y);
          break;
        case 'L':
          [, x, y] = c;
          points.push(x, y);
          break;
        case 'Q': {
          const [, cx, cy, ex, ey] = c;
          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const u = 1 - t;
            points.push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
          }
          x = ex;
          y = ey;
          break;
        }
        case 'C': {
          const [, c1x, c1y, c2x, c2y, ex, ey] = c;
          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const u = 1 - t;
            points.push(
              u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
              u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
            );
          }
          x = ex;
          y = ey;
          break;
        }
        case 'Z':
          if (x !== startX || y !== startY) points.push(startX, startY);
          closed = true;
          x = startX;
          y = startY;
          finish();
          points.push(x, y);
          break;
      }
    }
    finish();
    this.flatCache = { version: this.version, segments, contours };
    return contours;
  }

  private ensureStarted(): void {
    if (this.commands.length === 0) throw new InvalidOptionError('Start a path with moveTo().');
  }

  private push(command: Command): this {
    finite(command.slice(1) as number[]);
    this.commands.push(command);
    this.svgCache = null;
    this.boundsCache = null;
    this.version++;
    return this;
  }
}
