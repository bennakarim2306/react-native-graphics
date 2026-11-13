# Effects guide (Phase 4)

How to play, attach, combine and write effects; how particles and shaders work; and how effects follow ordinary React Native views. Every example uses the public `react-native-graphics` entry point and matches the implementation and its tests. The full type reference is in [API.md](API.md).

Contents:
1. [Playing and controlling effects](#1-playing-and-controlling-effects)
2. [Built-in effects](#2-built-in-effects)
3. [Particle system](#3-particle-system)
4. [Shader system](#4-shader-system)
5. [Composition: timelines, cues and Throw & Explode](#5-composition-timelines-cues-and-throw--explode)
6. [Rules for multiple effects](#6-rules-for-multiple-effects)
7. [React Native targets and the transform binding](#7-react-native-targets-and-the-transform-binding)
8. [Quality, reduced motion and capabilities](#8-quality-reduced-motion-and-capabilities)
9. [Custom effects](#9-custom-effects)
10. [Limitations](#10-limitations)

## 1. Playing and controlling effects

```tsx
const fx = useGameFX();

// At a point (overlay coordinates)
const boom = fx.play('explosion', { position: { x: 200, y: 400 }, particles: 150, screenShake: true });

// On a target: a <GameFXTarget id> id, its handle (fx.getTarget(id)) or a scene node
const fire = fx.attach('card', { effect: 'fire-border', intensity: 0.8, flameHeight: 25, color: '#FF6600', glow: true, sparks: true });
// equivalent: fx.attach('card', 'fire-border', { intensity: 0.8 })
// equivalent: fx.play('fire-border', { target: 'card', intensity: 0.8 })

fire.setIntensity(1.2);                    // = fire.update({ intensity: 1.2 })
fire.update({ color: '#2E7DFF', flameHeight: 30 });
fire.stop();                               // graceful: no new flames, completes when burnt out
boom.cancel();                             // immediate
await boom.finished;                       // { status: 'completed' | 'cancelled', reason? }
```

Every `play` and `attach` returns an `EffectHandle`:

| Member | Meaning |
| --- | --- |
| `status` | `playing`, `paused`, `completed`, `cancelled` |
| `finished` | Promise of `{ status, reason? }`. Never rejects |
| `onEnd(listener)` | Called once when the effect ends (immediately if it already has). Returns an unsubscribe function |
| `pause()`, `resume()` | Freeze and continue the effect's own time |
| `stop()` | Graceful end: emission and loops stop, what is on screen finishes. Effects without a graceful end are cancelled |
| `cancel()` | Immediate end; resources are released at once. Safe to call twice |
| `update(params)`, `setIntensity(n)` | Runtime parameter changes. Throws `InvalidOptionError` for invalid values or keys the effect cannot change. `updatable` says whether an effect accepts updates |
| `zIndex` | Draw order among effects (settable) |
| `key` | The replacement key, if one was given |

Cancellation reasons: `user` (`cancel()`), `cancelAll`, `limit` (more than `maxActiveEffects`, the oldest goes), `replaced` (same `key`), `owner` (the timeline that started it was cancelled), `error` (the effect threw), `reset`, `disposed` (provider unmounted).

`PlayOptions` (third argument of `play`, last argument of `attach`): `seed` (reproducible randomness), `zIndex`, `key`, `quality` (per-instance quality level).

All effects run on the engine clock (one clock per provider). There are no separate timers: pausing the engine pauses every effect, and tests drive everything with a `VirtualClock`.

## 2. Built-in effects

Fifteen effects are registered by default. Numbers are points, ms or degrees. "Target" means the effect accepts `target` (and therefore `fx.attach`); "updates" lists what `update()` accepts.

| Effect | What it is | Main parameters (defaults) | Updates |
| --- | --- | --- | --- |
| `fire-border` | Flames along a target's border | `intensity` 0.8 (0–2), `flameHeight` 24, `color` `#FF6A00`, `glow` true, `sparks` true, `shape` `rounded-rect` (`rect`, `ellipse`, or a `PathData`), `cornerRadius` 12, `padding` 2, `mode` `auto`/`shader`/`particles`, `duration` (until stopped), `heatHaze` false. Target required | `intensity`, `flameHeight`, `color`, `glow`, `sparks` |
| `explosion` | Composite of flash, shockwave, sparks, embers, smoke, optional debris and shake | `intensity` 1 (0.1–3), `particles` 150, `radius` 120, `colors`, `flash`/`shockwave`/`sparks`/`smoke` true, `debris` false (true or `{ image, frames }`), `screenShake` false (true or shake params) | `intensity` |
| `confetti` | Burst of tumbling strips | `count` 120, `direction` −90, `spread` 70, `power` 1, `duration` 2600, `colors`, `size` 5 | `intensity` |
| `golden-sparks` | Additive streak sparks, burst and/or continuous | `count` 60, `rate` 0, `duration` (until stopped when `rate` > 0), `power` 1, `direction`, `spread`, `colors` | `intensity`, `rate` |
| `smoke` | Rising, drifting soft puffs | `rate` 14, `burst` 0, `duration` (until stopped), `size` 14, `wind` 8, `rise` 1, `lifetime` 2200, `radius` 6, `colors` | `intensity`, `rate` |
| `trail` | World-space particles left behind a moving target | `rate` 70, `size` 5, `lifetime` 500, `colors`, `look` `soft`/`circle`/`spark`, `additive` true | `intensity`, `rate` |
| `glow-pulse` | Pulsing glow ring around a target | `color` `#FFD54A`, `frequency` 1.2, `pulses` Infinity, `radius` 14, `expand` 10, `padding` 4, `shape` `rect`/`circle`, `intensity` 1, `size` 60 (without target) | `intensity` |
| `shockwave` | Expanding ring(s) | `radius` 140, `width` 10, `duration` 520, `echoes` 1, `color`, `intensity` 1 | `intensity` |
| `flash` | Short radial light | `radius` 90, `duration` 220, `color`, `intensity` 1 | `intensity` |
| `screen-shake` | Shakes the overlay and/or host views | `scope` `overlay` (or target ids/nodes, or a list), `amplitude` 8, `rotation` 0, `duration` 400, `frequency` 28, `intensity` 1 | `intensity` |
| `victory` | Composite: confetti cannons at both edges and a centre burst, two waves of golden sparks, a shockwave ring and a glow pulse | `width` 280, `intensity` 1, `colors`, `glow` true | `intensity` |
| `particles` | The generic emitter (section 3) as an effect | every `EmitterConfig` field, plus `intensity` (multiplies the rate) | `intensity`, `rate` |
| `particle-burst` | The Phase 1 one-shot burst | `count`, `duration`, `colors`, `speed`, `gravity`… | – |
| `glow-border`, `energy-border` | Phase 3 outline effects | see [API.md](API.md) | – |

Placement (every effect except the borders and `screen-shake`): `position` (overlay coordinates) **or** `target`; `offset` (a point in the target's local space, so it rotates with it); `follow` (default true: keep following the target; false: capture its position at start, for an explosion that stays where the impact happened).

Each built-in effect validates its parameters when it starts and throws `InvalidOptionError` with the effect and parameter names.

## 3. Particle system

`ParticleEmitter` (`src/particles/emitter.ts`) is the simulation every particle effect uses. The `particles` effect exposes it directly:

```ts
fx.play('particles', {
  target: 'chest', follow: true,
  shape: { type: 'rect', width: 80, height: 60, edge: true },
  directionMode: 'normal', spread: 20,
  rate: 120, bursts: [{ count: 40 }], duration: 1500, maxParticles: 400,
  lifetime: { min: 400, max: 900 }, speed: { min: 60, max: 140 },
  gravity: { x: 0, y: 220 }, drag: 0.8,
  size: { min: 2, max: 5 }, scale: [0.4, 1, 0],
  opacity: { from: 1, to: 0, easing: 'easeInQuad' },
  rotation: { min: 0, max: 360 }, angularVelocity: { min: -180, max: 180 },
  colorOverLife: ['#FFF3C4', '#FFB300', '#FF3D0000'],
  look: 'spark', blendMode: 'plus',
  space: 'world', inheritVelocity: 0.3,
});
```

| Property | Fields |
| --- | --- |
| Birth | `shape`: `point`, `line` (`from`, `to`), `circle` (`radius`, `edge`), `rect` (`width`, `height`, `edge`, `cornerRadius`), `path` (`PathData`, births along the outline). Shapes are in the emitter's local space |
| Emission | `rate` (per second), `bursts` (`{ at, count }`), `duration`, `maxParticles` (default 500, at most 5000; extra births are dropped) |
| Direction | `direction` (degrees, −90 = up), `spread`, `directionMode`: `fixed`, `normal` (outward from the shape, for borders) or `radial` |
| Motion | `speed`, `gravity` (number = down, or a vector), `drag` (exponential), `inheritVelocity` (world space) |
| Life | `lifetime` |
| Appearance | `size`, `scale` (curve), `opacity` (curve), `rotation`, `angularVelocity`, `alignToVelocity`, `colors` (palette, one per particle) or `colorOverLife`, `look` (`circle`, `square` with `aspect`, `spark` with `stretch`, `ring`, `soft`, or `{ type: 'image', image, frames, frameMode }` for sprite-sheet particles), `blendMode` |

`Spread` values are a number or `{ min, max }`. Curves (`ValueCurve`) are a constant, `{ from, to, easing }` or an array of evenly spaced keys.

**World and local space** (the rule the brief asks to document):
- `space: 'world'` (default): a particle's position is fixed in overlay coordinates at birth. It does not move with the emitter afterwards. Use it for anything left behind: trails, smoke, sparks flying off a moving card, explosion debris. `inheritVelocity` gives newborn particles part of the emitter's velocity.
- `space: 'local'`: particles live in the emitter's coordinate system and move, rotate and scale with it every frame. Use it for things that belong to the object: the particle flames of `fire-border`, an aura.
- In every effect that takes a target, the emitter's transform is the target's transform (position, rotation, scale) every frame while `follow` is true.

**Determinism:** every emitter takes its randomness from a seeded generator (`PlayOptions.seed`, or a seed drawn from the engine's seeded generator). The same seed and the same frame times give the same particles (tested).

**Pooling and bounds:** particle buffers (typed arrays) come from a shared pool sized by capacity, so repeated effects reuse memory (the 100-explosion stress test reuses more buffers than it allocates). Particles are stored in struct-of-arrays form; the simulation allocates nothing per particle per frame. Counts are bounded by `maxParticles`, by the quality profile's particle scale, and by `maxActiveEffects` (default 32).

**Rendering:** the Skia adapter draws `circle`, `square`, `spark`, `ring` and `soft` particles one primitive per particle with a shared paint (`soft` adds a blur mask filter), and image particles with a single `drawAtlas` call per emitter. Batching the vector looks into fewer draw calls is a possible optimization once device measurements show it is needed.

## 4. Shader system

Shaders are SkSL runtime effects described by `ShaderDefinition` (source, typed uniforms, fallback color). They are used as fills of scene shapes, so they inherit the node's transform, opacity, clip and blend mode.

**Reusable primitives** (`SHADER_CHUNKS`): `hash`, `noise` (value noise), `fbm` (fractal noise), `warp` (domain warp), `sdRoundRect`, `sdEllipse` (signed distances to shapes) and `ramp` (color gradient). `composeShader({ name, use, uniforms, main })` assembles them, in dependency order, into one definition:

```ts
import { composeShader } from 'react-native-graphics';

const plasma = composeShader({
  name: 'plasma',
  use: ['fbm'],
  uniforms: { time: 0, size: [100, 100], color: [0.4, 0.8, 1, 1] },
  fallback: '#66CCFF',
  main: `half4 main(float2 p) { float n = fbm(p * 0.03 + time * 0.4); return half4(color.rgb * n, n); }`,
});
engine.scene.createNode({ shape: { type: 'rect', width: 100, height: 100, fill: { type: 'shader', shader: plasma } } });
```

Built on the primitives: `flameBorderShader` (the fire border) and `displacementShader` (heat haze, used by the `distort` node effect). Phase 3's `energyShader` and `fireShader` remain.

| Concern | How it works |
| --- | --- |
| Time | The engine sets `time` (seconds of engine time) and `size` automatically when a shader declares them. Paused engine, paused time |
| Parameters | Uniform values come from the fill (`uniforms: { … }`), are validated by name, type and value count, and can change every frame (fire-border updates intensity, color and flame height this way) |
| Compilation | One central cache in the renderer, keyed by shader source: each program is compiled once per renderer, however many nodes use it (tested with `shaderStats`). `renderer.precompile([...])` compiles ahead of time |
| Unsupported or broken | When runtime shaders are unavailable or compilation fails, the fill falls back to its `fallback` color and the renderer warns once (`onWarning`). Effects check `rendererCapabilities` first: `fire-border` in `auto` mode uses particle flames when shaders are unavailable |
| Bounds and transforms | A shader fills its shape. Coordinates (`p`) are the shape's local coordinates; the shape moves, rotates and scales with its node and effect target. Draw area = the shape's bounds; nothing outside them is shaded |
| Glow, blur, masking, distortion | Node effects (`glow`, `blur`, `drop-shadow`, `color-matrix`, `distort`) render the node through an offscreen layer with an image filter. Masks use blend modes (`dst-in`) inside `group` nodes (Phase 3) |
| Gradients | Linear and radial gradient fills, and `ramp` inside shaders |

## 5. Composition: timelines, cues and Throw & Explode

Effects are combined with the Phase 2 timeline. `fx.cue(effect, params, options)` is a timeline item that starts an effect at an exact time of the timeline, through the playback's own event dispatch (not a JavaScript timer). `params` can be a function evaluated at that moment, for example to read where an object is at its impact.

```ts
const tl = fx.timeline();
tl.add(fx.throw('card', { height: 220, distance: 120, duration: 900, rotation: 540 }));   // markers: launch, peak, impact
tl.add(fx.cue('explosion', { target: 'card', follow: false, particles: 150 }), 900);     // at the impact
tl.add(fx.cue('screen-shake', { scope: ['overlay', 'card'], amplitude: 7 }), 900);
const playback = tl.play();
playback.onMarker('impact', () => {/* app callback, same frame */});
await playback.finished;
```

Cue options: `hold` (how long the cue occupies the timeline so later items wait for the effect), `detached` (keep the effect when the playback is cancelled), `playWhenSkipped` (still play it when `finish()` jumps over it), plus `PlayOptions`.

`fx.throw(target, options)` is an analytical ballistic motion (not a physics engine): launch upwards, slow down to the `peak`, accelerate down to the landing point (`impact`). Options: `height` (200), `distance` (0), `drop` (0), `duration` (1000) **or** `gravity`, `rotation` (360), `restoreOnCancel` (true). It is a pure function of time, so it seeks, pauses and is frame-rate independent.

**Throw & Explode** packages the whole sequence as a reusable function:

```ts
const seq = fx.throwAndExplode('card', {
  throw: { height: 170, distance: 150, duration: 1000, rotation: 540 },
  explosion: { intensity: 1, particles: 150, debris: true },   // false: none
  shake: { amplitude: 9, duration: 380 },                       // false: none
  afterImpact: 'return',                                        // 'stay' | 'return' | 'vanish'
  settleDelay: 700, returnDuration: 450,
});
seq.playback.onMarker('impact', () => {});
seq.playback.cancel();   // or finish(), pause(), resume()
```

Order of events: launch → rotate while rising → `peak` → faster fall → `impact` → explosion (flash, shockwave, sparks, embers, smoke) and shake at the impact point, at the same frame → settle delay → return to the start (or fade back in for `vanish`). Guarantees, each covered by tests:
- Cancelling at any moment restores the view's transform and opacity **synchronously** (a replay started right after `cancel()` starts from the real resting state) and cancels the sequence's own explosion and shake.
- `finish()` jumps to the end state without playing the explosion.
- If the target unmounts mid-flight, the sequence cancels itself and starts nothing for the missing view.
- After a completed sequence, particles that are already flying finish on their own; nothing else is left running.

## 6. Rules for multiple effects

| Situation | Rule |
| --- | --- |
| Several effects on one target | Allowed without limit (within `maxActiveEffects`). They are independent; each follows the target |
| Draw order | By `zIndex` (default 0), then by start order. A negative `zIndex` draws below scene nodes (a glow behind a card sprite) |
| Replacing | Starting an effect with the `key` of a running effect cancels the running one (reason `replaced`). Use keys for "one fire per card" |
| Conflicting transforms | Two animations of the same property of the same object: the newer one takes over that property (`overwrite: 'auto'`; the older playback gets an `interrupted` event). Shakes are offsets added on top of the motion and removed exactly when they end, so they never fight with a throw or a tween |
| Ownership | Effects you start belong to you until they end. Effects a cue starts belong to the playback: cancelling or stopping the playback cancels them (reason `owner`) unless the cue is `detached` |
| Target unmount | The proxy node is destroyed: attached effects end (shader parts disappear at once, world-space particles already emitted finish), running sequences on it cancel, and the view's transform binding is discarded. A remounted target starts untransformed |
| Provider unmount | Everything is cancelled (reason `disposed`) and frame callbacks stop. No callback fires afterwards |
| Shared resources | Compiled shaders, gradients, images and particle buffers are shared and cached; effects never own them |
| Errors | An effect that throws is cancelled (reason `error`) and the error goes to `onError`; other effects keep running |

## 7. React Native targets and the transform binding

A React Native view cannot be drawn by Skia or turned into a texture, and the SDK does not try. Effects are drawn **around** views by the overlay, positioned from the view's measured layout:

```tsx
<GameFXTarget id="card" style={styles.card}>
  <Text>ACE OF SPADES</Text>
</GameFXTarget>
```

`<GameFXTarget>` renders a `View` (Reanimated `Animated.View`) with your style. It registers the id, measures its window rectangle on layout and on `fx.remeasure()` (call it from `onScroll`), and unregisters on unmount.

**Explicit transform binding.** React Native transforms applied elsewhere (your own `Animated` or Reanimated styles) are not observable by the engine. Instead, the engine owns a `TargetMotion` for each target and applies it to the view itself:

```ts
const card = fx.getTarget('card');            // { id, node, motion }
card.motion.x = 30;                           // the real view moves 30 points right
await fx.animate('card', { x: 120, y: -80, rotation: 360, scale: 1.2, duration: 1000 }).finished;
card.motion.reset();
```

- `motion` has `x`, `y`, `rotation`, `scale` (or `scaleX`/`scaleY`) and `opacity`. It is an animation target, so tweens, keyframes, timelines and `fx.throw` animate it.
- Each change is applied to the view through Reanimated shared values (`translateX`, `translateY`, `rotate`, `scaleX`, `scaleY` before the view's own style transform; opacity multiplied with the style's opacity). React does not re-render.
- At the same time the target's proxy node (what effects follow) is placed at the measured layout plus the motion, so fire, glows and trails stay aligned with the moving, rotating, scaling view.
- Layout measurement is deferred while the view is transformed and runs again when the motion returns to identity, so a measured box is always the untransformed layout.
- Shakes on a target (`screen-shake` with `scope: 'card'`) are temporary offsets on this binding: removed exactly when the shake ends, never written into your layout.

What is followed: layout changes, scrolling (with `remeasure`), the transform binding, and `rotation`/`scale` props passed to `<GameFXTarget>`. What is not: transforms you apply to the view by other means.

## 8. Quality, reduced motion and capabilities

| Level | Particle scale | Runtime shaders | Glow | Details (sparks, second rings, smoke in small effects) |
| --- | --- | --- | --- | --- |
| `low` | 0.35 | off (particle fallbacks) | off | off |
| `medium` | 0.65 | on | off | on |
| `high` (default) | 1 | on | on | on |

- Provider prop `quality`, or `fx.setQuality(level)` at runtime; per effect with `PlayOptions.quality`. A level applies to effects started afterwards.
- `adaptiveQuality` (provider prop): the engine averages frame times over windows (default 30 frames) and steps down above 22 ms or up below 14 ms, within `min`/`max`.
- `reducedMotion` (provider prop, default `'system'` = the OS setting via `AccessibilityInfo`, updated live; or `true`/`false`): screen shakes do nothing, flashes are dimmed to 40 %, and the generic particle effects emit half as many particles. Motions you start yourself (throws, tweens) are not changed: read `fx.reducedMotion` and choose.
- The overlay reports the renderer's capabilities (`runtimeShaders`, node effects) to the engine; effects pick a supported path.

Note from the Node benchmark: on `low`, `fire-border` replaces the GPU shader with about 50 CPU-simulated particles per border. That is cheaper for the GPU but costs more JavaScript time (see [PERFORMANCE.md](PERFORMANCE.md)); which is better on a given phone has to be measured there.

## 9. Custom effects

```ts
import { defineComposite, defineEffect, flash, shockwave, particles } from 'react-native-graphics';

// From primitives: a composite of existing effects, with one handle
const pop = defineComposite<{ position: { x: number; y: number } }>({
  name: 'pop',
  layers: (p) => [
    { name: 'flash', effect: flash, params: { position: p.position, radius: 50 } },
    { name: 'ring', effect: shockwave, params: { position: p.position, radius: 70 }, delay: 40 },
    { name: 'bits', effect: particles, params: { position: p.position, bursts: [{ count: 30 }], speed: { min: 80, max: 200 } } },
  ],
});

<GameFXProvider effects={[pop]}>…</GameFXProvider>
fx.play('pop', { position: { x: 100, y: 100 } });
```

`defineEffect({ name, create(params, context) })` writes an effect from scratch: `create` validates the parameters and returns an instance with `drawables`, `done`, `update(elapsedMs)` (elapsed time is absolute, so it is frame-rate independent), `dispose()`, and optionally `stop()` and `setParams()`. `context` gives the seeded `random`, the `quality` profile, `reducedMotion` and engine services (target resolution, camera and target offsets).

## 10. Limitations

- Effects are drawn around React Native views, never into them: no dissolve, distortion or recolouring of a view's own pixels (no view snapshots).
- Transforms of a view that are not made through `motion` are not tracked.
- Measurement (`measureInWindow`) is asynchronous: during scrolling, effects follow with up to one frame of delay.
- All simulation and picture recording run on the JavaScript thread; Skia draws the picture on the UI thread. A busy JS thread delays effect frames (not the app's UI).
- `distort` and `heatHaze` require runtime shaders; without them they are skipped.
- Lightning, ice, dissolve and the other optional presets from the brief were not built.
- Nothing in this guide has been verified on iOS. Android verification is pending for Phase 4 (see [PROGRESS.md](PROGRESS.md)).
