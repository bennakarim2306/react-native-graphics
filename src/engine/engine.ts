import { PlaybackImpl } from '../animation/playback';
import type { Playback, PlaybackHost, PlaybackResult } from '../animation/playback';
import { Playable, Wait } from '../animation/playable';
import type { PlayableOptions, PlayableRunner, PropertyAnimationLike } from '../animation/playable';
import { parallel, sequence, stagger, Timeline } from '../animation/timeline';
import { KeyframeAnimation, Tween } from '../animation/tween';
import type { KeyframeOptions, TweenVars } from '../animation/tween';
import type { AnimationTarget } from '../animation/target';
import type { Clock } from '../runtime/clock';
import type { Drawable, EffectDefinition, EffectInstance } from '../runtime/effect';
import { Emitter, rethrowAsync } from '../runtime/emitter';
import type { ErrorReporter, Unsubscribe } from '../runtime/emitter';
import { DisposedError, InvalidOptionError } from '../runtime/errors';
import { createRandom } from '../runtime/rng';
import type { Random } from '../runtime/rng';
import { LocalTimer } from '../runtime/timer';
import { Scene } from '../scene/scene';
import type { SceneOptions } from '../scene/scene';
import { AssetManager } from '../assets/assets';
import type { AssetManagerOptions } from '../assets/assets';
import { TargetRegistry } from '../scene/targets';
import type { SceneNode } from '../scene/node';
import { SpriteSheet } from '../sprites/sheet';
import type { SpriteSheetOptions } from '../sprites/sheet';
import { Sprite } from '../sprites/sprite';
import type { SpriteOptions } from '../sprites/sprite';

export type EffectStatus = 'playing' | 'paused' | 'completed' | 'cancelled';

export interface EffectResult {
  readonly status: 'completed' | 'cancelled';
  /** Why the effect was cancelled, when it was. */
  readonly reason?: 'user' | 'cancelAll' | 'limit' | 'reset' | 'disposed';
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
  /** Freezes the effect (its time stops). */
  pause(): void;
  resume(): void;
  /** Stops the effect immediately and releases its resources. Safe to call more than once. */
  cancel(): void;
}

export interface FrameEvent {
  /** Engine time of this frame in ms (clock time minus time spent with the engine paused). */
  readonly time: number;
  /**
   * Everything to draw this frame: the scene first (when it has visible shapes), then effects
   * in play order (later effects draw on top).
   */
  readonly drawables: readonly Drawable[];
  /** Number of effects after this frame. */
  readonly activeCount: number;
}

export interface EngineEvents {
  frame: FrameEvent;
  effectStart: { readonly handle: EffectHandle };
  effectEnd: { readonly handle: EffectHandle; readonly result: EffectResult };
  playbackStart: { readonly playback: Playback };
  playbackEnd: { readonly playback: Playback; readonly result: PlaybackResult };
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
  /** Scene layer order, bottom to top. */
  readonly layers?: SceneOptions['layers'];
  /** Receives errors thrown by listeners, callbacks and effects. Defaults to rethrowing on a microtask. */
  readonly onError?: ErrorReporter;
  /**
   * Asset cache. Pass options to create one owned by the engine (disposed with it), or share an
   * existing manager between engines (then you dispose it).
   */
  readonly assets?: AssetManager | AssetManagerOptions;
}

export type EngineState = 'running' | 'paused' | 'disposed';

interface ActiveEffect {
  readonly handle: EffectHandleImpl;
  readonly instance: EffectInstance;
  readonly timer: LocalTimer;
}

class EffectHandleImpl implements EffectHandle {
  status: EffectStatus = 'playing';
  readonly finished: Promise<EffectResult>;
  resolve!: (result: EffectResult) => void;

