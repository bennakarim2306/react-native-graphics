import { Skia } from '@shopify/react-native-skia';
import type { SkPicture } from '@shopify/react-native-skia';
import type { Engine } from '../engine/engine';
import { SkiaEffectsRenderer } from '../renderer/skia/SkiaEffectsRenderer';

interface Entry {
  readonly renderer: SkiaEffectsRenderer;
  users: number;
}

const shared = new WeakMap<Engine, Entry>();
let blank: SkPicture | null = null;

/**
 * The Skia renderer of an engine, shared by its overlay and the local effects layers of its
 * targets, so shaders compile once per engine. Each call must be matched by `releaseRenderer`.
 */
export function acquireRenderer(engine: Engine): SkiaEffectsRenderer {
  let entry = shared.get(engine);
  if (!entry) {
    entry = {
      renderer: new SkiaEffectsRenderer(Skia, (warning) => {
        if (__DEV__) console.warn(`[GameFX] ${warning.kind}: ${warning.detail}`);
      }),
      users: 0,
    };
    shared.set(engine, entry);
  }
  entry.users++;
  return entry.renderer;
}

/** Releases a renderer from `acquireRenderer`; the last release disposes it. */
export function releaseRenderer(engine: Engine): void {
  const entry = shared.get(engine);
  if (!entry) return;
  entry.users--;
  if (entry.users <= 0) {
    entry.renderer.dispose();
    shared.delete(engine);
  }
}

/** An empty picture (shared, never disposed). */
export function blankPicture(): SkPicture {
  if (!blank) {
    const recorder = Skia.PictureRecorder();
    recorder.beginRecording();
    blank = recorder.finishRecordingAsPicture();
  }
  return blank;
}
