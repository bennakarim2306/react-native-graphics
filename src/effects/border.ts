import type { NodeEffect } from '../graphics/effects';
import type { Color, Fill } from '../graphics/paint';
import { validateFill } from '../graphics/paint';
import { energyShader, fireShader } from '../graphics/shader';
import type { ShaderDefinition } from '../graphics/shader';
import { defineEffect } from '../runtime/effect';
import type { Drawable, EffectDefinition, EffectInstance } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { AttachmentHandle, AttachmentState } from '../scene/attachment';
import { composeTransform } from '../scene/matrix';
import { SceneNode } from '../scene/node';
import type { SceneCommand, SceneDrawable } from '../scene/scene';
import type { TargetRef } from '../scene/targets';

/** Parameters shared by the border effects. */
export interface BorderParams {
  /**
   * Node to outline. Its size comes from its shape bounds or its explicit `size` (a proxy node
   * of a React Native view has one). The border follows the node's position, rotation and scale.
   * A `<GameFXTarget>` id also works: the engine resolves it to the target's proxy node.
   */
  readonly target: TargetRef;
  /** Gap between the target's edge and the border, in points. Default 4. */
  readonly padding?: number;
  /** Corner radius of the border in points. Default 12. */
  readonly cornerRadius?: number;
  /** Border line width in points. Default 3. */
  readonly width?: number;
  /** Stops after this many ms. Default: runs until cancelled or the target is destroyed. */
  readonly duration?: number;
}

export interface GlowBorderParams extends BorderParams {
  /** Default `#FFD54A`. */
  readonly color?: Color;
  /** Blur radius of the glow in points. Default 10. */
  readonly radius?: number;
  /** Pulses per second (0 = steady). Default 1. */
  readonly pulse?: number;
  /** Glow strength multiplier. Default 1. */
  readonly intensity?: number;
}

export interface ShaderBorderParams extends BorderParams {
  /** Built-in shader name or a custom shader. Default `energy`. */
  readonly shader?: 'energy' | 'fire' | ShaderDefinition;
  /** Uniform overrides, for example `{ speed: 2 }` or `{ intensity: 1.5 }`. */
  readonly uniforms?: Readonly<Record<string, number | readonly number[]>>;
  /** Shorthand for the `intensity` (fire) or `speed` (energy) uniform. */
  readonly intensity?: number;
  /** Adds a soft glow of this color around the line. Default none. */
  readonly glowColor?: Color;
}

const nonNegative = (v: number, name: string, effect: string): number => {
  if (!Number.isFinite(v) || v < 0) throw new InvalidOptionError(`${effect} ${name} must be a finite number >= 0.`);
  return v;
};

interface BorderLook {
  stroke: Fill;
  width: number;
  effects(time: number): readonly NodeEffect[];
}

/**
 * Generic "outline that follows a node" effect: attaches to the target, rebuilds a rounded
 * rectangle around its current bounds every frame and draws it with the given look. It ends
 * when cancelled, after `duration`, or when the target is destroyed.
 */
class BorderInstance implements EffectInstance {
  drawables: readonly Drawable[] = [];
  done = false;
  private readonly handle: AttachmentHandle;
  private state: AttachmentState | null = null;
  private readonly padding: number;
  private readonly cornerRadius: number;
  private readonly duration: number;

  constructor(
    name: string,
    params: BorderParams,
    private readonly look: BorderLook,
  ) {
    if (!(params.target instanceof SceneNode)) throw new InvalidOptionError(`${name} needs a target scene node.`);
    if (params.target.destroyed) throw new InvalidOptionError(`${name} target has been destroyed.`);
    this.padding = nonNegative(params.padding ?? 4, 'padding', name);
    this.cornerRadius = nonNegative(params.cornerRadius ?? 12, 'cornerRadius', name);
    this.duration = params.duration ?? Infinity;
    if (!(this.duration > 0)) throw new InvalidOptionError(`${name} duration must be > 0.`);
    this.handle = params.target.attach({
      update: (state) => {
        this.state = state;
        this.rebuild();
      },
      onDetach: () => {
        this.done = true;
        this.drawables = [];
      },
    });
  }

  update(elapsedMs: number): void {
    if (elapsedMs >= this.duration) {
      this.done = true;
      this.drawables = [];
    }
  }

  dispose(): void {
    this.handle.detach();
    this.drawables = [];
  }