  constructor(
    readonly id: number,
    readonly effect: string,
    private readonly control: {
      cancel(handle: EffectHandleImpl): void;
      pause(handle: EffectHandleImpl): void;
      resume(handle: EffectHandleImpl): void;
    },
  ) {
    this.finished = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  pause(): void {
    if (this.status === 'playing') this.control.pause(this);
  }

  resume(): void {
    if (this.status === 'paused') this.control.resume(this);
  }

  cancel(): void {
    if (this.status === 'playing' || this.status === 'paused') this.control.cancel(this);
  }
}

interface RunningAnimation {
  readonly playback: PlaybackImpl;
  readonly animation: PropertyAnimationLike;
}

const DEFAULT_SEED = 0x5eed;
const DEFAULT_MAX_ACTIVE = 32;

/**
 * The runtime. It owns the scene graph, animation playbacks and effect instances, advances
 * them from a `Clock`, and publishes renderer-independent drawables once per frame. It knows
 * nothing about React or Skia.
 *
 * Per frame, in this order: playbacks advance (and deliver their markers), effects update,
 * attachments receive their targets' final transforms, then one `frame` event is published.
 *
 * The engine only listens to the clock while something is running or the scene changed, so
 * an idle engine costs no per-frame work.
 */
export class Engine implements PlayableRunner {
  /** The scene graph drawn below effects. Coordinates are overlay pixels. */
  readonly scene: Scene;
  /** Image and sprite-sheet assets. */
  readonly assets: AssetManager;
  /** Named anchors for host (React Native) views; see `GameFXTarget`. */
  readonly targets: TargetRegistry;
  private readonly ownsAssets: boolean;
  private readonly clock: Clock;
  private readonly random: Random;
  private readonly definitions = new Map<string, EffectDefinition<never>>();
  private readonly active: ActiveEffect[] = [];
  private readonly playbacks: PlaybackImpl[] = [];
  private readonly running = new Map<object, RunningAnimation[]>();
  private readonly emitter: Emitter<EngineEvents>;
  private readonly maxActive: number;
  private readonly reportError: ErrorReporter;
  private readonly engineTimer: LocalTimer;
  private readonly playbackHost: PlaybackHost;
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
    this.engineTimer = new LocalTimer(this.clock.now(), 0);
    this.scene = new Scene(options.layers ? { layers: options.layers } : {}, () => {
      if (this.currentState !== 'disposed') this.ensureSubscribed();
    });
    this.scene.markClean();
    this.targets = new TargetRegistry(this.scene, this.reportError);
    if (options.assets instanceof AssetManager) {
      this.assets = options.assets;
      this.ownsAssets = false;
    } else {
      this.assets = new AssetManager({ onError: this.reportError, ...options.assets });
      this.ownsAssets = true;
    }
    this.playbackHost = {
      now: () => this.now(),
      reportError: this.reportError,
      propertyAnimationStarted: (playback, animation) => {
        this.onPropertyAnimationStarted(playback, animation);
      },
      statusChanged: () => {
        this.updateSubscription();
      },
      ended: (playback, result) => {
        this.onPlaybackEnded(playback, result);
      },
    };
    for (const definition of options.effects ?? []) this.register(definition);
  }

  get state(): EngineState {
    return this.currentState;
  }

  /** Engine time in ms: clock time minus time spent paused. */
  now(): number {
    return this.engineTimer.local(this.clock.now());
  }

  /** Number of effects (playing or paused). */
  get activeCount(): number {
    return this.active.length;
  }

  /** Number of animation playbacks (playing or paused). */
  get playbackCount(): number {
    return this.playbacks.length;
  }

  /** Drawables published by the most recent frame. */
  get drawables(): readonly Drawable[] {
    return this.lastDrawables;
  }

