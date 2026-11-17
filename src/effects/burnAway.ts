import type { ImageAsset } from '../assets/assets';
import { formatColor, parseColor } from '../graphics/color';
import type { Color, ShaderImageChild } from '../graphics/paint';
import { validateFill } from '../graphics/paint';
import { PathData } from '../graphics/path';
import type { Rect } from '../graphics/path';
import { burnCharShader, burnGlowShader, burnPaperShader } from '../graphics/shaderLib';
import { ParticleEmitter } from '../particles/emitter';
import type { EmitterConfig } from '../particles/emitter';
import { contextQuality, defineEffect } from '../runtime/effect';
import type { Drawable, EffectContext, EffectDefinition, EffectInstance, TargetConcealment, TargetSnapshot } from '../runtime/effect';
import { InvalidOptionError } from '../runtime/errors';
import type { QualityProfile } from '../runtime/quality';
import type { Random } from '../runtime/rng';
import { composeTransform, multiply } from '../scene/matrix';
import type { Matrix2D } from '../scene/matrix';
import { SceneNode } from '../scene/node';
import type { TargetRef } from '../scene/targets';
import { firePalette } from './fireBorder';
import { checkNumber, shapeDrawable } from './placement';

/**
 * Where the fire starts. An edge burns as a ragged line that sweeps across; a corner, the
 * centre, a point (`x` and `y` from 0 to 1 across the target) or `random` (a point on the
 * outline) burn as a ragged hole that grows.
 */
export type BurnOrigin =
  | 'bottom'
  | 'top'
  | 'left'
  | 'right'
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'random'
  | { readonly x: number; readonly y: number };

export interface BurnAwayParams {
  /** What burns: a `<GameFXTarget>` id or handle, or a scene node. */
  readonly target: TargetRef;
  /**
   * The picture that burns. Default: a snapshot of the target's view taken by its host (iOS
   * and Android), or the image of a scene node's image shape. Without one (React Native Web,
   * a node without an image) the view chars and crumbles instead (see the docs).
   */
  readonly image?: ImageAsset;
  /** Time the fire takes to cross the target, in ms. Default 1600. */
  readonly duration?: number;
  /** Where the fire starts. Default `bottom`. */
  readonly from?: BurnOrigin;
  /** How ragged the burning edge is, 0 (straight) to 1. Default 0.6. */
  readonly roughness?: number;
  /** Color of the glowing edge and the flames. Default `#FF7A1A`. */
  readonly color?: Color;
  /** Color of the charred band ahead of the edge. Default `#2B1A0D`. */
  readonly charColor?: Color;
  /** Width of the charred band ahead of the edge, in points. Default 14. */
  readonly charWidth?: number;
  /** Width of the glowing edge, in points. Default 3. */
  readonly edgeWidth?: number;
  /** Brightness of the edge and how many particles fly, 0 to 2. Default 1. */
  readonly intensity?: number;
  /** Small flames along the edge. Default true. */
  readonly flames?: boolean;
  /** Embers that rise from the edge. Default true. */
  readonly embers?: boolean;
  /** Smoke (not on the `low` profile). Default true. */
  readonly smoke?: boolean;
  /** Black ash flakes that drift away (not on the `low` profile). Default true. */
  readonly ash?: boolean;
  /** Corner radius of the glow's and the charring's outline. Default 10. */
  readonly cornerRadius?: number;
}

// --- Edge geometry (pure, mirrors the burnField shader chunk) ---------------------------------

const TAU = Math.PI * 2;
const WAVES: readonly (readonly [number, number, number, number, number, number])[] = [
  // weight, angle·seed, angle offset, wavelength, phase·seed, phase offset
  [0.4, 0.61, 0, 64, 2.3, 0],
  [0.26, 0.98, 1.7, 37, 3.2, 0.5],
  [0.16, 1.35, 3.4, 21, 4.1, 1.0],
  [0.11, 1.72, 5.1, 12.5, 5.0, 1.5],
  [0.07, 2.09, 6.8, 7.5, 5.9, 2.0],
];

