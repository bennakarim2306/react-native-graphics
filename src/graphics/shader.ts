import { InvalidOptionError } from '../runtime/errors';

/** One uniform of a runtime shader, in declaration order. */
export interface ShaderUniform {
  readonly name: string;
  /** Default value; its length is the number of floats (1 to 4). */
  readonly value: readonly number[];
}

/**
 * A runtime shader program, written in SkSL (the language React Native Skia compiles). The
 * engine treats the source as data: the renderer compiles it once, caches it, and uses
 * `fallback` when runtime shaders are unavailable or compilation fails.
 *
 * Uniforms must be listed in the order they are declared in the source. Two names are filled
 * automatically when present: `time` (engine seconds) and `size` (shape width, height).
 */
export interface ShaderDefinition {
  readonly kind: 'shader';
  readonly name: string;
  readonly source: string;
  readonly uniforms: readonly ShaderUniform[];
  /** Solid color used when the shader cannot run. */
  readonly fallback: string;
}

export interface ShaderOptions {
  readonly name: string;
  readonly source: string;
  /** Uniform defaults in declaration order: `{ time: 0, size: [0, 0], color: [1, 0.5, 0, 1] }`. */
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
  readonly fallback?: string;
}

/** Declares a runtime shader that fills, strokes and effects can use. */
export function defineShader(options: ShaderOptions): ShaderDefinition {
  if (typeof options.name !== 'string' || options.name.length === 0) {
    throw new InvalidOptionError('A shader needs a name.');
  }
  if (typeof options.source !== 'string' || !options.source.includes('main')) {
    throw new InvalidOptionError(`Shader "${options.name}" needs SkSL source with a main function.`);
  }
  const uniforms: ShaderUniform[] = [];
  for (const [name, raw] of Object.entries(options.uniforms ?? {})) {
    const value = typeof raw === 'number' ? [raw] : [...raw];
    if (value.length < 1 || value.length > 4 || value.some((v) => !Number.isFinite(v))) {
      throw new InvalidOptionError(`Shader "${options.name}" uniform "${name}" needs 1 to 4 finite numbers.`);
    }
    uniforms.push({ name, value });
  }
  return {
    kind: 'shader',
    name: options.name,
    source: options.source,
    uniforms,
    fallback: options.fallback ?? '#FFFFFF',
  };
}

/**
 * Resolves the float values for a shader in declaration order, applying overrides and the
 * automatic `time` and `size` uniforms.
 */
export function shaderUniformValues(
  shader: ShaderDefinition,
  overrides: Readonly<Record<string, number | readonly number[]>> | undefined,
  auto: { readonly time: number; readonly width: number; readonly height: number },
): number[] {
  const out: number[] = [];
  for (const uniform of shader.uniforms) {
    const override = overrides?.[uniform.name];
    let value: readonly number[];
    if (override !== undefined) value = typeof override === 'number' ? [override] : override;
    else if (uniform.name === 'time') value = [auto.time];
    else if (uniform.name === 'size') value = [auto.width, auto.height];
    else value = uniform.value;
    for (let i = 0; i < uniform.value.length; i++) out.push(value[i] ?? uniform.value[i] ?? 0);
  }
  return out;
}

/**
 * Built-in animated "energy" fill: flowing bands of light. Works as a shape fill or a
 * stroke fill (for example an animated border).
 */
export const energyShader = defineShader({
  name: 'energy',
  fallback: '#7FDBFF',
  uniforms: { time: 0, size: [100, 100], colorA: [0.2, 0.6, 1, 1], colorB: [1, 0.3, 0.9, 1], speed: 1 },
  source: `
uniform float time;
uniform float2 size;
uniform float4 colorA;
uniform float4 colorB;
uniform float speed;

half4 main(float2 p) {
  float2 uv = p / max(size, float2(1.0));
  float t = time * speed;
  float v = sin(uv.x * 9.0 + t * 3.0) + sin(uv.y * 7.0 - t * 2.3) + sin((uv.x + uv.y) * 6.0 + t * 1.7);
  float k = 0.5 + 0.5 * sin(v * 1.6);
  float4 c = mix(colorA, colorB, k);
  float glow = 0.55 + 0.45 * sin(t * 4.0 + (uv.x - uv.y) * 12.0);
  return half4(c.rgb * glow, c.a);
}
`,
});

/**
 * Built-in flame-like fill: hot at the bottom, flickering upwards. Intended for borders and
 * small areas; a full fire effect with particles is planned for a later phase.
 */
export const fireShader = defineShader({
  name: 'fire',
  fallback: '#FF7A1A',
  uniforms: { time: 0, size: [100, 100], intensity: 1 },
  source: `
uniform float time;
uniform float2 size;
uniform float intensity;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}

half4 main(float2 p) {
  float2 uv = p / max(size, float2(1.0));
  float n = noise(float2(p.x * 0.08, p.y * 0.08 + time * 3.0)) * 0.6
          + noise(float2(p.x * 0.2, p.y * 0.2 + time * 5.0)) * 0.4;
  float heat = clamp(n * 1.4 * intensity, 0.0, 1.0);
  float3 col = mix(float3(0.9, 0.15, 0.0), float3(1.0, 0.85, 0.2), heat);
  return half4(col * (0.6 + 0.4 * heat), 1.0);
}
`,
});
