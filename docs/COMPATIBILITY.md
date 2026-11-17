# Compatibility

Status for `0.1.0-rc.0` on 2026-11-17. Every row says what was actually done. "Bundled" means
Metro produced a bundle without errors; it does not mean the app ran.

## Evidence levels

- **Device-verified:** run on a phone or emulator by a person, with the result observed.
- **Runtime-verified:** the app ran in a real runtime here (headless Chromium for the web, Node
  for `core`), driven by scripts with assertions.
- **Bundled:** type-checked and bundled by Metro for that platform; not run.
- **Not verified:** no evidence; instructions are based on the libraries' documentation.

## Platform matrix

| Environment | Level | Evidence |
| --- | --- | --- |
| Expo SDK 58, Expo Go, Android 17 emulator (Windows host), showcase app `example/` | Device-verified (owner) | Phases 1 to 4.5 checked by the owner on the emulator, including Phase 4.5 on an Android device with screenshots ([PROGRESS.md](PROGRESS.md)). `burn-away` and the Phase 5 changes are not checked on a device yet |
| Expo SDK 58, Expo Go, Android, consumer app `gamefx-consumer-test` | Bundled | `expo export --platform android` (Hermes bytecode, 1524 modules). Waiting for the owner's emulator run |
| Expo SDK 58, iOS (showcase and consumer) | Bundled | `expo export --platform ios`. Never run on a simulator or device |
| Expo SDK 58, web (React Native Web 0.21.4, CanvasKit), consumer app | Runtime-verified | Headless Chromium smoke test, 23 of 23 checks: every demo screen, navigation self-test ×10, provider remount ×20, no page errors ([TESTING.md](TESTING.md#consumer-app)) |
| Expo SDK 58, web, showcase app | Runtime-verified | Scripted capture of 68 screenshots, no page errors |
| Expo development build (`expo run:*`, EAS) | Not verified | Expected to work (no native code in the SDK; Skia and Reanimated autolink) |
| Bare React Native 0.88 (no Expo) | Not verified | Steps in [INSTALLATION.md](INSTALLATION.md#4-bare-react-native-not-verified) |
| Node 22, `react-native-graphics/core` (engine without React) | Runtime-verified | `npm run pack:verify`: installed tarball loaded with `require` and `import`, a particle burst runs to completion; 488 Jest tests |
| Jest with the React Native preset (this repository) | Runtime-verified | The `react-native` and `renderer` test projects. A separate app's Jest setup was not tried |

Expo Go only shows that the SDK works with the native modules Expo Go ships (Skia 2.14.0,
Reanimated 4.7.1, Worklets 0.13.0 on React Native 0.88.1). It does not prove compatibility with
arbitrary native React Native projects, other native module versions, or release builds.

## Library versions

| Library | Tested | Peer range | Notes |
| --- | --- | --- | --- |
| React Native | 0.88.1 | `>=0.88.0` | New Architecture only (Reanimated 4). Older versions were never run, so they are excluded |
| React | 19.3.0 | `>=19.3.0` | |
| `@shopify/react-native-skia` | 2.14.0 | `^2.14.0` | Runtime shaders (SkSL) are used with a capability check and fallbacks |
| `react-native-reanimated` | 4.7.1 | `^4.7.1` | Used by `<GameFXTarget>` for the transform binding |
| `react-native-worklets` | 0.13.0 | (Reanimated's peer) | Expo SDK 58 pins 0.13.0 |
| React Navigation (consumer app only) | native 7.5.2, native-stack 7.21.1 | not a dependency | Call `fx.remeasure()` on `transitionEnd` |
| TypeScript | 6.0.3 (apps), 5.9 (SDK build) | n/a | Strict mode, `exactOptionalPropertyTypes` in the SDK |

## Tooling

| Item | Tested | Not verified |
| --- | --- | --- |
| Node | 22.23.4 | Other versions (`engines: >=22`) |
| Package manager | npm 10.9.9 | yarn, pnpm (pnpm's links may need Metro's `unstable_enableSymlinks`) |
| JavaScript engine | Hermes (Expo Go Android, by the owner) | JSC |
| Build mode | Development (Expo Go) | Release builds |
| Host OS for scripts | Linux (CI and this environment) | Windows for `consumer:install`, `pack:verify` (the showcase install scripts have run on the owner's Windows PC) |

## Known platform differences

- **Web:** views cannot be captured, so `burn-away` uses its fallback (the view chars and fades).
  CanvasKit must be loaded before Skia is imported (see INSTALLATION.md).
- **Native stack navigation:** a pushed screen is measured while it slides in; overlay-drawn
  effects need `fx.remeasure()` after the transition. Effects drawn in a target's local layer
  (fire, glow) are not affected.
- **iOS:** nothing has run on iOS; treat it as unsupported until checked.
