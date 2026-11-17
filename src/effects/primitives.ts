import { resolveEasing } from '../animation/easing';
import { validateFill } from '../graphics/paint';
import type { Color, RadialGradient } from '../graphics/paint';
import { withAlpha } from '../graphics/color';
import { EMITTER_UPDATE_KEYS, ParticleEmitter } from '../particles/emitter';
import type { EmitterConfig, EmitterUpdate } from '../particles/emitter';
import { contextQuality, defineEffect } from '../runtime/effect';
import type { Drawable, EffectContext, EffectDefinition, EffectInstance, TransformOffset } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import { composeTransform } from '../scene/matrix';
import type { SceneNode } from '../scene/node';
import { checkNumber, Placement, shapeDrawable } from './placement';
import type { PlacementParams } from './placement';

// --- particles ------------------------------------------------------------------------------

/**
 * Parameters of the generic `particles` effect: an emitter placed at a position or target.
 * `handle.update` changes `intensity` and the emitter properties listed in `EmitterUpdate`
 * while it runs.
 */
export interface ParticlesParams extends EmitterConfig, PlacementParams {
  /** Multiplies the emission rate; change it at runtime with `handle.setIntensity`. Default 1. */
  readonly intensity?: number;
}

/** What `handle.update` accepts on the `particles` effect. */
export type ParticlesUpdate = EmitterUpdate & { readonly intensity?: number };

/** Presets map their own parameters to an emitter, so only these two change at runtime. */
const PRESET_UPDATE_KEYS: readonly string[] = ['intensity', 'rate'];
const PARTICLES_UPDATE_KEYS: readonly string[] = ['intensity', ...EMITTER_UPDATE_KEYS];

/**
 * An emitter that follows its placement. Used directly (`fx.play('particles', {...})`) and as
 * the building block of presets. World-space particles stay where they were born; local-space
 * particles move with the target.
 */
export class ParticlesInstance implements EffectInstance {
  readonly emitter: ParticleEmitter;
  private readonly placement: Placement;
  /** Quality and reduced-motion multiplier of counts and rates. */
  private readonly scale: number;
  private readonly updateKeys: readonly string[];
  private baseRate: number;
  private intensity: number;
  private stopped = false;
  private lastDrawables: readonly Drawable[];

  /**
   * `emitterUpdates`: accept every `EmitterUpdate` key in `setParams` (the `particles` effect);
   * otherwise only `intensity` and `rate` (presets).
   */
  constructor(
    params: ParticlesParams,
    context: EffectContext,
    private readonly name = 'particles',
    emitterUpdates = false,
  ) {
    this.placement = new Placement(params, context, name);
    this.intensity = checkNumber(params.intensity ?? 1, 'intensity', name, { min: 0, max: 10 });
    this.updateKeys = emitterUpdates ? PARTICLES_UPDATE_KEYS : PRESET_UPDATE_KEYS;
    const quality = contextQuality(context);
    const scale = quality.particleScale * (context.reducedMotion ? 0.5 : 1);
    this.scale = scale;
    this.emitter = new ParticleEmitter(params, context.random, { qualityScale: scale, transform: this.placement.matrix() });
    this.baseRate = (params.rate ?? 0) * scale;
    if (this.intensity !== 1 && this.baseRate > 0) this.emitter.setRate(this.baseRate * this.intensity);
    this.lastDrawables = [this.emitter];
  }

  get drawables(): readonly Drawable[] {
    return this.placement.visible ? this.lastDrawables : [];
  }

  get done(): boolean {
    return this.emitter.done;
  }

  update(elapsedMs: number): void {
    if (this.placement.targetGone && !this.stopped) this.stop();
    this.emitter.setTransform(this.placement.matrix());
    // Local-space particles move rigidly with a followed target; world-space ones stay behind.
    this.emitter.anchor = this.emitter.matrix ? this.placement.anchor : undefined;
    this.emitter.update(elapsedMs);
  }

