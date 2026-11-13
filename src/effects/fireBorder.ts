import { parseColor } from '../graphics/color';
import type { NodeEffect } from '../graphics/effects';
import { validateFill } from '../graphics/paint';
import type { Color } from '../graphics/paint';
import { PathData } from '../graphics/path';
import { flameBorderShader } from '../graphics/shaderLib';
import { ParticleEmitter } from '../particles/emitter';
import type { EmitterConfig } from '../particles/emitter';
import type { EmitterShape } from '../particles/shapes';
import { contextQuality, defineEffect } from '../runtime/effect';
import type { Drawable, EffectContext, EffectDefinition, EffectInstance } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { Random } from '../runtime/rng';
import { composeTransform } from '../scene/matrix';
import type { Matrix2D } from '../scene/matrix';
import { SceneNode } from '../scene/node';
import type { TargetRef } from '../scene/targets';
import { checkNumber, shapeDrawable } from './placement';

/** Outline the flames follow. A `PathData` (in the target's local coordinates) uses particle flames. */
export type FireBorderShape = 'rect' | 'rounded-rect' | 'ellipse' | PathData;

export interface FireBorderParams {
  /** Scene node or a `<GameFXTarget>` id (the engine resolves ids to the target's proxy node). */
  readonly target: TargetRef;
  /** 0 to 2. Default 0.8. Changeable while running (`handle.setIntensity`). */
  readonly intensity?: number;
  /** Maximum flame length in points. Default 24. Changeable while running. */
  readonly flameHeight?: number;
  /** Base flame color. Default `#FF6A00`. Changeable while running. */
  readonly color?: Color;
  /** Soft light around the flames (high quality only). Default true. */
  readonly glow?: boolean;
  /** Sparks that fly off the flames and stay behind when the target moves. Default true. */
  readonly sparks?: boolean;
  /** Gap between the target's edge and the flames' base. Default 2. */
  readonly padding?: number;
  /** Corner radius for `rounded-rect`. Default 12. */
  readonly cornerRadius?: number;
  /** Default `rounded-rect`. */
  readonly shape?: FireBorderShape;
  /**
   * `shader`: procedural flames (runtime shader, GPU). `particles`: additive particle flames
   * (any renderer). `auto` (default): shader when the quality profile and the renderer allow
   * it, otherwise particles.
   */
  readonly mode?: 'auto' | 'shader' | 'particles';
  /** Ends after this many ms (with a short fade). Default: until stopped or the target goes. */
  readonly duration?: number;
  /** Heat haze over the flames (distort node effect, high quality only). Default false. */
  readonly heatHaze?: boolean;
}

const UPDATABLE = new Set(['intensity', 'flameHeight', 'color', 'glow', 'sparks']);
const FADE_MS = 300;

interface Settings {
  intensity: number;
  flameHeight: number;
  color: string;
  rgb: [number, number, number];
  glow: boolean;
  sparks: boolean;
}

function resolveSettings(p: Partial<FireBorderParams>, base: Settings | null, name: string): Settings {
  const intensity = checkNumber(p.intensity ?? base?.intensity ?? 0.8, 'intensity', name, { min: 0, max: 2 });
  const flameHeight = checkNumber(p.flameHeight ?? base?.flameHeight ?? 24, 'flameHeight', name, { min: 1, max: 400 });
  const color = p.color ?? base?.color ?? '#FF6A00';
  validateFill(color, `${name} color`);
  const c = parseColor(color);
  const glow = p.glow ?? base?.glow ?? true;
  const sparks = p.sparks ?? base?.sparks ?? true;
  if (typeof glow !== 'boolean' || typeof sparks !== 'boolean') throw new InvalidOptionError(`${name} glow and sparks must be booleans.`);
  return { intensity, flameHeight, color, rgb: [c.r, c.g, c.b], glow, sparks };
}