  /** Makes an effect type available by name. Replaces an existing one with the same name. */
  register(definition: EffectDefinition<never>): void {
    this.assertAlive();
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

  // --- Effects ----------------------------------------------------------------------------

  /**
   * Starts an effect, either by registered name or by passing its definition directly.
   * Throws `InvalidOptionError` synchronously for unknown effects or invalid parameters.
   */
  play<Params>(effect: EffectDefinition<Params> | string, params: Params, options: { seed?: number } = {}): EffectHandle {
    this.assertAlive();
    const definition = typeof effect === 'string' ? this.definitions.get(effect) : effect;
    if (!definition) {
      throw new InvalidOptionError(`Unknown effect "${typeof effect === 'string' ? effect : definitionName(effect)}". Register it before playing it.`);
    }
    if (options.seed !== undefined && !Number.isFinite(options.seed)) {
      throw new InvalidOptionError(`seed must be a finite number, got ${String(options.seed)}.`);
    }
    const random = createRandom(options.seed ?? this.random.nextUint32());
    const instance = (definition as EffectDefinition<Params>).create(params, { random });

    const handle = new EffectHandleImpl(this.nextId++, definition.name, {
      cancel: (h) => {
        this.endEffect(h, { status: 'cancelled', reason: 'user' });
      },
      pause: (h) => {
        const entry = this.findEffect(h);
        entry?.timer.pause(this.now());
        h.status = 'paused';
        this.updateSubscription();
      },
      resume: (h) => {
        const entry = this.findEffect(h);
        entry?.timer.resume(this.now());
        h.status = 'playing';
        this.updateSubscription();
      },
    });
    instance.update(0);
    this.active.push({ handle, instance, timer: new LocalTimer(this.now()) });
    this.emitter.emit('effectStart', { handle });

    while (this.active.length > this.maxActive) {
      const oldest = this.active[0];
      if (!oldest) break;
      this.endEffect(oldest.handle, { status: 'cancelled', reason: 'limit' });
    }
    this.updateSubscription();
    return handle;
  }

  /**
   * Starts an effect that follows a target: a scene node, or the id of a registered host view
   * target (`<GameFXTarget id>`). The effect receives the node as its `target` parameter.
   * Throws `InvalidOptionError` for unknown target ids.
   */
  attach<Params extends { readonly target: SceneNode }>(
    target: string | SceneNode,
    effect: EffectDefinition<Params> | string,
    params: Omit<Params, 'target'>,
    options: { seed?: number } = {},
  ): EffectHandle {
    this.assertAlive();
    let node = typeof target === 'string' ? undefined : target;
    if (typeof target === 'string') {
      node = this.targets.node(target);
      if (!node) throw new InvalidOptionError(`Unknown target "${target}". Mount <GameFXTarget id="${target}"> first.`);
    }
    return this.play(effect, { ...params, target: node } as Params, options);
  }

  // --- Animations -------------------------------------------------------------------------

  /** Creates a tween bound to this engine. Call `.play()` or add it to a timeline. */
  animate<P extends string>(target: AnimationTarget<P>, vars: TweenVars<P>): Tween<P> {
    this.assertAlive();
    return this.bind(new Tween(target, vars));
  }

  /** Creates a keyframe animation bound to this engine. */
  keyframes<P extends string>(target: AnimationTarget<P>, options: KeyframeOptions<P>): KeyframeAnimation<P> {
    this.assertAlive();
    return this.bind(new KeyframeAnimation(target, options));
  }

  /** Creates an empty timeline bound to this engine. */
  timeline(options: PlayableOptions = {}): Timeline {
    this.assertAlive();
    return this.bind(new Timeline(options));
  }

  /** Timeline playing `items` one after another. */
  sequence(items: readonly Playable[], options: PlayableOptions = {}): Timeline {
    this.assertAlive();
    return this.bind(sequence(items, options));
  }

  /** Timeline playing `items` at the same time. */
  parallel(items: readonly Playable[], options: PlayableOptions = {}): Timeline {
    this.assertAlive();
    return this.bind(parallel(items, options));
  }

  /** Timeline starting `items` `each` ms apart. */
  stagger(items: readonly Playable[], each: number, options: PlayableOptions = {}): Timeline {
    this.assertAlive();
    return this.bind(stagger(items, each, options));
  }

  /** A pause of `ms` for use inside timelines. */
  wait(ms: number): Wait {
    return new Wait(ms);
  }

  /**
   * Starts a playable (tween, keyframes or timeline) and returns its playback. The initial
   * state is applied immediately; time starts now. A playable can run in one playback at a
   * time and cannot be run while it is inside a timeline.
   */
  run(playable: Playable): Playback {
    this.assertAlive();
    if (!(playable instanceof Playable)) {
      throw new InvalidOptionError('engine.run expects a tween, keyframe animation or timeline.');
    }
    if (playable.parent) {
      throw new InvalidOptionError('This animation is part of a timeline. Play the timeline instead.');
    }
    if (playable.activePlayback?.status === 'playing' || playable.activePlayback?.status === 'paused') {
      throw new InvalidOptionError('This animation is already playing. Cancel it first or create a new one.');
    }
    playable.locked = true;
    playable.resetState();
    const playback = new PlaybackImpl(this.nextId++, playable, this.playbackHost);
    playable.activePlayback = playback;
    this.playbacks.push(playback);
    this.emitter.emit('playbackStart', { playback });
    playback.begin();
    this.updateSubscription();
    return playback;
  }

  // --- Sprites ----------------------------------------------------------------------------

  /** Creates a sprite sheet from a loaded image asset (or the id of one). */
  createSpriteSheet(options: Omit<SpriteSheetOptions, 'image'> & { readonly image: SpriteSheetOptions['image'] | string }): SpriteSheet {
    this.assertAlive();
    const image = typeof options.image === 'string' ? this.assets.get(options.image) : options.image;
    return new SpriteSheet({ ...options, image });
  }

  /**
   * Creates a sprite node, added to `options.parent` or the scene root. Its animations run on
   * this engine's clock.
   */
  createSprite(options: SpriteOptions): Sprite {
    this.assertAlive();
    const sprite = new Sprite(this.scene, options, this);
    try {
      return this.scene.insert(sprite, options.parent);
    } catch (error) {
      sprite.destroy();
      throw error;
    }
  }

  // --- Control ----------------------------------------------------------------------------

  /** Freezes engine time: every playback and effect stops advancing until `resume`. */
  pause(): void {
    this.assertAlive();
    if (this.currentState === 'paused') return;
    this.engineTimer.pause(this.clock.now());
    this.currentState = 'paused';
    this.updateSubscription();
  }

  resume(): void {
    this.assertAlive();
    if (this.currentState !== 'paused') return;
    this.engineTimer.resume(this.clock.now());
    this.currentState = 'running';
    this.updateSubscription();
  }

  /** Cancels every effect and playback. Animated values keep their current state. */
  cancelAll(): void {
    this.assertAlive();
    for (const playback of [...this.playbacks]) playback.cancelWith('cancelAll');
    for (const entry of [...this.active]) {
      this.endEffect(entry.handle, { status: 'cancelled', reason: 'cancelAll' });
    }
  }

  /**
   * Stops every playback (returning animated values to their initial state) and cancels
   * every effect. Scene nodes stay. The engine keeps running.
   */
  reset(): void {
    this.assertAlive();
    for (const playback of [...this.playbacks].reverse()) playback.stopWith('reset');
    for (const entry of [...this.active]) {
      this.endEffect(entry.handle, { status: 'cancelled', reason: 'reset' });
    }
    this.scene.markDirty();
  }

  /**
   * Cancels everything, destroys the scene (attachments end with `engineDisposed`), stops
   * listening to the clock and removes all listeners. Idempotent. Any other method throws
   * `DisposedError` afterwards.
   */
  dispose(): void {
    if (this.currentState === 'disposed') return;
    for (const playback of [...this.playbacks]) playback.cancelWith('disposed');
    for (const entry of [...this.active]) {
      this.endEffect(entry.handle, { status: 'cancelled', reason: 'disposed' });
    }
    this.scene.dispose('engineDisposed');
    this.targets.dispose();
    if (this.ownsAssets) this.assets.dispose();
    this.currentState = 'disposed';
    this.unsubscribe();
    this.emitter.clear();
    this.definitions.clear();
    this.running.clear();
    this.lastDrawables = [];
  }

  // --- Frame loop -------------------------------------------------------------------------

  private readonly onFrame = (): void => {
    if (this.currentState === 'disposed') return;
    const time = this.now();
    this.inFrame = true;
    if (this.currentState === 'running') {
      for (const playback of [...this.playbacks]) {
        try {
          playback.tick();
        } catch (error) {
          this.reportError(error);
          playback.cancel();
        }
      }
      for (const entry of [...this.active]) {
        if (entry.handle.status !== 'playing') continue;
        try {
          entry.instance.update(Math.max(0, entry.timer.local(time)));
        } catch (error) {
          this.reportError(error);
          this.endEffect(entry.handle, { status: 'cancelled', reason: 'user' });
          continue;
        }
        if (entry.instance.done) this.endEffect(entry.handle, { status: 'completed' });
      }
    }
    this.scene.updateAttachments(time, this.reportError);
    this.inFrame = false;
    this.publish(time);
    this.updateSubscription();
  };

  private publish(time: number): void {
    const drawables: Drawable[] = [];
    const sceneDrawable = this.scene.drawable(time);
    if (sceneDrawable.commands.length > 0) drawables.push(sceneDrawable);
    for (const entry of this.active) drawables.push(...entry.instance.drawables);
    this.scene.markClean();
    this.lastDrawables = drawables;
    this.emitter.emit('frame', { time, drawables, activeCount: this.active.length });
  }

  private get needsFrames(): boolean {
    if (this.currentState === 'disposed') return false;
    if (this.scene.isDirty) return true;
    if (this.currentState === 'paused') return false;
    return (
      this.scene.hasAnimatedContent ||
      this.playbacks.some((p) => p.status === 'playing') || this.active.some((e) => e.handle.status === 'playing')
    );
  }

  private updateSubscription(): void {
    if (this.needsFrames) this.ensureSubscribed();
    else if (!this.inFrame) this.unsubscribe();
  }

  // --- Effects internals ------------------------------------------------------------------

  private findEffect(handle: EffectHandleImpl): ActiveEffect | undefined {
    return this.active.find((entry) => entry.handle === handle);
  }

  private endEffect(handle: EffectHandleImpl, result: EffectResult): void {
    if (handle.status !== 'playing' && handle.status !== 'paused') return;
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
    if (this.active.length === 0 && this.currentState !== 'disposed' && !this.inFrame) {
      // Publish a frame right away so renderers clear, then go idle.
      this.publish(this.now());
      this.updateSubscription();
    }
  }

  // --- Playback internals -----------------------------------------------------------------

  private bind<T extends Playable>(playable: T): T {
    playable.runner = this;
    return playable;
  }

  /** Overwrite `auto`: the newest animation of a property wins, older ones stop writing it. */
  private onPropertyAnimationStarted(playback: PlaybackImpl, animation: PropertyAnimationLike): void {
    const target = animation.target;
    let list = this.running.get(target);
    if (!list) {
      list = [];
      this.running.set(target, list);
    }
    if (animation.overwrite === 'auto') {
      const written = animation.writtenProperties();
      for (const other of list) {
        if (other.playback === playback || !other.playback.isActive) continue;
        const stopped = other.animation.killOverlapping(written);
        if (stopped.length > 0) other.playback.notifyInterrupted(target, stopped);
      }
    }
    if (!list.some((r) => r.animation === animation)) list.push({ playback, animation });
  }

  private onPlaybackEnded(playback: PlaybackImpl, result: PlaybackResult): void {
    const index = this.playbacks.indexOf(playback);
    if (index >= 0) this.playbacks.splice(index, 1);
    if (playback.root.activePlayback === playback) playback.root.activePlayback = null;
    for (const [target, list] of this.running) {
      const remaining = list.filter((r) => r.playback !== playback);
      if (remaining.length === 0) this.running.delete(target);
      else this.running.set(target, remaining);
    }
    this.emitter.emit('playbackEnd', { playback, result });
    this.scene.markDirty();
    this.updateSubscription();
  }

  // --- Clock ------------------------------------------------------------------------------

  private ensureSubscribed(): void {
    if (this.unsubscribeClock === null) this.unsubscribeClock = this.clock.subscribe(this.onFrame);
  }

  private unsubscribe(): void {
    this.unsubscribeClock?.();
    this.unsubscribeClock = null;
  }

  private assertAlive(): void {
    if (this.currentState === 'disposed') throw new DisposedError('Engine');
  }
}

export function createEngine(options: EngineOptions): Engine {
  return new Engine(options);
}

function definitionName(definition: EffectDefinition<unknown>): string {
  return typeof definition.name === 'string' ? definition.name : '(unnamed)';
}
