# Architecture

Status: **Phase 2.** Implemented: `runtime` (clocks, local timers, seeded RNG, events, effect contract), `animation` (easing, tweens, keyframes, timelines, playbacks), `scene` (scene graph, transforms, layers, attachments, host-view binding contract), `engine` (the runtime that ties them together), `particles` (burst simulation), `effects` (`particle-burst`), `renderer/skia` (scene shapes and particles) and `react-native` (provider, overlay, hook). `sprites` is planned for Phase 3. Open decisions are listed in [PROGRESS.md](PROGRESS.md).

## What the product is

An embeddable **2D game-effects engine** for existing React Native apps. A host app mounts one transparent overlay and triggers effects (particle bursts, sprites, confetti, explosions, card or image movement) through a typed API. The engine owns its own runtime, scene model, scheduling, effect composition and resource lifecycle. Skia and Reanimated/Worklets are infrastructure underneath, not the product. Game rules and app state stay in the host app.

Not in scope: physics, networking, gameplay rules, editors, 3D, audio, ECS, custom native renderers (see CLAUDE.md "Explicitly deferred").

## Module boundaries

One package to start, with internal modules. Arrows point to what a module may import.

```
            src/react-native  (Provider, Canvas, hooks, anchoring, safe areas, reduced motion)
               |         \
               |          src/renderer/skia   (draws a scene snapshot; owns native graphics resources)
               |         /
   src/effects (typed registry, presets, parameter validation)
        |            \
   src/particles   src/sprites   (emitters, lifetimes, atlases, frame playback)
        |            /
   src/engine (Engine: owns scene, playbacks, effects; frame loop; pause/resume/reset/dispose)
        |            \
   src/scene  (nodes, parent/child transforms, layers, draw order, opacity, bounds, attachments)
        |
   src/animation (easing, tweens, keyframes, timelines, markers, playbacks)
        |
   src/runtime   (clocks, local timers, emitter, errors, seeded RNG, effect contract)
```

`effects` and `particles` depend only on `runtime` (and `scene` for the `Point` type). `engine` depends on all engine modules but on nothing from React, React Native or Skia.

| Module | Pure TS, no React/RN/Skia? | First needed in |
| --- | --- | --- |
| `runtime` | Yes | **Phase 1, extended in Phase 2** |
| `animation` | Yes | **Phase 2 (done)** |
| `scene` | Yes | **Phase 2 (done)** |
| `engine` | Yes | **Phase 2** (moved out of `runtime`, extended) |
| `particles` | Yes (simulation only) | **Phase 1 (burst done)**, Phase 3 |
| `sprites` | Yes (frame math, atlas metadata) | Phase 3 |
| `effects` | Yes | **Phase 1 (`particle-burst` done)**, Phase 4 |
| `renderer/skia` | No: the only module importing `@shopify/react-native-skia` drawing APIs | **Phase 1 (done)** |
| `react-native` | No: host integration | **Phase 1 (done)** |

The "pure" column is **enforced** by an ESLint `no-restricted-imports` rule in `eslint.config.mjs`. It rejects imports of `react`, `react-native`, `react-native-*`, `@shopify/*` and of the `renderer/` and `react-native/` folders from the seven engine modules (`runtime`, `animation`, `scene`, `engine`, `particles`, `sprites`, `effects`).

Belote Tunisienne, or any other game, is an external consumer. Card-specific presets and the mapping from game events to effects live in that consumer, or in an optional adapter in Phase 6.

## Thread model (as implemented in Phases 1 and 2)

The UI-thread worklet approach proposed in Phase 0 was **not** used for the first slice. It needs worklet-compatible simulation code and cannot be verified without a device. Phase 1 uses the simpler, documented fallback:

1. **Simulation runs on the JS thread.** `FrameClock` uses `requestAnimationFrame`. The engine subscribes to it **only while effects are running**, so an idle engine does no per-frame work.
2. Each frame, the engine updates its effects from absolute elapsed time and emits a `frame` event with renderer-independent drawables (typed arrays that are reused, not reallocated).
3. `GameFXOverlay` records those drawables into an `SkPicture` with Skia's `PictureRecorder` (a JSI call, not the old bridge) and assigns it to a Reanimated shared value. The `<Picture>` element in the Skia `<Canvas>` redraws from it. **React does not re-render per frame.**