  private rebuild(): void {
    const s = this.state;
    if (!s || this.done || !s.visible || !s.inScene || s.opacity <= 0) {
      this.drawables = [];
      return;
    }
    // Size in screen points so the line width does not scale with the target.
    const width = s.width * Math.abs(s.scaleX) + this.padding * 2;
    const height = s.height * Math.abs(s.scaleY) + this.padding * 2;
    const matrix = composeTransform(s.x, s.y, s.rotation, 1, 1);
    const effects = this.look.effects(s.time);
    const draw: SceneCommand = {
      op: 'draw',
      item: {
        nodeId: -1,
        matrix,
        opacity: s.opacity,
        blendMode: 'normal',
        shape: {
          type: 'rect',
          width,
          height,
          cornerRadius: Math.min(this.cornerRadius, width / 2, height / 2),
          stroke: { fill: this.look.stroke, width: this.look.width, join: 'round' },
        },
      },
    };
    const commands: SceneCommand[] =
      effects.length > 0
        ? [
            { op: 'begin-group', nodeId: -1, clip: null, clipMatrix: matrix, layer: true, effects, blendMode: 'normal' },
            draw,
            { op: 'end-group', nodeId: -1 },
          ]
        : [draw];
    const drawable: SceneDrawable = {
      kind: 'scene',
      time: s.time,
      items: commands.flatMap((c) => (c.op === 'draw' ? [c.item] : [])),
      commands,
    };
    this.drawables = [drawable];
  }
}

/** Pulsing glowing outline around a node (or a React Native target's proxy node). */
export const glowBorder: EffectDefinition<GlowBorderParams> = defineEffect<GlowBorderParams>({
  name: 'glow-border',
  create(params) {
    const name = 'glow-border';
    const color = params.color ?? '#FFD54A';
    validateFill(color, `${name} color`);
    const radius = nonNegative(params.radius ?? 10, 'radius', name);
    const pulse = nonNegative(params.pulse ?? 1, 'pulse', name);
    const intensity = nonNegative(params.intensity ?? 1, 'intensity', name);
    const width = params.width ?? 3;
    if (!(Number.isFinite(width) && width > 0)) throw new InvalidOptionError(`${name} width must be > 0.`);
    return new BorderInstance(name, params, {
      stroke: color,
      width,
      effects: (time) => {
        const wave = pulse > 0 ? 0.5 + 0.5 * Math.sin((time / 1000) * pulse * Math.PI * 2) : 1;
        return [{ type: 'glow', color, radius: radius * (0.6 + 0.4 * wave), strength: intensity * (0.7 + 0.6 * wave) }];
      },
    });
  },
});

function shaderBorder(name: string, defaultShader: ShaderDefinition, intensityUniform: string): EffectDefinition<ShaderBorderParams> {
  return defineEffect<ShaderBorderParams>({
    name,
    create(params) {
      const option = params.shader;
      const shader = option === undefined ? defaultShader : option === 'energy' ? energyShader : option === 'fire' ? fireShader : option;
      const uniforms: Record<string, number | readonly number[]> = { ...params.uniforms };
      if (params.intensity !== undefined) {
        nonNegative(params.intensity, 'intensity', name);
        const key = shader.uniforms.some((u) => u.name === intensityUniform)
          ? intensityUniform
          : shader.uniforms.some((u) => u.name === 'intensity')
            ? 'intensity'
            : null;
        if (key) uniforms[key] = params.intensity;
      }
      const stroke: Fill = { type: 'shader', shader, uniforms };
      validateFill(stroke, `${name} shader`);
      const width = params.width ?? 4;
      if (!(Number.isFinite(width) && width > 0)) throw new InvalidOptionError(`${name} width must be > 0.`);
      const glowColor = params.glowColor;
      if (glowColor !== undefined) validateFill(glowColor, `${name} glowColor`);
      const effects: readonly NodeEffect[] = glowColor ? [{ type: 'glow', color: glowColor, radius: 8 }] : [];
      return new BorderInstance(name, params, { stroke, width, effects: () => effects });
    },
  });
}

/**
 * Animated outline drawn with a runtime shader (falls back to a solid color). `shader: 'fire'`
 * gives the older flickering-line look; the full flame effect is `fire-border`.
 */
export const energyBorder: EffectDefinition<ShaderBorderParams> = shaderBorder('energy-border', energyShader, 'speed');
