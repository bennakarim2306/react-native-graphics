import {
  BlendMode as SkBlendMode,
  BlurStyle,
  ColorChannel,
  ClipOp,
  FilterMode,
  MipmapMode,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
  TileMode,
} from '@shopify/react-native-skia';
import type {
  SkCanvas,
  SkColor,
  SkImage,
  SkImageFilter,
  SkMaskFilter,
  SkRSXform,
  SkPaint,
  SkPath,
  SkPicture,
  SkRect,
  SkRuntimeEffect,
  SkShader,
  Skia as SkiaApi,
} from '@shopify/react-native-skia';
import type { NodeEffect } from '../../graphics/effects';
import type { BlendMode, Fill, Stroke } from '../../graphics/paint';
import type { PathData } from '../../graphics/path';
import { shaderUniformValues } from '../../graphics/shader';
import { displacementShader } from '../../graphics/shaderLib';
import type { ShaderDefinition } from '../../graphics/shader';
import { isParticleDrawable } from '../../particles/burst';
import type { ParticleDrawable } from '../../particles/burst';
import type { Drawable } from '../../runtime/effect';
import { invert } from '../../scene/matrix';
import type { Matrix2D } from '../../scene/matrix';
import { isSceneDrawable } from '../../scene/scene';
import type { SceneDrawable, SceneDrawItem, SceneGroupCommand } from '../../scene/scene';
import { imageSize, shapeBounds } from '../../scene/shape';
import type { NodeShape } from '../../scene/shape';

/** The part of the Skia API the renderer uses. Injected so it can run against CanvasKit in tests. */
export type SkiaFactory = Pick<
  typeof SkiaApi,
  | 'Paint'
  | 'Color'
  | 'PictureRecorder'
  | 'XYWHRect'
  | 'RRectXY'
  | 'Point'
  | 'Matrix'
  | 'Path'
  | 'Shader'
  | 'ImageFilter'
  | 'ColorFilter'
  | 'RuntimeEffect'
  | 'RSXform'
  | 'MaskFilter'
>;

export interface RendererCapabilities {
  /** Drawable kinds this renderer can draw. Others are skipped and reported once. */
  readonly kinds: readonly string[];
  /** Shape types inside scene drawables. */
  readonly shapes: readonly NodeShape['type'][];
  /** Runtime (SkSL) shaders. When false, shader fills draw their fallback color. */
  readonly runtimeShaders: boolean;
  /** Node effects (`glow`, `blur`, `drop-shadow`, `color-matrix`). */
  readonly nodeEffects: readonly NodeEffect['type'][];
  readonly blendModes: readonly BlendMode[];
  readonly gradients: boolean;
  readonly clipping: boolean;
}

export interface DrawStats {
  readonly drawnPrimitives: number;
  readonly skippedDrawables: number;
}

/** Something the renderer could not draw as asked, reported once per cause. */
export interface RendererWarning {
  readonly kind: 'unsupported-drawable' | 'shader-compile-failed' | 'image-unavailable';
  readonly detail: string;
}

const BLEND: Readonly<Record<BlendMode, SkBlendMode>> = {
  normal: SkBlendMode.SrcOver,
  multiply: SkBlendMode.Multiply,
  screen: SkBlendMode.Screen,
  overlay: SkBlendMode.Overlay,
  darken: SkBlendMode.Darken,
  lighten: SkBlendMode.Lighten,
  'color-dodge': SkBlendMode.ColorDodge,
  'color-burn': SkBlendMode.ColorBurn,
  'hard-light': SkBlendMode.HardLight,
  'soft-light': SkBlendMode.SoftLight,
  difference: SkBlendMode.Difference,
  exclusion: SkBlendMode.Exclusion,
  plus: SkBlendMode.Plus,
  'src-in': SkBlendMode.SrcIn,
  'dst-in': SkBlendMode.DstIn,
  'dst-out': SkBlendMode.DstOut,
};

const CAP: Readonly<Record<NonNullable<Stroke['cap']>, StrokeCap>> = {
  butt: StrokeCap.Butt,
  round: StrokeCap.Round,
  square: StrokeCap.Square,
};

const JOIN: Readonly<Record<NonNullable<Stroke['join']>, StrokeJoin>> = {
  miter: StrokeJoin.Miter,
  round: StrokeJoin.Round,
  bevel: StrokeJoin.Bevel,
};

