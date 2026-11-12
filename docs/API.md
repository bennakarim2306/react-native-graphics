# Public API (Phase 3)

Everything below is exported from `react-native-graphics`. The platform-independent subset (engine, scene graph, animations, clocks, graphics descriptions, assets, sprites, particles, effect definitions) is also exported from `react-native-graphics/core`, which does not import React Native, React or Skia. The API is **pre-1.0 and may change**.

## Coordinates

All positions are **canvas coordinates**: density-independent points relative to the top-left corner of the `GameFXOverlay`. Scene nodes use the same space: a node's world position is a canvas position. Rotations are degrees, clockwise on screen.

- Touches and other window coordinates (`pageX`/`pageY`, `measureInWindow`): convert with `fx.fromWindow({ x, y })`, which subtracts the overlay's measured window origin.
- React Native views: wrap them in `<GameFXTarget id>`; the proxy node `engine.targets.node(id)` sits at the view's centre in canvas coordinates. Children of the proxy node are positioned relative to that centre.
- Safe-area handling is not applied automatically.

## React Native integration

### `<GameFXProvider>`

Creates one engine when it mounts and disposes it when it unmounts. Disposal cancels every running effect and playback (their `finished` promises resolve with `{ status: 'cancelled', reason: 'disposed' }`), destroys the scene and stops the frame loop.

| Prop | Type | Default |
| --- | --- | --- |
| `effects` | `EffectDefinition[]` | none (built-in effects are always registered) |
| `seed` | `number` | `0x5eed` |
| `maxActiveEffects` | `number` | `32` (the oldest is cancelled with reason `limit` beyond it) |
| `layers` | `string[]` | `['default']` (scene layers, bottom to top; `default` is always present) |
| `clock` | `Clock` | `requestAnimationFrame` clock |
| `onError` | `(error) => void` | rethrow on a microtask |
| `assets` | `Record<id, source>` | none. Registered at mount (`require('./a.png')`, URI, `{ uri }`, bytes) |
| `assetBudget` | `number` (bytes) | 64 MiB soft budget for decoded images |
| `assetManager` | `AssetManager` | none. Share one manager between providers (you dispose it) |
| `imageLoader` | `ImageLoader` | Skia loader (`createSkiaImageLoader()`) |

Props are read once at mount.

### `<GameFXOverlay>`

A transparent, absolutely positioned Skia canvas that draws the provider's scene and effects (scene below, effects on top). It has `pointerEvents="none"`, so it never intercepts touches. Render it as the last child of the view it should cover, so it draws above your UI. It measures its window position so targets and `fromWindow` convert correctly. Renderer warnings (failed shader compilation, unloaded images, unsupported drawables) are logged once each in development. Props: `style`, `testID`.

### `<GameFXTarget id>`

Wraps its children in a `View` and anchors effects to it. The engine keeps a proxy scene node at the view's centre with the view's size.

| Prop | Type | Default |
| --- | --- | --- |
| `id` | `string` | required, unique per provider |
| `trackEveryFrame` | `boolean` | `false`. Measure on every engine frame (views moved by transforms) |
| `rotation`, `scale` | `number` | none. Known transform of the view (measurement is axis-aligned) |
| `style`, `testID` | | |

Measured on mount, on layout changes, on `fx.remeasure()` (call it from `onScroll`) and when the overlay moves. On unmount the proxy node is destroyed and attached effects end. The children are ordinary React Native views; Skia does not render them.

### `useGameFXAssets(ids)`

`const { status, assets, error } = useGameFXAssets(['coin', 'slime'])` loads registered ids (shared and cached) and re-renders once with `status: 'ready'` (assets by id) or `'error'`.

### `useGameFX(): GameFX`

| Member | Description |
| --- | --- |
| `play(name, params, options?)` | Starts an effect and returns an `EffectHandle`. Built-in names are type-checked. You can also pass an `EffectDefinition` instead of a name. `options.seed` makes one instance reproducible. |
| `attach(target, effect, params?, options?)` | Starts an effect that follows a target: a `<GameFXTarget>` id or a scene node. Built-in attachable effects (`glow-border`, `energy-border`, `fire-border`) are type-checked. Throws `InvalidOptionError` for unknown ids. |
| `remeasure(id?)` | Asks targets (all, or one) to measure again, for example after scrolling. |
| `fromWindow(point)` | Window point → canvas point. |
| `assets` | The provider's `AssetManager` (or `null` until `ready`). |
| `cancelAll()` | Cancels every running effect and animation playback of this provider. |
| `activeCount` | Number of running effects. |
| `ready` | `false` only during the provider's very first render. Calling `play` then throws. |
| `engine` | The provider's `Engine` (scene, animations, timelines), or `null` until `ready`. |

