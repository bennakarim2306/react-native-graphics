import { assertFiniteNonNegative } from './errors';
import type { Unsubscribe } from './emitter';

/**
 * Source of time and frames for the engine. Times are in milliseconds and must never decrease.
 *
 * The engine only reads absolute times from a clock and never accumulates per-frame deltas,
 * so dropped or irregular frames cannot cause drift.
 */
export interface Clock {
  now(): number;
  /** Calls `onFrame` once per frame with the frame time. */
  subscribe(onFrame: (time: number) => void): Unsubscribe;
}

/**
 * Deterministic clock for tests and simulations. Time only moves when `advance` or `setTime`
 * is called, and each call delivers frames to subscribers synchronously.
 */
export class VirtualClock implements Clock {
  private time: number;
  private readonly subscribers = new Set<(time: number) => void>();

  constructor(startTime = 0) {
    assertFiniteNonNegative(startTime, 'startTime');
    this.time = startTime;
  }

  now(): number {
    return this.time;
  }

  subscribe(onFrame: (time: number) => void): Unsubscribe {
    this.subscribers.add(onFrame);
    return () => {
      this.subscribers.delete(onFrame);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Moves time forward by `ms`. With `frameMs`, frames are delivered every `frameMs`
   * (the last one landing exactly on the target time). Without it, one frame is delivered.
   */
  advance(ms: number, options: { frameMs?: number } = {}): void {
    assertFiniteNonNegative(ms, 'ms');
    const target = this.time + ms;
    const step = options.frameMs;
    if (step !== undefined) {
      if (!Number.isFinite(step) || step <= 0) {
        throw new RangeError(`frameMs must be a finite number > 0, got ${String(step)}.`);
      }
      while (this.time + step < target) {
        this.time += step;
        this.emitFrame();
      }
    }
    this.time = target;
    this.emitFrame();
  }

  /** Jumps to an absolute time (not earlier than now) and delivers one frame. */
  setTime(time: number): void {
    if (!Number.isFinite(time) || time < this.time) {
      throw new RangeError(`time must be finite and >= ${String(this.time)}, got ${String(time)}.`);
    }
    this.time = time;
    this.emitFrame();
  }

  /** Delivers a frame at the current time without moving time. */
  tick(): void {
    this.emitFrame();
  }

  private emitFrame(): void {
    for (const subscriber of [...this.subscribers]) {
      if (this.subscribers.has(subscriber)) subscriber(this.time);
    }
  }
}

export interface FrameSchedulerFunctions {
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

/**
 * Clock driven by a frame scheduler such as `requestAnimationFrame`. The functions are
 * injected so this module has no dependency on a particular platform. Frames are only
 * requested while there is at least one subscriber.
 */
export class FrameClock implements Clock {
  private readonly subscribers = new Set<(time: number) => void>();
  private handle: number | null = null;

  constructor(private readonly fns: FrameSchedulerFunctions) {}

  now(): number {
    return this.fns.now();
  }

  subscribe(onFrame: (time: number) => void): Unsubscribe {
    this.subscribers.add(onFrame);
    this.ensureRunning();
    return () => {
      this.subscribers.delete(onFrame);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  private ensureRunning(): void {
    if (this.handle !== null) return;
    this.handle = this.fns.requestFrame(this.onFrame);
  }

  private stop(): void {
    if (this.handle === null) return;
    this.fns.cancelFrame(this.handle);
    this.handle = null;
  }

  private readonly onFrame = (): void => {
    this.handle = null;
    const time = this.fns.now();
    for (const subscriber of [...this.subscribers]) {
      if (this.subscribers.has(subscriber)) subscriber(time);
    }
    if (this.subscribers.size > 0) this.ensureRunning();
  };
}