/** Raggedness of the burning edge at a point, about -0.5 to 0.5 (same as the shader). */
export function burnNoise(x: number, y: number, seed: number): number {
  let n = 0;
  for (const [w, as, ao, wavelength, ps, po] of WAVES) {
    const a = seed * as + ao;
    n += w * Math.sin((x * Math.cos(a) + y * Math.sin(a)) * (TAU / wavelength) + seed * ps + po);
  }
  return 0.5 * n;
}

/** How the edge travels across a target of `width` × `height` points. */
export interface BurnGeometry {
  readonly width: number;
  readonly height: number;
  /** True: a circle growing from `origin`. False: a line moving along `dir` from `origin`. */
  readonly radial: boolean;
  /** In target coordinates: points from its top-left corner. */
  readonly origin: { readonly x: number; readonly y: number };
  readonly dir: { readonly x: number; readonly y: number };
  /** Distance from the origin to the farthest point of the target. */
  readonly extent: number;
  /** Raggedness in points. */
  readonly amp: number;
  readonly seed: number;
}

/** Resolves `from` to the edge's geometry. `random` picks a point on the outline from `random`. */
export function burnGeometry(width: number, height: number, from: BurnOrigin, roughness: number, seed: number, random?: Random): BurnGeometry {
  const amp = roughness * Math.min(26, Math.max(6, Math.min(width, height) * 0.22));
  const line = (ox: number, oy: number, dx: number, dy: number, extent: number): BurnGeometry => ({
    width,
    height,
    radial: false,
    origin: { x: ox, y: oy },
    dir: { x: dx, y: dy },
    extent,
    amp,
    seed,
  });
  const point = (ox: number, oy: number): BurnGeometry => ({
    width,
    height,
    radial: true,
    origin: { x: ox, y: oy },
    dir: { x: 0, y: -1 },
    extent: Math.max(Math.hypot(ox, oy), Math.hypot(width - ox, oy), Math.hypot(ox, height - oy), Math.hypot(width - ox, height - oy)),
    amp,
    seed,
  });
  if (typeof from === 'object') return point(from.x * width, from.y * height);
  switch (from) {
    case 'bottom':
      return line(0, height, 0, -1, height);
    case 'top':
      return line(0, 0, 0, 1, height);
    case 'left':
      return line(0, 0, 1, 0, width);
    case 'right':
      return line(width, 0, -1, 0, width);
    case 'center':
      return point(width / 2, height / 2);
    case 'top-left':
      return point(0, 0);
    case 'top-right':
      return point(width, 0);
    case 'bottom-left':
      return point(0, height);
    case 'bottom-right':
      return point(width, height);
    case 'random': {
      // A point on the outline, chosen along its length.
      const t = (random?.next() ?? 0.5) * 2 * (width + height);
      if (t < width) return point(t, 0);
      if (t < width + height) return point(width, t - width);
      if (t < 2 * width + height) return point(2 * width + height - t, height);
      return point(0, 2 * (width + height) - t);
    }
  }
}

/** Distance of a point from where the fire started, along the burn (same as the shader). */
export function burnField(g: BurnGeometry, x: number, y: number): number {
  const d = g.radial ? Math.hypot(x - g.origin.x, y - g.origin.y) : (x - g.origin.x) * g.dir.x + (y - g.origin.y) * g.dir.y;
  return d + g.amp * burnNoise(x, y, g.seed);
}

/** Edge travel before anything shows and after everything burned, in points. */
export function burnRange(g: BurnGeometry, charWidth: number): { readonly start: number; readonly end: number } {
  return { start: -(g.amp * 0.5 + charWidth + 1), end: g.extent + g.amp * 0.5 + 2.5 };
}

/** Edge position after `t` (0 to 1) of the burn: slow to catch, then faster. */
export function burnProgress(t: number, start: number, end: number): number {
  const k = Math.min(1, Math.max(0, t));
  return start + (end - start) * (0.25 * k + 0.75 * k * k);
}

