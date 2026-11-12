/**
 * Maps an outside time (engine or clock time) to a local time that can be paused, resumed
 * and moved. Used by effect handles, animation playbacks and the engine itself, so every
 * pausable thing measures time the same way and never accumulates per-frame deltas.
 */
export class LocalTimer {
  private origin: number;
  private pausedAt: number | null = null;

  constructor(now: number, localStart = 0) {
    this.origin = now - localStart;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Local time at outside time `now`. Frozen while paused. */
  local(now: number): number {
    return (this.pausedAt ?? now) - this.origin;
  }

  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.origin += now - this.pausedAt;
    this.pausedAt = null;
  }

  /** Makes the local time equal `localTime` at outside time `now`, keeping the paused state. */
  seek(now: number, localTime: number): void {
    this.origin = (this.pausedAt ?? now) - localTime;
  }
}