It throws if used outside a `GameFXProvider`. `useGameFXEngine()` returns the underlying `Engine` (or `null` during the first render), for example to listen to `effectStart` or `effectEnd`.

## Effects

### `particle-burst`

A one-shot radial burst. Every particle is spawned at `position` and moves ballistically: `p(t) = p0 + v·t + ½·g·t²`. Scale and opacity change linearly over each particle's own lifetime. The effect completes when the last particle expires.

| Param | Type | Default | Valid range |
| --- | --- | --- | --- |
| `position` | `{ x, y }` | required | finite |
| `count` | `number` | `50` | integer 1 to 2000 |
| `duration` | `number` (ms) | `800` | > 0. Longest particle lifetime |
| `minLifetimeRatio` | `number` | `0.6` | 0 to 1. Shortest lifetime = ratio × duration |
| `speed` | `number \| { min, max }` (pt/s) | `{ min: 80, max: 260 }` | ≥ 0, min ≤ max |
| `direction` | `number` (deg) | `-90` (up) | finite. 0 = right, 90 = down |
| `spread` | `number` (deg) | `360` | 0 to 360 |
| `gravity` | `number \| { x, y }` (pt/s²) | `400` (down) | finite |
| `size` | `number` (pt radius) | `4` | ≥ 0 |
| `scale` | `{ from, to }` | `{ from: 1, to: 0.3 }` | ≥ 0 |
| `opacity` | `{ from, to }` | `{ from: 1, to: 0 }` | 0 to 1 |
| `colors` | `string[]` | warm gold palette | 1 to 256 Skia color strings |

### `glow-border`, `energy-border`, `fire-border`

Outlines that follow a target (start them with `fx.attach(id, name, params)` or `engine.attach(node, name, params)`). Every frame they read the target's position, rotation, scale and size and draw a rounded rectangle around it. The line width does not scale with the target. They hide while the target is hidden or out of the scene and complete when it is destroyed, when `duration` passes, or on `cancel()`.

| Param | Effects | Default |
| --- | --- | --- |
| `target` | all | set by `attach` |
| `padding`, `cornerRadius` | all | `4`, `12` (pt) |
| `width` | all | `3` (glow), `4` (shader borders) |
| `duration` | all | runs until cancelled |
| `color`, `radius`, `pulse`, `intensity` | `glow-border` | `#FFD54A`, `10` pt, `1` per second, `1` |
| `shader`, `uniforms`, `intensity`, `glowColor` | `energy-border`, `fire-border` | built-in shader; `intensity` maps to `speed` (energy) or `intensity` (fire) |

## Effect handles

```ts
interface EffectHandle {
  readonly id: number;
  readonly effect: string;
  readonly status: 'playing' | 'paused' | 'completed' | 'cancelled';
  readonly finished: Promise<{ status: 'completed' | 'cancelled'; reason?: 'user' | 'cancelAll' | 'limit' | 'reset' | 'disposed' }>;
  pause(): void;  // freezes this effect's time
  resume(): void;
  cancel(): void; // idempotent
}
```

- `finished` **never rejects**, so cancelled or skipped effects cannot cause unhandled promise rejections.
- Invalid parameters or unknown effect names throw `InvalidOptionError` **synchronously** from `play`, before anything is allocated.
- Using a disposed engine throws `DisposedError`.
- If an effect's `update` throws, that effect is cancelled and the error goes to `onError`. Other effects keep running.

## Custom effects

