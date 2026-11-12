# react-native-graphics

An embeddable 2D game-effects engine for existing React Native apps. Mount one transparent overlay and trigger effects through a typed API, without writing animation internals. Game rules and app state stay in your app.

> **Status: Phase 3.** The engine has a scene graph, tweens, keyframes and timelines with event markers (Phase 2), plus a graphics layer (images, paths, gradients, clipping, masks, blend modes, glow/blur/color effects, runtime shaders), sprite sheets, an asset manager, and effects anchored to ordinary React Native views. The API is not stable yet and the package is not published. Phases 1 and 2 have run on an Android 17 emulator in Expo Go; Phase 3 has been checked with tests, Android/iOS bundles and the web build only, and nothing has run on iOS yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

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

### Effects around an existing view

```tsx
<GameFXTarget id="buy-button">
  <Pressable onPress={buy}><Text>Buy</Text></Pressable>
</GameFXTarget>

const handle = fx.attach('buy-button', 'fire-border', { intensity: 0.8, cornerRadius: 12 });
// handle.cancel(); the effect also ends when the target unmounts
```

The border is drawn by the overlay around the view's measured rectangle; the view itself is not rendered by Skia. See the limitations in [docs/API.md](docs/API.md).

## Showcase app

`example/` is a separate Expo SDK 58 app that installs the packed SDK tarball and imports only the public entry point. It has three tabs: **Particles** (Phase 1 bursts), **Motion** (Phase 2: orbiting hierarchy, staggered keyframe loops, and a thrown card whose `impact` marker triggers a burst, with cancel, rewind, skip and pause buttons) and **Graphics** (Phase 3: A sprite animation with pause/resume/speed/stop, B hierarchical transforms, C 100 sprites per tap, D glow, shaders, clipping, grayscale and blur, E glow/energy/fire borders around a normal React Native button).

```sh
npm ci
npm run example:install       # build, pack into example/vendor/, install it in example/
cd example
npx expo start                # press s for Expo Go if needed, then scan the QR code
npm run export:web && npx serve dist-web   # optional web preview
```

Expo Go (SDK 58) runs the showcase without a native build. This has been verified on an Android 17 emulator. In Windows PowerShell 5, run the commands one per line, because `&&` is not supported there.

## Development

Requires Node 22 (see `.nvmrc`) and npm.

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run lint` | ESLint with `typescript-eslint` strict type-checked rules and module boundary rules |
| `npm test` | Jest: `core` (Node), `renderer` (real Skia via CanvasKit) and `react-native` projects |
| `npm run build` | Emits ESM JavaScript and `.d.ts` to `lib/` |
| `npm run check` | All of the above |
| `npm run bench` | Engine-side frame cost in Node (not a device measurement, see `docs/PERFORMANCE.md`) |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, thread model, coordinates, lifecycle.
- [docs/API.md](docs/API.md): public API and error/cancellation semantics.
- [docs/PROGRESS.md](docs/PROGRESS.md): phase status and verification evidence.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): measurements (none on devices yet).
