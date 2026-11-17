import { Playable } from '../animation/playable';
import type { IterationEvent, PlayableRunner } from '../animation/playable';
import type { Playback } from '../animation/playback';
import { InvalidOptionError } from '../runtime/errors';
import type { Point } from '../scene/matrix';
import { SceneNode } from '../scene/node';
import type { NodeOptions, SceneHost } from '../scene/node';
import type { ImageShape } from '../scene/shape';
import type { SpriteAnimation, SpriteAnimationSpec, SpriteSheet } from './sheet';

/**
 * Plays a sprite animation by setting `sprite.frame`. It is an ordinary playable: it runs on
 * the engine clock through a `Playback` (pause, resume, speed, seek, finish, markers) and can
 * be placed on timelines next to tweens. Frame events are delivered as markers.
 */
export class FrameAnimation extends Playable {
  private readonly starts: number[] = [];
  private readonly total: number;
  private readonly events: IterationEvent[];

  constructor(
    readonly sprite: Sprite,
    readonly animation: SpriteAnimation,
    options: { readonly repeat?: number; readonly delay?: number } = {},
  ) {
    super({ repeat: options.repeat ?? animation.repeat, delay: options.delay ?? 0 }, `sprite animation "${animation.name}"`);
    let t = 0;
    for (const d of animation.durations) {
      this.starts.push(t);
      t += d;
    }
    this.total = t;
    this.events = animation.events.map((e) => ({ kind: 'marker', name: e.name, time: this.starts[e.at] ?? 0 }));
  }

  get duration(): number {
    return this.total;
  }

  /** Index into the animation's frame list shown at time `t` of one pass. */
  indexAt(t: number): number {
    if (t >= this.total) return this.starts.length - 1;
    // Binary search for the last start <= t.
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  protected renderIteration(time: number): void {
    if (this.sprite.destroyed) return;
    this.sprite.frame = this.animation.frames[this.indexAt(time)] ?? 0;
  }

  iterationEvents(): readonly IterationEvent[] {
    return this.events;
  }
}

export interface SpriteOptions extends Omit<NodeOptions, 'shape'> {
  readonly sheet: SpriteSheet;
  /** Initial sheet frame. Default 0. */
  readonly frame?: number;
  /** Drawn size in points. Default: the frame's pixel size. */
  readonly width?: number;
  readonly height?: number;
  /** Origin within the drawn frame. Default: the sheet's anchor. */
  readonly anchor?: Point;
  /** `nearest` keeps pixel art crisp when scaled. Default `linear`. */
  readonly smoothing?: 'linear' | 'nearest';
}

export interface SpritePlayOptions {
  /** Playback rate. Default 1. */
  readonly speed?: number;
  /** Overrides the animation's loop setting: extra iterations, Infinity to loop. */
  readonly repeat?: number;
  readonly delay?: number;
}

/**
 * A scene node that draws one frame of a sprite sheet. It moves, rotates, scales, fades,
 * nests and attaches like any node; `play` runs a sheet animation on the engine clock.
 * The sprite retains the sheet's image while it exists.
 */
export class Sprite extends SceneNode {
  readonly sheet: SpriteSheet;
  private currentFrame = 0;
  private readonly frameShapes: (ImageShape | undefined)[];
  private readonly drawWidth: number | undefined;
  private readonly drawHeight: number | undefined;
  private readonly drawAnchor: Point;
  private readonly smoothing: 'linear' | 'nearest' | undefined;
  private current: Playback | null = null;
  private currentName: string | null = null;

  /** @internal Use `engine.createSprite`. */
  constructor(
    host: SceneHost,
    options: SpriteOptions,
    private readonly runner: PlayableRunner | null = null,
  ) {
    super(host, options);
    const sheet = options.sheet;
    if (!(sheet as unknown as { frames?: unknown }).frames || typeof sheet.frame !== 'function') {
      throw new InvalidOptionError('A sprite needs a sprite sheet (engine.createSpriteSheet).');
    }
    this.sheet = sheet;
    if (options.width !== undefined && !(Number.isFinite(options.width) && options.width >= 0)) {
      throw new InvalidOptionError('Sprite width must be a finite number >= 0.');
    }
    if (options.height !== undefined && !(Number.isFinite(options.height) && options.height >= 0)) {
      throw new InvalidOptionError('Sprite height must be a finite number >= 0.');
    }
    this.drawWidth = options.width;
    this.drawHeight = options.height;
    this.drawAnchor = options.anchor ?? sheet.anchor;
    this.smoothing = options.smoothing;
    this.frameShapes = new Array<ImageShape | undefined>(sheet.frameCount);
    this.frame = options.frame ?? 0;
  }

  /** Sheet frame currently shown. */
  get frame(): number {
    return this.currentFrame;
  }
  set frame(value: number) {
    this.sheet.frame(value); // validates
    if (value === this.currentFrame && this.shape) return;
    this.currentFrame = value;
    this.shape = this.shapeFor(value);
  }

  /** The playback of the animation started with `play`, while it runs. */
  get playback(): Playback | null {
    return this.current?.status === 'playing' || this.current?.status === 'paused' ? this.current : null;
  }

  /** Name of the animation started with `play`, while it runs. */
  get animationName(): string | null {
    return this.playback ? this.currentName : null;
  }

  /**
   * Creates a frame animation of this sprite without starting it, for example to add it to a
   * timeline. Pass a sheet animation name or an inline spec.
   */
  animation(name: string | SpriteAnimationSpec, options: SpritePlayOptions = {}): FrameAnimation {
    const resolved = typeof name === 'string' ? this.sheet.animation(name) : this.sheet.resolve('inline', name);
    const playable = new FrameAnimation(this, resolved, {
      ...(options.repeat !== undefined ? { repeat: options.repeat } : {}),
      ...(options.delay !== undefined ? { delay: options.delay } : {}),
    });
    playable.runner = this.runner;
    return playable;
  }

  /**
   * Starts a sheet animation on the engine clock, replacing the one started earlier by `play`
   * (which is cancelled). Returns its playback: pause, resume, `speed`, stop, finish, markers.
   */
  play(name: string | SpriteAnimationSpec, options: SpritePlayOptions = {}): Playback {
    if (this.destroyed) throw new InvalidOptionError('Cannot play an animation on a destroyed sprite.');
    if (!this.runner) throw new InvalidOptionError('This sprite was created without an engine. Use engine.createSprite.');
    const playable = this.animation(name, options);
    this.current?.cancel();
    const playback = this.runner.run(playable);
    if (options.speed !== undefined) playback.speed = options.speed;
    this.current = playback;
    this.currentName = typeof name === 'string' ? name : 'inline';
    return playback;
  }

  /** Cancels the animation started with `play`, keeping the current frame. */
  stopAnimation(): void {
    this.current?.cancel();
    this.current = null;
  }

  protected override onDestroy(): void {
    this.current?.cancel();
    this.current = null;
  }

  private shapeFor(index: number): ImageShape {
    let shape = this.frameShapes[index];
    if (!shape) {
      const source = this.sheet.frame(index);
      shape = {
        type: 'image',
        image: this.sheet.image,
        source,
        width: this.drawWidth ?? source.width,
        height: this.drawHeight ?? source.height,
        anchor: this.drawAnchor,
        ...(this.smoothing ? { smoothing: this.smoothing } : {}),
      };
      this.frameShapes[index] = shape;
    }
    return shape;
  }
}