/** Skia blur sigma for a visual radius in points. */
const sigma = (radius: number): number => radius / 2;

/** Row-major 3x3 matrix for `canvas.concat`. */
function toSkiaMatrix(m: Matrix2D): number[] {
  const [a, b, c, d, e, f] = m;
  return [a, c, e, b, d, f, 0, 0, 1];
}

interface CachedPath {
  version: number;
  path: SkPath | null;
}

/** Whole-overlay offset applied when recording (from `FrameEvent.camera`). */
export interface CameraTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly pivotX?: number;
  readonly pivotY?: number;
}

/**
 * Draws engine drawables with React Native Skia. It is the only place that knows Skia types:
 * the engine describes shapes, paints, clips, layers and effects in its own terms, and this
 * adapter maps them to Skia objects, caching what it can (colors, compiled shaders, converted
 * paths, gradients). Call `dispose` to release its paint.
 */
export class SkiaEffectsRenderer {
  readonly capabilities: RendererCapabilities;
  private readonly paint: SkPaint;
  private readonly layerPaint: SkPaint;
  private readonly colorCache = new Map<string, SkColor>();
  /** Compiled runtime effects by SkSL source: equal sources compile once. */
  private readonly effectCache = new Map<string, SkRuntimeEffect | null>();
  private compiles = 0;
  private readonly gradientCache = new WeakMap<object, SkShader>();
  private readonly pathCache = new WeakMap<PathData, CachedPath>();
  private readonly reported = new Set<string>();
  private readonly particleColor = new Float32Array(4);
  private softMaskFilter: SkMaskFilter | null = null;
  private disposed = false;

  constructor(
    private readonly skia: SkiaFactory,
    private readonly onWarning: (warning: RendererWarning) => void = () => undefined,
  ) {
    this.paint = skia.Paint();
    this.paint.setAntiAlias(true);
    this.layerPaint = skia.Paint();
    this.capabilities = {
      kinds: ['scene', 'particles'],
      shapes: ['rect', 'circle', 'ellipse', 'path', 'image'],
      runtimeShaders: typeof (skia.RuntimeEffect as { Make?: unknown } | undefined)?.Make === 'function',
      nodeEffects: ['glow', 'blur', 'drop-shadow', 'color-matrix', 'distort'],
      blendModes: Object.keys(BLEND) as BlendMode[],
      gradients: true,
      clipping: true,
    };
  }

  /** Draws all drawables onto `canvas`, in order. */
  draw(canvas: SkCanvas, drawables: readonly Drawable[]): DrawStats {
    let drawnPrimitives = 0;
    let skippedDrawables = 0;
    if (this.disposed) return { drawnPrimitives, skippedDrawables: drawables.length };
    for (const drawable of drawables) {
      if (isParticleDrawable(drawable)) {
        drawnPrimitives += this.drawParticles(canvas, drawable);
      } else if (isSceneDrawable(drawable)) {
        drawnPrimitives += this.drawScene(canvas, drawable);
      } else {
        skippedDrawables++;
        this.warn('unsupported-drawable', drawable.kind);
      }
    }
    return { drawnPrimitives, skippedDrawables };
  }

  /**
   * Records the drawables into a picture that a `<Picture>` element can display. `camera`
   * offsets everything (screen shake): a translation plus a rotation in degrees around
   * `pivotX`/`pivotY` (usually the overlay centre).
   */
  record(drawables: readonly Drawable[], bounds?: SkRect, camera?: CameraTransform): SkPicture {
    const recorder = this.skia.PictureRecorder();
    const canvas = recorder.beginRecording(bounds);
    const moved = camera !== undefined && (camera.x !== 0 || camera.y !== 0 || camera.rotation !== 0);
    if (moved) {
      canvas.save();
      canvas.translate(camera.x, camera.y);
      if (camera.rotation !== 0) canvas.rotate(camera.rotation, camera.pivotX ?? 0, camera.pivotY ?? 0);
    }
    this.draw(canvas, drawables);
    if (moved) canvas.restore();
    return recorder.finishRecordingAsPicture();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.colorCache.clear();
    this.effectCache.clear();
    this.paint.dispose();
    this.layerPaint.dispose();
  }

  // --- Particles --------------------------------------------------------------------------

