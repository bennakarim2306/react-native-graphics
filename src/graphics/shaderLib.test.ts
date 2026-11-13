import { formatColor, mixColor, parseColor, withAlpha } from './color';
import { composeShader, displacementShader, flameBorderShader, SHADER_CHUNKS } from './shaderLib';
import { validateFill } from './paint';
import { shaderUniformValues } from './shader';

describe('shader library', () => {
  it('composes chunks with their dependencies once, in dependency order, after the uniforms', () => {
    const shader = composeShader({
      name: 'test',
      use: ['warp', 'noise', 'sdRoundRect'],
      uniforms: { time: 0, size: [10, 20], tint: [1, 0, 0, 1] },
      main: '  return half4(1.0);',
    });
    const src = shader.source;
    expect(src.startsWith('uniform float time;\nuniform float2 size;\nuniform float4 tint;\n')).toBe(true);
    const at = (fn: string) => src.indexOf(fn);
    expect(at('float hash21')).toBeLessThan(at('float vnoise'));
    expect(at('float vnoise')).toBeLessThan(at('float fbm'));
    expect(at('float fbm')).toBeLessThan(at('float2 warp'));
    expect(src.split('float vnoise(').length).toBe(2);
    expect(at('half4 main(float2 p)')).toBeGreaterThan(at('float sdRoundRect'));
    expect(shader.uniforms.map((u) => u.name)).toEqual(['time', 'size', 'tint']);
  });

  it('rejects unknown chunks', () => {
    expect(() => composeShader({ name: 'x', use: ['nope'], uniforms: {}, main: '' })).toThrow('Unknown shader chunk "nope"');
  });

  it('equal compositions produce equal source (the renderer compiles each source once)', () => {
    const a = composeShader({ name: 'a', use: ['noise'], uniforms: { time: 0 }, main: 'return half4(0.0);' });
    const b = composeShader({ name: 'b', use: ['noise'], uniforms: { time: 0 }, main: 'return half4(0.0);' });
    expect(a.source).toBe(b.source);
    expect(Object.keys(SHADER_CHUNKS)).toEqual(expect.arrayContaining(['hash', 'noise', 'fbm', 'warp', 'sdRoundRect', 'sdEllipse', 'ramp']));
  });

  it('the flame and displacement shaders declare their uniforms with defaults and transparent/neutral fallbacks', () => {
    expect(flameBorderShader.fallback).toBe('#00000000');
    expect(displacementShader.fallback).toBe('#808080');
    // time, size(2), box(2), radius, flameHeight, intensity, color(3), seed, shape = 13 floats.
    const values = shaderUniformValues(flameBorderShader, { intensity: 1.5, color: [0, 0, 1] }, { time: 1000, width: 100, height: 50 });
    expect(values).toHaveLength(13);
    expect(values.slice(0, 3)).toEqual([1000, 100, 50]);
    expect(values.slice(7, 11)).toEqual([1.5, 0, 0, 1]);
    expect(() => { validateFill({ type: 'shader', shader: flameBorderShader, uniforms: { color: [1, 0] } }, 'fill'); }).toThrow('takes 3 value(s), got 2');
    expect(() => { validateFill({ type: 'shader', shader: flameBorderShader, uniforms: { heat: 1 } }, 'fill'); }).toThrow('no uniform');
  });
});

describe('colors', () => {
  it('parses hex, rgb() and rgba() and named colors', () => {
    expect(parseColor('#FF8000')).toEqual({ r: 1, g: 128 / 255, b: 0, a: 1 });
    expect(parseColor('#f80')).toEqual({ r: 1, g: 136 / 255, b: 0, a: 1 });
    expect(parseColor('#FF800080').a).toBeCloseTo(128 / 255, 9);
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(0,255,0)')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(parseColor('white')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(() => parseColor('nope')).toThrow('Unsupported color');
  });

  it('formats, mixes and changes alpha', () => {
    expect(formatColor({ r: 1, g: 0.5, b: 0, a: 1 })).toBe('#FF8000FF');
    expect(mixColor(parseColor('#000000'), parseColor('#FFFFFF'), 0.5).r).toBeCloseTo(0.5, 9);
    expect(withAlpha('#FF0000', 0)).toBe('#FF000000');
  });
});
