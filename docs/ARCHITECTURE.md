# Architecture

Status: **Phase 0 proposal.** Only the toolchain and the lint boundary below exist in code. Everything else is the target the next phases build and prove. Decisions still open are listed in [PROGRESS.md](PROGRESS.md#pending-decisions).

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
| `runtime` | Yes | Phase 1 (minimal), Phase 2 (full) |
| `animation` | Yes | Phase 2 |
| `scene` | Yes | Phase 2 |
| `particles` | Yes (simulation only) | Phase 1 (one burst), Phase 3 |
| `sprites` | Yes (frame math, atlas metadata) | Phase 3 |
| `effects` | Yes | Phase 1 (one preset), Phase 4 |
| `renderer/skia` | No: the only module importing `@shopify/react-native-skia` | Phase 1 |
| `react-native` | No: host integration | Phase 1 |

The "pure" column is **enforced** by an ESLint `no-restricted-imports` rule in `eslint.config.mjs`. It rejects imports of `react`, `react-native`, `react-native-*`, `@shopify/*` and of the `renderer/` and `react-native/` folders from the six engine modules.

Belote Tunisienne, or any other game, is an external consumer. Card-specific presets and the mapping from game events to effects live in that consumer, or in an optional adapter in Phase 6.

## Thread model (to be proven in Phase 1)

The decision is **not final** until the Phase 1 vertical slice runs on a device.

**Proposal:** per-frame simulation runs on the **UI thread** inside a Reanimated `useFrameCallback`. Results go into shared values that Skia reads directly. Particles are drawn as a single Skia `Atlas` (one draw call with per-particle transforms). React does not re-render per frame. The JS thread only starts, cancels and disposes effects.

- This requires the simulation functions to be **worklet-compatible**: plain functions over numbers and arrays that carry a `'worklet'` directive. The directive is only a string literal, so the engine modules stay importable and testable in Node without any React Native dependency.
- Arbitrary TypeScript (closures over classes, Maps, Promises) does **not** run on the UI thread. The engine therefore separates *descriptions and handles* (JS thread) from *per-frame math* (worklets).
- **Fallback** if the UI-thread approach fails on device: run the simulation on the JS thread with `requestAnimationFrame` and push snapshots to Skia through shared values. It is simpler, but it competes with the app's JS work.

## Runtime concepts

- **Clock**: injected interface (`now()`, frame subscription). `VirtualClock` for tests (advanced manually, no real sleeps). Frame clock adapter on device.
- **Time sampling**: effects evaluate `t = now - start - pausedTime`, clamped to the effect's duration. They do not accumulate per-frame deltas, so large frame gaps cannot cause drift. Large deltas are a required test case.
- **Seeded RNG**: all randomness (emission angles, colors, jitter) comes from an injected, seedable generator. The same seed gives the same particles in tests.
- **Effect handle**: `fx.play(...)` returns a handle with `pause()`, `resume()`, `cancel()`, `finish()`, `seek(ms)` (where meaningful), `state` and `finished: Promise<{ status: 'completed' | 'cancelled' }>`. `finished` **resolves** on cancel and never rejects for it, so skipped effects cannot cause unhandled rejections. Invalid parameters throw synchronously at `play()`.
- **States**: `idle -> playing <-> paused -> completed | cancelled -> disposed`. Disposal releases all resources and is idempotent.

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
- `<GameFXCanvas>` is an absolutely positioned, transparent Skia canvas with `pointerEvents="none"` by default, so it never blocks the host app's touches. Interactive modes are opt-in.
- `useGameFX()` returns the typed API (`play`, `register`, `cancelAll`).
- Unmounting the provider cancels and disposes every effect, stops frame callbacks and releases images and atlases. No effect callback fires after unmount.
- Reduced motion (`AccessibilityInfo`) and a quality setting are provider options that presets must honor.

## Effects and extensibility

- A typed **registry** maps preset names to definitions. `fx.play('confetti', params)` is type-checked against that preset's parameter type.
- Consumers register custom presets through the same public API that built-in presets use. They never modify engine internals.
- Parameters are validated at `play()` time with clear error messages.

## Packaging and consumer contract

- Native libraries (`react`, `react-native`, `@shopify/react-native-skia`, `react-native-reanimated`, `react-native-worklets`) become **peer dependencies**. The SDK does not bundle them.
- Version baseline proposed from Expo SDK 58 (current on 2026-11-11): React Native 0.88.1, React 19.3.0, Reanimated 4.7.1, Worklets 0.13.0, Skia 2.14.0. Reanimated 4 requires the New Architecture.
- A **separate example app** (`example/`) consumes the SDK only through its built public entry point. CI also packs the SDK with `npm pack` and type-checks the example against the tarball, so private paths cannot leak into the contract.

## What carries over from the earlier card-SDK design

Kept as-is: strict TypeScript, Jest, ESLint and the CI toolchain; the virtual clock and seeded RNG; time sampling without drift; handles whose promise resolves on cancel; lifecycle scopes with cleanup on unmount; logical coordinates; game state staying outside the SDK.

Changed: Skia is now the primary renderer instead of Reanimated view transforms. The engine gets its own scene model and effect registry. Card presets are no longer core (they become a later demo preset or consumer code). Game-event reconciliation (duplicates, reconnects) moves to the optional Belote adapter.