  stop(): void {
    this.stopped = true;
    this.emitter.stop();
  }

  setParams(patch: Readonly<Record<string, unknown>>): void {
    const name = this.name;
    const emitterPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!this.updateKeys.includes(key)) {
        throw new InvalidOptionError(`${name} cannot change "${key}" while running (allowed: ${this.updateKeys.join(', ')}).`);
      }
      if (key !== 'intensity' && key !== 'rate' && value !== undefined) emitterPatch[key] = value;
    }
    // Validate everything before changing anything.
    const intensity = patch.intensity === undefined ? undefined : checkNumber(patch.intensity, 'intensity', name, { min: 0, max: 10 });
    const rate = patch.rate === undefined ? undefined : checkNumber(patch.rate, 'rate', name, { min: 0 });
    if (Object.keys(emitterPatch).length > 0) this.emitter.configure(emitterPatch);
    if (intensity !== undefined) this.intensity = intensity;
    if (rate !== undefined) this.baseRate = rate * this.scale;
    if ((intensity !== undefined || rate !== undefined) && !this.stopped) this.emitter.setRate(this.baseRate * this.intensity);
  }

  dispose(): void {
    this.emitter.dispose();
    this.lastDrawables = [];
  }
}

/** Generic particle emitter effect. */
export const particles: EffectDefinition<ParticlesParams> = defineEffect<ParticlesParams>({
  name: 'particles',
  create: (params, context) => new ParticlesInstance(params, context, 'particles', true),
});

// --- flash ----------------------------------------------------------------------------------

export interface FlashParams extends PlacementParams {
  /** Final radius in points. Default 90. */
  readonly radius?: number;
  /** Default warm white `#FFF3C4`. */
  readonly color?: Color;
  /** Default 220 ms. */
  readonly duration?: number;
  /** Peak opacity, 0 to 1. Default 1. */
  readonly intensity?: number;
}

/** A short radial light flash (additive), for impacts and explosions. */
export const flash: EffectDefinition<FlashParams> = defineEffect<FlashParams>({
  name: 'flash',
  create(params, context) {
    const name = 'flash';
    const placement = new Placement(params, context, name);
    const radius = checkNumber(params.radius ?? 90, 'radius', name, { min: 0 });
    const duration = checkNumber(params.duration ?? 220, 'duration', name, { min: 1 });
    let intensity = checkNumber(params.intensity ?? 1, 'intensity', name, { min: 0, max: 1 });
    const color = params.color ?? '#FFF3C4';
    validateFill(color, `${name} color`);
    if (context.reducedMotion) intensity *= 0.4;
    // Unit-radius gradient scaled by the item matrix, so one cached gradient serves every frame.
    const gradient: RadialGradient = {
      type: 'radial-gradient',
      center: { x: 0, y: 0 },
      radius: 1,
      colors: ['#FFFFFF', color, withAlpha(color, 0)],
      positions: [0, 0.35, 1],
    };
    const shape = { type: 'circle' as const, radius: 1, fill: gradient };
    const easeOut = resolveEasing('easeOutCubic');
    let drawables: readonly Drawable[] = [];
    let done = false;
    return {
      get drawables() {
        return drawables;
      },
      get done() {
        return done;
      },
      update(elapsed) {
        const p = Math.min(1, elapsed / duration);
        if (p >= 1) {
          done = true;
          drawables = [];
          return;
        }
        const m = placement.matrix();
        const r = Math.max(0.01, radius * (0.35 + 0.65 * easeOut(p)));
        const opacity = intensity * (1 - p) * (1 - p) * placement.opacity;
        drawables = [shapeDrawable(elapsed, shape, composeTransform(m[4], m[5], 0, r, r), opacity, { blendMode: 'plus' })];
      },
      setParams(patch) {
        if (patch.intensity !== undefined) intensity = checkNumber(patch.intensity, 'intensity', name, { min: 0, max: 1 });
      },
      dispose() {
        drawables = [];
      },
    };
  },
});

