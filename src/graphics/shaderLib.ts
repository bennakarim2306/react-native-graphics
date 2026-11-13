import { InvalidOptionError } from '../runtime/errors';
import { defineShader } from './shader';
import type { ShaderDefinition } from './shader';

/**
 * Reusable SkSL building blocks. Presets compose them with `composeShader` instead of
 * repeating noise and distance functions in every shader, and the renderer compiles each
 * resulting source once (its cache is keyed by source text).
 */
export interface ShaderChunk {
  readonly name: string;
  readonly requires?: readonly string[];
  readonly code: string;
}

export const SHADER_CHUNKS: Readonly<Record<string, ShaderChunk>> = {
  hash: {
    name: 'hash',
    code: `float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}`,
  },
  noise: {
    name: 'noise',
    requires: ['hash'],
    code: `float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + float2(1.0, 0.0)), u.x),
             mix(hash21(i + float2(0.0, 1.0)), hash21(i + float2(1.0, 1.0)), u.x), u.y);
}`,
  },
  fbm: {
    name: 'fbm',
    requires: ['noise'],
    code: `float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + float2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}`,
  },
  warp: {
    name: 'warp',
    requires: ['fbm'],
    code: `float2 warp(float2 p, float t, float amount) {
  return p + amount * float2(fbm(p + float2(0.0, t)), fbm(p + float2(5.2, 1.3 - t))) - amount * 0.5;
}`,
  },
  sdRoundRect: {
    name: 'sdRoundRect',
    code: `float sdRoundRect(float2 p, float2 halfSize, float r) {
  float2 q = abs(p) - halfSize + r;
  return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}`,
  },
  sdEllipse: {
    name: 'sdEllipse',
    code: `float sdEllipse(float2 p, float2 r) {
  // Scaled-circle approximation: exact on the axes, close enough for soft effects.
  float k = length(p / max(r, float2(0.001)));
  return (k - 1.0) * min(r.x, r.y);
}`,
  },
  ramp: {
    name: 'ramp',
    code: `float3 ramp4(float t, float3 a, float3 b, float3 c, float3 d) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.33) return mix(a, b, t / 0.33);
  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
  return mix(c, d, (t - 0.66) / 0.34);
}`,
  },
};

export interface ComposeShaderOptions {
  readonly name: string;
  /** Chunk names to include (dependencies are added automatically, in order). */
  readonly use: readonly string[];
  /** Uniform declarations and defaults, in declaration order. */
  readonly uniforms: Readonly<Record<string, number | readonly number[]>>;
  /** Body of `half4 main(float2 p)`; the chunk functions are in scope. */
  readonly main: string;
  readonly fallback?: string;
}

function typeOf(value: number | readonly number[]): string {
  const n = typeof value === 'number' ? 1 : value.length;
  return n === 1 ? 'float' : `float${String(n)}`;
}

/** Builds a shader from chunks: uniform declarations, chunk code, then `main`. */
export function composeShader(options: ComposeShaderOptions): ShaderDefinition {
  const ordered: ShaderChunk[] = [];
  const visit = (name: string, stack: readonly string[]) => {
    const chunk = SHADER_CHUNKS[name];
    if (!chunk) throw new InvalidOptionError(`Unknown shader chunk "${name}".`);
    if (stack.includes(name)) throw new InvalidOptionError(`Shader chunk cycle at "${name}".`);
    for (const dep of chunk.requires ?? []) visit(dep, [...stack, name]);
    if (!ordered.includes(chunk)) ordered.push(chunk);
  };
  for (const name of options.use) visit(name, []);
  const declarations = Object.entries(options.uniforms)
    .map(([name, value]) => `uniform ${typeOf(value)} ${name};`)
    .join('\n');
  const source = `${declarations}\n\n${ordered.map((c) => c.code).join('\n\n')}\n\nhalf4 main(float2 p) {\n${options.main}\n}\n`;
  return defineShader({
    name: options.name,
    source,
    uniforms: options.uniforms,
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
  });
}

/**
 * Flames rising outward from a rounded rectangle (`shape` 0) or ellipse (`shape` 1) centred
 * in the drawn area. Inside the outline it is transparent, so the host view shows through.
 * Output is premultiplied. Uniforms:
 * - `box`: half size of the outline; `radius`: corner radius
 * - `flameHeight`: maximum flame length in points; `intensity`: 0 to 2
 * - `color`: base flame color (rgb); `seed`: varies the pattern between instances
 */
export const flameBorderShader = composeShader({
  name: 'flame-border',
  use: ['fbm', 'sdRoundRect', 'sdEllipse'],
  fallback: '#00000000',
  uniforms: {
    time: 0,
    size: [100, 100],
    box: [40, 30],
    radius: 12,
    flameHeight: 24,
    intensity: 1,
    color: [1, 0.42, 0.05],
    seed: 0,
    shape: 0,
  },
  main: `
  float2 c = p - size * 0.5;
  float d = shape < 0.5 ? sdRoundRect(c, box, radius) : sdEllipse(c, box);
  if (d < -2.0) return half4(0.0);
  float h = max(flameHeight * clamp(intensity, 0.0, 2.0), 0.001);
  // Outward direction (normalized position on the outline) so flames rise away from the edge.
  float2 n = normalize(c / max(box, float2(1.0)) + float2(0.0001));
  float2 q = c * 0.045 + float2(seed * 13.7, seed * 7.1);
  // Flame tongues: slow noise along the outline sets how tall each tongue is; faster noise
  // scrolling outward makes them flicker and break up.
  float tall = 0.35 + 0.85 * fbm(q * 0.9 + float2(time * 0.35, -time * 0.25));
  float flicker = fbm(q * 2.3 - n * time * 2.6);
  float f = 1.0 - d / (h * tall);
  f += (flicker - 0.5) * 0.85;
  f = clamp(f, 0.0, 1.0);
  float3 base = color.rgb;
  float3 col = mix(base * 0.35, base, smoothstep(0.0, 0.4, f));
  col = mix(col, float3(1.0, 0.82, 0.32), smoothstep(0.45, 0.8, f));
  col = mix(col, float3(1.0, 0.97, 0.86), smoothstep(0.86, 1.0, f));
  float a = smoothstep(0.02, 0.45, f) * smoothstep(-2.0, 0.5, d) * clamp(intensity, 0.0, 1.0);
  return half4(col * a, a);
`,
});

/** Grayscale noise for displacement (`distort` node effect): r and g are two noise fields. */
export const displacementShader = composeShader({
  name: 'displacement',
  use: ['noise'],
  fallback: '#808080',
  uniforms: { time: 0, frequency: 0.06, speed: 1 },
  main: `
  float2 q = p * frequency;
  float t = time * speed;
  return half4(vnoise(q + float2(0.0, t * 1.7)), vnoise(q + float2(7.3, -t * 1.3)), 0.5, 1.0);
`,
});
