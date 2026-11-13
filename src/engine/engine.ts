import { PlaybackImpl } from '../animation/playback';
import type { Playback, PlaybackHost, PlaybackResult } from '../animation/playback';
import { Playable, Wait } from '../animation/playable';
import type { PlayableOptions, PlayableRunner, PropertyAnimationLike } from '../animation/playable';
import { parallel, sequence, stagger, Timeline } from '../animation/timeline';
import { KeyframeAnimation, Tween } from '../animation/tween';
import type { KeyframeOptions, TweenVars } from '../animation/tween';
import type { AnimationTarget } from '../animation/target';
import type { Clock } from '../runtime/clock';
import type {
  Drawable,
  EffectCapabilities,
  EffectContext,
  EffectDefinition,
  EffectInstance,
  EffectServices,
  TransformOffset,
} from '../runtime/effect';
import { AdaptiveQuality, resolveQuality } from '../runtime/quality';
import type { AdaptiveQualityOptions, QualityLevel, QualityProfile } from '../runtime/quality';
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
import { SceneNode } from '../scene/node';
import { isTargetHandle } from '../scene/targets';
import type { TargetHandle, TargetRef } from '../scene/targets';
import { EffectCue } from './cue';
import type { CueOptions, CueParams } from './cue';
import { ThrowMotion } from '../motion/throw';
import type { ThrowOptions, ThrowTarget } from '../motion/throw';
import { SpriteSheet } from '../sprites/sheet';
import type { SpriteSheetOptions } from '../sprites/sheet';
import { Sprite } from '../sprites/sprite';
import type { SpriteOptions } from '../sprites/sprite';

export type EffectStatus = 'playing' | 'paused' | 'completed' | 'cancelled';

export interface EffectResult {
  readonly status: 'completed' | 'cancelled';
  /** Why the effect was cancelled, when it was. */
  readonly reason?: 'user' | 'cancelAll' | 'limit' | 'reset' | 'disposed' | 'replaced' | 'owner' | 'error';
}

/** Options of `engine.play` and `engine.attach`. */
export interface PlayOptions {
  /** Seed for this instance, for reproducible results. */
  readonly seed?: number;
  /**
   * Draw order among effects (higher on top; equal values keep start order). Effects with a
   * negative `zIndex` draw below the scene. Default 0.
   */
  readonly zIndex?: number;
  /**
   * Replacement key: starting an effect with the key of a running one cancels the running one
   * (reason `replaced`). Use it for "one fire per card" rules.
   */
  readonly key?: string;
  /** Quality for this instance instead of the engine's. */
  readonly quality?: QualityLevel | QualityProfile;
}

/** Parameters of an effect that can follow a target. */
export interface TargetParams {
  readonly target?: TargetRef;
}

/** `attach(target, { effect, ...params })`: the effect and its parameters in one object. */
export interface AttachSpec {
  readonly effect: string | EffectDefinition<never>;
  readonly [param: string]: unknown;
}

function isAttachSpec(value: unknown): value is AttachSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    'effect' in value &&
    typeof (value as { create?: unknown }).create !== 'function'
  );
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
  /**
   * Graceful stop: the effect stops producing new content (emission, loops) and completes once
   * what is on screen has finished. Effects that cannot stop gracefully are cancelled.
   */
  stop(): void;
  /**
   * Changes parameters while the effect runs (for example `{ intensity: 1 }`). Throws
   * `InvalidOptionError` for invalid values or when the effect does not support updates.
   */
  update(params: Readonly<Record<string, unknown>>): void;
  /** Shorthand for `update({ intensity })`. */
  setIntensity(intensity: number): void;
  /** True when the effect accepts `update`. */
  readonly updatable: boolean;
  /** Calls `listener` once when the effect ends (immediately if it already ended). */
  onEnd(listener: (result: EffectResult) => void): () => void;
  /** Draw order among effects. */
  zIndex: number;
  /** Replacement key, if any. */
  readonly key: string | undefined;
}

export interface FrameEvent {
  /** Engine time of this frame in ms (clock time minus time spent with the engine paused). */
  readonly time: number;
  /**
   * Everything to draw this frame, bottom to top: effects with a negative `zIndex`, the scene
   * (when it has visible shapes), then the other effects by `zIndex` (equal values keep start
   * order, so later effects draw on top).
   */
  readonly drawables: readonly Drawable[];
  /** Number of effects after this frame. */
  readonly activeCount: number;
  /** Offset of the whole overlay (screen shake), to apply when drawing. */
  readonly camera: { readonly x: number; readonly y: number; readonly rotation: number };
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
  /** Detail level for effects. Default `high`. */
  readonly quality?: QualityLevel | QualityProfile;
  /**
   * Lower quality automatically when frames are slow (measured from clock intervals) and raise
   * it again when they are fast. Default off.
   */
  readonly adaptiveQuality?: boolean | AdaptiveQualityOptions;
  /** Reduced motion: effects skip shakes and large flashes. Default false. */
  readonly reducedMotion?: boolean;
}

