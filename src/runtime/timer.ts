import { InvalidOptionError } from './errors';

/**
 * Maps an outside time (engine or clock time) to a local time that can be paused, resumed,
 * moved and sped up. Used by effect handles, animation playbacks and the engine itself, so
 * every pausable thing measures time the same way and never accumulates per-frame deltas.
 *
 * Local time is `base + (now - anchor) * rate`; changing the rate re-anchors at the current
 * time so the local time stays continuous.
 */
export class LocalTimer {
  private anchor: number;
  private base: number;
  private pausedAt: number | null = null;
  private currentRate = 1;

  constructor(now: number, localStart = 0) {
    this.anchor = now;
    this.base = localStart;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Local milliseconds per outside millisecond. Default 1. */
  get rate(): number {
    return this.currentRate;
  }

  /** Local time at outside time `now`. Frozen while paused. */
  local(now: number): number {
    return this.base + ((this.pausedAt ?? now) - this.anchor) * this.currentRate;
  }

  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.anchor += now - this.pausedAt;
    this.pausedAt = null;
  }

  /** Makes the local time equal `localTime` at outside time `now`, keeping the paused state. */
  seek(now: number, localTime: number): void {
    this.anchor = this.pausedAt ?? now;
    this.base = localTime;
  }

  /** Changes the speed from outside time `now` on. 0 freezes time without pausing. */
  setRate(now: number, rate: number): void {
    if (!Number.isFinite(rate) || rate < 0) {
      throw new InvalidOptionError(`speed must be a finite number >= 0, got ${String(rate)}.`);
    }
    const at = this.pausedAt ?? now;
    this.base = this.local(now);
    this.anchor = at;
    this.currentRate = rate;
  }
}