Consequences and limits:
- A busy JS thread delays effect frames. Effects stay correct (time-based), but may skip frames.
- Moving simulation to the UI thread remains an option for Phase 3. The pure, closed-form particle math was written so it can be moved to worklets later.
- Assigning a JS-recorded `SkPicture` to a shared value works on **Android** (Android 17 emulator, Expo Go, 2026-11-12), on web and in Jest. It is **not verified on iOS yet**, and frame timing has not been measured.
- Phase 2 keeps this model. Animations, timelines and the scene graph run in the same JS-thread frame callback, and the scene is drawn into the same picture as the effects. A frame is published only when something runs or the scene changed; nothing goes through React state.

## Runtime concepts

- **Clock**: injected interface (`now()`, frame subscription). `VirtualClock` for tests (advanced manually, no real sleeps), `FrameClock` (`requestAnimationFrame`) on device.
- **Engine time**: the engine maps clock time through a `LocalTimer`, so `engine.pause()` freezes every playback and effect at once and `resume()` continues without a jump. Every pausable object (engine, effect handle, playback) uses the same `LocalTimer`, which stores an origin and a pause point rather than accumulating deltas.
- **Time sampling**: effects and animations evaluate absolute local time (`now - start - pausedTime`). They never accumulate per-frame deltas, so large frame gaps cannot cause drift, and the same times give the same values at any frame rate (tested).
- **Seeded RNG**: all randomness comes from an injected, seedable generator.
- **Subscription**: the engine listens to the clock only while a playback or effect is playing, or after a scene change (one frame to publish it). An idle or fully paused engine costs nothing per frame.
- **Frame order**: (1) playbacks advance and deliver their markers, (2) effects update (including effects started by markers in step 1), (3) attachments receive their targets' final transforms, (4) one `frame` event publishes the scene drawable (if it has visible shapes) followed by effect drawables.
- **States**: engine `running ⇄ paused → disposed`. Effect handle `playing ⇄ paused → completed | cancelled`. Playback `playing ⇄ paused → completed | cancelled | stopped`. `finished` promises always resolve and never reject. Disposal is idempotent and releases everything.
- **Control**: `cancelAll()` cancels playbacks and effects (values stay where they are). `reset()` stops playbacks back to their initial state and cancels effects; the scene stays. `dispose()` also destroys the scene.
- **Bounded resources**: at most 2000 particles per burst and `maxActiveEffects` (default 32) running effects. The oldest effect is cancelled beyond that limit.

## Animation model (Phase 2)

