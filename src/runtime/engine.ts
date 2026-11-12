import type { Clock } from './clock';
import type { Drawable, EffectDefinition, EffectInstance } from './effect';
import { Emitter, rethrowAsync } from './emitter';
import type { ErrorReporter, Unsubscribe } from './emitter';
import { DisposedError, InvalidOptionError } from './errors';
import { createRandom } from './rng';
import type { Random } from './rng';

export type EffectStatus = 'playing' | 'completed' | 'cancelled';

export interface EffectResult {
  readonly status: Exclude<EffectStatus, 'playing'>;
  /** Why the effect was cancelled, when it was. */
  readonly reason?: 'user' | 'cancelAll' | 'limit' | 'disposed';
}

/** Handle to one running effect instance. */
export interface EffectHandle {
  readonly id: number;
  readonly effect: string;
  readonly status: EffectStatus;
  /**
   * Resolves when the effect completes or is cancelled. It never rejects, so skipping or
   * cancelling an effect cannot produce an unhandled promise rejection.
   */
  readonly finished: Promise<EffectResult>;
  /** Stops the effect immediately and releases its resources. Safe to call more than once. */
  cancel(): void;
}

export interface FrameEvent {
  /** Clock time of this frame in ms. */
  readonly time: number;
  /** Everything to draw this frame, in play order (later effects draw on top). */
  readonly drawables: readonly Drawable[];
  /** Number of running effects after this frame. */
  readonly activeCount: number;
}

export interface EngineEvents {
  frame: FrameEvent;
  effectStart: { readonly handle: EffectHandle };
  effectEnd: { readonly handle: EffectHandle; readonly result: EffectResult };
}

export interface EngineOptions {
  readonly clock: Clock;
  /** Seed for effects that don't pass their own. Defaults to a fixed value (0x5eed). */
  readonly seed?: number;
  /** Effect types available by name. More can be added with `register`. */
  readonly effects?: readonly EffectDefinition<never>[];
  /**
   * Maximum number of effects running at once. When exceeded, the oldest effect is cancelled
   * with reason `limit`. Defaults to 32.
   */
  readonly maxActiveEffects?: number;
  /** Receives errors thrown by event listeners. Defaults to rethrowing on a microtask. */
  readonly onError?: ErrorReporter;
}

export type EngineState = 'running' | 'disposed';

interface ActiveEffect {
  readonly handle: HandleImpl;
  readonly instance: EffectInstance;
  readonly startTime: number;
}

class HandleImpl implements EffectHandle {
  status: EffectStatus = 'playing';
  readonly finished: Promise<EffectResult>;
  resolve!: (result: EffectResult) => void;

  constructor(
    readonly id: number,
    readonly effect: string,
    private readonly onCancel: (handle: HandleImpl) => void,
  ) {
    this.finished = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  cancel(): void {
    if (this.status === 'playing') this.onCancel(this);
  }
}

const DEFAULT_SEED = 0x5eed;
const DEFAULT_MAX_ACTIVE = 32;

/**
 * The effects runtime. It owns effect instances, advances them from a `Clock`, and publishes
 * renderer-independent drawables once per frame. It knows nothing about React or Skia.
 *
 * The engine only listens to the clock while at least one effect is running, so an idle
 * engine costs no per-frame work.
 */
export class Engine {
  private readonly clock: Clock;
  private readonly random: Random;
  private readonly definitions = new Map<string, EffectDefinition<never>>();
  private readonly active: ActiveEffect[] = [];
  private readonly emitter: Emitter<EngineEvents>;
  private readonly maxActive: number;
  private readonly reportError: ErrorReporter;
  private unsubscribeClock: Unsubscribe | null = null;
  private nextId = 1;
  private currentState: EngineState = 'running';
  private lastDrawables: readonly Drawable[] = [];
  private inFrame = false;

  constructor(options: EngineOptions) {
    const maxActive = options.maxActiveEffects ?? DEFAULT_MAX_ACTIVE;
    if (!Number.isInteger(maxActive) || maxActive < 1) {
      throw new InvalidOptionError(`maxActiveEffects must be an integer >= 1, got ${String(maxActive)}.`);
    }
    const seed = options.seed ?? DEFAULT_SEED;
    if (!Number.isFinite(seed)) {
      throw new InvalidOptionError(`seed must be a finite number, got ${String(seed)}.`);
    }
    this.clock = options.clock;
    this.maxActive = maxActive;
    this.random = createRandom(seed);
    this.reportError = options.onError ?? rethrowAsync;
    this.emitter = new Emitter<EngineEvents>(this.reportError);
    for (const definition of options.effects ?? []) this.register(definition);
  }

  get state(): EngineState {
    return this.currentState;
  }

  get activeCount(): number {
    return this.active.length;
  }

  /** Drawables published by the most recent frame. */
  get drawables(): readonly Drawable[] {
    return this.lastDrawables;
  }

