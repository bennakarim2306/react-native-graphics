# Architecture

Status: **Phase 1.** Implemented so far: `runtime` (engine, clocks, seeded RNG, effect contract), `particles` (burst simulation), `effects` (`particle-burst`), `renderer/skia` and `react-native` (provider, overlay, hook). `animation`, `scene` and `sprites` are still plans for Phases 2 and 3. Open decisions are listed in [PROGRESS.md](PROGRESS.md).

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
   src/scene  (nodes, parent/child transforms, layers, draw order, opacity, bounds, coordinate transforms)
        |
   src/animation (timelines, keyframes, easing, interpolation, motion paths, sequence/parallel/stagger)
        |
   src/runtime   (clock, scheduler, update loop, effect handles + state machine, cancel/pause/resume/repeat/seek, seeded RNG)
```

| Module | Pure TS, no React/RN/Skia? | First needed in |
| --- | --- | --- |
| `runtime` | Yes | **Phase 1 (done, minimal)**, Phase 2 (full) |
| `animation` | Yes | Phase 2 |
| `scene` | Yes | Phase 2 |
| `particles` | Yes (simulation only) | **Phase 1 (burst done)**, Phase 3 |
| `sprites` | Yes (frame math, atlas metadata) | Phase 3 |
| `effects` | Yes | **Phase 1 (`particle-burst` done)**, Phase 4 |
| `renderer/skia` | No: the only module importing `@shopify/react-native-skia` drawing APIs | **Phase 1 (done)** |
| `react-native` | No: host integration | **Phase 1 (done)** |

The "pure" column is **enforced** by an ESLint `no-restricted-imports` rule in `eslint.config.mjs`. It rejects imports of `react`, `react-native`, `react-native-*`, `@shopify/*` and of the `renderer/` and `react-native/` folders from the six engine modules.

Belote Tunisienne, or any other game, is an external consumer. Card-specific presets and the mapping from game events to effects live in that consumer, or in an optional adapter in Phase 6.

## Thread model (Phase 1, as implemented)

The UI-thread worklet approach proposed in Phase 0 was **not** used for the first slice. It needs worklet-compatible simulation code and cannot be verified without a device. Phase 1 uses the simpler, documented fallback:

1. **Simulation runs on the JS thread.** `FrameClock` uses `requestAnimationFrame`. The engine subscribes to it **only while effects are running**, so an idle engine does no per-frame work.
2. Each frame, the engine updates its effects from absolute elapsed time and emits a `frame` event with renderer-independent drawables (typed arrays that are reused, not reallocated).
3. `GameFXOverlay` records those drawables into an `SkPicture` with Skia's `PictureRecorder` (a JSI call, not the old bridge) and assigns it to a Reanimated shared value. The `<Picture>` element in the Skia `<Canvas>` redraws from it. **React does not re-render per frame.**

Consequences and limits:
- A busy JS thread delays effect frames. Effects stay correct (time-based), but may skip frames.
- Moving simulation to the UI thread remains an option for Phase 3. The pure, closed-form particle math was written so it can be moved to worklets later.
- Assigning a JS-recorded `SkPicture` to a shared value has been verified on **web** (Reanimated web + CanvasKit) and in Jest. It has **not been verified on Android or iOS yet**.

## Runtime concepts

- **Clock**: injected interface (`now()`, frame subscription). `VirtualClock` for tests (advanced manually, no real sleeps). Frame clock adapter on device.
- **Time sampling**: effects evaluate `t = now - start - pausedTime`, clamped to the effect's duration. They do not accumulate per-frame deltas, so large frame gaps cannot cause drift. Large deltas are a required test case.
- **Seeded RNG**: all randomness (emission angles, colors, jitter) comes from an injected, seedable generator. The same seed gives the same particles in tests.
- **Effect handle** (Phase 1): `fx.play(...)` returns a handle with `cancel()`, `status` and `finished: Promise<{ status: 'completed' | 'cancelled', reason? }>`. `finished` **resolves** on cancel and never rejects, so skipped effects cannot cause unhandled rejections. Invalid parameters throw synchronously at `play()`. `pause`, `resume`, `finish` and `seek` are planned for Phase 2.
- **States** (Phase 1): `playing -> completed | cancelled`. The engine itself is `running -> disposed`. Disposal releases all resources and is idempotent.
- **Effect contract**: `EffectDefinition.create(params, { random })` validates and returns an `EffectInstance` with `update(elapsedMs)`, `done`, `drawables` and `dispose()`. The engine calls `dispose` exactly once.
- **Bounded resources**: at most 2000 particles per burst and `maxActiveEffects` (default 32) running effects. The oldest effect is cancelled beyond that limit.

## Scene model (Phase 2, kept minimal)

Nodes with a local transform (translate, rotate, scale, opacity), children, a layer and a z-order. World transforms are computed by pure functions. Renderers consume a **flat, sorted draw list** produced from the scene, never the scene graph itself. This keeps Skia out of the model and makes a second renderer possible later.

## Coordinate spaces

| Space | Meaning |
| --- | --- |
| Canvas | Default. Density-independent points relative to the overlay's top-left corner, matching React Native layout units |
| Window | Values from `measureInWindow` or touch events. Converted to canvas space by subtracting the overlay's window offset |
| Target-relative | An effect anchored to a host view (`ref`). The host view is measured and converted to canvas space. Re-measure on layout, scroll or rotation |

Safe-area insets are exposed to effects as data. They are not applied silently, because a full-screen celebration may intentionally draw under the notch. Every public API that accepts a position states which space it uses.

## Host integration

- `<GameFXProvider>` owns the runtime, registry and lifecycle scope for its subtree.
- `<GameFXOverlay>` (named `GameFXCanvas` in the Phase 0 proposal) is an absolutely positioned, transparent Skia canvas with `pointerEvents="none"` by default, so it never blocks the host app's touches. Interactive modes are opt-in.
- `useGameFX()` returns the typed API (`play`, `cancelAll`, `activeCount`, `ready`). Custom effects are registered through the provider's `effects` prop.
- Unmounting the provider cancels and disposes every effect, stops frame callbacks and releases images and atlases. No effect callback fires after unmount.
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