/**
 * Distance along a ray where the edge crosses it: the first point, walking away from where the
 * fire started, where the field reaches `progress`. Null when the ray never reaches it within
 * `maxT`. Marches in one-point steps (the edge can fold back on itself), then bisects.
 */
function crossing(g: BurnGeometry, progress: number, ox: number, oy: number, dx: number, dy: number, minT: number, maxT: number): number | null {
  const f = (t: number) => burnField(g, ox + dx * t, oy + dy * t) - progress;
  let a = minT;
  if (f(a) >= 0) return null;
  for (let b = a + 1; b <= maxT + 1; b += 1) {
    if (f(b) >= 0) {
      let lo = a;
      let hi = b;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) >= 0) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    }
    a = b;
  }
  return null;
}

/**
 * The burning edge inside the target at `progress`: polylines in target coordinates (a new
 * one wherever the edge leaves the target), on the same field the shader uses.
 */
export function burnFront(g: BurnGeometry, progress: number, samples = 24): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] | null = null;
  const inside = (x: number, y: number) => x >= -0.01 && x <= g.width + 0.01 && y >= -0.01 && y <= g.height + 0.01;
  const push = (x: number, y: number) => (run ??= []).push({ x: Math.min(g.width, Math.max(0, x)), y: Math.min(g.height, Math.max(0, y)) });
  const end = () => {
    if (run && run.length > 0) runs.push(run);
    run = null;
  };
  const reach = Math.abs(g.amp) * 0.5 + 1;
  if (g.radial) {
    for (let i = 0; i <= samples * 2; i++) {
      const a = (i / (samples * 2)) * TAU;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const r = crossing(g, progress, g.origin.x, g.origin.y, ux, uy, 0, Math.max(0, progress + reach));
      const x = g.origin.x + ux * (r ?? 0);
      const y = g.origin.y + uy * (r ?? 0);
      if (r !== null && inside(x, y)) push(x, y);
      else end();
    }
  } else {
    // Rays along the travel direction, from points across the whole target.
    const px = -g.dir.y;
    const py = g.dir.x;
    const span = Math.abs(px) * g.width + Math.abs(py) * g.height;
    const bx0 = px < 0 ? g.width : px > 0 ? 0 : g.origin.x;
    const by0 = py < 0 ? g.height : py > 0 ? 0 : g.origin.y;
    for (let i = 0; i <= samples; i++) {
      const u = (i / samples) * span;
      const bx = bx0 + px * u;
      const by = by0 + py * u;
      const v = crossing(g, progress, bx, by, g.dir.x, g.dir.y, progress - reach, progress + reach);
      const x = bx + g.dir.x * (v ?? 0);
      const y = by + g.dir.y * (v ?? 0);
      if (v !== null && inside(x, y)) push(x, y);
      else end();
    }
  }
  end();
  return runs;
}

// --- Effect -----------------------------------------------------------------------------------

const NAME = 'burn-away';
/** After the last of the target burned, the embers on its edge die out over this long. */
const AFTERGLOW_MS = 450;
/** Frames drawn over the still visible view before it is concealed: an overlap never flickers. */
const OVERLAP_FRAMES = 2;
/** A host that has not delivered a snapshot by then gets the charring fallback. */
const SNAPSHOT_TIMEOUT_MS = 800;
/** Fallback: the charred view fades out over the last part of the burn. */
const FALLBACK_FADE_FROM = 0.6;

const ORIGINS = ['bottom', 'top', 'left', 'right', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'random'];

type Mode = 'waiting' | 'image' | 'char';
type RGB = readonly [number, number, number];

const rgb = (c: Color): RGB => {
  const m = parseColor(c);
  return [m.r, m.g, m.b];
};

interface Resolved {
  readonly duration: number;
  readonly from: BurnOrigin;
  readonly roughness: number;
  readonly color: Color;
  readonly charColor: Color;
  readonly charWidth: number;
  readonly edgeWidth: number;
  readonly intensity: number;
  readonly flames: boolean;
  readonly embers: boolean;
  readonly smoke: boolean;
  readonly ash: boolean;
  readonly cornerRadius: number;
}