/**
 * The flagship border effect: animated flames around a target's outline that follow its
 * position, rotation and scale. Procedural shader flames (fbm noise scrolling outward from a
 * signed-distance outline, so tongue heights vary and flicker) or additive particle flames
 * when shaders are not available; optional glow and world-space sparks.
 */
export class FireBorderInstance implements EffectInstance {
  private readonly node: SceneNode;
  private readonly name = 'fire-border';
  private settings: Settings;
  private readonly padding: number;
  private readonly corner: number;
  private readonly shape: FireBorderShape;
  private readonly useShader: boolean;
  private readonly quality: ReturnType<typeof contextQuality>;
  private readonly duration: number;
  private readonly seed: number;
  private readonly random: Random;
  private readonly heatHaze: boolean;
  private flames: ParticleEmitter | null = null;
  private sparkEmitter: ParticleEmitter | null = null;
  private readonly draining: ParticleEmitter[] = [];
  private emitterKey = '';
  private stopAt = Infinity;
  private elapsed = 0;
  private list: Drawable[] = [];
  private finished = false;

  constructor(params: FireBorderParams, context: EffectContext) {
    const name = this.name;
    if (!(params.target instanceof SceneNode)) throw new InvalidOptionError(`${name} needs a target (scene node or GameFXTarget id).`);
    if (params.target.destroyed) throw new InvalidOptionError(`${name} target has been destroyed.`);
    this.node = params.target;
    this.settings = resolveSettings(params, null, name);
    this.padding = checkNumber(params.padding ?? 2, 'padding', name, { min: 0 });
    this.corner = checkNumber(params.cornerRadius ?? 12, 'cornerRadius', name, { min: 0 });
    const shape = params.shape ?? 'rounded-rect';
    if (!(shape instanceof PathData) && !['rect', 'rounded-rect', 'ellipse'].includes(shape)) {
      throw new InvalidOptionError(`${name} shape must be rect, rounded-rect, ellipse or a PathData.`);
    }
    if (shape instanceof PathData && shape.isEmpty) throw new InvalidOptionError(`${name} path must not be empty.`);
    this.shape = shape;
    this.duration = params.duration === undefined ? Infinity : checkNumber(params.duration, 'duration', name, { min: 1 });
    this.quality = contextQuality(context);
    const mode = params.mode ?? 'auto';
    if (!['auto', 'shader', 'particles'].includes(mode)) throw new InvalidOptionError(`${name} mode must be auto, shader or particles.`);
    const shadersAvailable = context.services?.capabilities?.runtimeShaders ?? true;
    this.useShader =
      !(shape instanceof PathData) && (mode === 'shader' || (mode === 'auto' && this.quality.shaders && shadersAvailable));
    this.heatHaze = (params.heatHaze ?? false) && this.quality.glow;
    this.random = context.random;
    this.seed = context.random.next() * 10;
  }

  /** `shader` or `particles`, as chosen at start. */
  get mode(): 'shader' | 'particles' {
    return this.useShader ? 'shader' : 'particles';
  }

  get drawables(): readonly Drawable[] {
    return this.list;
  }

  get done(): boolean {
    return this.finished;
  }

