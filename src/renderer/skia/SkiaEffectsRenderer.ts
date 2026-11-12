import type { SkCanvas, SkColor, SkPaint, SkPicture, SkRect, Skia as SkiaApi } from '@shopify/react-native-skia';
import { isParticleDrawable } from '../../particles/burst';
import type { ParticleDrawable } from '../../particles/burst';
import type { Drawable } from '../../runtime/effect';

/** The part of the Skia API the renderer uses. Injected so it can run against CanvasKit in tests. */
export type SkiaFactory = Pick<typeof SkiaApi, 'Paint' | 'Color' | 'PictureRecorder' | 'XYWHRect'>;

export interface RendererCapabilities {
  /** Drawable kinds this renderer can draw. Others are skipped and reported once. */
  readonly kinds: readonly string[];
}

export interface DrawStats {
  readonly drawnPrimitives: number;
  readonly skippedDrawables: number;
}

/**
 * Draws engine drawables with React Native Skia. It is the only place that knows Skia types.
 * It holds one reusable paint and a color cache; call `dispose` to release them.
 */
export class SkiaEffectsRenderer {
  readonly capabilities: RendererCapabilities = { kinds: ['particles'] };
  private readonly paint: SkPaint;
  private readonly colorCache = new Map<string, SkColor>();
  private readonly reportedKinds = new Set<string>();
  private disposed = false;

  constructor(
    private readonly skia: SkiaFactory,
    private readonly onUnsupported: (kind: string) => void = () => undefined,
  ) {
    this.paint = skia.Paint();
    this.paint.setAntiAlias(true);
  }

  /** Draws all drawables onto `canvas`, in order. */
  draw(canvas: SkCanvas, drawables: readonly Drawable[]): DrawStats {
    let drawnPrimitives = 0;
    let skippedDrawables = 0;
    if (this.disposed) return { drawnPrimitives, skippedDrawables: drawables.length };
    for (const drawable of drawables) {
      if (isParticleDrawable(drawable)) {
        drawnPrimitives += this.drawParticles(canvas, drawable);
      } else {
        skippedDrawables++;
        if (!this.reportedKinds.has(drawable.kind)) {
          this.reportedKinds.add(drawable.kind);
          this.onUnsupported(drawable.kind);
        }
      }
    }
    return { drawnPrimitives, skippedDrawables };
  }

  /** Records the drawables into a picture that a `<Picture>` element can display. */
  record(drawables: readonly Drawable[], bounds?: SkRect): SkPicture {
    const recorder = this.skia.PictureRecorder();
    const canvas = recorder.beginRecording(bounds);
    this.draw(canvas, drawables);
    return recorder.finishRecordingAsPicture();
  }

  dispose(): void {
    this.disposed = true;
    this.colorCache.clear();
    this.paint.dispose();
  }

  private drawParticles(canvas: SkCanvas, particles: ParticleDrawable): number {
    let drawn = 0;
    for (let i = 0; i < particles.count; i++) {
      if (particles.alive[i] !== 1) continue;
      const opacity = particles.opacity[i] ?? 0;
      const radius = particles.radius[i] ?? 0;
      if (opacity <= 0 || radius <= 0) continue;
      const color = this.color(particles.colors[particles.colorIndex[i] ?? 0] ?? '#FFFFFF');
      this.paint.setColor(color);
      this.paint.setAlphaf((color[3] ?? 1) * opacity);
      canvas.drawCircle(particles.x[i] ?? 0, particles.y[i] ?? 0, radius, this.paint);
      drawn++;
    }
    return drawn;
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
