# react-native-graphics

An embeddable 2D game-effects engine for existing React Native apps. Mount one transparent overlay and trigger effects through a typed API, without writing animation internals. Game rules and app state stay in your app.

> **Status: Phase 4.** The engine has a scene graph, tweens, keyframes and timelines with event markers (Phase 2), a graphics layer with sprites, assets and runtime shaders (Phase 3), and a composable effects system (Phase 4): fifteen built-in effects including a flagship `fire-border`, an explosion built from reusable primitives, confetti, sparks, smoke, trails, glow pulses, shockwaves and scoped screen shake; a configurable particle engine with five emitter shapes; a shader library with a central compile cache; and a Throw & Explode sequence that moves a real React Native view on the engine timeline. The API is not stable yet and the package is not published. Phases 1 to 3 have been checked by the owner on an Android 17 emulator in Expo Go. Phase 4 has been checked with tests, Android/iOS bundles and the web build, and awaits the same emulator check. Nothing has run on iOS yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Requirements

| Dependency | Version used and bundled (Expo SDK 58) | Peer range |
| --- | --- | --- |
| `react-native` (New Architecture) | 0.88.1 | `>=0.86.0` |
| `react` | 19.3.0 | `>=19.0.0` |
| `@shopify/react-native-skia` | 2.14.0 | `^2.14.0` |
| `react-native-reanimated` (+ `react-native-worklets` 0.13) | 4.7.1 | `^4.7.0` |

These are native modules. With Expo they are included in the SDK 58 runtime. In a bare React Native app, install them and rebuild the native app.

## Installation (local, until a release exists)

```sh
# In this repository
npm ci
npm run build && npm pack           # creates react-native-graphics-0.0.0.tgz

# In your app
npm install /path/to/react-native-graphics-0.0.0.tgz
npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets
```

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
```

The overlay draws effects around the view's measured rectangle; the view itself is not rendered by Skia. Effects combine on the engine timeline (`fx.timeline()`, `fx.cue(...)`, `fx.throw(...)`), and quality levels (`low`, `medium`, `high`) and reduced motion are provider props. See [docs/EFFECTS.md](docs/EFFECTS.md) for every effect, the particle and shader systems, composition rules and limitations.

## Showcase app

`example/` is a separate Expo SDK 58 app that installs the packed SDK tarball and imports only the public entry point. It has four tabs:

- **Effects** (Phase 4, "GameFX Effects Showcase"): A fire border on an ordinary card with intensity, color, move, rotate and scale controls; B Throw & Explode with cancel at any moment; C an effects playground; D a gallery of every preset; E several effects combined on the same targets; F performance scenarios with an on-screen meter (FPS of the effects loop, JS work per frame, particle counts).
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
| `npm run build` | Emits ESM JavaScript and `.d.ts` to `lib/` |
| `npm run check` | All of the above |
| `npm run bench` | Engine-side frame cost in Node, including the seven Phase 4 effect scenarios (not a device measurement, see `docs/PERFORMANCE.md`) |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, thread model, coordinates, lifecycle.
- [docs/API.md](docs/API.md): public API and error/cancellation semantics.
- [docs/EFFECTS.md](docs/EFFECTS.md): effects, particles, shaders, composition, React Native targets, quality, custom effects.
- [docs/TESTING.md](docs/TESTING.md): test layers, commands, visual and device checks.
- [docs/PROGRESS.md](docs/PROGRESS.md): phase status and verification evidence.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): Node benchmarks and the procedure for measuring on a device (no device numbers yet).
