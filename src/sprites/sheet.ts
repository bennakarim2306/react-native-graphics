import type { ImageAsset } from '../assets/assets';
import type { Rect } from '../graphics/path';
import { InvalidOptionError } from '../runtime/errors';
import type { Point } from '../scene/matrix';

/** Direction of a frame animation. `alternate` plays forwards then backwards (ping-pong). */
export type FrameDirection = 'forward' | 'reverse' | 'alternate';

/** A marker raised when a given frame is shown. Listen with `playback.onMarker(name, ...)`. */
export interface FrameEventSpec {
  /** Index into the animation's `frames` list (not the sheet frame number). */
  readonly at: number;
  readonly name: string;
}

/** A named sequence of sheet frames. */
export interface SpriteAnimationSpec {
  /** Sheet frame numbers in play order, or an inclusive range. */
  readonly frames: readonly number[] | { readonly from: number; readonly to: number };
  /** Frames per second. Ignored when `frameDuration` is given. Default 12. */
  readonly fps?: number;
  /** Duration of every frame in ms, or one duration per frame. */
  readonly frameDuration?: number | readonly number[];
  /** `true` loops forever, a number repeats that many extra times. Default false. */
  readonly loop?: boolean | number;
  readonly direction?: FrameDirection;
  readonly events?: readonly FrameEventSpec[];
}

/** A resolved animation: frame numbers and durations of one pass, after `direction`. */
export interface SpriteAnimation {
  readonly name: string;
  readonly frames: readonly number[];
  /** Duration of each entry of `frames`, in ms. */
  readonly durations: readonly number[];
  /** Extra iterations: 0 plays once, Infinity loops. */
  readonly repeat: number;
  readonly events: readonly FrameEventSpec[];
}

/** Uniform grid layout of frames in an image, read left to right, top to bottom. */
export interface SpriteGrid {
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Number of frames. Default: every full cell of the image. */
  readonly count?: number;
  /** Pixels around the grid. Default 0. */
  readonly margin?: number;
  /** Pixels between cells. Default 0. */
  readonly spacing?: number;
}

export interface SpriteSheetOptions {
  readonly image: ImageAsset;
  /** Frame layout as a grid... */
  readonly grid?: SpriteGrid;
  /** ...or as explicit rectangles in image pixels. */
  readonly frames?: readonly Rect[];
  readonly animations?: Readonly<Record<string, SpriteAnimationSpec>>;
  /** Default anchor of sprites using this sheet. Default centre (0.5, 0.5). */
  readonly anchor?: Point;
}

const positiveFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function gridFrames(image: ImageAsset, grid: SpriteGrid): Rect[] {
  const { frameWidth, frameHeight } = grid;
  const margin = grid.margin ?? 0;
  const spacing = grid.spacing ?? 0;
  if (!positiveFinite(frameWidth) || !positiveFinite(frameHeight)) {
    throw new InvalidOptionError('Sprite grid needs frameWidth and frameHeight > 0.');
  }
  if (!(Number.isFinite(margin) && margin >= 0 && Number.isFinite(spacing) && spacing >= 0)) {
    throw new InvalidOptionError('Sprite grid margin and spacing must be >= 0.');
  }
  const columns = Math.floor((image.width - 2 * margin + spacing) / (frameWidth + spacing));
  const rows = Math.floor((image.height - 2 * margin + spacing) / (frameHeight + spacing));
  const available = Math.max(0, columns) * Math.max(0, rows);
  const count = grid.count ?? available;
  if (!Number.isInteger(count) || count < 1 || count > available) {
    throw new InvalidOptionError(
      `Sprite grid fits ${String(available)} frames of ${String(frameWidth)}x${String(frameHeight)} in image "${image.id}", but ${String(count)} were requested.`,
    );
  }
  const frames: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    frames.push({
      x: margin + col * (frameWidth + spacing),
      y: margin + row * (frameHeight + spacing),
      width: frameWidth,
      height: frameHeight,
    });
  }
  return frames;
}

/**
 * Frames of one image plus named animations. Immutable; many sprites can share a sheet.
 * The sheet does not retain its image; sprites that draw it do.
 */
export class SpriteSheet {
  readonly image: ImageAsset;
  readonly frames: readonly Rect[];
  readonly anchor: Point;
  private readonly animationMap = new Map<string, SpriteAnimation>();

