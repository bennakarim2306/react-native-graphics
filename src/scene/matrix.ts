/**
 * 2D affine transform `[a, b, c, d, e, f]`, mapping a point (x, y) to
 * (a·x + c·y + e, b·x + d·y + f). Same layout as CanvasKit/DOMMatrix 2D.
 */
export type Matrix2D = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const IDENTITY: Matrix2D = [1, 0, 0, 1, 0, 0];

const DEG = Math.PI / 180;

/** Translate · rotate (degrees, clockwise on screen) · scale. */
export function composeTransform(x: number, y: number, rotationDeg: number, scaleX: number, scaleY: number): Matrix2D {
  const r = rotationDeg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, x, y];
}

/** `m1 · m2`: applies `m2` first, then `m1`. */
export function multiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyToPoint(m: Matrix2D, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Inverse transform, or null when the matrix is not invertible (for example scale 0). */
export function invert(m: Matrix2D): Matrix2D | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Rotation of the transform's x axis, in degrees within (-180, 180]. */
export function rotationOf(m: Matrix2D): number {
  return Math.atan2(m[1], m[0]) / DEG;
}

/** Length of the transformed unit axes. Mirroring shows as a negative scaleY. */
export function scaleOf(m: Matrix2D): { scaleX: number; scaleY: number } {
  const scaleX = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const scaleY = scaleX === 0 ? Math.hypot(m[2], m[3]) : det / scaleX;
  return { scaleX, scaleY };
}
