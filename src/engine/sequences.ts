import type { Playback } from '../animation/playback';
import type { Timeline } from '../animation/timeline';
import type { ExplosionParams, TrailParams } from '../effects/presets';
import type { ScreenShakeParams } from '../effects/primitives';
import type { ThrowOptions } from '../motion/throw';
import { InvalidOptionError } from '../runtime/errors';
import type { QualityLevel, QualityProfile } from '../runtime/quality';
import { SceneNode } from '../scene/node';
import { isTargetHandle } from '../scene/targets';
import type { TargetMotion, TargetRef } from '../scene/targets';
import type { EffectCue } from './cue';
import type { Engine } from './engine';

export interface ThrowAndExplodeOptions {
  /**
   * Flight: height, distance, drop, duration or gravity, rotation, scale. Defaults of
   * `motion.throw`, except `scale` (depth cue at mid-flight), which defaults to 1.08 here.
   */
  readonly throw?: ThrowOptions;
  /**
   * A trail behind the object during the flight (stops at the impact; its particles fade out).
   * `true` for the default `trail` effect or its parameters. Default false.
   */
  readonly trail?: boolean | Omit<TrailParams, 'target' | 'position' | 'follow'>;
  /**
   * Impact weight: the object squashes to `1 - punch` of its scale and springs back within
   * 220 ms after the impact. 0 turns it off. Needs a scalable target. Default 0.06.
   */
  readonly punch?: number;
  /**
   * Explosion at the impact point (sparks, smoke, flash, shockwave). Parameters of the
   * `explosion` effect; `false` turns it off. Default `{}`.
   */
  readonly explosion?: Omit<ExplosionParams, 'position' | 'target' | 'follow' | 'screenShake'> | false;
  /**
   * Where the explosion starts: `contact` (default), the lowest point of the object at the
   * impact, where it meets what it lands on, so the blast does not cover the object; or
   * `center`, its centre.
   */
  readonly explodeAt?: 'contact' | 'center';
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
  /**
   * Quality of the explosion, shake and trail instead of the engine's (the flight, its timing and
   * the impact moment are the same on every profile).
   */
  readonly quality?: QualityLevel | QualityProfile;
}

/** What `throwAndExplode` returns: the playback plus its parts, for events and tests. */
export interface ThrowAndExplodeSequence {
  readonly playback: Playback;
  readonly timeline: Timeline;
  /** The cue that starts the explosion at the impact, if any. */
  readonly explosion: EffectCue<ExplosionParams> | null;
  /** The cue that starts the shake at the impact, if any. */
  readonly shake: EffectCue<ScreenShakeParams> | null;
  /** The cue that starts the flight trail at the launch, if any. */
  readonly trail: EffectCue<TrailParams> | null;
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
  const explodeAt = options.explodeAt ?? 'contact';
  if (!['contact', 'center'].includes(explodeAt)) throw new InvalidOptionError('explodeAt must be contact or center.');
  const settleDelay = options.settleDelay ?? 700;
  const returnDuration = options.returnDuration ?? 450;
  const punch = options.punch ?? 0.06;
  for (const [name, value] of [
    ['settleDelay', settleDelay],
    ['returnDuration', returnDuration],
    ['punch', punch],
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

  if (punch >= 1) throw new InvalidOptionError('punch must be < 1.');
  const quality = options.quality !== undefined ? { quality: options.quality } : {};
  const start = { x: movable.x, y: movable.y, rotation: movable.rotation, opacity: movable.opacity, scale: movable.scale };
  const flight = engine.motion.throw(target, { scale: 1.08, ...options.throw });
  // The throw carries the `launch`, `peak` and `impact` markers; the impact parts start at its end.
  const impactAt = flight.duration;
  const timeline = engine.timeline().add(flight);

  let explosionCue: EffectCue<ExplosionParams> | null = null;
  if (options.explosion !== false) {
    const params = options.explosion ?? {};
    // Placed where the object is at the impact, computed when the cue fires (follow: false
    // captures that point): its centre, or the bottom middle of its bounds on screen.
    explosionCue = engine.cue<ExplosionParams>(
      'explosion',
      () => {
        const bounds = explodeAt === 'contact' && !node.destroyed ? node.getWorldBounds() : null;
        return bounds ? { ...params, position: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height } } : { ...params, target: node, follow: false };
      },
      { zIndex: 1, ...quality },
    );
    timeline.add(explosionCue, impactAt);
  }
  let shakeCue: EffectCue<ScreenShakeParams> | null = null;
  if (options.shake !== false) {
    const shake = options.shake ?? {};
    const scope = shake.scope ?? (hostId ? ['overlay', hostId] : 'overlay');
    shakeCue = engine.cue<ScreenShakeParams>('screen-shake', { amplitude: 7, duration: 360, ...shake, scope }, quality);
    timeline.add(shakeCue, impactAt);
  }

  let trailCue: EffectCue<TrailParams> | null = null;
  if (options.trail !== undefined && options.trail !== false) {
    const trail = options.trail === true ? {} : options.trail;
    trailCue = engine.cue<TrailParams>('trail', { ...trail, target: node }, { zIndex: -1, ...quality });
    timeline.add(trailCue, 0);
  }
  if (punch > 0) {
    const s = start.scale;
    timeline.add(
      engine.keyframes(movable, {
        duration: 220,
        keyframes: [
          { at: 0, scale: s },
          { at: 0.3, scale: s * (1 - punch), easing: 'easeOutQuad' },
          { at: 1, scale: s, easing: 'easeOutBack' },
        ],
      }),
      impactAt,
    );
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
  // The trail stops emitting at the impact (or when the sequence ends early or is skipped);
  // its particles fade on their own.
  const stopTrail = () => {
    for (const h of trailCue?.handles ?? []) h.stop();
  };
  if (trailCue) playback.onMarker('impact', stopTrail);
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
    stopTrail();
    // An interrupted sequence restores opacity and scale too (the throw restores position).
    if (result.status !== 'completed' && !node.destroyed) {
      if (afterImpact === 'vanish') movable.opacity = start.opacity;
      movable.scale = start.scale;
    }
  });
  return { playback, timeline, explosion: explosionCue, shake: shakeCue, trail: trailCue };
}
