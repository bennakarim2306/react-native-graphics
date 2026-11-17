# react-native-graphics

An embeddable 2D game-effects engine for existing React Native apps. Mount one transparent overlay and trigger effects through a typed API, without writing animation internals. Game rules and app state stay in your app.

> **Status: release candidate `0.1.0-rc.0` (Phase 5), not published.** The package builds, packs and installs into a separate app; its public API is pinned and documented. It has been run in Expo Go on an Android 17 emulator (showcase app, Phases 1 to 4.5) and in headless Chromium (web). The new consumer app has not been run on a device yet, nothing has run on iOS, and no device performance has been measured. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) and [docs/PROGRESS.md](docs/PROGRESS.md).

## Features

- **One overlay, no rewrite:** `<GameFXProvider>` and a transparent `<GameFXOverlay>` that never takes touches; your screens stay ordinary React Native.
- **Effects on existing views:** wrap a view in `<GameFXTarget id>` and attach effects that follow it while it moves, rotates and scales, or move the real view through the engine (`fx.animate`).
- **Sixteen built-in effects:** `fire-border`, `burn-away`, `explosion`, `confetti`, `golden-sparks`, `smoke`, `trail`, `glow-pulse`, `shockwave`, `flash`, `screen-shake`, `victory`, the generic `particles` emitter, `particle-burst`, `glow-border`, `energy-border`. Parameters are type-checked.
- **Composition:** timelines with markers and cues on one clock, Throw & Explode (throw, impact, explosion, shake, settle) with one handle to cancel or skip all of it.
- **Scene graph, sprites and assets:** nodes with parent/child transforms, sprite sheets and frame animations, an image cache with a memory budget, runtime shaders with fallbacks.
- **Control:** every effect returns a handle (`stop`, `cancel`, `pause`, `update`, `finished` that never rejects); quality levels `low`/`medium`/`high`, reduced motion, pause in the background, `engine.stats` diagnostics.
- **Core without React:** `react-native-graphics/core` runs the engine in plain Node with a virtual clock.

## Supported environments

| Dependency | Tested (Expo SDK 58) | Peer range |
| --- | --- | --- |
| `react-native` (New Architecture) | 0.88.1 | `>=0.88.0` |
| `react` | 19.3.0 | `>=19.3.0` |
| `@shopify/react-native-skia` | 2.14.0 | `^2.14.0` |
| `react-native-reanimated` (+ `react-native-worklets` 0.13) | 4.7.1 | `^4.7.1` |

Android: run in Expo Go on an Android 17 emulator. iOS: bundles only, never run. Web: React Native Web with CanvasKit. Bare React Native: documented, not run. Details and evidence in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Installation

The package is private; install the tarball packed from this repository (PowerShell: one line at a time):

```sh
npm ci
npm run build
npm pack                                  # react-native-graphics-0.1.0-rc.0.tgz
```

In your Expo app, with the tarball copied to `vendor/`:

```sh
npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets
npm install ./vendor/react-native-graphics-0.1.0-rc.0.tgz
```

