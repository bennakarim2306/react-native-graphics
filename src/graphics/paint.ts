import { InvalidOptionError } from '../runtime/errors';
import type { Point } from '../scene/matrix';
import type { ShaderDefinition } from './shader';

/** A CSS-style color string understood by the renderer, for example `#FFAA00`, `rgba(...)`. */
export type Color = string;

/** Linear gradient in the shape's local coordinates. */
export interface LinearGradient {
  readonly type: 'linear-gradient';
  readonly start: Point;
  readonly end: Point;
  readonly colors: readonly Color[];
  /** Stop positions in [0, 1], one per color. Evenly spaced when omitted. */
  readonly positions?: readonly number[];
}

/** Radial gradient in the shape's local coordinates. */
export interface RadialGradient {
  readonly type: 'radial-gradient';
  readonly center: Point;
  readonly radius: number;
  readonly colors: readonly Color[];
  readonly positions?: readonly number[];
}

/**
 * Procedural fill computed by a runtime shader. The uniform `time` (seconds of engine time)
 * and `size` (shape width and height) are filled in automatically when the shader declares
 * them; other uniforms come from `uniforms` or the shader's defaults.
 */
export interface ShaderFill {
  readonly type: 'shader';
  readonly shader: ShaderDefinition;
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
}

export type Fill = Color | LinearGradient | RadialGradient | ShaderFill;

export interface Stroke {
  readonly fill: Fill;
  readonly width: number;
  readonly cap?: 'butt' | 'round' | 'square';
  readonly join?: 'miter' | 'round' | 'bevel';
}

/** Compositing modes. Support depends on the renderer (see its capabilities). */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'plus'
  | 'src-in'
  | 'dst-in'
  | 'dst-out';

export const BLEND_MODES: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'plus',
  'src-in',
  'dst-in',
  'dst-out',
];

function finitePoint(p: Point | undefined, name: string): void {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new InvalidOptionError(`${name} must be a point with finite x and y.`);
  }
}

function validateStops(colors: readonly Color[], positions: readonly number[] | undefined, what: string): void {
  if (!Array.isArray(colors) || colors.length < 2 || colors.some((c) => typeof c !== 'string' || c.length === 0)) {
    throw new InvalidOptionError(`${what} needs at least two color strings.`);
  }
  if (positions !== undefined) {
    if (positions.length !== colors.length) {
      throw new InvalidOptionError(`${what} positions must have one entry per color.`);
    }
    let previous = 0;
    for (const p of positions) {
      if (!Number.isFinite(p) || p < previous || p > 1) {
        throw new InvalidOptionError(`${what} positions must be ascending numbers within [0, 1].`);
      }
      previous = p;
    }
  }
}

/** Throws `InvalidOptionError` for malformed fills. */
export function validateFill(fill: Fill, what = 'fill'): void {
  if (typeof fill === 'string') {
    if (fill.length === 0) throw new InvalidOptionError(`${what} color must not be empty.`);
    return;
  }
  const type: unknown = (fill as { type?: unknown }).type;
  switch (type) {
    case 'linear-gradient': {
      const g = fill as LinearGradient;
      finitePoint(g.start, `${what} start`);
      finitePoint(g.end, `${what} end`);
      validateStops(g.colors, g.positions, what);
      return;
    }
    case 'radial-gradient': {
      const g = fill as RadialGradient;
      finitePoint(g.center, `${what} center`);
      if (!(Number.isFinite(g.radius) && g.radius > 0)) throw new InvalidOptionError(`${what} radius must be > 0.`);
      validateStops(g.colors, g.positions, what);
      return;
    }
    case 'shader': {
      const s = fill as ShaderFill;
      if (typeof s.shader !== 'object' || (s.shader as { kind?: unknown }).kind !== 'shader') {
        throw new InvalidOptionError(`${what} shader must come from defineShader().`);
      }
      for (const [name, value] of Object.entries(s.uniforms ?? {})) {
        const values = typeof value === 'number' ? [value] : value;
        if (!s.shader.uniforms.some((u) => u.name === name)) {
          throw new InvalidOptionError(`${what}: shader "${s.shader.name}" has no uniform "${name}".`);
        }
        if (values.some((v) => !Number.isFinite(v))) {
          throw new InvalidOptionError(`${what}: uniform "${name}" must be finite.`);
        }
      }
      return;
    }
    default:
      throw new InvalidOptionError(`Unknown ${what} type "${String(type)}".`);
  }
}

export function validateStroke(stroke: Stroke, what = 'stroke'): void {
  validateFill(stroke.fill, `${what} fill`);
  if (!(Number.isFinite(stroke.width) && stroke.width > 0)) {
    throw new InvalidOptionError(`${what} width must be a finite number > 0.`);
  }
}

export function validateBlendMode(mode: BlendMode): void {
  if (!BLEND_MODES.includes(mode)) {
    throw new InvalidOptionError(`Unknown blend mode "${mode as string}". Use one of: ${BLEND_MODES.join(', ')}.`);
  }
}
