import { InvalidOptionError } from '../runtime/errors';
import { Playable, Wait } from './playable';
import type { IterationEvent, MarkerInfo, PlayableOptions, RenderContext, ScheduledEvent } from './playable';
import type { PlaybackResult } from './playback';

/**
 * Where to place something on a timeline:
 * - a number: absolute time in ms from the timeline start
 * - `'>'` (default): at the current end, so items play one after another
 * - `'<'`: at the start of the previously added item, so it plays in parallel with it
 * - `'+=200'` / `'-=200'`: relative to the current end
 * - `'impact'`, `'impact+=50'`, `'impact-=50'`: relative to a marker added with `mark`
 */
export type TimelinePosition = number | string;

interface Entry {
  readonly seq: number;
  readonly playable: Playable;
  readonly start: number;
  /** Local time the child was last rendered at; NaN before its first render. */
  lastLocal: number;
}

interface MarkerEntry {
  readonly seq: number;
  readonly kind: 'marker' | 'call';
  readonly name: string;
  readonly time: number;
  readonly callback?: (info: MarkerInfo) => void;
}

const RELATIVE = /^([+-])=(\d+(?:\.\d+)?)$/;
const MARKER_RELATIVE = /^(.+?)([+-])=(\d+(?:\.\d+)?)$/;

/**
 * Places playables on one time axis. Children run sequentially by default; positions make
 * them overlap. Markers name moments (for example `impact`) that playbacks report as events
 * at exactly that time, after rendering the state of that moment.
 *
 * A timeline can be edited until it is played or added to another timeline.
 */
export class Timeline extends Playable {
  private readonly entries: Entry[] = [];
  private readonly markerEntries: MarkerEntry[] = [];
  private end = 0;
  private previousStart = 0;
  private eventsCache: IterationEvent[] | null = null;
  private seq = 0;

  constructor(options: PlayableOptions = {}) {
    super(options, 'timeline');
  }

  get duration(): number {
    return this.end;
  }

  /** Children in start order. */
  get children(): readonly Playable[] {
    return this.entries.map((entry) => entry.playable);
  }

  /** Time of a marker added with `mark`, or undefined. */
  markerTime(name: string): number | undefined {
    return this.markerEntries.find((m) => m.kind === 'marker' && m.name === name)?.time;
  }

  /** Adds a playable at `position` (default: after everything added so far). */
  add(playable: Playable, position: TimelinePosition = '>'): this {
    this.assertEditable();
    if (!(playable instanceof Playable)) {
      throw new InvalidOptionError('timeline.add expects a tween, keyframe animation, timeline or wait.');
    }
    if (playable === this) throw new InvalidOptionError('A timeline cannot contain itself.');
    if (playable.parent || playable.locked) {
      throw new InvalidOptionError('This animation is already in a timeline or has been played. Create a new one.');
    }
    if (!Number.isFinite(playable.totalDuration)) {
      throw new InvalidOptionError('An infinitely repeating animation cannot be placed inside a timeline. Repeat the timeline instead.');
    }
    const start = this.resolve(position);
    playable.parent = this;
    playable.locked = true;
    const entry: Entry = { seq: this.seq++, playable, start, lastLocal: Number.NaN };
    // Keep entries sorted by start; equal starts keep insertion order.
    let index = this.entries.length;
    while (index > 0 && (this.entries[index - 1]?.start ?? 0) > start) index--;
    this.entries.splice(index, 0, entry);
    this.previousStart = start;
    this.end = Math.max(this.end, start + playable.totalDuration);
    this.eventsCache = null;
    return this;
  }

  /** Adds a named marker. Playbacks emit a `marker` event when they reach it. */
  mark(name: string, position: TimelinePosition = '>'): this {
    this.assertEditable();
    if (typeof name !== 'string' || name.length === 0 || /[+-]=/.test(name) || name === '<' || name === '>') {
      throw new InvalidOptionError(`Invalid marker name "${name}".`);
    }
    const time = this.resolve(position);
    this.markerEntries.push({ seq: this.seq++, kind: 'marker', name, time });
    this.end = Math.max(this.end, time);
    this.eventsCache = null;
    return this;
  }

  /** Calls `callback` when playback reaches `position`. */
  call(callback: (info: MarkerInfo) => void, position: TimelinePosition = '>'): this {
    this.assertEditable();
    if (typeof callback !== 'function') throw new InvalidOptionError('timeline.call expects a function.');
    const time = this.resolve(position);
    this.markerEntries.push({ seq: this.seq++, kind: 'call', name: 'call', time, callback });
    this.end = Math.max(this.end, time);
    this.eventsCache = null;
    return this;
  }

