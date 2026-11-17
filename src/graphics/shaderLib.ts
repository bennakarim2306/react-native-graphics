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
    // The lattice wraps every 289 cells: noise scrolled for hours keeps full float precision
    // (large coordinates would otherwise quantize the hash into visible blocks).
    code: `float hash21(float2 p) {
  p = mod(p, 289.0);
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
  fbm2: {
    name: 'fbm2',
    requires: ['noise'],
    code: `float fbm2(float2 p) {
  return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + float2(17.1, 9.2));
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

const FLAME_UNIFORMS = {
  time: 0,
  size: [100, 100],
  box: [40, 30],
  radius: 12,
  flameHeight: 24,
  intensity: 1,
  color: [1, 0.42, 0.05],
  seed: 0,
  shape: 0,
  up: [0, -1],
  speed: 1,
  glow: 1,
  coreColor: [-1, -1, -1],
  tipColor: [-1, -1, -1],
} as const;

/**
 * Body of both flame shaders. `NOISE` is the fbm variant (4 or 2 octaves); `GLOW` is 1.0 or
 * 0.0 (the lite variant compiles the halo out).
 */
const FLAME_MAIN = `
  float2 c = p - size * 0.5;
  float d0 = shape < 0.5 ? sdRoundRect(c, box, radius) : sdEllipse(c, box);
  float k = clamp(intensity, 0.0, 2.0);
  float h = max(flameHeight * (0.6 + 0.4 * k), 0.001);
  float glowOn = GLOW * clamp(glow, 0.0, 2.0);
  // Nothing to draw deep inside the outline or beyond the reach of tongues and halo.
  if (d0 < -4.0 || d0 > h * (2.0 + glowOn * 0.9)) return half4(0.0);
  // Screen "up" in this frame, so flames rise on screen whatever the target's rotation.
  float2 upv = normalize(up + float2(0.0, -0.000001));
  float2 rt = float2(-upv.y, upv.x);
  float along = dot(c, rt);
  float height = dot(c, upv);
  float t = time * speed;
  // Buoyancy: measure the distance from a point moved down by half its own distance, so
  // tongues reach about twice as far above the top edge as beside the sides, and stay short
  // below the bottom edge.
  float lift = clamp(d0, 0.0, h * 2.0) * 0.5;
  float2 cl = c - upv * lift;
  float d = shape < 0.5 ? sdRoundRect(cl, box, radius) : sdEllipse(cl, box);
  float2 s0 = float2(seed * 17.3, seed * 9.1);
  // Tongues: noise stretched along "up" and scrolling upward; a slow field along the outline
  // sets how far each tongue reaches and lets heights grow and shrink over time.
  // Tongues sway sideways more the further they are from the base, which tapers their tips.
  float rise = clamp(d0 / h, 0.0, 1.5);
  float sway = vnoise(float2(along * 0.035, height * 0.028 - t * 0.9) + s0 * 2.3) - 0.5;
  float along2 = along + sway * 16.0 * rise;
  float tongues = NOISE(float2(along2 * 0.13, height * 0.03 - t * 1.4) + s0);
  float tall = vnoise(float2(along * 0.05 + 3.7, t * 0.5) + s0);
  float lick = vnoise(float2(along2 * 0.24, height * 0.08 - t * 3.1) + s0 * 1.7);
  float g = clamp(1.0 - d / (h * 0.9 * (0.55 + 0.75 * tall)), 0.0, 1.0);
  // Solid and hot at the base; towards the tips only the strongest tongues survive.
  float T = g * 1.3 - (1.0 - tongues) * (1.05 - 0.55 * g) + (lick - 0.5) * 0.26 * (1.0 - g * 0.5);
  // Smooth brightness breathing (no frame-to-frame randomness).
  T *= 0.93 + 0.14 * vnoise(float2(t * 2.2, seed * 5.0));
  T = clamp(T, 0.0, 1.25);
  float3 mid = color.rgb;
  float3 hot = clamp(mid + float3(0.0, 0.38, 0.12) + (1.0 - mid) * 0.18, 0.0, 1.0);
  float3 core = coreColor.r < 0.0 ? mix(hot, float3(1.0), 0.72) : coreColor.rgb;
  float3 tip = tipColor.r < 0.0 ? mid * float3(0.85, 0.45, 0.4) : tipColor.rgb;
  float3 col = mix(tip, mid, smoothstep(0.1, 0.45, T));
  col = mix(col, hot, smoothstep(0.55, 0.9, T));
  col = mix(col, core, smoothstep(0.95, 1.2, T));
  float a = smoothstep(0.03, 0.26, T) * smoothstep(-3.0, 0.5, d0) * clamp(k, 0.0, 1.0);
  float3 rgb = col * a;
  // Halo: soft light around the flames, outside the outline, with a little spill on the edge.
  float outside = max(d0, 0.0);
  float halo = glowOn * 0.2 * clamp(k, 0.0, 1.2) * exp(-outside / (h * 0.55)) * (0.75 + 0.25 * tall);
  halo *= smoothstep(-4.0, 1.0, d0) * (d0 < 0.0 ? 0.4 : 1.0) * (1.0 - a * 0.6);
  rgb += mix(mid, hot, 0.25) * halo;
  return half4(rgb, min(1.0, a + halo * 0.5));
`;

/**
 * Procedural fire around a rounded rectangle (`shape` 0) or ellipse (`shape` 1) centred in the
 * drawn area: tongues that rise on screen (`up` is screen-up in the shader's frame), lean
 * upward along the sides, grow and shrink over time, with a white-yellow core, orange body,
 * red tips and an optional halo. Inside the outline it is transparent, so the host view shows
 * through. Continuous in time (noise advected by `time`), premultiplied output. Uniforms:
 * - `box`: half size of the outline; `radius`: corner radius
 * - `flameHeight`: flame length in points; `intensity`: 0 to 2; `speed`: flame speed factor
 * - `color`: body color (rgb); `coreColor`, `tipColor`: rgb, or -1 to derive from `color`
 * - `glow`: halo strength 0 to 2; `up`: screen-up direction in the frame; `seed`: pattern
 */
export const flameBorderShader = composeShader({
  name: 'flame-border',
  use: ['fbm', 'sdRoundRect', 'sdEllipse'],
  fallback: '#00000000',
  uniforms: FLAME_UNIFORMS,
  main: FLAME_MAIN.replace('NOISE', 'fbm').replace('GLOW', '1.0'),
});

/**
 * Cheaper variant of `flameBorderShader` for the low quality profile: two noise octaves
 * instead of four and no halo. Same uniforms, same shape and timing.
 */
export const flameBorderLiteShader = composeShader({
  name: 'flame-border-lite',
  use: ['fbm2', 'sdRoundRect', 'sdEllipse'],
  fallback: '#00000000',
  uniforms: FLAME_UNIFORMS,
  main: FLAME_MAIN.replace('NOISE', 'fbm2').replace('GLOW', '0.0'),
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
