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
  burnField: {
    name: 'burnField',
    // Mirrored exactly by burnNoise/burnField in effects/burnAway.ts, so particles can be born
    // on the edge the shader draws. Sums of sine waves (not hashed noise) keep GPU float
    // precision and JavaScript doubles in agreement. Needs the uniforms origin, dir, radial,
    // amp and seed.
    code: `float burnWave(float2 q, float a, float wavelength, float phase) {
  return sin(dot(q, float2(cos(a), sin(a))) * (6.2831853 / wavelength) + phase);
}
float burnNoise(float2 q, float s) {
  float n = 0.40 * burnWave(q, s * 0.61, 64.0, s * 2.3);
  n += 0.26 * burnWave(q, s * 0.98 + 1.7, 37.0, s * 3.2 + 0.5);
  n += 0.16 * burnWave(q, s * 1.35 + 3.4, 21.0, s * 4.1 + 1.0);
  n += 0.11 * burnWave(q, s * 1.72 + 5.1, 12.5, s * 5.0 + 1.5);
  n += 0.07 * burnWave(q, s * 2.09 + 6.8, 7.5, s * 5.9 + 2.0);
  return 0.5 * n;
}
float burnField(float2 q) {
  float d = radial > 0.5 ? length(q - origin) : dot(q - origin, dir);
  return d + amp * burnNoise(q, seed);
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
  /** Child shaders (`uniform shader name;`), declared before the uniforms. */
  readonly children?: readonly string[];
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
  const declarations = [
    ...(options.children ?? []).map((name) => `uniform shader ${name};`),
    ...Object.entries(options.uniforms).map(([name, value]) => `uniform ${typeOf(value)} ${name};`),
  ].join('\n');
  const source = `${declarations}\n\n${ordered.map((c) => c.code).join('\n\n')}\n\nhalf4 main(float2 p) {\n${options.main}\n}\n`;
  return defineShader({
    name: options.name,
    source,
    uniforms: options.uniforms,
    ...(options.children ? { children: options.children } : {}),
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

const BURN_FIELD_UNIFORMS = {
  size: [100, 100],
  box: [100, 100],
  margin: 0,
  progress: 0,
  origin: [0, 0],
  dir: [0, -1],
  radial: 0,
  amp: 10,
  seed: 0,
  time: 0,
  detail: 1,
} as const;

/** Fine fibres along the burning edge (not mirrored on the CPU: about ±1 point). */
const BURN_EDGE = `
  float2 q = p - float2(margin);
  float s = progress - burnField(q);
  if (detail > 0.5) s += (fbm2(q * 0.42 + float2(seed * 3.7, seed)) - 0.375) * 3.0;
`;

/**
 * A picture burning away (the `burn-away` effect's paper pass, normal blending). The child
 * `image` is the picture, placed by the fill; the shape is the picture plus `margin` on each
 * side. Ahead of the burning edge the picture browns and chars over `charWidth` points, the
 * edge glows (`rimWidth`, `rimColor`), behind it the picture is gone. Uniforms of the edge:
 * - `progress`: how far the edge has travelled, in points along the burn
 * - `origin`, `dir`, `radial`: a straight edge moving along `dir` from `origin`, or (radial 1)
 *   a circle growing from `origin`; card coordinates (points from its top-left corner)
 * - `amp`: how ragged the edge is, in points; `seed`: its pattern
 * - `detail`: 1 adds fibres and flicker, 0 is the cheaper low-quality edge
 */
export const burnPaperShader = composeShader({
  name: 'burn-paper',
  use: ['burnField', 'fbm2', 'noise'],
  fallback: '#00000000',
  children: ['image'],
  uniforms: { ...BURN_FIELD_UNIFORMS, charWidth: 14, rimWidth: 3, charColor: [0.17, 0.1, 0.05], rimColor: [1, 0.48, 0.1] },
  main: `${BURN_EDGE}
  half4 c = image.eval(p);
  float inside = clamp(q.x + 0.5, 0.0, 1.0) * clamp(box.x - q.x + 0.5, 0.0, 1.0) * clamp(q.y + 0.5, 0.0, 1.0) * clamp(box.y - q.y + 0.5, 0.0, 1.0);
  float a0 = float(c.a) * inside;
  float keep = 1.0 - smoothstep(-0.7, 0.7, s);
  if (a0 < 0.002 || keep <= 0.0) return half4(0.0);
  float3 col = float3(c.rgb) / max(float(c.a), 0.0001);
  float k = clamp(1.0 + s / charWidth, 0.0, 1.0);
  // Browning far ahead, a black charred band just ahead of the glowing edge.
  col = mix(col, col * float3(0.8, 0.64, 0.46), smoothstep(0.0, 0.5, k));
  col = mix(col, charColor, smoothstep(0.3, 0.8, k));
  float rim = smoothstep(-rimWidth, 0.0, s);
  float flick = detail > 0.5 ? 0.7 + 0.3 * vnoise(q * 0.18 + float2(seed, time * 5.0)) : 0.85;
  col = mix(col, rimColor, clamp(rim * rim * flick * 1.15, 0.0, 1.0));
  float a = a0 * keep;
  return half4(half3(col * a), half(a));
`,
});

/**
 * Light of a burning edge (the `burn-away` effect's glow pass, additive): a hot line on the
 * edge, a soft halo that may spill past the outline (a rounded rectangle of `box` and
 * `cornerRadius`), dying embers just behind the edge and flickering glints. Same edge uniforms
 * as `burnPaperShader`; `intensity` and `fade` scale the light.
 */
export const burnGlowShader = composeShader({
  name: 'burn-glow',
  use: ['burnField', 'fbm2', 'noise', 'sdRoundRect'],
  fallback: '#00000000',
  uniforms: { ...BURN_FIELD_UNIFORMS, rimWidth: 3, cornerRadius: 10, rimColor: [1, 0.48, 0.1], coreColor: [1, 0.9, 0.6], intensity: 1, fade: 1 },
  main: `${BURN_EDGE}
  float od = sdRoundRect(q - box * 0.5, box * 0.5, min(cornerRadius, min(box.x, box.y) * 0.5));
  float onPaper = 1.0 - smoothstep(-0.5, 0.8, od);
  float near = 1.0 - smoothstep(0.0, max(margin, 1.0), od);
  float w2 = rimWidth * rimWidth;
  float rim = exp(-(s * s) / (w2 * 0.9)) * onPaper;
  // The light reaches less far over the paper than into the burned side, so the char stays dark.
  float sh = s < 0.0 ? s * 2.2 : s;
  float halo = exp(-(sh * sh) / (w2 * 10.0)) * 0.18 * near;
  float after = s > 0.0 ? exp(-s / (rimWidth * 0.8)) * 0.35 * onPaper : 0.0;
  float flick = detail > 0.5 ? 0.65 + 0.35 * vnoise(q * 0.12 + float2(seed * 1.3, time * 4.0)) : 0.85;
  // Glowing specks in the char just ahead of the edge, round and flickering.
  float glint = 0.0;
  if (detail > 0.5 && s > -rimWidth * 2.5 && s < 0.0) {
    float2 cq = q * 0.8;
    float speck = 1.0 - smoothstep(0.12, 0.42, length(fract(cq) - 0.5));
    glint = step(0.97, hash21(floor(cq) + float2(floor(time * 7.0), seed))) * speck * 0.9 * onPaper;
  }
  float e = clamp((rim * 1.1 + halo + after + glint) * flick * intensity * fade, 0.0, 1.0);
  float3 col = mix(rimColor, coreColor, clamp(rim * 0.9, 0.0, 1.0));
  return half4(half3(col * e), half(e));
`,
});

/**
 * Charring drawn over a view that cannot be burned away (no picture of it): ahead of the edge
 * it scorches, behind it the view turns black. Normal blending, clipped to the rounded
 * rectangle of `box` and `cornerRadius`. Same edge uniforms as `burnPaperShader`.
 */
export const burnCharShader = composeShader({
  name: 'burn-char',
  use: ['burnField', 'fbm2', 'noise', 'sdRoundRect'],
  fallback: '#00000000',
  uniforms: { ...BURN_FIELD_UNIFORMS, charWidth: 14, cornerRadius: 10, charColor: [0.17, 0.1, 0.05] },
  main: `${BURN_EDGE}
  float od = sdRoundRect(q - box * 0.5, box * 0.5, min(cornerRadius, min(box.x, box.y) * 0.5));
  float onPaper = 1.0 - smoothstep(-0.5, 0.5, od);
  float k = clamp(1.0 + s / charWidth, 0.0, 1.0);
  float burnt = smoothstep(-0.6, 0.6, s);
  float a = max(k * k * 0.75, burnt * 0.96) * onPaper;
  if (a <= 0.0) return half4(0.0);
  float3 col = mix(float3(0.42, 0.26, 0.12), charColor, smoothstep(0.3, 1.0, k));
  if (detail > 0.5) col *= 0.85 + 0.3 * vnoise(q * 0.3 + float2(seed, 0.0));
  return half4(half3(col * a), half(a));
`,
});
