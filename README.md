# react-native-graphics

An embeddable 2D game-effects engine for existing React Native apps. Mount one transparent overlay and trigger effects through a typed API, without writing animation internals. Game rules and app state stay in your app.

> **Status: Phase 1 prototype.** One effect exists (`particle-burst`). The API is not stable yet and the package is not published. See [docs/PROGRESS.md](docs/PROGRESS.md) for what has and has not been verified, including the fact that it **has not yet run on a physical device or simulator**.

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

## Showcase app

`example/` is a separate Expo SDK 58 app that installs the packed SDK tarball and imports only the public entry point.

```sh
npm ci
npm run example:install       # build, pack into example/vendor/, install it in example/
cd example
npx expo start                # then open on a device, emulator or simulator
npm run export:web && npx serve dist-web   # optional web preview
```

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