export type EngineState = 'running' | 'paused' | 'disposed';

interface ActiveEffect {
  readonly handle: EffectHandleImpl;
  readonly instance: EffectInstance;
  readonly timer: LocalTimer;
}

interface HandleControl {
  cancel(handle: EffectHandleImpl): void;
  pause(handle: EffectHandleImpl): void;
  resume(handle: EffectHandleImpl): void;
  stop(handle: EffectHandleImpl): void;
  update(handle: EffectHandleImpl, params: Readonly<Record<string, unknown>>): void;
  zIndexChanged(): void;
}

class EffectHandleImpl implements EffectHandle {
  status: EffectStatus = 'playing';
  readonly finished: Promise<EffectResult>;
  result: EffectResult | null = null;
  updatable = false;
  private z: number;
  private readonly endListeners = new Set<(result: EffectResult) => void>();
  private resolveFinished!: (result: EffectResult) => void;

  constructor(
    readonly id: number,
    readonly effect: string,
    private readonly control: HandleControl,
    zIndex: number,
    readonly key: string | undefined,
    private readonly reportError: ErrorReporter,
  ) {
    this.z = zIndex;
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
  }

  get active(): boolean {
    return this.status === 'playing' || this.status === 'paused';
  }

  get zIndex(): number {
    return this.z;
  }
  set zIndex(value: number) {
    if (!Number.isFinite(value)) throw new InvalidOptionError('zIndex must be a finite number.');
    if (value === this.z) return;
    this.z = value;
    this.control.zIndexChanged();
  }

  pause(): void {
    if (this.status === 'playing') this.control.pause(this);
  }

  resume(): void {
    if (this.status === 'paused') this.control.resume(this);
  }

  cancel(): void {
    if (this.active) this.control.cancel(this);
  }

  stop(): void {
    if (this.active) this.control.stop(this);
  }

  update(params: Readonly<Record<string, unknown>>): void {
    const raw: unknown = params;
    if (typeof raw !== 'object' || raw === null) throw new InvalidOptionError('update expects an object of parameters.');
    if (!this.active) return;
    this.control.update(this, params);
  }

  setIntensity(intensity: number): void {
    this.update({ intensity });
  }

