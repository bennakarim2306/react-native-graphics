import { formatColor, parseColor } from '../graphics/color';
import type { RGBA } from '../graphics/color';
import type { NodeEffect } from '../graphics/effects';
import { validateFill } from '../graphics/paint';
import type { Color } from '../graphics/paint';
import { PathData } from '../graphics/path';
import { flameBorderLiteShader, flameBorderShader } from '../graphics/shaderLib';
import { EMITTER_UPDATE_KEYS, ParticleEmitter } from '../particles/emitter';
import type { EmitterConfig, EmitterUpdate } from '../particles/emitter';
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
  /** Body color of the flames. Default `#FF6A00`. Changeable while running. */
  readonly color?: Color;
  /**
   * Color of the hottest part near the base. Default: derived from `color` (white-yellow for
   * orange fire). Changeable while running.
   */
  readonly coreColor?: Color;
  /** Color of the flame tips. Default: a darker, redder `color`. Changeable while running. */
  readonly tipColor?: Color;
  /** How fast the flames rise and change, 0.1 to 4. Default 1. Changeable while running. */
  readonly speed?: number;
  /** Soft light around the flames. Default true. Changeable while running. */
  readonly glow?: boolean;
  /** Strength of that light, 0 to 2 (not drawn on the `low` profile). Default 1. Changeable while running. */
  readonly glowStrength?: number;
  /** Sparks that fly off the flames and stay behind when the target moves. Default true. */
  readonly sparks?: boolean;
  /** Multiplies how many sparks fly, 0 to 3. Default 1. Changeable while running. */
  readonly sparkDensity?: number;
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

const UPDATABLE = new Set(['intensity', 'flameHeight', 'color', 'coreColor', 'tipColor', 'speed', 'glow', 'glowStrength', 'sparks', 'sparkDensity']);
const FADE_MS = 300;

type RGB = readonly [number, number, number];

/** The flame colors from base (tips) to core, as the shader derives them. */
export interface FirePalette {
  readonly core: RGB;
  readonly hot: RGB;
  readonly mid: RGB;
  readonly tip: RGB;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const rgbOf = (c: RGBA): RGB => [c.r, c.g, c.b];

/**
 * Derives the flame palette from the body color (mirrors the shader): `hot` shifts toward
 * yellow (or cyan for blue fire), `core` is close to white, `tip` darker and redder.
 */
export function firePalette(color: Color, coreColor?: Color, tipColor?: Color): FirePalette {
  const m = parseColor(color);
  const hot: RGB = [clamp01(m.r + (1 - m.r) * 0.18), clamp01(m.g + 0.38 + (1 - m.g) * 0.18), clamp01(m.b + 0.12 + (1 - m.b) * 0.18)];
  const core: RGB = coreColor ? rgbOf(parseColor(coreColor)) : [hot[0] + (1 - hot[0]) * 0.72, hot[1] + (1 - hot[1]) * 0.72, hot[2] + (1 - hot[2]) * 0.72];
  const tip: RGB = tipColor ? rgbOf(parseColor(tipColor)) : [m.r * 0.85, m.g * 0.45, m.b * 0.4];
  return { core, hot, mid: rgbOf(m), tip };
}

const hex = (c: RGB, alpha = 1) => formatColor({ r: c[0], g: c[1], b: c[2], a: alpha });

interface Settings {
  intensity: number;
  flameHeight: number;
  color: string;
  coreColor: string | undefined;
  tipColor: string | undefined;
  palette: FirePalette;
  speed: number;
  glow: boolean;
  glowStrength: number;
  sparks: boolean;
  sparkDensity: number;
}

function resolveSettings(p: Partial<FireBorderParams>, base: Settings | null, name: string): Settings {
  const intensity = checkNumber(p.intensity ?? base?.intensity ?? 0.8, 'intensity', name, { min: 0, max: 2 });
  const flameHeight = checkNumber(p.flameHeight ?? base?.flameHeight ?? 24, 'flameHeight', name, { min: 1, max: 400 });
  const speed = checkNumber(p.speed ?? base?.speed ?? 1, 'speed', name, { min: 0.1, max: 4 });
  const glowStrength = checkNumber(p.glowStrength ?? base?.glowStrength ?? 1, 'glowStrength', name, { min: 0, max: 2 });
  const sparkDensity = checkNumber(p.sparkDensity ?? base?.sparkDensity ?? 1, 'sparkDensity', name, { min: 0, max: 3 });
  const color = p.color ?? base?.color ?? '#FF6A00';
  validateFill(color, `${name} color`);
  const coreColor = 'coreColor' in p ? p.coreColor : base?.coreColor;
  const tipColor = 'tipColor' in p ? p.tipColor : base?.tipColor;
  if (coreColor !== undefined) validateFill(coreColor, `${name} coreColor`);
  if (tipColor !== undefined) validateFill(tipColor, `${name} tipColor`);
  const glow = p.glow ?? base?.glow ?? true;
  const sparks = p.sparks ?? base?.sparks ?? true;
  if (typeof glow !== 'boolean' || typeof sparks !== 'boolean') throw new InvalidOptionError(`${name} glow and sparks must be booleans.`);
  const palette = firePalette(color, coreColor, tipColor);
  return { intensity, flameHeight, color, coreColor, tipColor, palette, speed, glow, glowStrength, sparks, sparkDensity };
}

/**
 * The flagship border effect: animated flames around a target's outline that follow its
 * position, rotation and scale. Procedural shader flames (tongues of noise advected upward on
 * screen from a signed-distance outline, with a core-to-tip color ramp and a halo drawn in the
 * same shader) or additive particle flames when shaders are not available; optional
 * world-space sparks that rise and curl upward.
 *
 * Emitters are created once and reconfigured in place when the target's size, rotation or the
 * settings change, so resizing a target never restarts or duplicates the particles.
 */
export class FireBorderInstance implements EffectInstance {
  private readonly node: SceneNode;
  private readonly name = 'fire-border';
  private settings: Settings;
  private readonly padding: number;
  private readonly corner: number;
  private readonly shape: FireBorderShape;
  private readonly useShader: boolean;
  private readonly lite: boolean;
  private readonly quality: ReturnType<typeof contextQuality>;
  private readonly duration: number;
  private readonly seed: number;
  private readonly random: Random;
  private readonly heatHaze: boolean;
  private flames: ParticleEmitter | null = null;
  private sparkEmitter: ParticleEmitter | null = null;
  private readonly draining: ParticleEmitter[] = [];
  /** Outline size the emitters were configured for. */
  private emitterSize = '';
  /** Settings the emitters were configured for (null forces a reconfiguration). */
  private emitterSettings: Settings | null = null;
  /** Target rotation (degrees) the particle flames' up direction was set for. */
  private emitterRotation = NaN;
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
    this.lite = this.quality.shaderDetail === 'lite';
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