- **Playable**: the base of tweens, keyframe animations, timelines and waits. It has `delay`, `repeat` (integer or `Infinity`) and `yoyo`. Layout in time: `delay`, then `repeat + 1` iterations of `duration`. `render(t)` is a **pure function of local time**: it sets targets to the state at `t` and keeps no other state than the start values captured at first render. Seeking backwards or forwards therefore equals playing to that point.
- **Tween**: from start values (captured when it first renders past its delay, or given with `from`) to end values with one easing. **KeyframeAnimation**: per-property tracks between keyframes at `at ∈ [0, 1]`, each segment with the easing of the keyframe it approaches.
- **Targets**: anything implementing `AnimationTarget` (`hasProperty`, `getProperty`, `setProperty`, optional `destroyed` and `expandProperty`). Scene nodes implement it; `objectTarget(obj)` adapts plain objects. Unknown properties and non-finite values are rejected when the animation is created. Destroyed targets are never written.
- **Timeline**: places children on one axis by position (`'>'` end, `'<'` with the previous child, `'+=n'`, `'-=n'`, absolute ms, or relative to a marker). Children render in start order so later ones win on shared properties; children that are now in the future but were rendered before return to their initial state (latest first), which makes backward seeks and loops exact. Timelines are locked once played or nested. Infinite children are rejected (repeat the timeline instead). `sequence`, `parallel`, `stagger` and `wait` are thin helpers.
- **Markers and callbacks**: `mark(name, position)` and `call(fn, position)`. Events of nested timelines bubble up with their offsets. With `repeat`, markers fire once per iteration; with `yoyo`, reversed iterations mirror their times.
- **Event timing ("impact")**: a marker fires at its exact timeline time, not at the frame time. When a frame jumps from `t0` to `t1`, the playback collects the events in `(t0, t1]` (the first frame includes 0), sorts them by time (ties keep insertion order), and for each one **renders the state at the event time first, then dispatches it**. After the events it renders `t1`. So a listener for `impact` placed at the end of a fall sees the object exactly on the floor, even if the frame lands 39 ms later (tested). If a listener pauses the playback, it freezes exactly at the marker; if it cancels or seeks, the remaining events of that frame are dropped.
- **Playback**: `engine.run(playable)` or `playable.play()` returns a `Playback` with `pause`, `resume`, `cancel` (values stay), `stop` (values return to the initial state), `finish` (jump to the end and deliver skipped markers with `skipped: true`; an endless loop finishes at the end of its current iteration), `seek` (no events), and events `start`, `pause`, `resume`, `marker`, `loop`, `interrupted`, `end`. The initial state is applied synchronously at `play()`; markers at time 0 fire on the first frame, so listeners attached right after `play()` receive them.
- **Interruption** (`overwrite: 'auto'`, default): when an animation starts, other active playbacks stop writing the overlapping properties of the same target and receive an `interrupted` event; their timing is unchanged. `scale` overlaps `scaleX`/`scaleY`. `overwrite: 'none'` lets both write (the one rendered last wins).

## Scene model (Phase 2)