// --- shockwave ------------------------------------------------------------------------------

export interface ShockwaveParams extends PlacementParams {
  /** Final radius in points. Default 140. */
  readonly radius?: number;
  /** Default `#FFE9A8`. */
  readonly color?: Color;
  /** Default 520 ms. */
  readonly duration?: number;
  /** Ring width at the start in points. Default 10. */
  readonly width?: number;
  /** 0 to 1. Default 1. */
  readonly intensity?: number;
  /** Extra rings, each following the previous one. Default 1 (with detail quality). */
  readonly echoes?: number;
}

/**
 * An expanding, thinning, fading shock front: a thin bright leading edge over a wider faint
 * band, with optional echo rings. Drawn as two strokes per ring (no offscreen glow layer).
 */
export const shockwave: EffectDefinition<ShockwaveParams> = defineEffect<ShockwaveParams>({
  name: 'shockwave',
  create(params, context) {
    const name = 'shockwave';
    const placement = new Placement(params, context, name);
    const radius = checkNumber(params.radius ?? 140, 'radius', name, { min: 0 });
    const duration = checkNumber(params.duration ?? 520, 'duration', name, { min: 1 });
    const width = checkNumber(params.width ?? 10, 'width', name, { min: 0 });
    let intensity = checkNumber(params.intensity ?? 1, 'intensity', name, { min: 0, max: 1 });
    const quality = contextQuality(context);
    const echoes = Math.round(checkNumber(params.echoes ?? 1, 'echoes', name, { min: 0, max: 4 }));
    const rings = 1 + (quality.details ? echoes : 0);
    const color = params.color ?? '#FFE9A8';
    validateFill(color, `${name} color`);
    // Fast start, long settle: a pressure front that decelerates.
    const ease = (t: number) => 1 - (1 - t) ** 4;
    const lag = 0.18; // fraction of the duration between rings
    const total = duration * (1 + lag * (rings - 1));
    let drawables: Drawable[] = [];
    let done = false;
    return {
      get drawables() {
        return drawables;
      },
      get done() {
        return done;
      },
      update(elapsed) {
        if (elapsed >= total) {
          done = true;
          drawables = [];
          return;
        }
        const m = placement.matrix();
        const at = composeTransform(m[4], m[5], 0, 1, 1);
        drawables = [];
        for (let k = 0; k < rings; k++) {
          const p = (elapsed - k * lag * duration) / duration;
          if (p <= 0 || p >= 1) continue;
          const r = Math.max(0.5, radius * ease(p) * (1 - k * 0.12));
          const w = Math.max(0.5, width * (1 - p) ** 0.7);
          const fade = intensity * (1 - p) ** 1.6 * (k === 0 ? 1 : 0.45) * placement.opacity;
          // The faint band trails just inside the bright edge.
          const band = { type: 'circle' as const, radius: Math.max(0.5, r - w * 0.9), stroke: { fill: color, width: w * 2.4 } };
          const edge = { type: 'circle' as const, radius: r, stroke: { fill: color, width: Math.max(0.5, w * 0.45) } };
          drawables.push(shapeDrawable(elapsed, band, at, fade * 0.16, { blendMode: 'plus' }));
          drawables.push(shapeDrawable(elapsed, edge, at, fade, { blendMode: 'plus' }));
        }
      },
      setParams(patch) {
        if (patch.intensity !== undefined) intensity = checkNumber(patch.intensity, 'intensity', name, { min: 0, max: 1 });
      },
      dispose() {
        drawables = [];
      },
    };
  },
});

// --- screen shake ---------------------------------------------------------------------------