function resolve(p: BurnAwayParams): Resolved {
  const duration = checkNumber(p.duration ?? 1600, 'duration', NAME, { min: 50, max: 60000 });
  const roughness = checkNumber(p.roughness ?? 0.6, 'roughness', NAME, { min: 0, max: 1 });
  const charWidth = checkNumber(p.charWidth ?? 14, 'charWidth', NAME, { min: 1, max: 200 });
  const edgeWidth = checkNumber(p.edgeWidth ?? 3, 'edgeWidth', NAME, { min: 0.5, max: 40 });
  const intensity = checkNumber(p.intensity ?? 1, 'intensity', NAME, { min: 0, max: 2 });
  const cornerRadius = checkNumber(p.cornerRadius ?? 10, 'cornerRadius', NAME, { min: 0 });
  const from = p.from ?? 'bottom';
  if (typeof from === 'object') {
    if ((from as unknown) === null || !Number.isFinite(from.x) || !Number.isFinite(from.y) || from.x < 0 || from.x > 1 || from.y < 0 || from.y > 1) {
      throw new InvalidOptionError(`${NAME} from point needs x and y from 0 to 1.`);
    }
  } else if (!ORIGINS.includes(from)) {
    throw new InvalidOptionError(`${NAME} from must be one of ${ORIGINS.join(', ')} or { x, y }.`);
  }
  const color = p.color ?? '#FF7A1A';
  const charColor = p.charColor ?? '#2B1A0D';
  validateFill(color, `${NAME} color`);
  validateFill(charColor, `${NAME} charColor`);
  const flags = { flames: p.flames ?? true, embers: p.embers ?? true, smoke: p.smoke ?? true, ash: p.ash ?? true };
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value !== 'boolean') throw new InvalidOptionError(`${NAME} ${key} must be a boolean.`);
  }
  return { duration, from, roughness, color, charColor, charWidth, edgeWidth, intensity, cornerRadius, ...flags };
}

interface Emitters {
  smoke: ParticleEmitter | null;
  flames: ParticleEmitter | null;
  embers: ParticleEmitter | null;
  ash: ParticleEmitter | null;
}

/** Particles per second for every 100 points of burning edge, at intensity 1. */
const RATES = { flames: 240, embers: 40, smoke: 14, ash: 16 } as const;

/**
 * A target that burns away: a ragged edge sweeps across it from `from`, browning and charring
 * the picture ahead of it, glowing, and leaving nothing behind; small flames, embers, smoke and
 * ash flakes rise from the edge. At the end the target stays hidden (a host view through its
 * motion, `motion.opacity = 0`; a scene node with `visible = false`). Cancelling (or `stop`)
 * at any time shows the target again, unchanged.
 *
 * How: for a `<GameFXTarget>`, the host takes a picture of the view, the effect draws that
 * picture where the view is (moving, rotating and scaling with it) and hides the real view two
 * frames later, so nothing flickers. A scene node's image shape is burned directly. Without a
 * picture the effect chars the view instead and fades it out (see `BurnAwayParams.image`).
 */
export class BurnAwayInstance implements EffectInstance {
  private readonly node: SceneNode;
  private readonly settings: Resolved;
  private readonly quality: QualityProfile;
  private readonly shaders: boolean;
  private readonly detail: number;
  private readonly random: Random;
  private readonly seed: number;
  private readonly reduced: boolean;
  private readonly context: EffectContext;
  private readonly palette: ReturnType<typeof firePalette>;
  private readonly rimRgb: RGB;
  private readonly charRgb: RGB;
  private mode: Mode;
  private image: ImageAsset | null = null;
  private source: Rect | undefined;
  private snapshot: TargetSnapshot | null = null;
  private retained: ImageAsset | null = null;
  private child: { readonly key: string; readonly value: ShaderImageChild } | null = null;
  private concealment: TargetConcealment | null = null;
  private emitters: Emitters = { smoke: null, flames: null, embers: null, ash: null };
  private geometry: BurnGeometry | null = null;
  private burnStart = -1;
  private framesDrawn = 0;
  private opacity = 1;
  private vanished = false;
  private disposed = false;
  private finished = false;
  private list: Drawable[] = [];

