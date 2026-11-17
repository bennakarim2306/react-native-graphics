import { Playable } from '../animation/playable';
import type { IterationEvent, MarkerInfo } from '../animation/playable';
import type { PlaybackResult } from '../animation/playback';
import { InvalidOptionError } from '../runtime/errors';
import type { EffectDefinition } from '../runtime/effect';
import type { EffectHandle, PlayOptions } from './engine';

/** Parameters of a cued effect, or a function that computes them when the cue fires. */
export type CueParams<Params> = Params | ((info: MarkerInfo) => Params);

export interface CueOptions extends PlayOptions {
  /**
   * How long the cue occupies on the timeline, in ms, so later items can wait for the effect.
   * Default 0 (the timeline continues immediately).
   */
  readonly hold?: number;
  /** Keep the effects running when the playback is cancelled or stopped. Default false. */
  readonly detached?: boolean;
  /** Also play the effect when `finish()` skips over the cue. Default false. */
  readonly playWhenSkipped?: boolean;
}

/** What a cue needs from the engine. */
export interface CueHost {
  play<Params>(effect: EffectDefinition<Params> | string, params: Params, options?: PlayOptions): EffectHandle;
}

/**
 * A timeline item that starts an effect at an exact moment of the timeline (for example the
 * `impact` marker of a throw). It fires through the playback's event dispatch, so it is
 * synchronized with the animated state, not with a JavaScript timer.
 */
export class EffectCue<Params> extends Playable {
  private readonly holdMs: number;
  private readonly spawned: EffectHandle[] = [];
  private readonly events: readonly IterationEvent[];
  private readonly listeners = new Set<(handle: EffectHandle) => void>();

  constructor(
    private readonly host: CueHost,
    readonly effect: EffectDefinition<Params> | string,
    private readonly params: CueParams<Params>,
    private readonly options: CueOptions = {},
  ) {
    super({}, 'cue');
    this.holdMs = options.hold ?? 0;
    if (!Number.isFinite(this.holdMs) || this.holdMs < 0) throw new InvalidOptionError('cue hold must be a finite number >= 0.');
    const name = typeof effect === 'string' ? effect : effect.name;
    this.events = [{ kind: 'call', name: `cue:${name}`, time: 0, callback: (info) => { this.fire(info); } }];
  }

  get duration(): number {
    return this.holdMs;
  }

  /** Effects started by this cue that are still running. */
  get handles(): readonly EffectHandle[] {
    return this.spawned.filter((h) => h.status === 'playing' || h.status === 'paused');
  }

  /** Calls `listener` with the handle each time the cue starts its effect. */
  onFire(listener: (handle: EffectHandle) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  iterationEvents(): readonly IterationEvent[] {
    return this.events;
  }

  protected renderIteration(): void {
    // A cue draws nothing itself.
  }

  protected override onPlaybackEnd(result: PlaybackResult): void {
    if (result.status === 'completed' || this.options.detached) return;
    for (const handle of this.spawned.splice(0)) handle.cancel();
  }

  private fire(info: MarkerInfo): void {
    if (info.skipped && !this.options.playWhenSkipped) return;
    const params = typeof this.params === 'function' ? (this.params as (i: MarkerInfo) => Params)(info) : this.params;
    const o = this.options;
    const playOptions: PlayOptions = {
      ...(o.seed !== undefined ? { seed: o.seed } : {}),
      ...(o.zIndex !== undefined ? { zIndex: o.zIndex } : {}),
      ...(o.key !== undefined ? { key: o.key } : {}),
      ...(o.quality !== undefined ? { quality: o.quality } : {}),
    };
    const handle = this.host.play(this.effect, params, playOptions);
    this.spawned.push(handle);
    void handle.finished.then(() => {
      const index = this.spawned.indexOf(handle);
      if (index >= 0) this.spawned.splice(index, 1);
    });
    for (const listener of this.listeners) listener(handle);
  }
}