Bare React Native, web and Jest setup: [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Quick start

```tsx
import { GameFXOverlay, GameFXProvider, useGameFX } from 'react-native-graphics';
import { Button, View } from 'react-native';

export default function App() {
  return (
    <GameFXProvider>
      {/* The overlay covers this View: effects draw above it and never block touches. */}
      <View style={{ flex: 1 }}>
        <Screen />
        <GameFXOverlay />
      </View>
    </GameFXProvider>
  );
}

function Screen() {
  const fx = useGameFX();
  return (
    <Button
      title="Celebrate"
      onPress={(e) => {
        const handle = fx.play('particle-burst', {
          position: fx.fromWindow({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }),
          count: 60,
          duration: 900,
        });
        handle.finished.then((r) => console.log(r.status)); // 'completed' | 'cancelled'
      }}
    />
  );
}
```

Positions are in points relative to the overlay's top-left corner. `fx.fromWindow` converts window coordinates such as `pageX`/`pageY` using the overlay's measured position. See [docs/API.md](docs/API.md).

### Scene nodes, timelines and impact events

```tsx
const { engine } = useGameFX();               // available once fx.ready is true
const card = engine.scene.createNode({
  x: 200, y: 500,
  shape: { type: 'rect', width: 44, height: 64, color: '#fff', cornerRadius: 6 },
});
const playback = engine.timeline()
  .add(engine.animate(card, { y: 270, rotation: 360, duration: 520, easing: 'easeOutQuad' }))
  .add(engine.animate(card, { y: 500, duration: 560, easing: 'easeInQuad' }))
  .mark('impact')                             // exactly when the fall ends
  .play();
playback.onMarker('impact', () => {
  fx.play('particle-burst', { position: card.localToWorld({ x: 0, y: 32 }) });
});
// playback.pause() / resume() / cancel() / stop() / finish() / seek(ms); await playback.finished
```

### Sprites and assets

```tsx
<GameFXProvider assets={{ hero: require('./assets/hero-sheet.png') }}>…</GameFXProvider>

const { status, assets } = useGameFXAssets(['hero']);   // 'loading' | 'loaded' | 'failed'
const sheet = engine.createSpriteSheet({
  image: 'hero',
  grid: { frameWidth: 64, frameHeight: 64 },
  animations: { run: { frames: { from: 0, to: 5 }, fps: 12, loop: true, events: [{ at: 3, name: 'step' }] } },
});
const hero = engine.createSprite({ sheet, x: 100, y: 200, smoothing: 'nearest' });
const run = hero.play('run');                 // a Playback on the engine clock
run.speed = 2;                                // pause(), resume(), stop(), onMarker('step', …)
engine.animate(hero, { x: 300, rotation: 360, duration: 1000 }).play();
```

### Effects on an existing view

```tsx
<GameFXTarget id="card" style={styles.card}>
  <Text>ACE OF SPADES</Text>
</GameFXTarget>

// Flames around the card; they follow it while it moves, rotates and scales.
const fire = fx.attach('card', { effect: 'fire-border', intensity: 0.8, flameHeight: 25, color: '#FF6600', glow: true, sparks: true });
fire.setIntensity(1.2);
fire.stop();                                  // graceful; the effect also ends when the target unmounts

// Move the real view through the engine (explicit transform binding).
fx.animate('card', { x: 120, y: -80, rotation: 360, duration: 1000 });

// Throw the view, explode at the impact, shake, and bring it back. One handle for all of it.
const seq = fx.throwAndExplode('card', {
  throw: { height: 170, distance: 150, duration: 1000, rotation: 540 },
  explosion: { particles: 150, debris: true },
  shake: { amplitude: 9 },
  afterImpact: 'return',
});
seq.playback.cancel();                        // restores the view's transform and opacity at once

// Burn the view away from its bottom edge; it stays hidden until the app shows it again.
const burn = fx.play('burn-away', { target: 'card', from: 'bottom', duration: 1600 });
burn.cancel();                                // the view comes back at once
fx.getTarget('card')?.motion.reset();         // after it burned: show the view again
```

Effects that stay fixed to the card (the flames, glows, pulses) are drawn in a small canvas inside the card's own view, so the phone moves them with the card in the same frame, also while a list scrolls. Free particles such as sparks and explosions are drawn by the overlay. The view itself is not rendered by Skia. Effects combine on the engine timeline (`fx.timeline()`, `fx.cue(...)`, `fx.throw(...)`), and quality levels (`low`, `medium` (default), `high`) and reduced motion are provider props. See [docs/EFFECTS.md](docs/EFFECTS.md) for every effect, the particle and shader systems, composition rules and limitations.

### Custom effects

```tsx
import { defineComposite, flash, particles, shockwave } from 'react-native-graphics';

const pop = defineComposite<{ position: { x: number; y: number } }>({
  name: 'pop',
  layers: (p) => [
    { name: 'flash', effect: flash, params: { position: p.position, radius: 50 } },
    { name: 'ring', effect: shockwave, params: { position: p.position, radius: 70 }, delay: 40 },
    { name: 'bits', effect: particles, params: { position: p.position, bursts: [{ count: 30 }] } },
  ],
});

<GameFXProvider effects={[pop]}>…</GameFXProvider>
fx.play('pop', { position: { x: 100, y: 100 } });   // or fx.play(pop, {...}) without registering
```

`defineEffect` writes one from scratch ([docs/EFFECTS.md](docs/EFFECTS.md#9-custom-effects)).

### Lifecycle and cleanup

```tsx
function Card() {
  const fx = useGameFX();
  const fire = useRef<EffectHandle | null>(null);
  useEffect(() => () => fire.current?.cancel(), []);   // optional: unmounting the target ends it too
  return (
    <GameFXTarget id="card">
      <Pressable onPress={() => { fire.current = fx.attach('card', 'fire-border', { intensity: 0.8 }); }}>
        <Text>Ignite</Text>
      </Pressable>
    </GameFXTarget>
  );
}
```

When a `<GameFXTarget>` unmounts, effects on it stop and fade out, sequences on it are cancelled and its animations end. When the provider unmounts, everything is cancelled and released. Your own timers, `engine.on` listeners and looping timelines are yours to clean up. `fx.engine?.stats` shows what is still running ([docs/API.md](docs/API.md#lifecycle-and-cleanup-guarantees)).

## Consumer test app

`consumer/` is an ordinary Expo app (`gamefx-consumer-test`) that uses the SDK exactly like a third-party app: `npm run consumer:install` copies it **outside** this repository (to `../gamefx-consumer-test`), packs the SDK and installs the tarball there. It imports only the public entry points (checked by `npm run check:imports`). Screens: A a normal rewards page with effects on "Claim", B fire border, C Throw & Explode, D particle bursts, E composition, F navigation and lifecycle (with self-tests), G quality and reduced motion, H performance scenarios.

```sh
npm run consumer:install
cd ../gamefx-consumer-test
npx expo start --clear
```

(PowerShell: `cd ..\gamefx-consumer-test`.) Press `a` for the Android emulator or scan the QR code with Expo Go. More in [docs/TESTING.md](docs/TESTING.md#consumer-app).

## Showcase app

`example/` is the development showcase: a separate Expo SDK 58 app that installs the packed SDK tarball and imports only the public entry point. It has four tabs:

- **Effects** (Phase 4, "GameFX Effects Showcase"): A fire border on an ordinary card with intensity, color, move, rotate and scale controls; B Throw & Explode with cancel at any moment; C an effects playground; D a gallery of every preset; E several effects combined on the same targets; F performance scenarios with an on-screen meter (FPS of the effects loop, JS work per frame, particle counts); G an emitter lab (Phase 4A) with four emitters at once (point, circle, line, rect; world and local space) on moving scene objects, live changes of rate, speed, spread, gravity, size and colors, pause, resume, stop and cancel per emitter, and removing the orb they follow, with pool counters. H a visual quality comparison (Phase 4.5): the same fire and explosions at `low`, `medium` and `high` side by side; the fire border with every visual parameter (intensity, flame height, speed, glow strength, spark density, color) changed live while the card moves, rotates and scales; Throw & Explode with explosion intensity, particle density, glow, trail and fire on the card, with throw, replay and cancel; and a combined finale (fire, throw with trail, explosion, golden sparks, confetti and a victory burst on the impact marker). I (right under A) burns an ordinary card view away, with origin, color, duration and roughness, "fire first" and "move while burning" toggles, cancel and restore, and a hand of three cards burned one after another.
- **Particles** (Phase 1 bursts).
- **Motion** (Phase 2: orbiting hierarchy, staggered keyframe loops, and a thrown card whose `impact` marker triggers a burst, with cancel, rewind, skip and pause buttons).
- **Graphics** (Phase 3: sprite animation, hierarchical transforms, 100 sprites per tap, glow, shaders, clipping, grayscale and blur, borders around a normal React Native button).

In a shell (macOS, Linux, or PowerShell one line at a time):

```sh
npm ci
npm run example:install
cd example
npx expo start --clear
```

Then press `a` for the Android emulator, or scan the QR code with Expo Go. `npm run example:install` builds the SDK, packs it into `example/vendor/` and installs it in `example/`. Run it again after every SDK change. Expo Go (SDK 58) runs the showcase without a native build; this has been verified on an Android 17 emulator. In Windows PowerShell 5, run the commands one per line, because `&&` is not supported there. For a web preview, run `npx expo export --platform web --output-dir dist-web` in `example/` and serve `dist-web`; [docs/TESTING.md](docs/TESTING.md) describes the scripted screenshot check.

## Development

Requires Node 22 (see `.nvmrc`) and npm.

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run lint` | ESLint with `typescript-eslint` strict type-checked rules and module boundary rules |
| `npm test` | Jest: `core` (Node), `renderer` (real Skia via CanvasKit) and `react-native` projects |
| `npm run build` | ES modules (`lib/module`), CommonJS (`lib/commonjs`) and declarations (`lib/typescript`), with source maps |
| `npm run pack:verify` | Builds, packs and validates the package, then installs it in an empty project |
| `npm run check` | Typecheck, lint, tests and `pack:verify` |
| `npm run consumer:install` | Creates the consumer test app outside the repository from a fresh tarball |
| `npm run example:install` | Packs the SDK into the showcase and installs it |
| `npm run bench` | Engine-side frame cost in Node, including the seven Phase 4 effect scenarios (not a device measurement, see `docs/PERFORMANCE.md`) |
| `npm run bench:render` | Picture recording and CPU raster cost with real Skia (CanvasKit) per particle look and quality profile (not a device measurement) |
| `npm run visual` | Renders the deterministic visual regression scenes to PNG with real Skia (`visual-out/`) |

## Known limitations

- No device performance measurements yet; Node and web numbers are not phone numbers ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- iOS has never been run; bare React Native has not been run.
- From the owner's Android device check of Phase 4.5: the fire border reads as a soft halo with little flame detail, a card at the moment of impact looks washed out, some particles leave the demo boxes.
- Effects are drawn around views, not into them (except `burn-away`, which burns a picture of the view on iOS and Android).
- Overlay-drawn effects on a screen pushed by React Navigation's native stack need `fx.remeasure()` after the transition.
- All simulation runs on the JavaScript thread; a busy JS thread delays effect frames, not the app's UI.

More in [docs/EFFECTS.md](docs/EFFECTS.md#10-limitations) and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Documentation

- [docs/INSTALLATION.md](docs/INSTALLATION.md): Expo, bare React Native, web and Jest setup.
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md): what was verified, on what.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): common problems and fixes.
- [docs/RELEASE.md](docs/RELEASE.md): versioning, package name, release checklist.
- [CHANGELOG.md](CHANGELOG.md): release notes and breaking changes.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, thread model, coordinates, lifecycle.
- [docs/API.md](docs/API.md): public API and error/cancellation semantics.
- [docs/EFFECTS.md](docs/EFFECTS.md): effects, particles, shaders, composition, React Native targets, quality, custom effects.
- [docs/TESTING.md](docs/TESTING.md): test layers, commands, visual and device checks.
- [docs/PROGRESS.md](docs/PROGRESS.md): phase status and verification evidence.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): benchmark scenarios, Node numbers and the device procedure (no device numbers yet).