  constructor(params: BurnAwayParams, context: EffectContext) {
    if (!(params.target instanceof SceneNode)) throw new InvalidOptionError(`${NAME} needs a target (scene node or GameFXTarget id).`);
    if (params.target.destroyed) throw new InvalidOptionError(`${NAME} target has been destroyed.`);
    if (params.image !== undefined && (typeof params.image !== 'object' || (params.image as { kind?: unknown } | null)?.kind !== 'image')) {
      throw new InvalidOptionError(`${NAME} image must be an image asset.`);
    }
    this.node = params.target;
    this.settings = resolve(params);
    this.context = context;
    this.quality = contextQuality(context);
    this.shaders = this.quality.shaders && (context.services?.capabilities?.runtimeShaders ?? true);
    this.detail = this.quality.shaderDetail === 'lite' ? 0 : 1;
    this.reduced = context.reducedMotion ?? false;
    this.random = context.random;
    this.seed = context.random.next() * 10;
    this.palette = firePalette(this.settings.color);
    this.rimRgb = rgb(this.settings.color);
    this.charRgb = rgb(this.settings.charColor);

    const shape = this.node.shape;
    const given = params.image ?? (shape?.type === 'image' ? shape.image : undefined);
    if (given && !given.disposed) {
      given.retain();
      this.retained = given;
      this.image = given;
      if (!params.image && shape?.type === 'image' && shape.source) this.source = shape.source;
      this.mode = 'image';
      return;
    }
    const pending = context.services?.snapshotTarget?.(this.node) ?? null;
    if (!pending) {
      this.mode = 'char';
      return;
    }
    this.mode = 'waiting';
    pending.then(
      (snapshot) => {
        if (this.disposed || this.mode !== 'waiting') {
          snapshot.release();
          return;
        }
        this.snapshot = snapshot;
        this.image = snapshot.image;
        this.mode = 'image';
      },
      () => {
        if (!this.disposed && this.mode === 'waiting') this.mode = 'char';
      },
    );
  }

  /** `waiting` for the host's snapshot, `image` (burning a picture) or `char` (the fallback). */
  get kind(): Mode {
    return this.mode;
  }

