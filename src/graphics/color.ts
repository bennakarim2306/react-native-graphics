import { InvalidOptionError } from '../runtime/errors';

/** Color as four floats in [0, 1] (not premultiplied). */
export interface RGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const NAMED: Readonly<Record<string, string>> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  orange: '#FFA500',
  gold: '#FFD700',
  gray: '#808080',
  grey: '#808080',
  purple: '#800080',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
};

const cache = new Map<string, RGBA>();

/**
 * Parses `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb(r, g, b)`, `rgba(r, g, b, a)` and a few
 * names. The engine needs numeric colors to interpolate particle colors over their lifetime;
 * renderers accept the same strings. Throws `InvalidOptionError` for anything else.
 */
export function parseColor(value: string): RGBA {
  const cached = cache.get(value);
  if (cached) return cached;
  const parsed = parse(value);
  if (!parsed) throw new InvalidOptionError(`Unsupported color "${value}". Use #RRGGBB, #RRGGBBAA, rgb() or rgba().`);
  if (cache.size > 512) cache.clear();
  cache.set(value, parsed);
  return parsed;
}

function parse(input: string): RGBA | null {
  if (typeof input !== 'string') return null;
  const value = (NAMED[input.trim().toLowerCase()] ?? input).trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    const expand = hex.length === 3 || hex.length === 4 ? hex.replace(/./g, (c) => c + c) : hex;
    if (expand.length !== 6 && expand.length !== 8) return null;
    const n = (i: number) => parseInt(expand.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: expand.length === 8 ? n(6) : 1 };
  }
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (match) {
    const c = (s: string | undefined) => Math.min(255, Number(s)) / 255;
    const a = match[4] === undefined ? 1 : Math.min(1, Number(match[4]));
    const out = { r: c(match[1]), g: c(match[2]), b: c(match[3]), a };
    return [out.r, out.g, out.b, out.a].every(Number.isFinite) ? out : null;
  }
  return null;
}

/** `#RRGGBBAA` for floats in [0, 1]. */
export function formatColor(c: RGBA): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a)}`.toUpperCase();
}

/** Linear interpolation between two colors. */
export function mixColor(a: RGBA, b: RGBA, t: number): RGBA {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
}

/** Color with its alpha multiplied by `alpha`. */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return formatColor({ ...c, a: c.a * alpha });
}
