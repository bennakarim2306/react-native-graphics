import { InvalidOptionError } from '../runtime/errors';
import type { Playback } from './playback';

/** Options shared by tweens, keyframe animations and timelines. */
export interface PlayableOptions {
  /** Wait before the first iteration, in ms. Default 0. */
  readonly delay?: number;
  /** Extra iterations after the first: 0 plays once, `Infinity` loops forever. Default 0. */
  readonly repeat?: number;
  /** Play every other iteration backwards. Default false. */
  readonly yoyo?: boolean;
}

/** Information passed to marker listeners and timeline callbacks. */
export interface MarkerInfo {
  readonly name: string;
  /** Time of the marker on the playback's own time axis, in ms. */
  readonly time: number;
  /**
   * True when the marker was passed by `finish()` instead of being reached by playback.
   * Listeners can use it to skip expensive visuals while keeping app state consistent.
   */
  readonly skipped: boolean;
}

/** An event inside one iteration of a playable. */
export interface IterationEvent {
  readonly kind: 'marker' | 'call';
  readonly name: string;
  /** Time within one iteration, in ms. */
  readonly time: number;
  readonly callback?: (info: MarkerInfo) => void;
}

/** An event placed on a playback's time axis. */
export interface ScheduledEvent extends IterationEvent {
  readonly order: number;
}

/** Services a playback gives to the animations it renders. */
export interface RenderContext {
  /** Called once when a property animation renders for the first time (its "start"). */
  propertyAnimationStarted?(animation: PropertyAnimationLike): void;
}

/** What the interruption logic needs to know about a property animation. */
export interface PropertyAnimationLike {
  readonly target: object;
  readonly overwrite: 'auto' | 'none';
  /** Real properties written (shorthands expanded). */
  writtenProperties(): ReadonlySet<string>;
  /** Stops writing every property that overlaps `properties`. Returns the ones it stopped. */
  killOverlapping(properties: ReadonlySet<string>): string[];
}

/** Something that can run a playable, usually an engine. */
export interface PlayableRunner {
  run(playable: Playable): Playback;
}

/** Cap on loop iterations scanned for events in one step (only reached with huge time jumps). */
const MAX_EVENT_ITERATIONS = 1000;

export function validatePlayableOptions(options: PlayableOptions, what: string): Required<PlayableOptions> {
  const delay = options.delay ?? 0;
  const repeat = options.repeat ?? 0;
  const yoyo = options.yoyo ?? false;
  if (!Number.isFinite(delay) || delay < 0) {
    throw new InvalidOptionError(`${what} delay must be a finite number >= 0, got ${String(delay)}.`);
  }
  if (!(repeat === Infinity || (Number.isInteger(repeat) && repeat >= 0))) {
    throw new InvalidOptionError(`${what} repeat must be an integer >= 0 or Infinity, got ${String(repeat)}.`);
  }
  if (typeof yoyo !== 'boolean') {
    throw new InvalidOptionError(`${what} yoyo must be a boolean.`);
  }
  return { delay, repeat, yoyo };
}

/**
 * Base class of everything that can be placed on a timeline or played: tweens, keyframe
 * animations, timelines and waits.
 *
 * A playable is a pure function of time: `render(t)` sets its targets to the state at local
 * time `t`. Nothing accumulates between renders, so rendering at any time (forwards,
 * backwards, or jumping) gives the same result as playing up to it.
 *
 * Time layout: `delay`, then `repeat + 1` iterations of `duration` each.
 */
export abstract class Playable {
  readonly delay: number;
  readonly repeat: number;
  readonly yoyo: boolean;
  /** @internal Timeline this playable was added to. */
  parent: Playable | null = null;
  /** @internal Engine (or other runner) that `play()` uses. */
  runner: PlayableRunner | null = null;
  /** @internal Set once the playable is added to a timeline or played. */
  locked = false;
  /** @internal Playback currently running this playable as its root. */
  activePlayback: Playback | null = null;
  protected started = false;

  protected constructor(options: PlayableOptions, what: string) {
    const resolved = validatePlayableOptions(options, what);
    this.delay = resolved.delay;
    this.repeat = resolved.repeat;
    this.yoyo = resolved.yoyo;
  }

  /** Length of one iteration in ms. */
  abstract get duration(): number;