    if (frame && !stopping) this.ensureEmitters(w, h, rotation);
    for (const e of [this.flames, this.sparkEmitter]) {
      if (e && frame) e.setTransform(frame);
    }
    // Particle flames (local space) move rigidly with the target; sparks (world space) do not.
    for (const e of [this.flames, ...this.draining]) {
      if (e?.matrix) e.anchor = alive ? this.node : undefined;
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
      const glowOn = s.glow && !this.lite ? s.glowStrength : 0;
      const margin = s.flameHeight * (0.6 + 0.4 * s.intensity) * (2.0 + glowOn * 0.9) + 4;
      const ellipse = this.shape === 'ellipse';
      const radius = this.shape === 'rect' || ellipse ? 0 : Math.min(this.corner, w / 2, h / 2);
      const effects: NodeEffect[] = [];
      if (this.heatHaze) effects.push({ type: 'distort', amount: 3, frequency: 0.05, speed: 1.5 });
      // Screen-up in the flame frame (the frame is rotated with the target).
      const theta = (rotation * Math.PI) / 180;
      const p = s.palette;
      this.list.push(
        shapeDrawable(
          elapsedMs,
          {
            type: 'rect',
            width: w + margin * 2,
            height: h + margin * 2,
            fill: {
              type: 'shader',
              shader: this.lite ? flameBorderLiteShader : flameBorderShader,
              uniforms: {
                box: [w / 2, h / 2],
                radius,
                flameHeight: s.flameHeight,
                intensity: s.intensity,
                color: p.mid,
                coreColor: s.coreColor === undefined ? [-1, -1, -1] : p.core,
                tipColor: s.tipColor === undefined ? [-1, -1, -1] : p.tip,
                speed: s.speed,
                glow: glowOn,
                up: [-Math.sin(theta), -Math.cos(theta)],
                seed: this.seed,
                shape: ellipse ? 1 : 0,
              },
            },
          },
          frame,
          opacity,
          { blendMode: 'plus', effects, anchor: this.node },
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
    // Validated as a whole first; emitters are reconfigured on the next frame.
    this.settings = resolveSettings(patch, this.settings, this.name);
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

  /**
   * Creates the emitters once and keeps them in step with the outline size, the rotation (for
   * the particle flames' up direction) and the settings. Only switching sparks on or off adds
   * or retires an emitter (a retired one drains: its particles finish their life).
   */
  private ensureEmitters(w: number, h: number, rotation: number): void {
    const s = this.settings;
    const sizeKey = `${w.toFixed(1)}x${h.toFixed(1)}`;
    const wantFlames = !this.useShader;
    const wantSparks = s.sparks && s.sparkDensity > 0 && this.quality.details;
    const scale = this.quality.particleScale;
    let createdFlames = false;
    let createdSparks = false;
    if (wantFlames && !this.flames) {
      this.flames = new ParticleEmitter(this.flameConfig(w, h, rotation), this.random, { qualityScale: scale });
      this.emitterRotation = rotation;
      createdFlames = true;
    }
    if (wantSparks && !this.sparkEmitter) {
      this.sparkEmitter = new ParticleEmitter(this.sparkConfig(w, h), this.random, { qualityScale: scale });
      createdSparks = true;
    } else if (!wantSparks && this.sparkEmitter) {
      this.sparkEmitter.stop();
      this.draining.push(this.sparkEmitter);
      this.sparkEmitter = null;
    }
    const created = createdFlames || createdSparks;
    const sizeChanged = sizeKey !== this.emitterSize;
    const settingsChanged = this.emitterSettings !== s;
    if (sizeChanged || settingsChanged) {
      const outline = this.outline(w, h);
      if (this.flames && !createdFlames) {
        this.flames.configure(settingsChanged ? { ...pickUpdate(this.flameConfig(w, h, rotation)), shape: outline } : { shape: outline });
        this.emitterRotation = rotation;
      }
      if (this.sparkEmitter && !createdSparks) {
        this.sparkEmitter.configure(settingsChanged ? { ...pickUpdate(this.sparkConfig(w, h)), shape: outline } : { shape: outline });
      }
    }
    // Particle flames rise on screen: turn their direction and buoyancy with the target.
    if (this.flames && Math.abs(rotation - this.emitterRotation) > 2) {
      const up = this.upFlame(rotation);
      this.flames.configure({ direction: up.direction, gravity: up.gravity });
      this.emitterRotation = rotation;
    }
    if (created || sizeChanged || settingsChanged) {
      this.emitterSize = sizeKey;
      this.emitterSettings = s;
      this.applyRates(w, h);
    }
    if (created) {
      const frame = this.node.destroyed ? null : this.node.worldMatrix;
      if (frame) {
        const m: Matrix2D = composeTransform(frame[4], frame[5], (Math.atan2(frame[1], frame[0]) * 180) / Math.PI, 1, 1);
        this.flames?.setTransform(m);
        this.sparkEmitter?.setTransform(m);
      }
    }
  }

  /** Direction (degrees) and buoyancy of the particle flames in the rotated local frame. */
  private upFlame(rotation: number): { direction: number; gravity: { x: number; y: number } } {
    const theta = (rotation * Math.PI) / 180;
    const ux = -Math.sin(theta);
    const uy = -Math.cos(theta);
    const lift = this.settings.flameHeight * 3.2;
    return { direction: (Math.atan2(uy, ux) * 180) / Math.PI, gravity: { x: ux * lift, y: uy * lift } };
  }

  private flameConfig(w: number, h: number, rotation: number): EmitterConfig {
    const s = this.settings;
    const p = s.palette;
    const fh = s.flameHeight;
    const speed = fh * 1.6 * s.speed;
    const up = this.upFlame(rotation);
    return {
      shape: this.outline(w, h),
      space: 'local',
      rate: 1,
      maxParticles: Math.min(5000, Math.ceil(this.perimeter(w, h) * 2) + 64),
      directionMode: 'fixed',
      direction: up.direction,
      spread: 34,
      speed: { min: speed * 0.45, max: speed },
      gravity: up.gravity,
      drag: 1.4,
      lifetime: { min: 240 / Math.sqrt(s.speed), max: 560 / Math.sqrt(s.speed) },
      size: { min: fh * 0.2, max: fh * 0.38 },
      scale: { from: 1, to: 0.15, easing: 'easeInQuad' },
      opacity: [0, 0.85, 0.55, 0],
      look: 'soft',
      blendMode: 'plus',
      colorOverLife: [hex(p.core), hex(p.hot), hex(p.mid), hex(p.tip), hex(p.tip, 0)],
    };
  }

  private sparkConfig(w: number, h: number): EmitterConfig {
    const p = this.settings.palette;
    return {
      shape: this.outline(w, h),
      space: 'world',
      rate: 1,
      maxParticles: 240,
      directionMode: 'normal',
      spread: 50,
      speed: { min: 30, max: 115 },
      // Buoyant: sparks that leave downward slow down and curl back up.
      gravity: -140,
      drag: 1.3,
      lifetime: { min: 450, max: 1100 },
      size: { min: 0.7, max: 1.6 },
      look: 'spark',
      stretch: 0.05,
      blendMode: 'plus',
      opacity: [1, 1, 0.8, 0],
      colorOverLife: ['#FFF8E6', hex(p.hot), hex(p.mid), hex(p.tip, 0)],
    };
  }

  private applyRates(w: number, h: number): void {
    const s = this.settings;
    const scale = this.quality.particleScale;
    const perimeter = this.perimeter(w, h);
    if (this.stopAt !== Infinity) return;
    this.flames?.setRate(perimeter * 1.4 * s.intensity * scale);
    this.sparkEmitter?.setRate(perimeter * 0.035 * s.intensity * s.sparkDensity * scale);
  }
}

/** The emitter properties `configure` accepts, taken from a full config. */
function pickUpdate(config: EmitterConfig): EmitterUpdate {
  const out: Record<string, unknown> = {};
  for (const key of EMITTER_UPDATE_KEYS) {
    if (key !== 'rate' && config[key] !== undefined) out[key] = config[key];
  }
  return out;
}

/** Animated flames around a target's border. */
export const fireBorder: EffectDefinition<FireBorderParams> = defineEffect<FireBorderParams>({
  name: 'fire-border',
  create: (params, context) => new FireBorderInstance(params, context),
});