  onEnd(listener: (result: EffectResult) => void): () => void {
    if (this.result) {
      try {
        listener(this.result);
      } catch (error) {
        this.reportError(error);
      }
      return () => undefined;
    }
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** @internal */
  settle(result: EffectResult): void {
    this.status = result.status;
    this.result = result;
    this.resolveFinished(result);
    for (const listener of [...this.endListeners]) {
      try {
        listener(result);
      } catch (error) {
        this.reportError(error);
      }
    }
    this.endListeners.clear();
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
  private qualityProfile: QualityProfile;
  private adaptive: AdaptiveQuality | null;
  private lastFrameClock: number | null = null;
  private reduced: boolean;
  private capabilitiesValue: EffectCapabilities | null = null;
  private readonly cameraOffsets = new Set<TransformOffset & { removed: boolean }>();
  private readonly services: EffectServices;
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
    this.qualityProfile = resolveQuality(options.quality ?? 'high');
    const adaptive = options.adaptiveQuality;
    this.adaptive = adaptive
      ? new AdaptiveQuality(this.qualityProfile.level, typeof adaptive === 'object' ? adaptive : {})
      : null;
    this.reduced = options.reducedMotion ?? false;
    const capabilities = () => this.capabilitiesValue;
    this.services = {
      resolveTarget: (target) => this.resolveTarget(target),
      addCameraOffset: () => this.addCameraOffset(),
      addTargetOffset: (target) => {
        const id = typeof target === 'string' ? target : this.targets.idOf(target);
        return id === undefined ? null : this.targets.addOffset(id);
      },
      get capabilities() {
        return capabilities();
      },
    };
    for (const definition of options.effects ?? []) this.register(definition);
  }

  // --- Quality, accessibility and renderer ------------------------------------------------

  /** Detail level used by effects started from now on. */
  get quality(): QualityProfile {
    return this.qualityProfile;
  }
  set quality(value: QualityLevel | QualityProfile) {
    this.qualityProfile = resolveQuality(value);
  }

  /** True when the user asked for reduced motion; effects skip shakes and large flashes. */
  get reducedMotion(): boolean {
    return this.reduced;
  }
  set reducedMotion(value: boolean) {
    this.reduced = value;
  }

  /** What the active renderer supports; set by the overlay. */
  get rendererCapabilities(): EffectCapabilities | null {
    return this.capabilitiesValue;
  }
  setRendererCapabilities(capabilities: EffectCapabilities | null): void {
    this.capabilitiesValue = capabilities;
  }

  /** Current overlay offset from screen-shake effects. */
  get camera(): { x: number; y: number; rotation: number } {
    let x = 0;
    let y = 0;
    let rotation = 0;
    for (const offset of this.cameraOffsets) {
      x += offset.x;
      y += offset.y;
      rotation += offset.rotation;
    }
    return { x, y, rotation };
  }

  /** A host target by id: its proxy node and its transform binding (`motion`). */
  getTarget(id: string): TargetHandle | undefined {
    return this.targets.get(id);
  }

  /**
   * Resolves a target id, target handle or node to a node. Throws `InvalidOptionError` for
   * unknown ids or destroyed nodes.
   */
  resolveTarget(target: TargetRef): SceneNode {
    if (isTargetHandle(target)) target = target.node;
    if (target instanceof SceneNode) {
      if (target.destroyed) throw new InvalidOptionError('The target node has been destroyed.');
      return target;
    }
    if (typeof target !== 'string') throw new InvalidOptionError('A target must be a scene node, a target id or a target handle.');
    const node = this.targets.node(target);
    if (!node) throw new InvalidOptionError(`Unknown target "${target}". Mount <GameFXTarget id="${target}"> first.`);
    return node;
  }

  private addCameraOffset(): TransformOffset {
    const values = { x: 0, y: 0, rotation: 0 };
    const offset = {
      removed: false,
      get x() {
        return values.x;
      },
      set x(v: number) {
        values.x = v;
      },
      get y() {
        return values.y;
      },
      set y(v: number) {
        values.y = v;
      },
      get rotation() {
        return values.rotation;
      },
      set rotation(v: number) {
        values.rotation = v;
      },
      remove: () => {
        if (offset.removed) return;
        offset.removed = true;
        this.cameraOffsets.delete(offset);
        this.scene.markDirty();
      },
    };
    this.cameraOffsets.add(offset);
    return offset;
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
  play<Params>(effect: EffectDefinition<Params> | string, params: Params, options: PlayOptions = {}): EffectHandle {
    this.assertAlive();
    const definition = typeof effect === 'string' ? this.definitions.get(effect) : effect;
    if (!definition) {
      throw new InvalidOptionError(`Unknown effect "${typeof effect === 'string' ? effect : definitionName(effect)}". Register it before playing it.`);
    }
    if (options.seed !== undefined && !Number.isFinite(options.seed)) {
      throw new InvalidOptionError(`seed must be a finite number, got ${String(options.seed)}.`);
    }
    const zIndex = options.zIndex ?? 0;
    if (!Number.isFinite(zIndex)) throw new InvalidOptionError('zIndex must be a finite number.');
    if (options.key !== undefined && (typeof options.key !== 'string' || options.key.length === 0)) {
      throw new InvalidOptionError('key must be a non-empty string.');
    }
    // A `target` given as a host target id or handle resolves to its proxy node.
    let resolved = params;
    if (typeof params === 'object' && params !== null) {
      const target = (params as { target?: unknown }).target;
      if (typeof target === 'string' || isTargetHandle(target)) resolved = { ...params, target: this.resolveTarget(target) };
    }
    const random = createRandom(options.seed ?? this.random.nextUint32());
    const context: EffectContext = {
      random,
      quality: options.quality !== undefined ? resolveQuality(options.quality) : this.qualityProfile,
      reducedMotion: this.reduced,
      services: this.services,
    };
    const instance = (definition as EffectDefinition<Params>).create(resolved, context);

    if (options.key !== undefined) {
      for (const entry of [...this.active]) {
        if (entry.handle.key === options.key) this.endEffect(entry.handle, { status: 'cancelled', reason: 'replaced' });
      }
    }

    const handle = new EffectHandleImpl(
      this.nextId++,
      definition.name,
      this.handleControl,
      zIndex,
      options.key,
      this.reportError,
    );
    handle.updatable = typeof instance.setParams === 'function';
    try {
      instance.update(0);
    } catch (error) {
      try {
        instance.dispose();
      } catch (disposeError) {
        this.reportError(disposeError);
      }
      throw error;
    }
    this.active.push({ handle, instance, timer: new LocalTimer(this.now()) });
    this.sortEffects();
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
   * Starts an effect that follows a target: a scene node, the id of a registered host view
   * target (`<GameFXTarget id>`) or its handle (`getTarget(id)`). The effect receives the node
   * as its `target` parameter.
   * Two forms: `attach(target, 'fire-border', { intensity: 1 })` and
   * `attach(target, { effect: 'fire-border', intensity: 1 })`.
   * Throws `InvalidOptionError` for unknown target ids.
   */
  attach<Params extends TargetParams>(
    target: TargetRef,
    effect: EffectDefinition<Params> | string,
    params?: Omit<Params, 'target'>,
    options?: PlayOptions,
  ): EffectHandle;
  attach(target: TargetRef, spec: AttachSpec, options?: PlayOptions): EffectHandle;
  attach(
    target: TargetRef,
    effectOrSpec: EffectDefinition<TargetParams> | string | AttachSpec,
    paramsOrOptions?: object,
    maybeOptions?: PlayOptions,
  ): EffectHandle {
    this.assertAlive();
    const node = this.resolveTarget(target);
    if (isAttachSpec(effectOrSpec)) {
      const { effect, ...params } = effectOrSpec;
      return this.play(effect, { ...params, target: node }, (paramsOrOptions ?? {}));
    }
    return this.play(effectOrSpec, { ...(paramsOrOptions ?? {}), target: node }, maybeOptions ?? {});
  }

  /**
   * A timeline item that starts an effect when playback reaches it. `params` can be a function
   * evaluated at that moment (for example to read the impact position). Effects started by a
   * cue are cancelled when the playback is cancelled or stopped, unless `detached` is set.
   */
  cue<Params>(effect: EffectDefinition<Params> | string, params: CueParams<Params>, options: CueOptions = {}): EffectCue<Params> {
    this.assertAlive();
    if (typeof effect === 'string' && !this.definitions.has(effect)) {
      throw new InvalidOptionError(`Unknown effect "${effect}". Register it before using it in a cue.`);
    }
    return this.bind(new EffectCue(this, effect, params, options));
  }

  /** Motion helpers that build timeline items. */
  readonly motion = {
    /**
     * Ballistic throw of a scene node or host target (`id`): launched upwards, rotating, then
     * falling under constant gravity to a landing point. Markers: `launch`, `peak`, `impact`.
     */
    throw: (target: TargetRef | ThrowTarget, options: ThrowOptions): ThrowMotion => {
      this.assertAlive();
      let animated: ThrowTarget;
      if (isTargetHandle(target)) {
        animated = target.motion;
      } else if (typeof target === 'string') {
        const motion = this.targets.motion(target);
        if (!motion) throw new InvalidOptionError(`Unknown target "${target}". Mount <GameFXTarget id="${target}"> first.`);
        animated = motion;
      } else {
        animated = target;
      }
      return this.bind(new ThrowMotion(animated, options));
    },
  };

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
    this.cameraOffsets.clear();
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
    const clockNow = this.clock.now();
    if (this.adaptive && this.lastFrameClock !== null && this.currentState === 'running') {
      const level = this.adaptive.sample(clockNow - this.lastFrameClock);
      if (level) this.qualityProfile = resolveQuality(level);
    }
    this.lastFrameClock = clockNow;
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
          this.endEffect(entry.handle, { status: 'cancelled', reason: 'error' });
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
    // Effects are sorted by zIndex; negative ones draw below the scene.
    let i = 0;
    for (; i < this.active.length && (this.active[i]?.handle.zIndex ?? 0) < 0; i++) {
      drawables.push(...(this.active[i]?.instance.drawables ?? []));
    }
    if (sceneDrawable.commands.length > 0) drawables.push(sceneDrawable);
    for (; i < this.active.length; i++) drawables.push(...(this.active[i]?.instance.drawables ?? []));
    this.scene.markClean();
    this.lastDrawables = drawables;
    this.emitter.emit('frame', { time, drawables, activeCount: this.active.length, camera: this.camera });
  }

  private sortEffects(): void {
    // Stable: equal zIndex keeps start order.
    this.active.sort((a, b) => a.handle.zIndex - b.handle.zIndex || a.handle.id - b.handle.id);
  }

  private readonly handleControl: HandleControl = {
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
    stop: (h) => {
      const entry = this.findEffect(h);
      if (!entry) return;
      if (typeof entry.instance.stop !== 'function') {
        this.endEffect(h, { status: 'cancelled', reason: 'user' });
        return;
      }
      try {
        entry.instance.stop();
      } catch (error) {
        this.reportError(error);
        this.endEffect(h, { status: 'cancelled', reason: 'error' });
        return;
      }
      if (h.status === 'paused') {
        entry.timer.resume(this.now());
        h.status = 'playing';
      }
      if (entry.instance.done && !this.inFrame) this.endEffect(h, { status: 'completed' });
      this.updateSubscription();
    },
    update: (h, params) => {
      const entry = this.findEffect(h);
      if (!entry) return;
      if (typeof entry.instance.setParams !== 'function') {
        throw new InvalidOptionError(`Effect "${h.effect}" does not support parameter updates.`);
      }
      entry.instance.setParams(params);
      this.scene.markDirty();
    },
    zIndexChanged: () => {
      this.sortEffects();
      this.scene.markDirty();
    },
  };

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
    handle.settle(result);
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
    this.lastFrameClock = null;
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