  private drawParticles(canvas: SkCanvas, particles: ParticleDrawable): number {
    if (particles.aliveCount === 0) return 0;
    const look = particles.look ?? 'circle';
    if (look === 'image') return this.drawImageParticles(canvas, particles);
    let drawn = 0;
    this.resetPaint();
    const p = this.paint;
    p.setBlendMode(BLEND[particles.blendMode ?? 'normal']);
    const restore = particles.matrix ? canvas.save() : -1;
    if (particles.matrix) canvas.concat(toSkiaMatrix(particles.matrix));
    if (look === 'spark' || look === 'ring') {
      p.setStyle(PaintStyle.Stroke);
      p.setStrokeCap(StrokeCap.Round);
    }
    if (look === 'soft') p.setMaskFilter(this.softMask());
    const rgb = particles.red && particles.green && particles.blue ? particles : null;
    const aspect = particles.aspect ?? 1;
    const stretch = particles.stretch ?? 0.04;
    const c = this.particleColor;
    for (let i = 0; i < particles.count; i++) {
      if (particles.alive[i] !== 1) continue;
      const opacity = particles.opacity[i] ?? 0;
      const radius = particles.radius[i] ?? 0;
      if (opacity <= 0 || radius <= 0) continue;
      if (rgb) {
        c[0] = rgb.red?.[i] ?? 1;
        c[1] = rgb.green?.[i] ?? 1;
        c[2] = rgb.blue?.[i] ?? 1;
        c[3] = opacity;
        p.setColor(c);
      } else {
        const color = this.color(particles.colors?.[particles.colorIndex?.[i] ?? 0] ?? '#FFFFFF');
        p.setColor(color);
        p.setAlphaf((color[3] ?? 1) * opacity);
      }
      const x = particles.x[i] ?? 0;
      const y = particles.y[i] ?? 0;
      switch (look) {
        case 'square': {
          const rotation = particles.rotation?.[i] ?? 0;
          canvas.save();
          canvas.translate(x, y);
          if (rotation !== 0) canvas.rotate(rotation, 0, 0);
          canvas.drawRect(this.skia.XYWHRect(-radius * aspect, -radius, radius * 2 * aspect, radius * 2), p);
          canvas.restore();
          break;
        }
        case 'spark': {
          const vx = particles.vx?.[i] ?? 0;
          const vy = particles.vy?.[i] ?? 0;
          p.setStrokeWidth(radius);
          canvas.drawLine(x, y, x - vx * stretch, y - vy * stretch, p);
          break;
        }
        case 'ring':
          p.setStrokeWidth(Math.max(0.5, radius * 0.3));
          canvas.drawCircle(x, y, radius, p);
          break;
        case 'soft':
          // A unit circle blurred in its own (scaled) coordinates: one mask filter for all sizes.
          canvas.save();
          canvas.translate(x, y);
          canvas.scale(radius, radius);
          canvas.drawCircle(0, 0, 0.7, p);
          canvas.restore();
          break;
        default:
          canvas.drawCircle(x, y, radius, p);
      }
      drawn++;
    }
    if (look === 'soft') p.setMaskFilter(null);
    if (restore >= 0) canvas.restoreToCount(restore);
    return drawn;
  }

  /** Image particles: one `drawAtlas` call for all live particles. */
  private drawImageParticles(canvas: SkCanvas, particles: ParticleDrawable): number {
    const native = particles.image?.native as SkImage | undefined;
    if (!particles.image || !native) {
      this.warn('image-unavailable', particles.image?.id ?? 'particles');
      return 0;
    }
    const full = { x: 0, y: 0, width: particles.image.width, height: particles.image.height };
    const srcs: SkRect[] = [];
    const xforms: SkRSXform[] = [];
    const colors: SkColor[] = [];
    for (let i = 0; i < particles.count; i++) {
      if (particles.alive[i] !== 1) continue;
      const opacity = particles.opacity[i] ?? 0;
      const radius = particles.radius[i] ?? 0;
      if (opacity <= 0 || radius <= 0) continue;
      const frame = particles.frames?.[particles.frame?.[i] ?? 0] ?? full;
      const scale = (radius * 2) / Math.max(frame.width, frame.height, 1);
      const angle = ((particles.rotation?.[i] ?? 0) * Math.PI) / 180;
      const scos = Math.cos(angle) * scale;
      const ssin = Math.sin(angle) * scale;
      const hw = frame.width / 2;
      const hh = frame.height / 2;
      const x = particles.x[i] ?? 0;
      const y = particles.y[i] ?? 0;
      srcs.push(this.skia.XYWHRect(frame.x, frame.y, frame.width, frame.height));
      xforms.push(this.skia.RSXform(scos, ssin, x - (scos * hw - ssin * hh), y - (ssin * hw + scos * hh)));
      const tint = Float32Array.of(particles.red?.[i] ?? 1, particles.green?.[i] ?? 1, particles.blue?.[i] ?? 1, opacity);
      colors.push(tint);
    }
    if (srcs.length === 0) return 0;
    this.resetPaint();
    this.paint.setBlendMode(BLEND[particles.blendMode ?? 'normal']);
    const restore = particles.matrix ? canvas.save() : -1;
    if (particles.matrix) canvas.concat(toSkiaMatrix(particles.matrix));
    canvas.drawAtlas(native, srcs, xforms, this.paint, SkBlendMode.Modulate, colors);
    if (restore >= 0) canvas.restoreToCount(restore);
    return srcs.length;
  }