```ts
import { defineEffect, ParticleBurst, resolveBurstParams } from 'react-native-graphics';

const fountain = defineEffect<{ x: number; y: number }>({
  name: 'fountain',
  create({ x, y }, { random }) {
    const burst = new ParticleBurst(resolveBurstParams({ position: { x, y }, direction: -90, spread: 30 }), random);
    return {
      update: (elapsedMs) => burst.update(elapsedMs),
      get done() { return burst.done; },
      drawables: [burst],
      dispose: () => burst.dispose(),
    };
  },
});

<GameFXProvider effects={[fountain]}>…</GameFXProvider>
fx.play(fountain, { x: 100, y: 400 });   // typed
fx.play('fountain', { x: 100, y: 400 }); // by name, params checked at runtime only
```

An `EffectInstance` receives the **elapsed time since it started** (not a per-frame delta), must report `done`, expose renderer-independent `drawables`, and release resources in `dispose` (called exactly once). The Skia renderer draws `scene` and `particles` drawables. Other kinds are skipped and reported once. An effect can draw shapes, images and filters by publishing a `SceneDrawable` (`{ kind: 'scene', time, items, commands }`); the border effects do this.

## Scene graph

```ts
const { scene } = engine;                       // or useGameFX().engine.scene
const table = scene.createNode({ x: 200, y: 300 });
const card = scene.createNode({
  parent: table,                                 // default: the scene root; null: detached
  y: -40, rotation: 15, scale: 1.2, opacity: 1, zIndex: 2, layer: 'cards',
  shape: { type: 'rect', width: 44, height: 64, color: '#fff', cornerRadius: 6 },
});
card.getWorldPosition();        // { x, y } in canvas coordinates
card.localToWorld({ x: 0, y: 32 });
card.worldToLocal(point);      // throws InvalidOptionError if a scale of 0 makes it undefined
card.localToNode(point, other);
card.getWorldRotation(); card.getWorldScale(); card.worldOpacity; card.worldVisible;
card.getLocalBounds(); card.getWorldBounds();   // from the shape, axis-aligned
table.addChild(node); node.removeFromParent(); node.destroy(); node.traverse(fn);
scene.setLayers(['background', 'cards', 'fx']); scene.findByName('card'); scene.nodeCount;
```

| Node property | Meaning |
| --- | --- |
| `x`, `y` | Position of the node's origin in its parent's space. Shapes are centred on the origin |
| `rotation` | Degrees, clockwise on screen |
| `scaleX`, `scaleY`, `scale` | `scale` reads `scaleX` and writes both |
| `opacity` | Multiplied with ancestors, clamped to [0, 1] when drawing |
| `visible` | Hidden nodes and their subtrees are not drawn |
| `zIndex` | Order among siblings (higher on top), ties keep insertion order |
| `layer` | Layer name (inherited when unset). Layers draw bottom to top |
| `shape` | Optional visual, centred on the origin (paths use their own coordinates). See "Graphics" |
| `blendMode` | How the node composites: `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `plus`, `src-in`, `dst-in`, `dst-out` |
| `effects` | `NodeEffect[]` applied to the node and its subtree (offscreen layer) |
| `group` | Draw the subtree into its own layer (for masks with `dst-in` children) |
| `clipChildren` | Clip descendants to the node's shape outline |
| `size` | `{ width, height }` for nodes without a shape (bounds, attachments) |

Invalid values (non-finite numbers, unknown layers, invalid shapes, cycles, nodes from another scene) throw `InvalidOptionError`. Using a destroyed node's hierarchy methods throws `DisposedError`; property writes to a destroyed node are ignored.

## Graphics

```ts
import { PathData, defineShader, energyShader, grayscale } from 'react-native-graphics';

scene.createNode({ shape: { type: 'rect', width: 80, height: 50, cornerRadius: 8,
  fill: { type: 'linear-gradient', start: { x: -40, y: 0 }, end: { x: 40, y: 0 }, colors: ['#FF7043', '#FFD54A'] },
  stroke: { fill: '#FFFFFF', width: 2, join: 'round' } } });
scene.createNode({ shape: { type: 'ellipse', width: 60, height: 30, fill: { type: 'radial-gradient', center: { x: 0, y: 0 }, radius: 30, colors: ['#fff', '#000'] } } });
const star = new PathData().polygon(0, 0, 5, 30, 12);           // also moveTo/lineTo/quadTo/cubicTo/close/rect/ellipse
scene.createNode({ shape: { type: 'path', path: star, color: '#FFD54A' } });
scene.createNode({ shape: { type: 'image', image: engine.assets.get('hero'), width: 64, height: 64, anchor: { x: 0.5, y: 1 } } });
scene.createNode({ effects: [{ type: 'glow', color: '#7FDBFF', radius: 12 }], shape: { type: 'circle', radius: 20, fill: { type: 'shader', shader: energyShader } } });
group.effects = [grayscale(1), { type: 'blur', radius: 4 }];
window.clipChildren = true;