  iterationEvents(): readonly IterationEvent[] {
    if (this.eventsCache) return this.eventsCache;
    // Events at the same time keep the order in which they were added to the timeline.
    const out: ScheduledEvent[] = [];
    const sources: (Entry | MarkerEntry)[] = [...this.entries, ...this.markerEntries].sort((a, b) => a.seq - b.seq);
    for (const source of sources) {
      if ('playable' in source) {
        source.playable.collectEvents(0, source.playable.totalDuration, true, out, source.start);
      } else {
        const { kind, name, time, callback } = source;
        out.push(callback ? { kind, name, time, callback, order: out.length } : { kind, name, time, order: out.length });
      }
    }
    out.sort((a, b) => a.time - b.time || a.order - b.order);
    this.eventsCache = out.map(({ kind, name, time, callback }) =>
      callback ? { kind, name, time, callback } : { kind, name, time },
    );
    return this.eventsCache;
  }

  override notifyPlaybackEnd(result: PlaybackResult): void {
    super.notifyPlaybackEnd(result);
    for (const entry of this.entries) entry.playable.notifyPlaybackEnd(result);
  }

  override resetState(): void {
    super.resetState();
    for (const entry of this.entries) {
      entry.lastLocal = Number.NaN;
      entry.playable.resetState();
    }
  }

  protected renderIteration(time: number, context: RenderContext): void {
    // Children that are now in the future but were rendered before (seeking or looping
    // backwards) return to their initial state, latest first so the earliest wins.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (!entry || time >= entry.start || Number.isNaN(entry.lastLocal) || entry.lastLocal === 0) continue;
      entry.playable.render(0, context);
      entry.lastLocal = 0;
    }
    // Started children render in start order, so later ones win on shared properties.
    for (const entry of this.entries) {
      if (time < entry.start) continue;
      const local = Math.min(time - entry.start, entry.playable.totalDuration);
      if (local === entry.lastLocal) continue;
      entry.playable.render(local, context);
      entry.lastLocal = local;
    }
  }

  private assertEditable(): void {
    if (this.locked) {
      throw new InvalidOptionError('This timeline has been played or added to another timeline and can no longer be changed.');
    }
  }

  private resolve(position: TimelinePosition): number {
    let time: number;
    if (typeof position === 'number') {
      time = position;
    } else if (position === '>') {
      time = this.end;
    } else if (position === '<') {
      time = this.previousStart;
    } else {
      const relative = RELATIVE.exec(position);
      const markerRelative = relative ? null : MARKER_RELATIVE.exec(position);
      if (relative) {
        const amount = Number(relative[2]);
        time = relative[1] === '+' ? this.end + amount : this.end - amount;
      } else {
        const name = markerRelative ? (markerRelative[1] ?? '') : position;
        const marker = this.markerTime(name);
        if (marker === undefined) {
          throw new InvalidOptionError(`Unknown timeline position "${position}". Add the marker with mark() first.`);
        }
        const amount = markerRelative ? Number(markerRelative[3]) : 0;
        time = markerRelative?.[2] === '-' ? marker - amount : marker + amount;
      }
    }
    if (!Number.isFinite(time) || time < 0) {
      throw new InvalidOptionError(`Timeline position must resolve to a finite time >= 0, got ${String(time)}.`);
    }
    return time;
  }
}

/** Creates an empty timeline that is not bound to an engine. */
export function timeline(options: PlayableOptions = {}): Timeline {
  return new Timeline(options);
}

/** Plays the items one after another. */
export function sequence(items: readonly Playable[], options: PlayableOptions = {}): Timeline {
  const tl = new Timeline(options);
  for (const item of items) tl.add(item);
  return tl;
}

/** Plays the items at the same time. */
export function parallel(items: readonly Playable[], options: PlayableOptions = {}): Timeline {
  const tl = new Timeline(options);
  for (const item of items) tl.add(item, 0);
  return tl;
}

/** Starts the items `each` ms apart. */
export function stagger(items: readonly Playable[], each: number, options: PlayableOptions = {}): Timeline {
  if (!Number.isFinite(each) || each < 0) {
    throw new InvalidOptionError(`stagger interval must be a finite number >= 0, got ${String(each)}.`);
  }
  const tl = new Timeline(options);
  items.forEach((item, index) => tl.add(item, index * each));
  return tl;
}

export { Wait };
