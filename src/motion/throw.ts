import { Playable } from '../animation/playable';
import type { IterationEvent, PlayableOptions } from '../animation/playable';
import type { PlaybackResult } from '../animation/playback';
import type { AnimationTarget } from '../animation/target';
import { InvalidOptionError } from '../runtime/errors';
import type { Point } from '../scene/matrix';

/** Something a throw can move: needs numeric `x`, `y` and `rotation`. */
export type ThrowTarget = AnimationTarget;

export interface ThrowOptions extends PlayableOptions {
  /** Height of the peak above the start, in points (> 0). Default 200. */
  readonly height?: number;
  /** Horizontal distance travelled until impact (negative = to the left). Default 0. */
  readonly distance?: number;
  /** How far below the start the object lands (negative = above). Default 0. */
  readonly drop?: number;
  /** Time from launch to impact in ms. Default 1000. Ignored when `gravity` is given. */
  readonly duration?: number;
  /** Gravity in points per second squared; when set, it decides the duration instead. */
  readonly gravity?: number;
  /** Degrees turned during the flight. Default 360. */
  readonly rotation?: number;
  /**
   * When the playback is cancelled or stopped, put the target back where it started. Default
   * true, so an interrupted throw never leaves a view floating mid-air.
   */
  readonly restoreOnCancel?: boolean;
}

/**
 * An analytical ballistic throw: constant horizontal speed, vertical motion under constant
 * gravity (`y = y0 - v0·t + g·t²/2`), linear rotation. Up and down are one parabola, so the
 * object slows to a stop at the peak and accelerates as it falls. It is a pure function of
 * time like every playable (seekable, frame-rate independent) and carries three markers:
 * `launch` (0), `peak` and `impact` (the end).
 */
export class ThrowMotion extends Playable {
  readonly height: number;
  readonly distance: number;
  readonly drop: number;
  readonly turn: number;
  /** Gravity in points per second squared. */
  readonly gravity: number;
  /** Time of the peak in ms. */
  readonly peakTime: number;
  private readonly total: number;
  private readonly launchSpeed: number;
  private readonly restore: boolean;
  private readonly events: readonly IterationEvent[];
  private start = { x: 0, y: 0, rotation: 0 };

  constructor(
    readonly target: ThrowTarget,
    options: ThrowOptions = {},
  ) {
    super(options, 'throw');
    for (const name of ['x', 'y', 'rotation']) {
      const label: string = name;
      if (!target.hasProperty(name)) throw new InvalidOptionError(`A throw target needs a numeric "${label}" property.`);
    }
    const finite = (value: number, name: string) => {
      if (!Number.isFinite(value)) throw new InvalidOptionError(`throw ${name} must be a finite number.`);
      return value;
    };
    this.height = finite(options.height ?? 200, 'height');
    if (this.height <= 0) throw new InvalidOptionError('throw height must be > 0.');
    this.distance = finite(options.distance ?? 0, 'distance');
    this.drop = finite(options.drop ?? 0, 'drop');
    if (this.height + this.drop < 0) throw new InvalidOptionError('throw drop must not be above the peak (height + drop >= 0).');
    this.turn = finite(options.rotation ?? 360, 'rotation');
    this.restore = options.restoreOnCancel ?? true;
    const up = Math.sqrt(2 * this.height);
    const down = Math.sqrt(2 * (this.height + this.drop));
    if (options.gravity !== undefined) {
      const g = finite(options.gravity, 'gravity');
      if (g <= 0) throw new InvalidOptionError('throw gravity must be > 0.');
      this.gravity = g;
      this.total = ((up + down) / Math.sqrt(g)) * 1000;
    } else {
      const duration = finite(options.duration ?? 1000, 'duration');
      if (duration <= 0) throw new InvalidOptionError('throw duration must be > 0.');
      this.total = duration;
      const seconds = duration / 1000;
      this.gravity = ((up + down) / seconds) ** 2;
    }
    this.peakTime = (up / Math.sqrt(this.gravity)) * 1000;
    this.launchSpeed = this.gravity * (this.peakTime / 1000);
    this.events = [
      { kind: 'marker', name: 'launch', time: 0 },
      { kind: 'marker', name: 'peak', time: this.peakTime },
      { kind: 'marker', name: 'impact', time: this.total },
    ];
  }

  get duration(): number {
    return this.total;
  }

  /** Offset from the start at local time `ms` (before any target is involved). */
  offsetAt(ms: number): Point & { rotation: number } {
    const t = Math.min(Math.max(ms, 0), this.total) / 1000;
    const k = this.total > 0 ? Math.min(1, Math.max(0, ms / this.total)) : 1;
    return {
      x: this.distance * k,
      y: -(this.launchSpeed * t - 0.5 * this.gravity * t * t),
      rotation: this.turn * k,
    };
  }

  /** Where the target lands, relative to where it started. */
  get landingOffset(): Point {
    return { x: this.distance, y: this.drop };
  }

  iterationEvents(): readonly IterationEvent[] {
    return this.events;
  }

  protected override onStart(): void {
    this.start = {
      x: this.target.getProperty('x'),
      y: this.target.getProperty('y'),
      rotation: this.target.getProperty('rotation'),
    };
  }

  protected renderIteration(time: number): void {
    if (this.target.destroyed) return;
    const o = this.offsetAt(time);
    this.target.setProperty('x', this.start.x + o.x);
    this.target.setProperty('y', this.start.y + o.y);
    this.target.setProperty('rotation', this.start.rotation + o.rotation);
  }

  protected override onPlaybackEnd(result: PlaybackResult): void {
    if (result.status === 'cancelled' && this.restore && this.started && !this.target.destroyed) {
      this.target.setProperty('x', this.start.x);
      this.target.setProperty('y', this.start.y);
      this.target.setProperty('rotation', this.start.rotation);
    }
  }
}
