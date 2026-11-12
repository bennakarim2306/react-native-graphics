import { Emitter } from '../runtime/emitter';
import type { ErrorReporter, Unsubscribe } from '../runtime/emitter';
import { InvalidOptionError } from '../runtime/errors';
import { LocalTimer } from '../runtime/timer';
import type { MarkerInfo, Playable, PropertyAnimationLike, RenderContext, ScheduledEvent } from './playable';

export type PlaybackStatus = 'playing' | 'paused' | 'completed' | 'cancelled' | 'stopped';

export interface PlaybackResult {
  /**
   * - `completed`: reached the end (or `finish()` was called)
   * - `cancelled`: stopped where it was; animated values keep their current state
   * - `stopped`: returned to the initial state with `stop()` or `engine.reset()`
   */
  readonly status: 'completed' | 'cancelled' | 'stopped';
  readonly reason?: 'user' | 'cancelAll' | 'reset' | 'disposed';
}

export interface MarkerEvent extends MarkerInfo {
  readonly playback: Playback;
}

export interface PlaybackEvents {
  start: { readonly playback: Playback };
  pause: { readonly playback: Playback };
  resume: { readonly playback: Playback };
  marker: MarkerEvent;
  loop: { readonly playback: Playback; readonly iteration: number };
  /** Another animation took over some properties of one of this playback's animations. */
  interrupted: { readonly playback: Playback; readonly target: object; readonly properties: readonly string[] };
  end: { readonly playback: Playback; readonly result: PlaybackResult };
}

/** Controls one running playable (tween, keyframes or timeline). */
export interface Playback {
  readonly id: number;
  readonly status: PlaybackStatus;
  /** Current time on the playback's own axis, in ms (excludes paused time). */
  readonly time: number;
  /** Total length in ms; `Infinity` for endless loops. */
  readonly duration: number;
  /** Resolves when the playback ends. Never rejects. */
  readonly finished: Promise<PlaybackResult>;
  /**
   * Playback rate: 1 is normal, 2 twice as fast, 0.5 half speed, 0 frozen (still "playing").
   * Changes take effect from the current time on, without jumps. Default 1.
   */
  speed: number;
  /** Freezes the playback. When called from a marker listener it freezes exactly at the marker. */
  pause(): void;
  resume(): void;
  /** Ends the playback where it is. Values keep their current state. Idempotent. */
  cancel(): void;
  /** Ends the playback and returns everything to its initial state. Idempotent. */
  stop(): void;
  /**
   * Jumps to the end and completes. Markers and callbacks that were skipped over are still
   * delivered, with `skipped: true`, so app logic tied to them stays consistent. An endless
   * loop finishes at the end of its current iteration.
   */
  finish(): void;
  /** Moves to `time` (ms) without emitting markers. Works while playing or paused. */
  seek(time: number): void;
  on<K extends keyof PlaybackEvents>(type: K, listener: (event: PlaybackEvents[K]) => void): Unsubscribe;
  /** Listens to one marker by name. */
  onMarker(name: string, listener: (event: MarkerEvent) => void): Unsubscribe;
}

/** What a playback needs from the engine running it. */
export interface PlaybackHost {
  /** Current engine time in ms. */
  now(): number;
  readonly reportError: ErrorReporter;
  propertyAnimationStarted(playback: PlaybackImpl, animation: PropertyAnimationLike): void;
  statusChanged(playback: PlaybackImpl): void;
  ended(playback: PlaybackImpl, result: PlaybackResult): void;
}

/** @internal Engine-side implementation of `Playback`. */
export class PlaybackImpl implements Playback {
  private currentStatus: PlaybackStatus = 'playing';
  private readonly timer: LocalTimer;
  private readonly emitter: Emitter<PlaybackEvents>;
  private readonly markerEmitter: Emitter<Record<string, MarkerEvent>>;
  private lastTime: number | null = null;
  private iteration = 0;
  /** Changes on every seek, pause and end, so an event loop can tell it was interrupted. */
  private generation = 0;
  private dispatchTime: number | null = null;
  private resolveFinished!: (result: PlaybackResult) => void;
  readonly finished: Promise<PlaybackResult>;
  readonly context: RenderContext;

  constructor(
    readonly id: number,
    readonly root: Playable,
    private readonly host: PlaybackHost,
  ) {
    this.timer = new LocalTimer(host.now());
    this.emitter = new Emitter<PlaybackEvents>(host.reportError);
    this.markerEmitter = new Emitter<Record<string, MarkerEvent>>(host.reportError);
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    this.context = {
      propertyAnimationStarted: (animation) => {
        host.propertyAnimationStarted(this, animation);
      },
    };
  }

  get status(): PlaybackStatus {
    return this.currentStatus;
  }

  get time(): number {
    return this.lastTime ?? 0;
  }

  get duration(): number {
    return this.root.totalDuration;
  }

  get speed(): number {
    return this.timer.rate;
  }

  set speed(value: number) {
    this.timer.setRate(this.host.now(), value);
  }

  get isActive(): boolean {
    return this.currentStatus === 'playing' || this.currentStatus === 'paused';
  }

  /** Emits `start` and renders the initial state. Markers at time 0 fire on the first frame. */
  begin(): void {
    const generation = this.generation;
    this.emitter.emit('start', { playback: this });
    if (this.interruptedSince(generation)) return;
    this.renderAt(0);
    // Time 0 has been shown but not "passed": markers at 0 fire on the first frame.
    this.lastTime = null;
  }