export interface ScreenShakeParams {
  /**
   * What shakes: `overlay` (everything the engine draws), a host target id or proxy node (the
   * React Native view itself moves through its transform binding), or a list. Default `overlay`.
   */
  readonly scope?: string | SceneNode | readonly (string | SceneNode)[];
  /** Maximum displacement in points. Default 8. */
  readonly amplitude?: number;
  /** Maximum rotation in degrees. Default 0. */
  readonly rotation?: number;
  /** Default 400 ms. */
  readonly duration?: number;
  /** Oscillations per second. Default 28. */
  readonly frequency?: number;
  /** Multiplies the amplitude; `handle.setIntensity` changes it while running. Default 1. */
  readonly intensity?: number;
}

/**
 * Shakes the overlay and/or host views with a decaying, seeded oscillation. It only adds a
 * temporary offset: when it ends (or is cancelled) the offset is removed and every view is
 * exactly where it was; layout is never changed. Under reduced motion it does nothing.
 */
export const screenShake: EffectDefinition<ScreenShakeParams> = defineEffect<ScreenShakeParams>({
  name: 'screen-shake',
  create(params, context) {
    const name = 'screen-shake';
    const amplitude = checkNumber(params.amplitude ?? 8, 'amplitude', name, { min: 0, max: 200 });
    const rotation = checkNumber(params.rotation ?? 0, 'rotation', name, { min: 0, max: 45 });
    const duration = checkNumber(params.duration ?? 400, 'duration', name, { min: 1 });
    const frequency = checkNumber(params.frequency ?? 28, 'frequency', name, { min: 0.1, max: 120 });
    let intensity = checkNumber(params.intensity ?? 1, 'intensity', name, { min: 0, max: 5 });
    const scopes = Array.isArray(params.scope) ? params.scope : [params.scope ?? 'overlay'];
    const offsets: TransformOffset[] = [];
    if (!context.reducedMotion) {
      for (const scope of scopes as readonly (string | SceneNode)[]) {
        if (!context.services) throw new InvalidOptionError(`${name} needs an engine.`);
        if (scope === 'overlay') {
          offsets.push(context.services.addCameraOffset());
          continue;
        }
        const offset = context.services.addTargetOffset(scope);
        if (!offset) {
          for (const o of offsets) o.remove();
          throw new InvalidOptionError(`${name} scope must be "overlay" or a host target (GameFXTarget id or its node).`);
        }
        offsets.push(offset);
      }
    }
    // Two incommensurate sine pairs per axis with seeded phases: irregular but reproducible.
    const r = context.random;
    const phase = [r.next(), r.next(), r.next(), r.next(), r.next()].map((v) => v * Math.PI * 2);
    let done = offsets.length === 0;
    const clear = () => {
      for (const o of offsets.splice(0)) o.remove();
    };
    return {
      drawables: [],
      get done() {
        return done;
      },
      update(elapsed) {
        if (done) return;
        if (elapsed >= duration) {
          clear();
          done = true;
          return;
        }
        const t = elapsed / 1000;
        const decay = (1 - elapsed / duration) ** 2;
        const w = 2 * Math.PI * frequency;
        const a = amplitude * intensity * decay;
        const x = a * (0.7 * Math.sin(w * t + (phase[0] ?? 0)) + 0.3 * Math.sin(w * 1.7 * t + (phase[1] ?? 0)));
        const y = a * (0.7 * Math.sin(w * 1.13 * t + (phase[2] ?? 0)) + 0.3 * Math.sin(w * 2.1 * t + (phase[3] ?? 0)));
        const rot = rotation * intensity * decay * Math.sin(w * 0.9 * t + (phase[4] ?? 0));
        for (const o of offsets) {
          o.x = x;
          o.y = y;
          o.rotation = rot;
        }
      },
      stop() {
        clear();
        done = true;
      },
      setParams(patch) {
        if (patch.intensity !== undefined) intensity = checkNumber(patch.intensity, 'intensity', name, { min: 0, max: 5 });
      },
      dispose() {
        clear();
      },
    };
  },
});
