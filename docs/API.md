# Public API (Phase 1)

Everything below is exported from `react-native-graphics`. The platform-independent subset (engine, clocks, particles, effect definitions) is also exported from `react-native-graphics/core`, which does not import React Native, React or Skia. The API is **pre-1.0 and may change**.

## Coordinates

All positions are **canvas coordinates**: density-independent points relative to the top-left corner of the `GameFXOverlay`. When the overlay covers the screen from the window origin, a touch's `pageX`/`pageY` are canvas coordinates. Converting from other views (measured `ref`s) and safe-area handling are not provided yet.

## React Native integration

### `<GameFXProvider>`

Creates one engine when it mounts and disposes it when it unmounts. Disposal cancels every running effect (their `finished` promises resolve with `{ status: 'cancelled', reason: 'disposed' }`) and stops the frame loop.

| Prop | Type | Default |
| --- | --- | --- |
| `effects` | `EffectDefinition[]` | none (built-in effects are always registered) |
| `seed` | `number` | `0x5eed` |
| `maxActiveEffects` | `number` | `32` (the oldest is cancelled with reason `limit` beyond it) |
| `clock` | `Clock` | `requestAnimationFrame` clock |
| `onError` | `(error) => void` | rethrow on a microtask |

Props are read once at mount.

### `<GameFXOverlay>`

A transparent, absolutely positioned Skia canvas that draws the provider's effects. It has `pointerEvents="none"`, so it never intercepts touches. Render it as the last child so it draws above your UI. Props: `style`, `testID`.

### `useGameFX(): GameFX`

| Member | Description |
| --- | --- |
| `play(name, params, options?)` | Starts an effect and returns an `EffectHandle`. Built-in names are type-checked. You can also pass an `EffectDefinition` instead of a name. `options.seed` makes one instance reproducible. |
| `cancelAll()` | Cancels every running effect of this provider. |
| `activeCount` | Number of running effects. |
| `ready` | `false` only during the provider's very first render. Calling `play` then throws. |

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

## Effect handles

```ts
interface EffectHandle {
  readonly id: number;
  readonly effect: string;
  readonly status: 'playing' | 'completed' | 'cancelled';
  readonly finished: Promise<{ status: 'completed' | 'cancelled'; reason?: 'user' | 'cancelAll' | 'limit' | 'disposed' }>;
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

An `EffectInstance` receives the **elapsed time since it started** (not a per-frame delta), must report `done`, expose renderer-independent `drawables`, and release resources in `dispose` (called exactly once). In Phase 1 the Skia renderer can only draw `particles` drawables. Other kinds are skipped and reported.

## Engine without React (`react-native-graphics/core`)

```ts
import { createEngine, particleBurst, VirtualClock } from 'react-native-graphics/core';

const clock = new VirtualClock();
const engine = createEngine({ clock, effects: [particleBurst], seed: 1 });
const handle = engine.play('particle-burst', { position: { x: 0, y: 0 } });
clock.advance(1000, { frameMs: 16 });  // deterministic frames
engine.on('frame', ({ drawables }) => { /* draw with any renderer */ });
engine.dispose();
```

`Engine` members: `play`, `register`, `hasEffect`, `cancelAll`, `dispose`, `on('frame' | 'effectStart' | 'effectEnd')`, `state`, `activeCount`, `drawables`. Clocks: `VirtualClock` (manual, for tests) and `FrameClock` (injected `requestFrame`/`cancelFrame`/`now`).

Note: `lib/` is ESM without file extensions. It works with Metro, Jest/Babel and bundlers, but not with plain Node `import` yet (planned for packaging in Phase 5).