const ripple = defineShader({
  name: 'ripple',
  uniforms: { time: 0, size: [1, 1], tint: [0.2, 0.6, 1, 1] },   // declaration order; time and size are filled in
  fallback: '#3399FF',
  source: `uniform float time; uniform float2 size; uniform float4 tint;
half4 main(float2 p) { float d = length(p / size - 0.5); return half4(tint.rgb * (0.5 + 0.5 * sin(d * 40 - time * 6)), 1); }`,
});
```

| Shape | Fields |
| --- | --- |
| `rect` | `width`, `height`, `cornerRadius?` + paint |
| `circle` | `radius` + paint |
| `ellipse` | `width`, `height` + paint |
| `path` | `path: PathData` + paint (local coordinates) |
| `image` | `image: ImageAsset`, `source?` (rect in image pixels), `width?`, `height?` (default: source size), `anchor?` (default centre), `smoothing?` (`linear` or `nearest`) |

Paint = `color?` (shorthand), `fill?: Fill`, `stroke?: { fill, width, cap?, join? }`; at least one is required. `Fill` is a color string, `{ type: 'linear-gradient', start, end, colors, positions? }`, `{ type: 'radial-gradient', center, radius, colors, positions? }` or `{ type: 'shader', shader, uniforms? }`.

**Node effects:** `{ type: 'glow', color, radius, strength? }`, `{ type: 'blur', radius }`, `{ type: 'drop-shadow', dx, dy, radius, color }`, `{ type: 'color-matrix', matrix }` (20 numbers), helpers `grayscale(amount)`, `brightness(factor)`.

**Shaders:** `defineShader({ name, source, uniforms?, fallback? })`. SkSL source with `half4 main(float2 p)`; `p` starts at the shape's top-left corner. `time` (seconds) and `size` are automatic. Built-ins: `energyShader` (`colorA`, `colorB`, `speed`), `fireShader` (`intensity`). If runtime shaders are unavailable or compilation fails, the fallback color is drawn and a warning is reported once. Scenes with visible shader fills keep the engine drawing every frame.

**Masks:** put a child with `blendMode: 'dst-in'` inside a node with `group: true`; the child's alpha (a gradient or an image covering the group) masks the group.

Renderer capabilities: `new SkiaEffectsRenderer(Skia).capabilities` (`kinds`, `shapes`, `runtimeShaders`, `nodeEffects`, `blendModes`, `gradients`, `clipping`).

## Assets

```ts
<GameFXProvider assets={{ coin: require('./coin-sheet.png') }}>…</GameFXProvider>