- `engine.scene` is a renderer-independent scene graph. `SceneNode` has position (its origin in the parent's space), rotation (degrees, clockwise on screen), scale (`scaleX`, `scaleY`, `scale` shorthand), opacity, visibility, `zIndex`, an optional layer (inherited) and an optional built-in shape (`rect` with optional corner radius, or `circle`, centred on the origin).
- Local matrix = translate · rotate · scale. World matrices are cached and invalidated for the subtree when a node or an ancestor changes. `localToWorld`, `worldToLocal`, `localToNode`, world position/rotation/scale, world opacity and visibility, and axis-aligned world bounds are available.
- Hierarchy: `createNode({ parent })`, `addChild` (reparenting, cycle checks), `removeChild`/`removeFromParent` (the node stays alive and can be re-added), `destroy()` (recursive; attachments end with `targetDestroyed`; animations skip destroyed nodes).
- Draw order: layers from bottom to top (`scene.setLayers`), then depth-first within a layer, siblings by `zIndex` then insertion order. Hidden and fully transparent subtrees are skipped. The renderer receives a flat `scene` drawable (`{ matrix, opacity, shape }` per item), never the graph.
- Opacity is multiplied per item. Group opacity with an offscreen layer (so overlapping children do not show through each other) is not implemented.

## Effect attachments and React Native views

**Attachments (implemented as an interface):** `node.attach(attachment, { offset, inheritRotation, inheritScale })` returns a handle. Every frame, after animations, the engine calls `attachment.update(state)` with the world position of the attachment point (the offset is in the node's local space, so it rotates and scales with the node), world rotation, scale, opacity, visibility and whether the node is still in the scene. `onDetach(reason)` is called exactly once with `detached`, `targetDestroyed` or `engineDisposed`. What to do when the target is hidden or leaves the scene is the attachment's decision (for example stop emitting and let particles finish). Phase 3 effects (trails, fire, glow emitters) will implement `Attachment`, so they follow moving and rotating targets without new engine concepts.

**React Native views (designed, not implemented):** the engine cannot capture or transform arbitrary native views, and does not try to. Instead, a view is represented in the scene by a **proxy node** that mirrors its layout, and effects attach to that node. Phase 2 provides the contract (`HostViewBinding`, `HostLayout`, `createHostViewBinding`, `syncNodeToLayout`). The planned React Native side:

1. A hook such as `useGameFXTarget(ref)` creates a proxy node and measures the view with `measureInWindow`, converting window coordinates to overlay coordinates by subtracting the overlay's own window offset. It re-measures on `onLayout`, orientation change and scroll events of a known scroll container.
2. For views moved by the app with Reanimated, the binding would read the same shared values (translate, rotate, scale) instead of measuring every frame. Doing that on the UI thread requires the UI-thread frame path from the thread-model notes; until then it is sampled on the JS thread.
3. When the view unmounts, the binding is disposed: the proxy node is destroyed and attachments end with `targetDestroyed`.

Effects drawn on top of a view are always drawn by the overlay; the view itself is never re-rendered by Skia. Effects that need the view's pixels (dissolve, distortion) would need an explicit snapshot mechanism and are out of scope until there is a decision for it.

## Coordinate spaces

| Space | Meaning |
| --- | --- |
| Canvas (scene/world) | Default. Density-independent points relative to the overlay's top-left corner, matching React Native layout units. Scene world coordinates are canvas coordinates |
| Node-local | A node's own space: origin at its position, axes rotated and scaled with it. Converted with `localToWorld`/`worldToLocal`/`localToNode` |
| Window | Values from `measureInWindow` or touch events. Converted to canvas space by subtracting the overlay's window offset |
| Target-relative | An effect anchored to a host view (`ref`). The host view is measured and converted to canvas space. Re-measure on layout, scroll or rotation |

Safe-area insets are exposed to effects as data. They are not applied silently, because a full-screen celebration may intentionally draw under the notch. Every public API that accepts a position states which space it uses.

## Host integration

- `<GameFXProvider>` owns the runtime, registry and lifecycle scope for its subtree.
- `<GameFXOverlay>` (named `GameFXCanvas` in the Phase 0 proposal) is an absolutely positioned, transparent Skia canvas with `pointerEvents="none"` by default, so it never blocks the host app's touches. Interactive modes are opt-in.
- `useGameFX()` returns the typed API (`play`, `cancelAll`, `activeCount`, `ready`, and `engine` for scene nodes, animations and timelines). Custom effects are registered through the provider's `effects` prop, scene layers through `layers`.
- Unmounting the provider cancels every playback and effect, destroys the scene (ending attachments), and stops frame callbacks. No effect or marker callback fires after unmount.
- Reduced motion (`AccessibilityInfo`) and a quality setting are planned provider options (not in Phase 1).

## Effects and extensibility

- A typed **registry** maps preset names to definitions. `fx.play('confetti', params)` is type-checked against that preset's parameter type.
- Consumers register custom presets through the same public API that built-in presets use. They never modify engine internals.
- Parameters are validated at `play()` time with clear error messages.

## Packaging and consumer contract

- Native libraries (`react`, `react-native`, `@shopify/react-native-skia`, `react-native-reanimated`, `react-native-worklets`) become **peer dependencies**. The SDK does not bundle them.
- Version baseline proposed from Expo SDK 58 (current on 2026-11-11): React Native 0.88.1, React 19.3.0, Reanimated 4.7.1, Worklets 0.13.0, Skia 2.14.0. Reanimated 4 requires the New Architecture.
- A **separate example app** (`example/`) installs the SDK from the `npm pack` tarball and imports only `react-native-graphics`. CI packs the SDK, installs it into the example, type-checks it and bundles it for Android and iOS, so private paths cannot leak into the contract.
- Entry points: `react-native-graphics` (everything) and `react-native-graphics/core` (no React Native, React or Skia imports).

## What carries over from the earlier card-SDK design

Kept as-is: strict TypeScript, Jest, ESLint and the CI toolchain; the virtual clock and seeded RNG; time sampling without drift; handles whose promise resolves on cancel; lifecycle scopes with cleanup on unmount; logical coordinates; game state staying outside the SDK.

Changed: Skia is now the primary renderer instead of Reanimated view transforms. The engine gets its own scene model and effect registry. Card presets are no longer core (they become a later demo preset or consumer code). Game-event reconciliation (duplicates, reconnects) moves to the optional Belote adapter.
