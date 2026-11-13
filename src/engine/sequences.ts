import type { Playback } from '../animation/playback';
import type { Timeline } from '../animation/timeline';
import type { ExplosionParams } from '../effects/presets';
import type { ScreenShakeParams } from '../effects/primitives';
import type { ThrowOptions } from '../motion/throw';
import { InvalidOptionError } from '../runtime/errors';
import { SceneNode } from '../scene/node';
import { isTargetHandle } from '../scene/targets';
import type { TargetMotion, TargetRef } from '../scene/targets';
import type { EffectCue } from './cue';
import type { Engine } from './engine';

export interface ThrowAndExplodeOptions {
  /** Flight: height, distance, drop, duration or gravity, rotation. Defaults of `motion.throw`. */
  readonly throw?: ThrowOptions;
  /**
   * Explosion at the impact point (sparks, smoke, flash, shockwave). Parameters of the
   * `explosion` effect; `false` turns it off. Default `{}`.
   */
  readonly explosion?: Omit<ExplosionParams, 'position' | 'target' | 'follow' | 'screenShake'> | false;
  /**
   * Shake after the impact: `overlay`, target ids, or a list. Default: the overlay and the
   * thrown target (when it is a host target). `false` turns it off.
   */
  readonly shake?: Omit<ScreenShakeParams, 'intensity'> | false;
  /**
   * What the object does after the impact:
   * - `stay`: it stays where it landed
   * - `return` (default): after `settleDelay` it glides back to where it started
   * - `vanish`: it fades out at the impact and fades back in at its start after `settleDelay`
   */
  readonly afterImpact?: 'stay' | 'return' | 'vanish';
  /** Pause between the impact and the return, in ms. Default 700. */
  readonly settleDelay?: number;
  /** Duration of the return, in ms. Default 450. */
  readonly returnDuration?: number;
}

/** What `throwAndExplode` returns: the playback plus its parts, for events and tests. */
export interface ThrowAndExplodeSequence {
  readonly playback: Playback;
  readonly timeline: Timeline;
  /** The cue that starts the explosion at the impact, if any. */
  readonly explosion: EffectCue<ExplosionParams> | null;
  /** The cue that starts the shake at the impact, if any. */
  readonly shake: EffectCue<ScreenShakeParams> | null;
}

type Movable = TargetMotion | SceneNode;

/**
 * The "throw and explode" orchestration as one reusable timeline: launch, rise while rotating,
 * slow down at the peak, fall faster, hit the landing point, then at the exact `impact`
 * marker an explosion (sparks, smoke, flash, shockwave) and a short shake, then settle.
 * Everything runs on the engine clock; no JavaScript timers.
 *
 * `target` is a host target id (`<GameFXTarget id>`, the React Native view moves through its
 * transform binding) or a scene node. Cancelling or stopping the returned playback puts the
 * object back where it started and cancels the explosion and shake, so an interrupted sequence
 * always leaves a consistent state; so does the object going away (the sequence cancels
 * itself). `finish()` jumps to the end state without the explosion.
 */
export function throwAndExplode(engine: Engine, target: TargetRef, options: ThrowAndExplodeOptions = {}): ThrowAndExplodeSequence {
  const afterImpact = options.afterImpact ?? 'return';
  if (!['stay', 'return', 'vanish'].includes(afterImpact)) throw new InvalidOptionError('afterImpact must be stay, return or vanish.');
  const settleDelay = options.settleDelay ?? 700;
  const returnDuration = options.returnDuration ?? 450;
  for (const [name, value] of [
    ['settleDelay', settleDelay],
    ['returnDuration', returnDuration],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new InvalidOptionError(`${name} must be a finite number >= 0.`);
  }

  // What moves (host target motion or the node) and where its explosions are placed (the node).
  let movable: Movable;
  let node: SceneNode;
  let hostId: string | null = null;
  if (typeof target === 'string' || isTargetHandle(target)) {
    const id = typeof target === 'string' ? target : target.id;
    const handle = engine.getTarget(id);
    if (!handle) throw new InvalidOptionError(`Unknown target "${id}". Mount <GameFXTarget id="${id}"> first.`);
    movable = handle.motion;
    node = handle.node;
    hostId = id;
  } else if (target instanceof SceneNode) {
    if (target.destroyed) throw new InvalidOptionError('The target node has been destroyed.');
    movable = target;
    node = target;
  } else {
    throw new InvalidOptionError('throwAndExplode target must be a target id, a target handle or a scene node.');
  }

  const start = { x: movable.x, y: movable.y, rotation: movable.rotation, opacity: movable.opacity };
  const flight = engine.motion.throw(target, options.throw ?? {});
  // The throw carries the `launch`, `peak` and `impact` markers; the impact parts start at its end.
  const impactAt = flight.duration;
  const timeline = engine.timeline().add(flight);

  let explosionCue: EffectCue<ExplosionParams> | null = null;
  if (options.explosion !== false) {
    const params = options.explosion ?? {};
    // Placed where the object is at the impact (follow: false captures that point).
    explosionCue = engine.cue<ExplosionParams>('explosion', () => ({ ...params, target: node, follow: false }), { zIndex: 1 });
    timeline.add(explosionCue, impactAt);
  }
  let shakeCue: EffectCue<ScreenShakeParams> | null = null;
  if (options.shake !== false) {
    const shake = options.shake ?? {};
    const scope = shake.scope ?? (hostId ? ['overlay', hostId] : 'overlay');
    shakeCue = engine.cue<ScreenShakeParams>('screen-shake', { amplitude: 7, duration: 360, ...shake, scope });
    timeline.add(shakeCue, impactAt);
  }

  if (afterImpact === 'vanish') {
    timeline.add(engine.animate(movable, { opacity: 0, duration: 90 }), impactAt);
  }
  if (afterImpact !== 'stay') {
    timeline.add(engine.wait(settleDelay), impactAt);
    if (afterImpact === 'vanish') {
      timeline
        .add(engine.animate(movable, { x: start.x, y: start.y, rotation: start.rotation, duration: 0 }))
        .add(engine.animate(movable, { opacity: start.opacity, duration: returnDuration, easing: 'easeOutQuad' }));
    } else {
      timeline.add(
        engine.animate(movable, { x: start.x, y: start.y, rotation: start.rotation, duration: returnDuration, easing: 'easeInOutCubic' }),
      );
    }
  }

  const playback = timeline.play();
  // If the object goes away (view unmounted, node destroyed) the sequence cancels itself, so no
  // explosion or shake starts for something that no longer exists.
  const watch = node.attach({
    update: () => undefined,
    onDetach: (reason) => {
      if (reason !== 'detached') playback.cancel();
    },
  });
  // Synchronous (not `finished.then`): a replay started right after `cancel()` must see the
  // restored state, not a half-faded object.
  playback.on('end', ({ result }) => {
    watch.detach();
    // An interrupted sequence restores the opacity too (the throw itself restores position).
    if (result.status !== 'completed' && afterImpact === 'vanish' && !node.destroyed) movable.opacity = start.opacity;
  });
  return { playback, timeline, explosion: explosionCue, shake: shakeCue };
}