const { status, assets } = useGameFXAssets(['coin']);       // or:
const { coin } = await engine.assets.load(['coin']);        // or register + load: load({ id: source })
engine.assets.state('coin');      // 'registered' | 'loading' | 'loaded' | 'error'
engine.assets.get('coin');        // throws unless loaded; peek() returns undefined instead
engine.assets.on('error', ({ id, error }) => …);
engine.assets.unload('coin');     // throws while in use; { force: true } frees anyway
engine.assets.remove('coin'); engine.assets.stats; engine.assets.dispose();
```

- Same id loaded twice → one request, one decoded image. Failed loads reject with `AssetLoadError` (`assetId`, `cause`) and can be retried.
- Image shapes and sprites retain their image; unreferenced images are evicted least-recently-used first when the byte budget is exceeded.
- `addImage(id, { native, width, height })` adds an image decoded elsewhere.
- `AssetManager` takes `{ loader, maxBytes, onError }`; `createSkiaImageLoader()` is the React Native loader.

## Sprites

```ts
const sheet = engine.createSpriteSheet({
  image: 'coin',                                    // asset id or ImageAsset
  grid: { frameWidth: 64, frameHeight: 64 },         // or frames: [{ x, y, width, height }, …]
  animations: {
    spin: { frames: { from: 0, to: 7 }, fps: 12, loop: true },
    flip: { frames: [0, 2, 4, 6], frameDuration: [80, 40, 40, 120], direction: 'alternate', events: [{ at: 2, name: 'edge' }] },
  },
});
const coin = engine.createSprite({ sheet, parent: table, x: 20, scale: 2, width: 64, height: 64, anchor: { x: 0.5, y: 0.5 } });
const playback = coin.play('spin', { speed: 2 });   // Playback: pause, resume, speed, stop, finish, seek, onMarker
playback.speed = 0.5;
coin.play('flip').onMarker('edge', () => …);        // replaces the previous play() animation
engine.timeline().add(engine.animate(coin, { x: 200 })).add(coin.animation('spin', { repeat: 2 }), '<');
coin.frame = 3; coin.stopAnimation(); coin.destroy();
```

| Animation field | Meaning |
| --- | --- |
| `frames` | Sheet frame numbers, or `{ from, to }` (inclusive, may count down) |
| `fps` / `frameDuration` | Default 12 fps; `frameDuration` (ms, one value or one per frame) wins |
| `loop` | `true` loops forever; a number repeats that many extra times |
| `direction` | `forward`, `reverse`, `alternate` (ping-pong without repeating the ends) |
| `events` | `[{ at, name }]`: marker when the `at`-th frame of the list is shown |

Sprite animations run on the engine clock, pause with `engine.pause()`, and deliver frame events at their exact time even when frames are skipped.

## Animations

```ts
const rise = engine.animate(card, { y: -230, rotation: 360, duration: 520, easing: 'easeOutQuad' });
const fall = engine.animate(card, { y: 0, duration: 560, easing: 'easeInQuad' });
const squash = engine.keyframes(card, {
  duration: 260,
  keyframes: [
    { at: 0.3, scaleX: 1.3, scaleY: 0.7, easing: 'easeOutQuad' },
    { at: 1, scaleX: 1, scaleY: 1, easing: 'easeOutBack' },
  ],
});

const throwCard = engine.timeline()
  .add(rise)
  .add(fall)
  .mark('impact')          // the impact is the end of the fall: when the card touches the floor
  .add(squash)
  .call(() => console.log('settled'));

