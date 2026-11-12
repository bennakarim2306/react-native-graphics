import { InvalidOptionError } from '../runtime/errors';
import { resolveEasing } from './easing';
import type { Easing, EasingFunction } from './easing';
import { Playable } from './playable';
import type { IterationEvent, PlayableOptions, PropertyAnimationLike, RenderContext } from './playable';
import { assertAnimationTarget } from './target';
import type { AnimationTarget } from './target';

/**
 * How a property animation treats other running animations of the same properties on the
 * same target when it starts:
 * - `auto` (default): the other animations stop writing the overlapping properties and their
 *   playbacks receive an `interrupted` event. Their timing is unchanged.
 * - `none`: both keep writing; the one rendered last in a frame wins.
 */
export type Overwrite = 'auto' | 'none';

export interface PropertyAnimationOptions extends PlayableOptions {
  /** Length of one iteration in ms. Default 300. 0 jumps to the end values. */
  readonly duration?: number;
  readonly overwrite?: Overwrite;
}

export interface TweenOptions<P extends string> extends PropertyAnimationOptions {
  /** Default `linear`. */
  readonly easing?: Easing;
  /** Start values. Properties not listed start from their value when the tween starts. */
  readonly from?: Partial<Record<P, number>>;
}

/** Tween options plus the end values of the properties to animate. */
export type TweenVars<P extends string> = TweenOptions<P> & Partial<Record<P, number>>;

const TWEEN_OPTION_KEYS = new Set(['duration', 'delay', 'repeat', 'yoyo', 'easing', 'from', 'overwrite']);
const DEFAULT_DURATION = 300;

function validateDuration(duration: number | undefined, what: string): number {
  const d = duration ?? DEFAULT_DURATION;
  if (!Number.isFinite(d) || d < 0) {
    throw new InvalidOptionError(`${what} duration must be a finite number >= 0, got ${String(d)}.`);
  }
  return d;
}

function validateOverwrite(overwrite: Overwrite | undefined, what: string): Overwrite {
  const o: unknown = overwrite ?? 'auto';
  if (o !== 'auto' && o !== 'none') {
    throw new InvalidOptionError(`${what} overwrite must be "auto" or "none", got ${String(o)}.`);
  }
  return o;
}