  /** Makes an effect type available by name. Replaces an existing one with the same name. */
  register(definition: EffectDefinition<never>): void {
    this.assertRunning();
    if (typeof definition.name !== 'string' || definition.name.length === 0) {
      throw new InvalidOptionError('An effect definition needs a non-empty name.');
    }
    this.definitions.set(definition.name, definition);
  }

  hasEffect(name: string): boolean {
    return this.definitions.has(name);
  }

  on<K extends keyof EngineEvents>(type: K, listener: (event: EngineEvents[K]) => void): Unsubscribe {
    return this.emitter.on(type, listener);
  }

  /**
   * Starts an effect, either by registered name or by passing its definition directly.
   * Throws `InvalidOptionError` synchronously for unknown effects or invalid parameters.
   */
  play<Params>(effect: EffectDefinition<Params> | string, params: Params, options: { seed?: number } = {}): EffectHandle {
    this.assertRunning();
    const definition = typeof effect === 'string' ? this.definitions.get(effect) : effect;
    if (!definition) {
      throw new InvalidOptionError(`Unknown effect "${typeof effect === 'string' ? effect : definitionName(effect)}". Register it before playing it.`);
    }
    if (options.seed !== undefined && !Number.isFinite(options.seed)) {
      throw new InvalidOptionError(`seed must be a finite number, got ${String(options.seed)}.`);
    }
    const random = createRandom(options.seed ?? this.random.nextUint32());
    const instance = (definition as EffectDefinition<Params>).create(params, { random });

    const handle = new HandleImpl(this.nextId++, definition.name, (h) => {
      this.end(h, { status: 'cancelled', reason: 'user' });
    });
    const startTime = this.clock.now();
    instance.update(0);
    this.active.push({ handle, instance, startTime });
    this.emitter.emit('effectStart', { handle });

    while (this.active.length > this.maxActive) {
      const oldest = this.active[0];
      if (!oldest) break;
      this.end(oldest.handle, { status: 'cancelled', reason: 'limit' });
    }
    this.ensureSubscribed();
    return handle;
  }

  /** Cancels every running effect. */
  cancelAll(): void {
    this.assertRunning();
    for (const entry of [...this.active]) {
      this.end(entry.handle, { status: 'cancelled', reason: 'cancelAll' });
    }
  }

  /**
   * Cancels all effects, stops listening to the clock and removes all listeners.
   * Idempotent. Any other method throws `DisposedError` afterwards.
   */
  dispose(): void {
    if (this.currentState === 'disposed') return;
    for (const entry of [...this.active]) {
      this.end(entry.handle, { status: 'cancelled', reason: 'disposed' });
    }
    this.currentState = 'disposed';
    this.unsubscribe();
    this.emitter.clear();
    this.definitions.clear();
    this.lastDrawables = [];
  }

  private readonly onFrame = (time: number): void => {
    if (this.currentState !== 'running') return;
    this.inFrame = true;
    for (const entry of [...this.active]) {
      if (entry.handle.status !== 'playing') continue;
      try {
        entry.instance.update(Math.max(0, time - entry.startTime));
      } catch (error) {
        this.reportError(error);
        this.end(entry.handle, { status: 'cancelled', reason: 'user' });
        continue;
      }
      if (entry.instance.done) this.end(entry.handle, { status: 'completed' });
    }
    this.inFrame = false;
    const drawables: Drawable[] = [];
    for (const entry of this.active) drawables.push(...entry.instance.drawables);
    this.lastDrawables = drawables;
    this.emitter.emit('frame', { time, drawables, activeCount: this.active.length });
    if (this.active.length === 0) this.unsubscribe();
  };

  private end(handle: HandleImpl, result: EffectResult): void {
    if (handle.status !== 'playing') return;
    const index = this.active.findIndex((entry) => entry.handle === handle);
    const entry = this.active[index];
    if (index >= 0) this.active.splice(index, 1);
    handle.status = result.status;
    try {
      entry?.instance.dispose();
    } catch (error) {
      this.reportError(error);
    }
    handle.resolve(result);
    this.emitter.emit('effectEnd', { handle, result });
    if (this.active.length === 0 && this.currentState === 'running' && !this.inFrame) {
      // Publish one empty frame so renderers clear, then go idle on the next frame.
      this.lastDrawables = [];
      this.emitter.emit('frame', { time: this.clock.now(), drawables: [], activeCount: 0 });
    }
  }

  private ensureSubscribed(): void {
    if (this.unsubscribeClock === null) this.unsubscribeClock = this.clock.subscribe(this.onFrame);
  }

  private unsubscribe(): void {
    this.unsubscribeClock?.();
    this.unsubscribeClock = null;
  }

  private assertRunning(): void {
    if (this.currentState === 'disposed') throw new DisposedError('Engine');
  }
}

export function createEngine(options: EngineOptions): Engine {
  return new Engine(options);
}

function definitionName(definition: EffectDefinition<unknown>): string {
  return typeof definition.name === 'string' ? definition.name : '(unnamed)';
}