  /** Advances to the current engine time. */
  tick(): void {
    if (this.currentStatus !== 'playing') return;
    this.advanceTo(this.clamp(this.timer.local(this.host.now())), false);
  }

  pause(): void {
    if (this.currentStatus !== 'playing') return;
    const now = this.host.now();
    if (this.dispatchTime !== null) {
      this.timer.seek(now, this.dispatchTime);
      this.lastTime = this.dispatchTime;
    }
    this.timer.pause(now);
    this.currentStatus = 'paused';
    this.generation++;
    this.emitter.emit('pause', { playback: this });
    this.host.statusChanged(this);
  }

  resume(): void {
    if (this.currentStatus !== 'paused') return;
    this.timer.resume(this.host.now());
    this.currentStatus = 'playing';
    this.emitter.emit('resume', { playback: this });
    this.host.statusChanged(this);
  }

  cancel(): void {
    this.cancelWith('user');
  }

  /** @internal */
  cancelWith(reason: NonNullable<PlaybackResult['reason']>): void {
    if (!this.isActive) return;
    this.end({ status: 'cancelled', reason });
  }

  stop(): void {
    this.stopWith('user');
  }

  /** @internal */
  stopWith(reason: NonNullable<PlaybackResult['reason']>): void {
    if (!this.isActive) return;
    this.generation++;
    this.renderAt(0);
    this.end({ status: 'stopped', reason });
  }

  finish(): void {
    if (!this.isActive) return;
    let target = this.root.totalDuration;
    if (!Number.isFinite(target)) {
      const d = this.root.duration;
      target = this.root.delay + (this.root.iterationAt(this.time) + 1) * d;
    }
    const generation = this.generation;
    this.advanceTo(target, true);
    if (!this.interruptedSince(generation)) this.complete();
  }

  seek(time: number): void {
    if (!this.isActive) return;
    if (!Number.isFinite(time) || time < 0) {
      throw new InvalidOptionError(`seek time must be a finite number >= 0, got ${String(time)}.`);
    }
    const t = this.clamp(time);
    this.generation++;
    this.timer.seek(this.host.now(), t);
    this.renderAt(t);
    this.iteration = this.root.iterationAt(t);
    this.host.statusChanged(this);
  }

  on<K extends keyof PlaybackEvents>(type: K, listener: (event: PlaybackEvents[K]) => void): Unsubscribe {
    return this.emitter.on(type, listener);
  }

  onMarker(name: string, listener: (event: MarkerEvent) => void): Unsubscribe {
    return this.markerEmitter.on(name, listener);
  }

  /** @internal Called by the engine when another animation took over properties. */
  notifyInterrupted(target: object, properties: readonly string[]): void {
    this.emitter.emit('interrupted', { playback: this, target, properties });
  }

  /** True when the playback ended, paused or seeked since `generation` was read. */
  private interruptedSince(generation: number): boolean {
    return generation !== this.generation || !this.isActive;
  }

  private clamp(time: number): number {
    return Math.max(0, Math.min(time, this.root.totalDuration));
  }

  private renderAt(time: number, atEnd = false): void {
    try {
      this.root.render(time, this.context, atEnd);
    } catch (error) {
      this.host.reportError(error);
      this.cancelWith('user');
      return;
    }
    this.lastTime = time;
  }

  /**
   * Moves from the last rendered time to `time`. Each event in between is delivered after
   * rendering the exact state at its time, so an `impact` marker sees objects at the impact
   * position even if the frame lands later.
   */
  private advanceTo(time: number, skipped: boolean): void {
    const from = this.lastTime ?? 0;
    const includeFrom = this.lastTime === null;
    const events: ScheduledEvent[] = [];
    if (time >= from) this.root.collectEvents(from, time, includeFrom, events, 0);
    events.sort((a, b) => a.time - b.time || a.order - b.order);

    const generation = this.generation;
    for (const event of events) {
      this.renderAt(event.time);
      if (this.interruptedSince(generation)) return;
      this.dispatchTime = event.time;
      this.dispatch(event, skipped);
      this.dispatchTime = null;
      if (this.interruptedSince(generation)) return;
    }
    this.renderAt(time, skipped);
    if (this.interruptedSince(generation)) return;

    const iteration = this.root.iterationAt(time);
    if (!skipped && iteration > this.iteration) {
      this.iteration = iteration;
      this.emitter.emit('loop', { playback: this, iteration });
      if (this.interruptedSince(generation)) return;
    }
    if (!skipped && time >= this.root.totalDuration) this.complete();
  }

  private dispatch(event: ScheduledEvent, skipped: boolean): void {
    const info: MarkerEvent = { name: event.name, time: event.time, skipped, playback: this };
    if (event.kind === 'call') {
      try {
        event.callback?.(info);
      } catch (error) {
        this.host.reportError(error);
      }
      return;
    }
    this.emitter.emit('marker', info);
    this.markerEmitter.emit(event.name, info);
  }

  private complete(): void {
    this.end({ status: 'completed' });
  }

  private end(result: PlaybackResult): void {
    this.currentStatus = result.status;
    this.generation++;
    this.dispatchTime = null;
    this.host.ended(this, result);
    this.resolveFinished(result);
    this.emitter.emit('end', { playback: this, result });
    this.emitter.clear();
    this.markerEmitter.clear();
  }
}