  /** Delay plus all iterations, in ms. `Infinity` when it repeats forever. */
  get totalDuration(): number {
    const d = this.duration;
    if (d === 0) return this.delay;
    return this.delay + d * (this.repeat + 1);
  }

  /** Renders one iteration at `time` in [0, duration]. */
  protected abstract renderIteration(time: number, context: RenderContext): void;

  /** Events within one iteration, sorted by time. */
  abstract iterationEvents(): readonly IterationEvent[];

  /** Called the first time the playable renders past its delay. */
  protected onStart?(context: RenderContext): void;

  /** @internal Forgets captured start values so the playable can run again. */
  resetState(): void {
    this.started = false;
  }

  /** Starts this playable on the engine that created it. */
  play(): Playback {
    if (this.parent) {
      throw new InvalidOptionError('This animation is part of a timeline. Play the timeline instead.');
    }
    if (!this.runner) {
      throw new InvalidOptionError('This animation was created without an engine. Use engine.run(animation).');
    }
    return this.runner.run(this);
  }

  /**
   * Renders the state at local time `time` (clamped by the caller to [0, totalDuration]).
   * At an exact iteration boundary the next iteration's start is shown, unless `atEnd` asks
   * for the end of the iteration that just finished (used when finishing endless loops).
   */
  render(time: number, context: RenderContext, atEnd = false): void {
    if (time < this.delay) {
      // Before the start: show the initial state, but only once start values were captured.
      if (this.started) this.renderIteration(0, context);
      return;
    }
    if (!this.started) {
      this.started = true;
      this.onStart?.(context);
    }
    const d = this.duration;
    if (d === 0) {
      this.renderIteration(0, context);
      return;
    }
    const rel = time - this.delay;
    let k: number;
    let u: number;
    if (rel >= d * (this.repeat + 1)) {
      k = this.repeat;
      u = d;
    } else {
      k = Math.floor(rel / d);
      u = rel - k * d;
      if (atEnd && u === 0 && k > 0) {
        k -= 1;
        u = d;
      }
    }
    this.renderIteration(this.yoyo && k % 2 === 1 ? d - u : u, context);
  }

  /** Zero-based iteration at local time `time`. */
  iterationAt(time: number): number {
    const d = this.duration;
    if (time < this.delay || d === 0) return 0;
    return Math.min(this.repeat, Math.floor((time - this.delay) / d));
  }

  /**
   * Adds the events in the local interval (from, to] (or [from, to] when `includeFrom`) to
   * `out`, shifted by `offset`.
   */
  collectEvents(from: number, to: number, includeFrom: boolean, out: ScheduledEvent[], offset: number): void {
    const events = this.iterationEvents();
    if (events.length === 0 || to < this.delay) return;
    const d = this.duration;
    const inRange = (t: number) => (t > from || (includeFrom && t === from)) && t <= to;
    if (d === 0) {
      for (const event of events) {
        const t = this.delay + event.time;
        if (inRange(t)) out.push({ ...event, time: offset + t, order: out.length });
      }
      return;
    }
    const kLast = Math.min(this.repeat, Math.floor((to - this.delay) / d));
    const kFirst = Math.max(0, Math.floor((from - this.delay) / d), kLast - MAX_EVENT_ITERATIONS);
    for (let k = kFirst; k <= kLast; k++) {
      const base = this.delay + k * d;
      const reversed = this.yoyo && k % 2 === 1;
      const ordered = reversed ? [...events].reverse() : events;
      for (const event of ordered) {
        const t = base + (reversed ? d - event.time : event.time);
        if (inRange(t)) out.push({ ...event, time: offset + t, order: out.length });
      }
    }
  }
}

/** A playable that does nothing for a while. Useful as a spacer in timelines. */
export class Wait extends Playable {
  private readonly ms: number;

  constructor(ms: number) {
    super({}, 'wait');
    if (!Number.isFinite(ms) || ms < 0) {
      throw new InvalidOptionError(`wait duration must be a finite number >= 0, got ${String(ms)}.`);
    }
    this.ms = ms;
  }

  get duration(): number {
    return this.ms;
  }

  protected renderIteration(): void {
    // Nothing to draw.
  }

  iterationEvents(): readonly IterationEvent[] {
    return [];
  }
}

/** Creates a playable that waits `ms` milliseconds. */
export function wait(ms: number): Wait {
  return new Wait(ms);
}