  get drawables(): readonly Drawable[] {
    return this.list;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The edge's geometry once burning (for tests and tools). */
  get edge(): BurnGeometry | null {
    return this.geometry;
  }

  update(elapsedMs: number): void {
    if (this.finished || this.disposed) return;
    this.list = [];
    if (this.mode === 'waiting') {
      if (elapsedMs < SNAPSHOT_TIMEOUT_MS && !this.node.destroyed) return;
      this.mode = 'char';
    }
    if (this.burnStart < 0) {
      this.burnStart = elapsedMs;
      this.opacity = this.node.destroyed ? 0 : this.node.worldOpacity;
      if (this.mode === 'char') this.concealment = this.context.services?.concealTarget?.(this.node, 1) ?? null;
    }
    const s = this.settings;
    const t = elapsedMs - this.burnStart;
    const alive = !this.node.destroyed && this.node.inScene;
    const bounds = alive ? this.node.getLocalBounds() : null;
    const m = alive ? this.node.worldMatrix : null;
    if (!bounds || !m || bounds.width <= 0 || bounds.height <= 0) {
      // Nothing to burn (gone or not measured yet): end without hiding anything.
      this.stopEmitters();
      this.updateEmitters(elapsedMs);
      if (this.emittersDone()) this.finish();
      return;
    }
    const w = bounds.width;
    const h = bounds.height;
    if (this.geometry?.width !== w || this.geometry.height !== h) {
      const random = this.geometry ? undefined : this.random;
      this.geometry = burnGeometry(w, h, this.geometry ? this.originOf(this.geometry) : s.from, s.roughness, this.seed, random);
    }
    const g = this.geometry;
    const range = burnRange(g, s.charWidth);
    const k = t / s.duration;
    const progress = k <= 1 ? burnProgress(k, range.start, range.end) : range.end + (range.end - range.start) * 1.75 * (k - 1);
    const burned = t >= s.duration;

    // Hide the real view once the picture has been on screen for a couple of frames.
    if (this.mode === 'image' && !this.concealment && !burned && this.framesDrawn >= OVERLAP_FRAMES) {
      this.concealment = this.context.services?.concealTarget?.(this.node, 0) ?? null;
    }
    if (this.mode === 'char' && this.concealment && !burned) {
      const fade = Math.min(1, Math.max(0, (k - FALLBACK_FADE_FROM) / (1 - FALLBACK_FADE_FROM)));
      this.concealment.opacity = 1 - fade * fade;
    }
    if (burned && !this.vanished) {
      this.vanished = true;
      if (this.concealment) this.concealment.vanish();
      else this.context.services?.concealTarget?.(this.node, 0)?.vanish();
    }

    // The target's centre, with its rotation and scale (shader passes draw in target points).
    const frame: Matrix2D = multiply(m, [1, 0, 0, 1, bounds.x + w / 2, bounds.y + h / 2]);
    const margin = Math.ceil(s.edgeWidth * 4 + 6);
    const uniforms = {
      box: [w, h],
      margin,
      progress,
      origin: [g.origin.x, g.origin.y],
      dir: [g.dir.x, g.dir.y],
      radial: g.radial ? 1 : 0,
      amp: g.amp,
      seed: this.seed,
      detail: this.detail,
    };
    const rect = { type: 'rect' as const, width: w + margin * 2, height: h + margin * 2 };
    const opacity = this.opacity;
    if (this.shaders && !burned && this.mode === 'image' && this.image && !this.image.disposed) {
      this.list.push(
        shapeDrawable(
          elapsedMs,
          {
            ...rect,
            fill: {
              type: 'shader',
              shader: burnPaperShader,
              uniforms: { ...uniforms, charWidth: s.charWidth, rimWidth: s.edgeWidth, charColor: this.charRgb, rimColor: this.rimRgb },
              children: { image: this.childFor(this.image, w, h, margin) },
            },
          },
          frame,
          opacity,
        ),
      );
      this.framesDrawn++;
    } else if (this.shaders && !burned && this.mode === 'char') {
      this.list.push(
        shapeDrawable(
          elapsedMs,
          {
            ...rect,
            fill: {
              type: 'shader',
              shader: burnCharShader,
              uniforms: { ...uniforms, charWidth: s.charWidth, cornerRadius: s.cornerRadius, charColor: this.charRgb },
            },
          },
          frame,
          opacity * (this.concealment?.opacity ?? 1),
          // Over the still visible view: drawn inside it when its host has a local layer.
          { anchor: this.node },
        ),
      );
    } else if (!this.shaders && !burned && this.mode === 'image' && this.image && !this.image.disposed) {
      // No runtime shaders: the picture fades while the particles burn along the edge.
      this.list.push(
        shapeDrawable(
          elapsedMs,
          { type: 'image', image: this.image, width: w, height: h, ...(this.source ? { source: this.source } : {}) },
          frame,
          opacity * (1 - Math.min(1, Math.max(0, k))),
        ),
      );
      this.framesDrawn++;
    }
    const glowFade = burned ? Math.max(0, 1 - (t - s.duration) / AFTERGLOW_MS) : 1;
    if (this.shaders && glowFade > 0 && s.intensity > 0) {
      const p = this.palette;
      this.list.push(
        shapeDrawable(
          elapsedMs,
          {
            ...rect,
            fill: {
              type: 'shader',
              shader: burnGlowShader,
              uniforms: {
                ...uniforms,
                rimWidth: s.edgeWidth,
                cornerRadius: s.cornerRadius,
                rimColor: this.rimRgb,
                coreColor: p.core,
                intensity: s.intensity,
                fade: glowFade,
              },
            },
          },
          frame,
          opacity,
          { blendMode: 'plus' },
        ),
      );
    }

    // Particles along the edge.
    if (burned) this.stopEmitters();
    else this.feedEmitters(g, progress, m, frame, w, h);
    this.updateEmitters(elapsedMs);
    for (const e of this.allEmitters()) {
      if (e.aliveCount > 0) this.list.push(e);
    }
    if (burned && glowFade === 0 && this.emittersDone()) this.finish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Cancelled before the end: the target shows again as it was.
    if (this.concealment?.active) this.concealment.reveal();
    this.concealment = null;
    for (const e of this.allEmitters()) e.dispose();
    this.emitters = { smoke: null, flames: null, embers: null, ash: null };
    this.snapshot?.release();
    this.snapshot = null;
    this.retained?.release();
    this.retained = null;
    this.image = null;
    this.child = null;
    this.list = [];
  }

  private finish(): void {
    this.finished = true;
    this.list = [];
  }

  private originOf(g: BurnGeometry): BurnOrigin {
    // A resized target keeps where the fire started, relative to its size.
    return g.radial ? { x: g.width > 0 ? g.origin.x / g.width : 0.5, y: g.height > 0 ? g.origin.y / g.height : 0.5 } : this.settings.from === 'random' ? 'bottom' : this.settings.from;
  }

  private childFor(image: ImageAsset, w: number, h: number, margin: number): ShaderImageChild {
    const key = `${image.id}:${String(w)}x${String(h)}+${String(margin)}`;
    if (this.child?.key !== key) {
      this.child = {
        key,
        value: { type: 'image', image, rect: { x: margin, y: margin, width: w, height: h }, ...(this.source ? { source: this.source } : {}) },
      };
    }
    return this.child.value;
  }

  private feedEmitters(g: BurnGeometry, progress: number, m: Matrix2D, centre: Matrix2D, w: number, h: number): void {
    const s = this.settings;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    const rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const runs = burnFront(g, progress);
    // Emitter frame: the target's centre and rotation, no scale (sizes stay in points).
    const frame = composeTransform(centre[4], centre[5], rotation, 1, 1);
    const path = new PathData();
    let length = 0;
    for (const run of runs) {
      const pts = run.map((pt) => ({ x: (pt.x - w / 2) * sx, y: (pt.y - h / 2) * sy }));
      const first = pts[0];
      if (!first) continue;
      path.moveTo(first.x, first.y);
      if (pts.length === 1) path.lineTo(first.x + 0.5, first.y);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (!a || !b) continue;
        path.lineTo(b.x, b.y);
        length += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    this.ensureEmitters(Math.min(w * sx, h * sy));
    const theta = (rotation * Math.PI) / 180;
    // Screen-up in the rotated emitter frame.
    const up = (Math.atan2(-Math.cos(theta), -Math.sin(theta)) * 180) / Math.PI;
    const scale = this.quality.particleScale * s.intensity;
    for (const [name, e] of Object.entries(this.emitters) as [keyof Emitters, ParticleEmitter | null][]) {
      if (!e) continue;
      e.setTransform(frame);
      if (path.isEmpty) {
        e.setRate(0);
        continue;
      }
      e.configure({ shape: { type: 'path', path }, direction: up });
      e.setRate((RATES[name] * Math.max(length, 4) * scale) / 100);
    }
  }

  private ensureEmitters(size: number): void {
    const s = this.settings;
    const details = this.quality.details && !this.reduced;
    const want = {
      smoke: s.smoke && details,
      flames: s.flames,
      embers: s.embers,
      ash: s.ash && details,
    };
    const base = Math.min(10, Math.max(2.5, size * 0.055));
    const p = this.palette;
    const hex = (c: RGB, a = 1) => formatColor({ r: c[0], g: c[1], b: c[2], a });
    const configs: Record<keyof Emitters, () => EmitterConfig> = {
      smoke: () => ({
        space: 'world',
        rate: 0,
        // Emits until stopped; the rate follows the edge's length every frame.
        duration: Infinity,
        maxParticles: 80,
        directionMode: 'fixed',
        spread: 40,
        speed: { min: 10, max: 30 },
        gravity: { x: 0, y: -24 },
        drag: 0.6,
        lifetime: { min: 1000, max: 1800 },
        size: { min: base * 1.1, max: base * 2.1 },
        scale: { from: 0.8, to: 2.6 },
        opacity: [0, 0.32, 0.18, 0],
        look: 'soft',
        colorOverLife: ['#5A534D', '#6B645E', '#7A736C'],
      }),
      flames: () => ({
        space: 'world',
        rate: 0,
        // Emits until stopped; the rate follows the edge's length every frame.
        duration: Infinity,
        maxParticles: 600,
        directionMode: 'fixed',
        spread: 50,
        speed: { min: base * 4, max: base * 9 },
        gravity: { x: 0, y: -base * 36 },
        drag: 1.2,
        // Short-lived: the edge moves on quickly and flames only live where there is paper.
        lifetime: { min: 160, max: 340 },
        size: { min: base * 0.5, max: base * 0.9 },
        scale: { from: 1, to: 0.2, easing: 'easeInQuad' },
        opacity: [0, 1, 0.7, 0],
        look: 'soft',
        blendMode: 'plus',
        colorOverLife: [hex(p.core), hex(p.hot), hex(p.mid), hex(p.tip), hex(p.tip, 0)],
      }),
      embers: () => ({
        space: 'world',
        rate: 0,
        // Emits until stopped; the rate follows the edge's length every frame.
        duration: Infinity,
        maxParticles: 240,
        directionMode: 'fixed',
        spread: 110,
        speed: { min: 20, max: 75 },
        gravity: { x: 0, y: -60 },
        drag: 1,
        lifetime: { min: 500, max: 1200 },
        size: { min: 0.8, max: 1.8 },
        look: 'spark',
        stretch: 0.05,
        glow: this.quality.glow ? 0.6 : 0,
        blendMode: 'plus',
        opacity: [1, 1, 0.8, 0],
        colorOverLife: ['#FFF4D6', hex(p.hot), hex(p.mid), hex(p.tip, 0)],
      }),
      ash: () => ({
        space: 'world',
        rate: 0,
        // Emits until stopped; the rate follows the edge's length every frame.
        duration: Infinity,
        maxParticles: 200,
        directionMode: 'fixed',
        spread: 120,
        speed: { min: 8, max: 34 },
        gravity: { x: 0, y: -14 },
        drag: 0.8,
        lifetime: { min: 900, max: 1700 },
        size: { min: 0.8, max: 2.2 },
        rotation: { min: 0, max: 360 },
        angularVelocity: { min: -320, max: 320 },
        look: 'square',
        aspect: 1.6,
        opacity: [0.95, 0.85, 0.6, 0],
        colors: ['#141110', '#231E1A', '#36302A', '#4A3F36'],
      }),
    };
    for (const name of Object.keys(configs) as (keyof Emitters)[]) {
      if (want[name] && !this.emitters[name]) {
        this.emitters[name] = new ParticleEmitter(configs[name](), this.random, { qualityScale: this.quality.particleScale });
      }
    }
  }

  private allEmitters(): ParticleEmitter[] {
    const { smoke, flames, embers, ash } = this.emitters;
    return [smoke, flames, embers, ash].filter((e): e is ParticleEmitter => e !== null);
  }

  private stopEmitters(): void {
    for (const e of this.allEmitters()) e.stop();
  }

  private updateEmitters(elapsedMs: number): void {
    for (const e of this.allEmitters()) e.update(elapsedMs);
  }

  private emittersDone(): boolean {
    return this.allEmitters().every((e) => e.done);
  }
}

/** A target (a host view or a scene node) that burns away and stays hidden. */
export const burnAway: EffectDefinition<BurnAwayParams> = defineEffect<BurnAwayParams>({
  name: NAME,
  create: (params, context) => new BurnAwayInstance(params, context),
});