function checkProperty(target: AnimationTarget, name: string, value: unknown, what: string): void {
  const label = name;
  if (!target.hasProperty(name)) {
    throw new InvalidOptionError(`${what}: the target has no animatable property "${label}".`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidOptionError(`${what}: "${name}" must be a finite number, got ${String(value)}.`);
  }
}

/**
 * Shared behaviour of tweens and keyframe animations: start-value capture, interruption and
 * never writing to destroyed targets.
 */
export abstract class PropertyAnimation<P extends string = string> extends Playable implements PropertyAnimationLike {
  readonly target: AnimationTarget<P>;
  readonly overwrite: Overwrite;
  protected readonly properties: readonly P[];
  /** Start value of each property, captured when the animation starts. */
  protected startValues: number[] | null = null;
  protected readonly killed = new Set<P>();
  private readonly ownDuration: number;
  private written: Set<string> | null = null;

  protected constructor(
    target: AnimationTarget<P>,
    properties: readonly P[],
    options: PropertyAnimationOptions,
    what: string,
  ) {
    super(options, what);
    this.target = target;
    this.properties = properties;
    this.ownDuration = validateDuration(options.duration, what);
    this.overwrite = validateOverwrite(options.overwrite, what);
  }

  get duration(): number {
    return this.ownDuration;
  }

  iterationEvents(): readonly IterationEvent[] {
    return [];
  }

  writtenProperties(): ReadonlySet<string> {
    if (!this.written) {
      this.written = new Set();
      for (const p of this.properties) {
        for (const real of this.target.expandProperty?.(p) ?? [p]) this.written.add(real);
      }
    }
    return this.written;
  }

  killOverlapping(properties: ReadonlySet<string>): string[] {
    const stopped: string[] = [];
    for (const p of this.properties) {
      if (this.killed.has(p)) continue;
      const reals = this.target.expandProperty?.(p) ?? [p];
      if (reals.some((r) => properties.has(r))) {
        this.killed.add(p);
        stopped.push(p);
      }
    }
    return stopped;
  }

  /** True when every property was taken over by another animation. */
  get fullyInterrupted(): boolean {
    return this.killed.size === this.properties.length;
  }

  override resetState(): void {
    super.resetState();
    this.startValues = null;
    this.killed.clear();
  }

  protected override onStart(context: RenderContext): void {
    if (!this.target.destroyed) {
      this.startValues = this.properties.map((p) => this.initialValue(p));
    }
    context.propertyAnimationStarted?.(this);
  }

  /** Start value of a property when the animation starts. */
  protected initialValue(property: P): number {
    return this.target.getProperty(property);
  }

  protected renderIteration(time: number): void {
    const start = this.startValues;
    if (!start || this.target.destroyed) return;
    const d = this.duration;
    const progress = d > 0 ? Math.min(1, Math.max(0, time / d)) : 1;
    for (let i = 0; i < this.properties.length; i++) {
      const p = this.properties[i] as P;
      if (this.killed.has(p)) continue;
      this.target.setProperty(p, this.valueAt(i, progress, start[i] ?? 0));
    }
  }

  /** Value of property `index` at linear progress in [0, 1]. */
  protected abstract valueAt(index: number, progress: number, startValue: number): number;
}

/** Animates properties from their start values to end values with one easing. */
export class Tween<P extends string = string> extends PropertyAnimation<P> {
  private readonly endValues: readonly number[];
  private readonly explicitStart: readonly (number | undefined)[];
  private readonly easing: EasingFunction;

  constructor(target: AnimationTarget<P>, vars: TweenVars<P>) {
    assertAnimationTarget(target);
    if (typeof vars !== 'object') throw new InvalidOptionError('tween options must be an object.');
    const properties: P[] = [];
    const endValues: number[] = [];
    for (const [key, value] of Object.entries(vars)) {
      if (TWEEN_OPTION_KEYS.has(key)) continue;
      checkProperty(target, key, value, 'tween');
      properties.push(key as P);
      endValues.push(value as number);
    }
    if (properties.length === 0) {
      throw new InvalidOptionError('tween needs at least one property to animate, for example { x: 100 }.');
    }
    const from: Partial<Record<string, number>> = vars.from ?? {};
    for (const [key, value] of Object.entries(from)) {
      if (!properties.includes(key as P)) {
        throw new InvalidOptionError(`tween from.${key} has no matching end value.`);
      }
      checkProperty(target, key, value, 'tween from');
    }
    super(target, properties, vars, 'tween');
    this.endValues = endValues;
    this.explicitStart = properties.map((p) => from[p]);
    this.easing = resolveEasing(vars.easing);
  }

  protected override initialValue(property: P): number {
    const index = this.properties.indexOf(property);
    return this.explicitStart[index] ?? super.initialValue(property);
  }

  protected valueAt(index: number, progress: number, startValue: number): number {
    const end = this.endValues[index] ?? startValue;
    return startValue + (end - startValue) * this.easing(progress);
  }
}

/** One keyframe: a position in [0, 1] of the duration plus property values reached there. */
export type Keyframe<P extends string> = {
  /** Position within the duration, from 0 to 1. */
  readonly at: number;
  /** Easing used to reach this keyframe from the previous one. Default `linear`. */
  readonly easing?: Easing;
} & Partial<Record<P, number>>;

export interface KeyframeOptions<P extends string> extends PropertyAnimationOptions {
  /** At least one keyframe, in ascending `at` order. */
  readonly keyframes: readonly Keyframe<P>[];
}

interface TrackPoint {
  readonly at: number;
  /** null means "the value when the animation starts". */
  readonly value: number | null;
  readonly easing: EasingFunction;
}

/**
 * Animates properties through keyframes. Each property interpolates between the keyframes
 * that mention it; before its first keyframe it starts from its value at the start.
 */
export class KeyframeAnimation<P extends string = string> extends PropertyAnimation<P> {
  private readonly tracks: readonly (readonly TrackPoint[])[];

  constructor(target: AnimationTarget<P>, options: KeyframeOptions<P>) {
    assertAnimationTarget(target);
    const frames = (options as Partial<KeyframeOptions<P>>).keyframes;
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new InvalidOptionError('keyframes needs a non-empty keyframes array.');
    }
    const trackMap = new Map<P, TrackPoint[]>();
    let previousAt = 0;
    for (const frame of frames as readonly Keyframe<P>[]) {
      const at = frame.at;
      if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 1) {
        throw new InvalidOptionError(`keyframe "at" must be a number within [0, 1], got ${String(at)}.`);
      }
      if (at < previousAt) {
        throw new InvalidOptionError('keyframes must be in ascending "at" order.');
      }
      previousAt = at;
      const easing = resolveEasing(frame.easing);
      for (const [key, value] of Object.entries(frame)) {
        if (key === 'at' || key === 'easing') continue;
        checkProperty(target, key, value, 'keyframe');
        let track = trackMap.get(key as P);
        if (!track) {
          track = [];
          trackMap.set(key as P, track);
        }
        track.push({ at, value: value as number, easing });
      }
    }
    if (trackMap.size === 0) {
      throw new InvalidOptionError('keyframes need at least one property value.');
    }
    const properties = [...trackMap.keys()];
    super(target, properties, options, 'keyframes');
    this.tracks = properties.map((p) => {
      const track = trackMap.get(p) ?? [];
      const first = track[0];
      return first && first.at === 0 ? track : [{ at: 0, value: null, easing: resolveEasing('linear') }, ...track];
    });
  }

  protected valueAt(index: number, progress: number, startValue: number): number {
    const track = this.tracks[index] ?? [];
    let previous = track[0];
    if (!previous) return startValue;
    for (let i = 1; i < track.length; i++) {
      const next = track[i];
      if (!next) break;
      if (progress <= next.at) {
        const a = previous.value ?? startValue;
        const b = next.value ?? startValue;
        const span = next.at - previous.at;
        const local = span > 0 ? (progress - previous.at) / span : 1;
        return a + (b - a) * next.easing(local);
      }
      previous = next;
    }
    return previous.value ?? startValue;
  }
}

/** Creates a tween that is not bound to an engine. Run it with `engine.run(...)`. */
export function tween<P extends string>(target: AnimationTarget<P>, vars: TweenVars<P>): Tween<P> {
  return new Tween(target, vars);
}

/** Creates a keyframe animation that is not bound to an engine. */
export function keyframes<P extends string>(target: AnimationTarget<P>, options: KeyframeOptions<P>): KeyframeAnimation<P> {
  return new KeyframeAnimation(target, options);
}
