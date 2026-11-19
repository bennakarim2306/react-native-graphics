# Installation

`react-native-graphics` is private and not on npm. Until a release is authorized, you install it
from a tarball packed from this repository (see [RELEASE.md](RELEASE.md)). Everything else on this
page is how a published version would be installed too.

What was verified, and on what, is in [COMPATIBILITY.md](COMPATIBILITY.md). In short: Expo SDK 58
apps, bundled for Android, iOS and web, and run in Expo Go on an Android 17 emulator (showcase app)
and in headless Chromium (web). Bare React Native and iOS have not been run.

## 1. Requirements

| Dependency | Tested version (Expo SDK 58) | Peer range |
| --- | --- | --- |
| `react-native` (New Architecture) | 0.88.1 | `>=0.88.0` |
| `react` | 19.3.0 | `>=19.3.0` |
| `@shopify/react-native-skia` | 2.14.0 | `^2.14.0` |
| `react-native-reanimated` | 4.7.1 | `^4.7.1` |
| `react-native-worklets` (required by Reanimated 4) | 0.13.0 | via Reanimated |

- These are native modules. The SDK itself has **no runtime dependencies** and no native code.
- Reanimated 4 requires the New Architecture (the default in React Native 0.88 and Expo SDK 58).
- Node 22 or newer to build the SDK. Apps only need what their React Native version needs.
- TypeScript is optional. The declarations were checked with TypeScript 6.0 (Expo's
  `moduleResolution: "bundler"`) and 5.9.

## 2. Get the package

In this repository (Windows PowerShell 5: run each line on its own):

```sh
npm ci
npm run build
npm pack
```

This writes `react-native-graphics-0.1.0-rc.0.tgz`. Copy it into your app, for example into a
`vendor/` folder, so the lockfile can refer to it by a relative path.

`npm run pack:verify` does the same and also checks the archive (contents, entry points, types,
installation into an empty project). `npm run consumer:install` builds the consumer test app
outside the repository with a fresh tarball.

## 3. Expo (managed workflow)

```sh
npx expo install @shopify/react-native-skia react-native-reanimated react-native-worklets
npm install ./vendor/react-native-graphics-0.1.0-rc.0.tgz
```

- `npx expo install` picks the versions bundled with your Expo SDK. With SDK 58 they match the
  peer ranges above.
- **Expo Go:** Expo Go for SDK 58 contains Skia, Reanimated and Worklets, so apps using this SDK
  run there without a native build. Verified on an Android 17 emulator with the showcase app.
- **Expo Go needs the exact native versions.** Expo Go runs your JavaScript against its own
  native Skia, Reanimated and Worklets. Install them with `npx expo install` and check with
  `npx expo install --check`; a newer patch from `npm install` (for example Reanimated 4.7.2 instead
  of 4.7.1) crashes at runtime (see TROUBLESHOOTING.md).
- **Development builds** (`npx expo run:android`, `npx expo run:ios`, EAS Build) need nothing
  extra from this SDK; Skia and Reanimated are autolinked. Not run yet.
- `babel-preset-expo` already includes the Worklets Babel plugin. No configuration is needed.
- Nothing is required in `app.json`. The SDK needs no permissions.

## 4. Bare React Native (not verified)

The steps follow the peer libraries' own documentation. They have **not** been run with this SDK.

```sh
npm install @shopify/react-native-skia react-native-reanimated react-native-worklets
npm install ./vendor/react-native-graphics-0.1.0-rc.0.tgz
cd ios
pod install
cd ..
```

Add the Worklets plugin as the **last** Babel plugin (`babel.config.js`):

```js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
};
```

Then rebuild the native app (`npx react-native run-android`, `npx react-native run-ios`) and clear
Metro's cache once (`npx react-native start --reset-cache`). Metro resolves the package through
its `react-native` export condition (ES modules in `lib/module`); no Metro configuration is needed.

## 5. Mount it

```tsx
import { GameFXOverlay, GameFXProvider } from 'react-native-graphics';

export default function App() {
  return (
    <GameFXProvider>
      <View style={{ flex: 1 }}>
        <YourNavigationOrScreens />
        <GameFXOverlay />   {/* last child: draws above, never takes touches */}
      </View>
    </GameFXProvider>
  );
}
```

Then trigger effects with `useGameFX()` (see the [README](../README.md#quick-start) and
[API.md](API.md)). With React Navigation's native stack, screens slide in after they were
measured; call `fx.remeasure()` when a transition ends so overlay-drawn effects line up:

```tsx
const navigation = useNavigation();
const fx = useGameFX();
useEffect(() => navigation.addListener('transitionEnd', () => { if (fx.ready) fx.remeasure(); }), [navigation, fx]);
```

## 6. Web (React Native Web)

React Native Skia draws with CanvasKit (WebAssembly) on the web. Load it before anything imports
Skia, and serve `canvaskit.wasm` next to the page:

```ts
// index.web.ts
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

void LoadSkiaWeb({ locateFile: (file) => `/${file}` }).then(async () => {
  const { default: App } = await import('./App');
  registerRootComponent(App);
});
```

Copy `node_modules/canvaskit-wasm/bin/full/canvaskit.wasm` to `public/` (the consumer app's
`scripts/web-prepare.mjs` does this). On the web, views cannot be captured, so `burn-away` uses its
fallback (the view chars and fades instead of burning as a picture).

## 7. Jest

The package's `react-native` export condition points to ES modules. Test environments that use
that condition (the React Native Jest preset) must transform the package:

```js
// jest.config.js
module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|@shopify/react-native-skia|react-native-graphics)/)'],
};
```

With `jest-expo`, check that its `transformIgnorePatterns` lets `react-native-graphics` through (not tried here). Skia and Reanimated
need their own Jest setup (Skia's `jestEnv`/`jestSetup`, Reanimated's mock); see their
documentation. In a plain Node environment `require('react-native-graphics/core')` loads the
CommonJS build and needs nothing. Only the repository's own tests have run this way; a separate
app's Jest setup has not been tried.

## 8. Check the installation

- `import { SDK_VERSION } from 'react-native-graphics'` should print `0.1.0-rc.0`.
- `node_modules/react-native-graphics` must be a real folder, not a link to the repository.
  Links make Metro resolve the SDK's own `node_modules` (two copies of React).
- The consumer app's `npm run check:imports` checks this and that only public entry points are
  imported.

If something fails, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