  update(elapsedMs: number): void {
    this.elapsed = elapsedMs;
    if (this.finished) return;
    if (this.node.destroyed && this.stopAt === Infinity) this.stopAt = elapsedMs;
    if (elapsedMs >= this.duration && this.stopAt === Infinity) this.stopAt = this.duration;
    const stopping = this.stopAt !== Infinity;
    const fade = stopping ? Math.max(0, 1 - (elapsedMs - this.stopAt) / FADE_MS) : 1;
    // Stopping: no new particles; the shader flames fade out and the particles burn out.
    if (stopping) {
      this.flames?.stop();
      this.sparkEmitter?.stop();
    }
    this.list = [];
    const alive = !this.node.destroyed;
    const visible = alive && this.node.inScene && this.node.worldVisible;
    const m = alive ? this.node.worldMatrix : null;
    const size = this.size();
    const sx = m ? Math.hypot(m[0], m[1]) : 1;
    const sy = m ? Math.hypot(m[2], m[3]) : 1;
    const w = size.width * sx + this.padding * 2;
    const h = size.height * sy + this.padding * 2;
    const rotation = m ? (Math.atan2(m[1], m[0]) * 180) / Math.PI : 0;
    const frame = m ? composeTransform(m[4], m[5], rotation, 1, 1) : null;
    const s = this.settings;
    const opacity = visible ? this.node.worldOpacity * fade : 0;

    if (frame && !stopping) this.ensureEmitters(w, h);
    for (const e of [this.flames, this.sparkEmitter]) {
      if (e && frame) e.setTransform(frame);
    }
    for (const e of [...this.draining, this.flames, this.sparkEmitter]) e?.update(elapsedMs);
    for (let i = this.draining.length - 1; i >= 0; i--) {
      const e = this.draining[i];
      if (e?.done) {
        e.dispose();
        this.draining.splice(i, 1);
      }
    }

    if (visible && frame && this.useShader && opacity > 0) {
      const margin = s.flameHeight * 1.8 + 4;
      const ellipse = this.shape === 'ellipse';
      const radius = this.shape === 'rect' || ellipse ? 0 : Math.min(this.corner, w / 2, h / 2);
      const effects: NodeEffect[] = [];
      if (s.glow && this.quality.glow) effects.push({ type: 'glow', color: s.color, radius: s.flameHeight * 0.6, strength: Math.min(1.5, s.intensity) });
      if (this.heatHaze) effects.push({ type: 'distort', amount: 3, frequency: 0.05, speed: 1.5 });
      this.list.push(
        shapeDrawable(
          elapsedMs,
          {
            type: 'rect',
            width: w + margin * 2,
            height: h + margin * 2,
            fill: {
              type: 'shader',
              shader: flameBorderShader,
              uniforms: {
                box: [w / 2, h / 2],
                radius,
                flameHeight: s.flameHeight,
                intensity: s.intensity,
                color: s.rgb,
                seed: this.seed,
                shape: ellipse ? 1 : 0,
              },
            },
          },
          frame,
          opacity,
          { blendMode: 'plus', effects },
        ),
      );
    }
    if (visible) {
      for (const e of [...this.draining, this.flames, this.sparkEmitter]) {
        if (e && e.aliveCount > 0) this.list.push(e);
      }
    }
    const emittersDone = [this.flames, this.sparkEmitter, ...this.draining].every((e) => !e || e.done);
    if (fade === 0 && emittersDone) this.finish();
  }

  stop(): void {
    if (this.stopAt === Infinity) this.stopAt = this.elapsed;
  }

  setParams(patch: Readonly<Record<string, unknown>>): void {
    for (const key of Object.keys(patch)) {
      if (!UPDATABLE.has(key)) throw new InvalidOptionError(`fire-border cannot change "${key}" while running.`);
    }
    const next = resolveSettings(patch, this.settings, this.name);
    const rebuild = next.color !== this.settings.color || next.sparks !== this.settings.sparks || next.flameHeight !== this.settings.flameHeight;
    const rateChanged = next.intensity !== this.settings.intensity;
    this.settings = next;
    if (rebuild) this.emitterKey = '';
    else if (rateChanged) this.applyRates();
  }

  dispose(): void {
    for (const e of [this.flames, this.sparkEmitter, ...this.draining]) e?.dispose();
    this.flames = null;
    this.sparkEmitter = null;
    this.draining.length = 0;
    this.list = [];
  }

  private finish(): void {
    this.finished = true;
    this.list = [];
  }

  private size(): { width: number; height: number } {
    if (this.node.destroyed) return { width: 0, height: 0 };
    const b = this.node.getLocalBounds();
    return b ? { width: b.width, height: b.height } : { width: 0, height: 0 };
  }