const playback = throwCard.play();          // same as engine.run(throwCard)
playback.onMarker('impact', ({ time, skipped }) => {
  if (!skipped) fx.play('particle-burst', { position: card.localToWorld({ x: 0, y: 32 }) });
});
const result = await playback.finished;     // { status: 'completed' | 'cancelled' | 'stopped', reason? }
```

**Common options** (tweens, keyframes, timelines): `delay` (ms, default 0), `repeat` (extra iterations, integer or `Infinity`, default 0), `yoyo` (reverse every other iteration).

**Tween options:** the properties to animate with their end values, plus `duration` (ms, default 300, 0 jumps to the end), `easing`, `from` (explicit start values), `overwrite` (`'auto'` default, or `'none'`). Start values are captured when the tween first renders past its delay.

**Keyframes:** `keyframes: [{ at: 0..1, easing?, ...values }]` in ascending `at` order; each property interpolates between the keyframes that mention it and starts from its current value if its first keyframe is after 0.

**Easings:** `linear`, `easeIn|Out|InOut` + `Quad`, `Cubic`, `Sine`, `Back`, `Bounce`, the aliases `easeIn`, `easeOut`, `easeInOut` (cubic), `cubicBezier(x1, y1, x2, y2)`, or any `(t) => number`.

**Targets:** scene nodes (`x`, `y`, `rotation`, `scale`, `scaleX`, `scaleY`, `opacity`) and `objectTarget(plainObject)` for any numeric fields. Other `AnimationTarget` implementations are possible.

**Timeline:** `add(playable, position?)`, `mark(name, position?)`, `call(fn, position?)`, `duration`, `totalDuration`, `children`, `markerTime(name)`. Positions: `'>'` (default, after everything so far), `'<'` (with the previous child), `'+=200'`, `'-=200'`, a number (ms), `'impact'`, `'impact+=50'`. Helpers: `engine.sequence(items)`, `engine.parallel(items)`, `engine.stagger(items, eachMs)`, `engine.wait(ms)`. The same functions exist unbound (`timeline()`, `tween()`, `keyframes()`, `sequence()`, ...) for use with `engine.run`.

Rules: a timeline cannot be changed after it was played or nested; a playable can be in one timeline only and run in one playback at a time; infinitely repeating children are rejected inside timelines.

### Playback

| Member | Behaviour |
| --- | --- |
| `status` | `playing`, `paused`, `completed`, `cancelled`, `stopped` |
| `time`, `duration` | Current and total time in ms (`Infinity` for endless loops) |
| `finished` | Resolves once with `{ status, reason? }` (reasons: `user`, `cancelAll`, `reset`, `disposed`). Never rejects |
| `pause()`, `resume()` | From a marker listener, `pause()` freezes exactly at the marker |
| `cancel()` | Ends where it is; values keep their current state |
| `stop()` | Ends and returns every animated value to its initial state |
| `finish()` | Jumps to the end; markers and callbacks passed over are delivered with `skipped: true`. Endless loops finish at the end of the current iteration |
| `seek(ms)` | Moves without emitting markers, while playing or paused |
| `speed` | Rate (1 normal, 2 double, 0 frozen). Changes are continuous; negative values throw |
| `on(type, fn)` | `start`, `pause`, `resume`, `marker`, `loop`, `interrupted`, `end` |
| `onMarker(name, fn)` | One marker by name |

**Event timing:** markers fire in timeline-time order, and before each one the playback renders the exact state at the marker time, so the `impact` listener sees the card exactly at the floor even if the frame arrives later. The initial state is applied at `play()`; markers at time 0 fire on the first frame. Errors thrown by listeners and `call` callbacks go to `onError` and do not stop the playback.

**Interruption:** with `overwrite: 'auto'`, a newly started animation takes over overlapping properties of the same target from other playbacks (they get an `interrupted` event with the properties and keep their timing). `scale` overlaps `scaleX`/`scaleY`.

## Attachments

```ts
const handle = card.attach({
  onAttach(target) {},
  update(state) { /* state.x, y, rotation, scaleX, scaleY, opacity, visible, inScene, time */ },
  onDetach(reason) { /* 'detached' | 'targetDestroyed' | 'engineDisposed', exactly once */ },
}, { offset: { x: 0, y: -32 }, inheritRotation: true, inheritScale: true });
handle.detach();
```

`update` runs every frame after animations, with the world transform of the attachment point and the target's `width`/`height`. The border effects are built on it. `engine.targets` (`TargetRegistry`: `register`, `updateWindowLayout`, `setOrigin`, `node`, `layout`, `unregister`, `requestRemeasure`, events `added`, `layout`, `removed`, `remeasure`) is what `<GameFXTarget>` uses; `createHostViewBinding` and `syncNodeToLayout` remain available for custom host integrations.

## Engine without React (`react-native-graphics/core`)

```ts
import { createEngine, particleBurst, VirtualClock } from 'react-native-graphics/core';

const clock = new VirtualClock();
const engine = createEngine({ clock, effects: [particleBurst], seed: 1 });
engine.on('frame', ({ drawables }) => { /* draw with any renderer */ });
const node = engine.scene.createNode();
engine.animate(node, { x: 100, duration: 500 }).play();
const handle = engine.play('particle-burst', { position: { x: 0, y: 0 } });
clock.advance(1000, { frameMs: 16 });  // deterministic frames
engine.dispose();
```

`Engine` members: `scene`, `assets`, `targets`, `createSprite`, `createSpriteSheet`, `attach`, `play`, `animate`, `keyframes`, `timeline`, `sequence`, `parallel`, `stagger`, `wait`, `run`, `register`, `hasEffect`, `pause`, `resume`, `cancelAll`, `reset`, `dispose`, `now()`, `on('frame' | 'effectStart' | 'effectEnd' | 'playbackStart' | 'playbackEnd')`, `state` (`running`, `paused`, `disposed`), `activeCount`, `playbackCount`, `drawables`. Clocks: `VirtualClock` (manual, for tests) and `FrameClock` (injected `requestFrame`/`cancelFrame`/`now`).

Note: `lib/` is ESM without file extensions. It works with Metro, Jest/Babel and bundlers, but not with plain Node `import` yet (planned for packaging in Phase 5).
