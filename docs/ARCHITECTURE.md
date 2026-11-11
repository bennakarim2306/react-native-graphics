# Architecture (proposal, Phase 1)

This is the plan the later phases build against. Nothing below except the toolchain exists in code yet. Sections marked **Decision needed** are listed in [PROGRESS.md](PROGRESS.md).

## Goals that shape the design

1. **Game state and presentation are separate.** The game (server-authoritative) emits events. The SDK only *visualizes* them. No game action ever waits for, or depends on, an animation finishing.
2. **Deterministic core.** Every animation is a pure function of time. Given the same spec and the same timestamp, it returns the same values. This makes it testable with a virtual clock and lets the UI thread evaluate it without the JS thread.
3. **Renderer independence.** Card motion uses Reanimated transforms; particles and custom drawing use Skia. Neither leaks into the core or the public API.
4. **Resolution independence.** Specs use logical coordinates. Conversion to pixels and safe areas happens in one place.

## Module boundaries

The SDK starts as **one npm package with internal modules** (and subpath exports later). Splitting into several packages is only worth it once a second consumer needs to install the core without React Native. Dependencies point downwards only:

```
src/react          Provider, hooks, components, reduced-motion, feature flags
   |    \
   |   src/integration   event queue, dedupe, interrupt/skip/snap-to-final reconciliation
   |    /
src/renderers/reanimated   src/renderers/skia     (adapters; the only code that imports them)
   |                           |
src/cards  src/effects   presets that produce plain-data specs (deal, fan, flip, sparks, ...)
   |          |
src/layout   logical coordinate space -> pixels, safe areas, responsive anchors
   |
src/core     clock, easing, cubic Bezier, interpolation, keyframes, timeline, composition, seeded RNG
```

| Module | Depends on | May import React / RN? | Phase |
| --- | --- | --- | --- |
| `core` | nothing | **No** (enforced by ESLint `no-restricted-imports`) | 2 |
| `layout` | `core` | No | 2/3 |
| `cards` | `core`, `layout` | No | 3 |
| `effects` | `core`, `layout` | No (simulation only; drawing is in the Skia adapter) | 4 |
| `renderers/reanimated` | `core` | Yes (Reanimated, Worklets) | 3 |
| `renderers/skia` | `core`, `effects` | Yes (Skia) | 4 |
| `integration` | `core` | No | 3/5 |
| `react` | all of the above | Yes | 3 |

Belote-specific glue (mapping "player 2 played the ace of spades" to `moveCard`) lives in the **game app**, not in this SDK.

## Animation specs and handles

- Builders such as `moveCard(...)`, `sequence([...])`, `parallel([...])`, `stagger(...)` return an **inert, serializable spec** (plain objects and numbers). Plain data is required because Reanimated worklets can only capture serializable values, and it makes specs easy to snapshot in tests.
- `play()` turns a spec into a **handle**: `pause()`, `resume()`, `seek(ms)`, `cancel()`, `finish()` (jump to the end state), plus `finished: Promise<AnimationResult>`.
- `finished` **resolves** with `{ status: 'completed' | 'cancelled' | 'finished-early' }` and never rejects for cancellation, so callers cannot create unhandled rejections by skipping animations. Invalid configuration throws synchronously when the spec is built. **Decision needed:** confirm this shape.
- Zero duration is valid and completes on the next tick. Negative or non-finite durations, delays and repeat counts are rejected.

## Clocks

- `Clock` is an injected interface: `now()` and `subscribe(onFrame)`.
- `VirtualClock` (tests): advanced manually with `advance(ms)`. All core tests use it; no real-time sleeps.
- `FrameClock` (runtime): driven by `requestAnimationFrame` on JS, or by Reanimated's frame callback on the UI thread.
- A timeline samples `t = clock.now() - startTime - pausedDuration`, clamps to `[0, duration]`, and evaluates. It never accumulates per-frame deltas, so dropped frames don't cause drift.
- Randomness (shuffle jitter, particle spread) comes from an injected **seeded RNG**, so effects are reproducible in tests.

## Rendering adapters

- **Reanimated adapter:** binds a spec to `SharedValue`s (`translateX`, `translateY`, `rotate`, `scale`, `opacity`, and a `zIndex`/order channel for stacking). The spec is evaluated in a worklet, so no React state updates happen per frame.
- **Skia adapter:** draws particle systems and glows in a single `<Canvas>` overlay. Particles live in a fixed-size pool with bounded lifetimes; the pool is released on unmount.
- Sprite sheets or Rive are **not** planned until a concrete effect needs them.

## Lifecycle and cleanup

- Every handle is owned by an `AnimationScope` (one per mounted provider or screen). Unmounting the scope cancels all handles, unsubscribes from the clock and frees particle pools.
- Callbacks (`onComplete`, etc.) are guarded so they never fire after their scope has been disposed.
- Navigation away or app backgrounding cancels or fast-forwards running animations, depending on configuration.

## Reconciling with authoritative game events

The integration layer receives game events with a stable id and sequence number.

- **Duplicates** (same id) are ignored.
- **Out-of-order** events with a lower sequence than the last applied one are ignored.
- **Interruption:** when a new event arrives while an older animation is running, the older one is `finish()`ed (snapped to its end state) before the new one starts, unless they are declared as compatible to run in parallel.
- **Reconnect / resync:** the game supplies a full state snapshot; the SDK cancels everything and renders the snapshot without animation.
- **Reduced motion / animations disabled:** specs are evaluated directly at their end state.

In every case the visual end state equals the authoritative state. The game never reads animation state back.

## Coordinates and layout

Specs use a logical scene space (for example a 1000 x 1000 table, or anchors such as `seat:south`). `layout` maps logical points to pixels from the measured container and safe-area insets, and re-runs on resize or rotation. Card sizes are expressed relative to the scene, not in pixels.

## Testing strategy

| Layer | How it is tested |
| --- | --- |
| `core`, `layout`, `cards`, `effects` simulation | Jest unit tests with `VirtualClock` and seeded RNG; exact values at fixed timestamps |
| `integration` | Jest tests for duplicates, out-of-order events, interruption, reconnect |
| Renderer adapters and `react` | Jest with the React Native preset and the Reanimated/Skia test mocks (Phase 3+) |
| Visual output and performance | Demo app on real devices or emulators; only measured results are reported |
