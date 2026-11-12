# react-native-graphics

An embeddable 2D game-effects engine for existing React Native apps. Mount one transparent overlay and trigger effects through a typed API, without writing animation internals. Game rules and app state stay in your app.

> **Status: Phase 2.** The engine has a scene graph, tweens, keyframes, timelines with event markers, and one effect (`particle-burst`). The API is not stable yet and the package is not published. See [docs/PROGRESS.md](docs/PROGRESS.md) for what has and has not been verified. Phase 1 has run on an Android 17 emulator in Expo Go; the Phase 2 demo has been checked in the web build only so far, and nothing has run on iOS yet.

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
    <View style={{ flex: 1 }}>
      <GameFXProvider>
        <Screen />
        {/* Last child: draws above your UI and never blocks touches. */}
        <GameFXOverlay />
      </GameFXProvider>
    </View>
  );
}

function Screen() {
  const fx = useGameFX();
  return (
    <Button
      title="Celebrate"
      onPress={(e) => {
        const handle = fx.play('particle-burst', {
          position: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY },
          count: 60,
          duration: 900,
        });
        handle.finished.then((r) => console.log(r.status)); // 'completed' | 'cancelled'
      }}
    />
  );
}
```

Positions are in points relative to the overlay's top-left corner. If the overlay fills the screen from the window origin, `pageX`/`pageY` can be used directly. See [docs/API.md](docs/API.md).

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

## Showcase app

`example/` is a separate Expo SDK 58 app that installs the packed SDK tarball and imports only the public entry point. It has two tabs: **Particle effects** (Phase 1 bursts) and **Motion & timelines** (Phase 2: orbiting hierarchy, staggered keyframe loops, and a thrown card whose `impact` marker triggers a burst, with cancel, rewind, skip and pause buttons).

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

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, thread model, coordinates, lifecycle.
- [docs/API.md](docs/API.md): public API and error/cancellation semantics.
- [docs/PROGRESS.md](docs/PROGRESS.md): phase status and verification evidence.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): measurements (none on devices yet).