  constructor(options: SpriteSheetOptions) {
    const image = options.image;
    if (typeof image !== 'object' || (image as { kind?: unknown }).kind !== 'image') {
      throw new InvalidOptionError('A sprite sheet needs a loaded image asset.');
    }
    if (image.disposed) throw new InvalidOptionError(`Image asset "${image.id}" has been unloaded.`);
    this.image = image;
    if (options.grid && options.frames) throw new InvalidOptionError('Pass either grid or frames, not both.');
    if (options.grid) {
      this.frames = gridFrames(image, options.grid);
    } else if (options.frames) {
      if (options.frames.length === 0) throw new InvalidOptionError('A sprite sheet needs at least one frame.');
      for (const r of options.frames) {
        const ok =
          [r.x, r.y].every((v) => Number.isFinite(v) && v >= 0) &&
          positiveFinite(r.width) &&
          positiveFinite(r.height) &&
          r.x + r.width <= image.width &&
          r.y + r.height <= image.height;
        if (!ok) throw new InvalidOptionError(`Sprite frame ${JSON.stringify(r)} is outside image "${image.id}".`);
      }
      this.frames = options.frames.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    } else {
      this.frames = [{ x: 0, y: 0, width: image.width, height: image.height }];
    }
    const anchor = options.anchor ?? { x: 0.5, y: 0.5 };
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) throw new InvalidOptionError('Sheet anchor must be finite.');
    this.anchor = { x: anchor.x, y: anchor.y };
    for (const [name, spec] of Object.entries(options.animations ?? {})) {
      this.animationMap.set(name, this.resolve(name, spec));
    }
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get animationNames(): readonly string[] {
    return [...this.animationMap.keys()];
  }

  hasAnimation(name: string): boolean {
    return this.animationMap.has(name);
  }

  animation(name: string): SpriteAnimation {
    const animation = this.animationMap.get(name);
    if (!animation) {
      throw new InvalidOptionError(`Sprite sheet has no animation "${name}". Known: ${this.animationNames.join(', ') || 'none'}.`);
    }
    return animation;
  }

  frame(index: number): Rect {
    const rect = this.frames[index];
    if (!Number.isInteger(index) || !rect) {
      throw new InvalidOptionError(`Sprite frame ${String(index)} is out of range (0 to ${String(this.frames.length - 1)}).`);
    }
    return rect;
  }

  /** Validates an animation spec against this sheet and resolves direction and durations. */
  resolve(name: string, spec: SpriteAnimationSpec): SpriteAnimation {
    const what = `Sprite animation "${name}"`;
    let base: number[];
    if (Array.isArray(spec.frames)) {
      base = [...(spec.frames as readonly number[])];
    } else {
      const { from, to } = spec.frames as { from: number; to: number };
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new InvalidOptionError(`${what} range needs integers.`);
      base = [];
      const step = to >= from ? 1 : -1;
      for (let f = from; f !== to + step; f += step) base.push(f);
    }
    if (base.length === 0) throw new InvalidOptionError(`${what} needs at least one frame.`);
    for (const f of base) this.frame(f);

    let durations: number[];
    if (spec.frameDuration !== undefined) {
      const d = spec.frameDuration;
      if (typeof d === 'number') {
        durations = base.map(() => d);
      } else {
        if (d.length !== base.length) throw new InvalidOptionError(`${what} needs one frameDuration per frame.`);
        durations = [...d];
      }
    } else {
      const fps = spec.fps ?? 12;
      if (!positiveFinite(fps)) throw new InvalidOptionError(`${what} fps must be > 0.`);
      durations = base.map(() => 1000 / fps);
    }
    if (!durations.every(positiveFinite)) throw new InvalidOptionError(`${what} frame durations must be > 0.`);

    const events = spec.events ?? [];
    for (const e of events) {
      if (!Number.isInteger(e.at) || e.at < 0 || e.at >= base.length || typeof e.name !== 'string' || e.name.length === 0) {
        throw new InvalidOptionError(`${what} event needs a name and an index within its frames.`);
      }
    }

    const direction: unknown = spec.direction ?? 'forward';
    let frames = base;
    let mappedEvents: FrameEventSpec[] = [...events];
    if (direction === 'reverse') {
      frames = [...base].reverse();
      durations = [...durations].reverse();
      mappedEvents = events.map((e) => ({ at: base.length - 1 - e.at, name: e.name }));
    } else if (direction === 'alternate') {
      // 0 1 2 3 → 0 1 2 3 2 1 (the ends are not repeated, so loops are seamless).
      const back = base.slice(1, -1).reverse();
      const backDurations = durations.slice(1, -1).reverse();
      frames = [...base, ...back];
      durations = [...durations, ...backDurations];
      mappedEvents = [...events];
      for (const e of events) {
        if (e.at > 0 && e.at < base.length - 1) mappedEvents.push({ at: 2 * base.length - 2 - e.at, name: e.name });
      }
    } else if (direction !== 'forward') {
      throw new InvalidOptionError(`${what} direction must be forward, reverse or alternate.`);
    }

    const loop = spec.loop ?? false;
    let repeat: number;
    if (loop === true) repeat = Infinity;
    else if (loop === false) repeat = 0;
    else if (Number.isInteger(loop) && loop >= 0) repeat = loop;
    else throw new InvalidOptionError(`${what} loop must be a boolean or an integer >= 0.`);

    return { name, frames, durations, repeat, events: mappedEvents.sort((a, b) => a.at - b.at) };
  }
}

export function createSpriteSheet(options: SpriteSheetOptions): SpriteSheet {
  return new SpriteSheet(options);
}