  private softMask(): SkMaskFilter {
    if (!this.softMaskFilter) this.softMaskFilter = this.skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.3, true);
    return this.softMaskFilter;
  }

  // --- Scene ------------------------------------------------------------------------------

  /** Executes the scene's display list: shapes, clip groups and filtered layers. */
  private drawScene(canvas: SkCanvas, scene: SceneDrawable): number {
    let drawn = 0;
    const saves: number[] = [];
    for (const command of scene.commands) {
      if (command.op === 'draw') {
        if (this.drawItem(canvas, command.item, scene.time)) drawn++;
      } else if (command.op === 'begin-group') {
        saves.push(this.beginGroup(canvas, command, scene.time));
      } else {
        const count = saves.pop();
        if (count !== undefined) canvas.restoreToCount(count);
      }
    }
    // Unbalanced lists (should not happen) must not leak state into the next drawable.
    const first = saves[0];
    if (first !== undefined) canvas.restoreToCount(first);
    return drawn;
  }

  private beginGroup(canvas: SkCanvas, group: SceneGroupCommand, time: number): number {
    const count = canvas.save();
    if (group.clip) this.clipTo(canvas, group.clip, group.clipMatrix);
    if (group.layer) {
      this.layerPaint.setImageFilter(this.imageFilter(group.effects, time));
      this.layerPaint.setBlendMode(BLEND[group.blendMode]);
      canvas.saveLayer(this.layerPaint);
    }
    return count;
  }

  /** Clips to a shape outline placed by `matrix`, keeping the canvas matrix unchanged. */
  private clipTo(canvas: SkCanvas, shape: NodeShape, matrix: Matrix2D): void {
    const inverse = invert(matrix);
    if (!inverse) {
      // A zero scale collapses the outline: nothing inside the group is visible.
      canvas.clipRect(this.skia.XYWHRect(0, 0, 0, 0), ClipOp.Intersect, true);
      return;
    }
    canvas.concat(toSkiaMatrix(matrix));
    if (shape.type === 'path') {
      const path = this.path(shape.path);
      if (path) canvas.clipPath(path, ClipOp.Intersect, true);
      else canvas.clipRect(this.skia.XYWHRect(0, 0, 0, 0), ClipOp.Intersect, true);
    } else if (shape.type === 'circle' || shape.type === 'ellipse') {
      // A rounded rect whose radii are half its size is exactly the ellipse.
      const b = shapeBounds(shape);
      const rect = this.skia.XYWHRect(b.x, b.y, b.width, b.height);
      canvas.clipRRect(this.skia.RRectXY(rect, b.width / 2, b.height / 2), ClipOp.Intersect, true);
    } else {
      const b = shapeBounds(shape);
      const rect = this.skia.XYWHRect(b.x, b.y, b.width, b.height);
      const radius = shape.type === 'rect' ? (shape.cornerRadius ?? 0) : 0;
      if (radius > 0) canvas.clipRRect(this.skia.RRectXY(rect, radius, radius), ClipOp.Intersect, true);
      else canvas.clipRect(rect, ClipOp.Intersect, true);
    }
    canvas.concat(toSkiaMatrix(inverse));
  }

  private drawItem(canvas: SkCanvas, item: SceneDrawItem, time: number): boolean {
    const shape = item.shape;
    canvas.save();
    canvas.concat(toSkiaMatrix(item.matrix));
    let drawn = false;
    if (shape.type === 'image') {
      drawn = this.drawImage(canvas, shape, item);
    } else {
      const fill = shape.fill ?? shape.color;
      if (fill !== undefined) {
        this.setupPaint(fill, item, shape, time);
        this.drawGeometry(canvas, shape);
        drawn = true;
      }
      if (shape.stroke) {
        this.setupPaint(shape.stroke.fill, item, shape, time);
        this.paint.setStyle(PaintStyle.Stroke);
        this.paint.setStrokeWidth(shape.stroke.width);
        this.paint.setStrokeCap(CAP[shape.stroke.cap ?? 'butt']);
        this.paint.setStrokeJoin(JOIN[shape.stroke.join ?? 'miter']);
        this.drawGeometry(canvas, shape);
        drawn = true;
      }
    }
    canvas.restore();
    return drawn;
  }

  private drawGeometry(canvas: SkCanvas, shape: Exclude<NodeShape, { type: 'image' }>): void {
    switch (shape.type) {
      case 'circle':
        canvas.drawCircle(0, 0, shape.radius, this.paint);
        return;
      case 'ellipse':
        canvas.drawOval(this.skia.XYWHRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height), this.paint);
        return;
      case 'path': {
        const path = this.path(shape.path);
        if (path) canvas.drawPath(path, this.paint);
        return;
      }
      case 'rect': {
        const rect = this.skia.XYWHRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
        const radius = shape.cornerRadius ?? 0;
        if (radius > 0) canvas.drawRRect(this.skia.RRectXY(rect, radius, radius), this.paint);
        else canvas.drawRect(rect, this.paint);
      }
    }
  }

  private drawImage(canvas: SkCanvas, shape: Extract<NodeShape, { type: 'image' }>, item: SceneDrawItem): boolean {
    const native = shape.image.native as SkImage | undefined;
    if (!native) {
      this.warn('image-unavailable', shape.image.id);
      return false;
    }
    const b = shapeBounds(shape);
    const { width, height } = imageSize(shape);
    if (width === 0 || height === 0) return false;
    const src = shape.source ?? { x: 0, y: 0, width: shape.image.width, height: shape.image.height };
    this.resetPaint();
    this.paint.setAlphaf(item.opacity);
    this.paint.setBlendMode(BLEND[item.blendMode]);
    canvas.drawImageRectOptions(
      native,
      this.skia.XYWHRect(src.x, src.y, src.width, src.height),
      this.skia.XYWHRect(b.x, b.y, width, height),
      shape.smoothing === 'nearest' ? FilterMode.Nearest : FilterMode.Linear,
      MipmapMode.None,
      this.paint,
    );
    return true;
  }

  /** Configures the shared paint for a fill: color, gradient or runtime shader. */
  private setupPaint(fill: Fill, item: SceneDrawItem, shape: NodeShape, time: number): void {
    this.resetPaint();
    this.paint.setBlendMode(BLEND[item.blendMode]);
    if (typeof fill === 'string') {
      const color = this.color(fill);
      this.paint.setColor(color);
      this.paint.setAlphaf((color[3] ?? 1) * item.opacity);
      return;
    }
    if (fill.type === 'shader') {
      const effect = this.runtimeEffect(fill.shader);
      if (!effect) {
        const color = this.color(fill.shader.fallback);
        this.paint.setColor(color);
        this.paint.setAlphaf((color[3] ?? 1) * item.opacity);
        return;
      }
      const b = shapeBounds(shape);
      const uniforms = shaderUniformValues(fill.shader, fill.uniforms, {
        time: time / 1000,
        width: b.width,
        height: b.height,
      });
      // Shader coordinates start at the shape's top-left corner, so `p / size` is in [0, 1].
      this.paint.setShader(effect.makeShader(uniforms, this.skia.Matrix().translate(b.x, b.y)));
      this.paint.setAlphaf(item.opacity);
      return;
    }
    let shader = this.gradientCache.get(fill);
    if (!shader) {
      const colors = fill.colors.map((c) => this.color(c));
      const positions = fill.positions ? [...fill.positions] : null;
      shader =
        fill.type === 'linear-gradient'
          ? this.skia.Shader.MakeLinearGradient(
              this.skia.Point(fill.start.x, fill.start.y),
              this.skia.Point(fill.end.x, fill.end.y),
              colors,
              positions,
              TileMode.Clamp,
            )
          : this.skia.Shader.MakeRadialGradient(
              this.skia.Point(fill.center.x, fill.center.y),
              fill.radius,
              colors,
              positions,
              TileMode.Clamp,
            );
      this.gradientCache.set(fill, shader);
    }
    this.paint.setShader(shader);
    this.paint.setAlphaf(item.opacity);
  }

  private resetPaint(): void {
    const p = this.paint;
    p.setShader(null);
    p.setStyle(PaintStyle.Fill);
    p.setBlendMode(SkBlendMode.SrcOver);
    p.setColor(this.color('#000000'));
  }

  private imageFilter(effects: readonly NodeEffect[], time: number): SkImageFilter | null {
    let filter: SkImageFilter | null = null;
    const F = this.skia.ImageFilter;
    for (const effect of effects) {
      switch (effect.type) {
        case 'glow': {
          const base = this.color(effect.color);
          const strength = effect.strength ?? 1;
          const s = sigma(effect.radius);
          // Glow = colored, blurred copy of the content drawn under it. Strength above 1 stacks
          // a tighter second copy.
          const color = Float32Array.of(base[0] ?? 1, base[1] ?? 1, base[2] ?? 1, Math.min(1, strength) * (base[3] ?? 1));
          filter = F.MakeDropShadow(0, 0, s, s, color, filter);
          if (strength > 1) {
            const extra = Float32Array.of(base[0] ?? 1, base[1] ?? 1, base[2] ?? 1, Math.min(1, strength - 1) * (base[3] ?? 1));
            filter = F.MakeDropShadow(0, 0, s / 2, s / 2, extra, filter);
          }
          break;
        }
        case 'blur':
          filter = F.MakeBlur(sigma(effect.radius), sigma(effect.radius), TileMode.Decal, filter);
          break;
        case 'drop-shadow':
          filter = F.MakeDropShadow(effect.dx, effect.dy, sigma(effect.radius), sigma(effect.radius), this.color(effect.color), filter);
          break;
        case 'color-matrix':
          filter = F.MakeColorFilter(this.skia.ColorFilter.MakeMatrix([...effect.matrix]), filter);
          break;
        case 'distort': {
          const runtime = this.runtimeEffect(displacementShader);
          if (!runtime || effect.amount === 0) break;
          const uniforms = shaderUniformValues(displacementShader, { frequency: effect.frequency ?? 0.06, speed: effect.speed ?? 1 }, {
            time: time / 1000,
            width: 0,
            height: 0,
          });
          const field = F.MakeShader(runtime.makeShader(uniforms));
          filter = F.MakeDisplacementMap(ColorChannel.R, ColorChannel.G, effect.amount * 2, field, filter);
          break;
        }
      }
    }
    return filter;
  }

  private runtimeEffect(shader: ShaderDefinition): SkRuntimeEffect | null {
    if (this.effectCache.has(shader.source)) return this.effectCache.get(shader.source) ?? null;
    let effect: SkRuntimeEffect | null = null;
    if (this.capabilities.runtimeShaders) {
      this.compiles++;
      try {
        effect = this.skia.RuntimeEffect.Make(shader.source);
      } catch {
        effect = null;
      }
    }
    if (!effect) this.warn('shader-compile-failed', shader.name);
    this.effectCache.set(shader.source, effect);
    return effect;
  }

  /** Shader programs compiled so far and programs currently cached (for tests and profiling). */
  get shaderStats(): { readonly compiles: number; readonly cached: number } {
    return { compiles: this.compiles, cached: this.effectCache.size };
  }

  /** Compiles shaders ahead of time (for example while a screen opens) to avoid a first-use hitch. */
  precompile(shaders: readonly ShaderDefinition[]): void {
    for (const shader of shaders) this.runtimeEffect(shader);
  }

  private path(data: PathData): SkPath | null {
    const cached = this.pathCache.get(data);
    if (cached && cached.version === data.version) return cached.path;
    const path = data.isEmpty ? null : this.skia.Path.MakeFromSVGString(data.toSvg());
    this.pathCache.set(data, { version: data.version, path });
    return path;
  }

  private warn(kind: RendererWarning['kind'], detail: string): void {
    const key = `${kind}:${detail}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.onWarning({ kind, detail });
  }

  private color(value: string): SkColor {
    let color = this.colorCache.get(value);
    if (!color) {
      color = this.skia.Color(value);
      this.colorCache.set(value, color);
    }
    return color;
  }
}
