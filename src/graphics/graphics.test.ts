import { InvalidOptionError } from '../runtime/errors';
import { brightness, grayscale, validateNodeEffect } from './effects';
import { validateBlendMode, validateFill, validateStroke } from './paint';
import type { BlendMode, Fill } from './paint';
import { PathData } from './path';
import { defineShader, energyShader, fireShader, shaderUniformValues } from './shader';

describe('PathData', () => {
  it('builds SVG path data and tracks a version', () => {
    const path = new PathData().moveTo(0, 0).lineTo(10, 0).quadTo(15, 5, 10, 10).cubicTo(5, 15, 0, 15, 0, 10).close();
    expect(path.toSvg()).toBe('M 0 0 L 10 0 Q 15 5 10 10 C 5 15 0 15 0 10 Z');
    expect(path.version).toBe(5);
    expect(path.isEmpty).toBe(false);
    path.lineTo(20, 20);
    expect(path.toSvg()).toContain('L 20 20');
  });

  it('computes bounds including control points and caches them per change', () => {
    const path = new PathData().moveTo(-5, 0).quadTo(0, -20, 5, 0);
    expect(path.getBounds()).toEqual({ x: -5, y: -20, width: 10, height: 20 });
    expect(path.getBounds()).toBe(path.getBounds());
    expect(new PathData().getBounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('adds rectangles, ellipses, polygons and stars', () => {
    expect(new PathData().rect(0, 0, 10, 5).getBounds()).toEqual({ x: 0, y: 0, width: 10, height: 5 });
    const ellipse = new PathData().ellipse(0, 0, 20, 10).getBounds();
    expect(ellipse.width).toBeCloseTo(40);
    expect(ellipse.height).toBeCloseTo(20);
    const hexagon = new PathData().polygon(0, 0, 6, 10);
    expect(hexagon.toSvg().split('L')).toHaveLength(6);
    const star = new PathData().polygon(0, 0, 5, 10, 4);
    expect(star.toSvg().split('L')).toHaveLength(10);
    expect(star.getBounds().y).toBeCloseTo(-10); // first point straight up
  });

  it('rejects invalid input', () => {
    expect(() => new PathData().lineTo(1, 1)).toThrow('moveTo');
    expect(() => new PathData().moveTo(NaN, 0)).toThrow(InvalidOptionError);
    expect(() => new PathData().polygon(0, 0, 2, 5)).toThrow('3 points');
  });
});

describe('paints', () => {
  it('accepts colors, gradients and shader fills', () => {
    const fills: Fill[] = [
      '#FF0000',
      { type: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colors: ['red', 'blue'] },
      { type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 4, colors: ['red', 'blue', 'green'], positions: [0, 0.5, 1] },
      { type: 'shader', shader: energyShader, uniforms: { speed: 2 } },
    ];
    for (const fill of fills) expect(() => { validateFill(fill); }).not.toThrow();
    expect(() => { validateStroke({ fill: '#FFF', width: 2 }); }).not.toThrow();
  });

  it('rejects malformed paints with clear messages', () => {
    expect(() => { validateFill(''); }).toThrow('must not be empty');
    expect(() => { validateFill({ type: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colors: ['red'] }); }).toThrow('two color');
    expect(() => { validateFill({ type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 4, colors: ['a', 'b'], positions: [0.5, 0.2] }); },
    ).toThrow('ascending');
    expect(() => { validateFill({ type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 0, colors: ['a', 'b'] }); }).toThrow('radius');
    expect(() => { validateFill({ type: 'shader', shader: energyShader, uniforms: { nope: 1 } }); }).toThrow('no uniform "nope"');
    expect(() => { validateFill({ type: 'shader', shader: {} as typeof energyShader }); }).toThrow('defineShader');
    expect(() => { validateFill({ type: 'pattern' } as unknown as Fill); }).toThrow('Unknown fill type');
    expect(() => { validateStroke({ fill: '#FFF', width: 0 }); }).toThrow('width');
    expect(() => { validateBlendMode('glow' as BlendMode); }).toThrow('Unknown blend mode');
  });
});

describe('shaders', () => {
  it('defines uniforms in declaration order and resolves values with automatic time and size', () => {
    const shader = defineShader({
      name: 'test',
      source: 'uniform float time; uniform float2 size; uniform float4 tint; half4 main(float2 p) { return half4(1); }',
      uniforms: { time: 0, size: [0, 0], tint: [1, 0, 0, 1] },
    });
    expect(shader.uniforms.map((u) => u.name)).toEqual(['time', 'size', 'tint']);
    expect(shader.fallback).toBe('#FFFFFF');
    expect(shaderUniformValues(shader, undefined, { time: 1.5, width: 30, height: 20 })).toEqual([1.5, 30, 20, 1, 0, 0, 1]);
    expect(shaderUniformValues(shader, { tint: [0, 1, 0, 1], time: 9 }, { time: 1.5, width: 30, height: 20 })).toEqual([
      9, 30, 20, 0, 1, 0, 1,
    ]);
  });

  it('validates definitions', () => {
    expect(() => defineShader({ name: '', source: 'main' })).toThrow('name');
    expect(() => defineShader({ name: 'x', source: 'nothing' })).toThrow('main function');
    expect(() => defineShader({ name: 'x', source: 'main', uniforms: { a: [1, 2, 3, 4, 5] } })).toThrow('1 to 4');
  });

  it('ships the built-in energy and fire shaders with fallbacks', () => {
    expect(energyShader.uniforms.map((u) => u.name)).toEqual(['time', 'size', 'colorA', 'colorB', 'speed']);
    expect(fireShader.uniforms.map((u) => u.name)).toEqual(['time', 'size', 'intensity']);
    expect(energyShader.fallback).toMatch(/^#/);
  });
});

describe('node effects', () => {
  it('builds color matrices', () => {
    const identity = grayscale(0);
    if (identity.type !== 'color-matrix') throw new Error('expected a color matrix');
    expect(identity.matrix.map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    const gray = grayscale(1);
    if (gray.type !== 'color-matrix') throw new Error('expected a color matrix');
    expect(gray.matrix.slice(0, 3)).toEqual(gray.matrix.slice(5, 8));
    expect(brightness(2)).toMatchObject({ type: 'color-matrix' });
  });

  it('validates effects', () => {
    expect(() => { validateNodeEffect({ type: 'glow', color: '#FFF', radius: -1 }); }).toThrow('radius');
    expect(() => { validateNodeEffect({ type: 'blur', radius: Infinity }); }).toThrow('radius');
    expect(() => { validateNodeEffect({ type: 'drop-shadow', dx: NaN, dy: 0, radius: 1, color: '#000' }); }).toThrow('offset');
    expect(() => { validateNodeEffect({ type: 'color-matrix', matrix: [1, 2] }); }).toThrow('20 finite');
    expect(() => { validateNodeEffect({ type: 'sparkle' } as never); }).toThrow('Unknown node effect');
  });
});