  private outline(w: number, h: number): EmitterShape {
    if (this.shape instanceof PathData) return { type: 'path', path: this.shape };
    if (this.shape === 'ellipse') {
      return { type: 'path', path: new PathData().ellipse(0, 0, w / 2, h / 2) };
    }
    return { type: 'rect', width: w, height: h, edge: true, cornerRadius: this.shape === 'rect' ? 0 : Math.min(this.corner, w / 2, h / 2) };
  }

  private perimeter(w: number, h: number): number {
    return 2 * (w + h);
  }

  /** (Re)creates emitters when the outline size or settings changed; old ones drain. */
  private ensureEmitters(w: number, h: number): void {
    const s = this.settings;
    const key = `${String(Math.round(w / 2))}x${String(Math.round(h / 2))}|${s.color}|${String(s.sparks)}|${String(s.flameHeight)}`;
    if (key === this.emitterKey) return;
    this.emitterKey = key;
    for (const old of [this.flames, this.sparkEmitter]) {
      if (old) {
        old.stop();
        this.draining.push(old);
      }
    }
    this.flames = null;
    this.sparkEmitter = null;
    const outline = this.outline(w, h);
    const perimeter = this.perimeter(w, h);
    const scale = this.quality.particleScale;
    if (!this.useShader) {
      const speed = s.flameHeight * 2.2;
      const config: EmitterConfig = {
        shape: outline,
        space: 'local',
        rate: 1,
        maxParticles: Math.min(5000, Math.ceil(perimeter * 1.2) + 32),
        directionMode: 'normal',
        spread: 30,
        speed: { min: speed * 0.5, max: speed },
        lifetime: { min: 260, max: 520 },
        size: { min: s.flameHeight * 0.22, max: s.flameHeight * 0.42 },
        scale: { from: 1, to: 0.15, easing: 'easeInQuad' },
        opacity: [0, 0.9, 0.6, 0],
        look: 'soft',
        blendMode: 'plus',
        colorOverLife: ['#FFF4D0', '#FFC94D', s.color, `${s.color.slice(0, 7)}00`],
      };
      this.flames = new ParticleEmitter(config, this.random, { qualityScale: scale });
    }
    if (s.sparks && this.quality.details) {
      this.sparkEmitter = new ParticleEmitter(
        {
          shape: outline,
          space: 'world',
          rate: 1,
          maxParticles: 160,
          directionMode: 'normal',
          spread: 50,
          speed: { min: 40, max: 120 },
          gravity: -90,
          drag: 0.8,
          lifetime: { min: 400, max: 900 },
          size: { min: 0.8, max: 1.8 },
          look: 'spark',
          stretch: 0.06,
          blendMode: 'plus',
          colors: ['#FFF3C4', '#FFD54A', s.color],
        },
        this.random,
        { qualityScale: scale },
      );
    }
    this.applyRates();
    const frame = this.node.destroyed ? null : this.node.worldMatrix;
    if (frame) {
      const m: Matrix2D = composeTransform(frame[4], frame[5], (Math.atan2(frame[1], frame[0]) * 180) / Math.PI, 1, 1);
      this.flames?.setTransform(m);
      this.sparkEmitter?.setTransform(m);
    }
  }

  private applyRates(): void {
    const s = this.settings;
    const scale = this.quality.particleScale;
    const size = this.size();
    const perimeter = this.perimeter(size.width + this.padding * 2, size.height + this.padding * 2);
    if (this.stopAt !== Infinity) return;
    this.flames?.setRate(perimeter * 1.4 * s.intensity * scale);
    this.sparkEmitter?.setRate(perimeter * 0.035 * s.intensity * scale);
  }
}

/** Animated flames around a target's border. */
export const fireBorder: EffectDefinition<FireBorderParams> = defineEffect<FireBorderParams>({
  name: 'fire-border',
  create: (params, context) => new FireBorderInstance(params, context),
});
