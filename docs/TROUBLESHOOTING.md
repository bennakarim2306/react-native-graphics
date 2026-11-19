# Troubleshooting

Problems seen while building and testing the SDK and its apps, with the fix. Commands are one per
line so they also work in Windows PowerShell 5.

## Installation and bundling

**`"C:\Program" is not recognized` (German: `Der Befehl "C:\Program" ist entweder falsch geschrieben`) from `npm run consumer:install`, `example:install` or `pack:verify` on Windows**
The scripts used to start every command through `cmd.exe`, which split `C:\Program Files\nodejs\node.exe` at the space. Fixed on 2026-11-19 (commit a297427): update the branch (`git pull`) and run the command again. The `windows` CI job checks this with spaces in all paths.

**`Unable to resolve module react-native-graphics/lib/...` or `.../src/...`**
Deep imports are blocked by the package's `exports`. Import from `react-native-graphics` or
`react-native-graphics/core`.

**npm `EINTEGRITY` when installing the tarball**
The lockfile remembers the checksum of an older tarball with the same name. Install the file again
by path (`npm install ./vendor/react-native-graphics-0.1.0-rc.0.tgz`), which refreshes the entry;
`npm run example:install` and `npm run consumer:install` do this.

**Two copies of React ("Invalid hook call") or Skia errors after installing from a folder**
`npm install ../react-native-graphics` creates a link, and Metro then resolves React, React Native
and Skia from the SDK repository's own `node_modules`. Install the packed tarball instead. The
consumer's `npm run check:imports` reports a linked install.

**`npm ERR! ERESOLVE` peer dependency conflict**
Your React Native, React or Reanimated is older than the peer range (`react-native >=0.88.0`,
`react >=19.3.0`, `react-native-reanimated ^4.7.1`). Older versions were never tested. With Expo,
`npx expo install --fix` aligns the native modules to your SDK.

**Expo CLI tries to reach the network and fails (`api.expo.dev`)**
Offline or behind a firewall, set `EXPO_OFFLINE=1` (PowerShell: `$env:EXPO_OFFLINE = "1"`) before
`npx expo start` or `npx expo export`.

**Metro serves an old version of the SDK after reinstalling**
Restart with a clean cache: `npx expo start --clear` (bare React Native:
`npx react-native start --reset-cache`).

## Runtime

**Expo Go: `Uncaught Error: Cannot convert undefined value to object` in Reanimated's `PropsRegistryGarbageCollector.ts` (`unprocessSettledUpdate`)**
The app's Reanimated JavaScript is newer than the native Reanimated inside Expo Go. Expo SDK 58's Expo Go contains Reanimated 4.7.1; with `"react-native-reanimated": "~4.7.1"` npm installed 4.7.2, whose JavaScript expects a newer native module. Expo's start screen hints at it ("1 package may need updating"). Fix: `npx expo install --check`, then `npx expo install --fix` (or pin the exact version Expo lists). The consumer and showcase apps pin `4.7.1` since 2026-11-19, and CI runs `npx expo install --check` for both. Development builds compile the native code from `node_modules` and do not have this mismatch.

**`NotReadyError: GameFX is not ready yet`**
An effect was started during the provider's very first render. Start effects from event handlers
or `useEffect`, or check `fx.ready` first.

**`InvalidOptionError: Unknown target "card"`**
No `<GameFXTarget id="card">` is mounted under the same provider (yet). Targets register when they
mount; start effects after that (event handlers, or an effect in the parent of the target).

**Overlay-drawn effects (explosions, sparks, confetti) appear offset on a screen pushed by React
Navigation's native stack**
The screen's views were measured while the screen slid in. Call `fx.remeasure()` on the
navigator's `transitionEnd` event (see INSTALLATION.md section 5). Effects drawn inside a target
(fire, glow, borders) are not affected.

**Effects lag behind a view while a list scrolls**
Overlay-drawn effects follow measured positions, and measuring is asynchronous. Call
`fx.remeasure()` from `onScroll`, or let fixed effects draw in the target's local layer (the
default `effectsLayer="local"`).

**Fire or glow is cut off at the edge of a container**
The local layer is clipped by ancestors with `overflow: 'hidden'`. Use
`<GameFXTarget effectsLayer="overlay">` there.

**An effect seems to run forever, or the frame loop never stops**
Check `fx.engine?.stats`. Effects with `rate` and no `duration` (fire, smoke, continuous sparks,
trails, glow pulses with infinite pulses) run until `stop()`/`cancel()` or until their target
unmounts. A timeline that loops forever runs until you cancel it, even if its views unmounted:
cancel it in your component's cleanup. Tweens and keyframes of an unmounted target end by
themselves (`targetDestroyed`).

**Counters stay above zero for a moment after leaving a screen**
Expected: effects bound to an unmounted view stop emitting and complete when their last particles
faded (about 2 s for fire and sparks). The consumer app's self-tests wait up to 6 s.

**Effects jump ahead after the app returns from the background**
`pauseInBackground` is on by default. If you set it to `false`, the engine keeps its clock running
in the background and effects continue from the current time when frames resume.

**`burn-away` chars and fades instead of burning a picture of the view on the web**
Views cannot be captured on the web; this is the fallback.

**Nothing draws on the web; console shows CanvasKit errors**
`LoadSkiaWeb()` must finish before anything imports Skia, and `canvaskit.wasm` must be served next
to the page (INSTALLATION.md section 6).

## Tests

**Jest: `SyntaxError: Cannot use import statement outside a module` from `react-native-graphics`**
The React Native Jest preset resolves the package's ES modules. Add `react-native-graphics` to
`transformIgnorePatterns` (INSTALLATION.md section 7).

**Web smoke test: `Playwright is not installed`**
In the consumer folder: `npm i -D playwright`, then `npx playwright install chromium`, then
`npm run test:web`. `PW_CHROMIUM_PATH` selects another Chromium.

## Known issues

See [CHANGELOG.md](../CHANGELOG.md#known-issues-not-addressed-in-this-release-candidate) and
[COMPATIBILITY.md](COMPATIBILITY.md).
