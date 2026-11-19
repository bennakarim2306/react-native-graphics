# Progress

| Phase | Status |
| --- | --- |
| 0. Repository audit and migration | **Done** (2026-11-11, merged in PR #1) |
| 1. Working engine prototype (particle burst) | **Done on Android** (2026-11-12, Android 17 emulator, Expo Go). iOS not yet verified. See below |
| 2. Runtime, scene graph and animation orchestration | **Done on Android** (2026-11-12, Android 17 emulator, Expo Go). iOS not verified. See below |
| 3. Graphics engine, sprites, assets, RN anchoring | **Done on Android** (implemented 2026-11-12; verified by the owner on the Android 17 emulator, Expo Go, 2026-11-13). iOS not verified |
| 4. Advanced effects, particles, shaders, composable FX | **Checked on Android by the owner, one fix pending re-check** (implemented 2026-11-13). The owner confirmed graphics and functions on the Android 17 emulator (2026-11-16) and reported effects trailing moving cards in the later demos; the fix (local effects layers) is implemented and tested, not yet re-checked on the emulator. iOS not verified. See below |
| 4A. Effects runtime and advanced particle engine | **Implemented and tested in the container, ready for review** (2026-11-17). Not run on Android or iOS yet. See below |
| 4.5. Visual fidelity, rendering quality, performance | **Implemented and tested in the container; visual acceptance pending** (2026-11-17). Checked with automated tests, real Skia renders (before/after) and the web build. Not run on Android or iOS; no device performance measured. See below and [PHASE_4_5_VISUAL_QUALITY_REPORT.md](PHASE_4_5_VISUAL_QUALITY_REPORT.md) |
| Burn-away effect (owner's request, 2026-11-17) | **Implemented and tested in the container; not run on a device yet** (2026-11-17). A new built-in effect: a view burns away and stays hidden. Checked with tests, real Skia renders, Android/iOS bundles and the web build (fallback only). The view capture on iOS/Android is untested. See below |
| 4B, 4C, 4D | Not started (not to begin without the owner) |
| 5. SDK packaging, independent integration, API stabilization, release readiness | **Implemented but not yet fully validated** (2026-11-17). Release candidate `0.1.0-rc.0` built, packed, validated and installed into an independent consumer app; all automated checks pass and the consumer ran end to end on the web. Not yet run on Android (owner's emulator) or iOS; no device performance measured. See below |
| 6 | Not started (not to begin without the owner) |

## Phase 5: SDK packaging and release readiness (2026-11-17)

### Status

**Implemented but not yet fully validated.** Everything the brief asks for is implemented and passes automated checks in the container. Three acceptance criteria need a device and are open: Android runtime of the consumer app (15), iOS (16, explicitly pending: deferred by the owner) and device performance numbers (17 is documented, but only with Node and web numbers). Branch `claude/phase-5-sdk-release`, based on `claude/project-thread-5mm4qx` (PR #4, `burn-away`), which is based on `main` after PR #3 (Phases 2 to 4.5) was merged.

Baseline: the starting commit (ceb064a, PR #4) passed `npm run check` with 39 suites and 470 tests and its CI was green; no baseline failures were carried into Phase 5.

### What was done

- **Packaging:** version `0.1.0-rc.0` (`private: true` and `UNLICENSED` kept); ES modules, CommonJS and declarations with maps (`scripts/build.mjs`, `tsconfig.build*.json`); `exports` with `types`/`react-native`/`browser`/`module`/`default` conditions for `.` and `./core`, deep imports blocked; `files` limited to `lib/`, `src/` without tests, README, CHANGELOG; `sideEffects: false`; peer ranges narrowed to the tested versions; no runtime dependencies, no install scripts.
- **Package validation:** `scripts/verify-package.mjs` (`npm run pack:verify`, part of `npm run check` and CI) and `scripts/public-api.mjs` with the pinned export list `scripts/public-api.json`.
- **Public API:** explicit export lists (19 internal helpers and 3 internal types no longer exported), `NotReadyError`, `DEFAULT_QUALITY`, `CustomEffectName`, `engine.stats`, `<GameFXProvider pauseInBackground>`, typed parameters for built-in names in every overload (a type hole let misspelled parameters through), union-friendly `attach` parameters. Details and migration notes in [CHANGELOG.md](../CHANGELOG.md).
- **Lifecycle fix found by the consumer app:** an endless animation of a `<GameFXTarget>` (`fx.animate(id, { repeat: Infinity })`) kept running after the view unmounted, so the frame loop never stopped and each visit of a screen added one more. Reproduced with a failing test, fixed in the engine's frame loop (tweens and keyframes of a destroyed object end with `targetDestroyed`), regression tests added in `playback.test.ts` and `lifecycle.test.tsx`. The existing test that expected such a tween to "complete" now expects `cancelled`/`targetDestroyed` (behaviour change, listed in the changelog).
- **Other fixes:** `fx.quality` before ready reported `high` (default is `medium`); explicit `'worklet'` directives in `<GameFXTarget>`'s animated styles.
- **Tests:** ten release lifecycle scenarios with real components (`lifecycle.test.tsx`), public API contract tests, a type-level API test (`apiTypes.test.tsx`).
- **Consumer app** `gamefx-consumer-test` (`consumer/`, installed outside the repository by `scripts/install-consumer.mjs`): screens A to H, import-isolation check, headless web smoke test, benchmark screen for the nine brief scenarios.
- **CI:** `check` job now ends with `pack:verify`; new `consumer` job (fresh tarball into the runner's temp folder, typecheck, import check, Android/iOS/web bundles, web smoke test with Playwright 1.63.0); new `windows` job (`pack:verify` and `consumer:install` with spaces in every path, then the consumer's import check and type check); npm cache per lockfile.
- **Docs:** README, INSTALLATION (new), API, EFFECTS (per-effect reference), COMPATIBILITY (new), PERFORMANCE, TESTING, TROUBLESHOOTING (new), RELEASE (new), ARCHITECTURE, CHANGELOG (new).

### Verification (Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run check` (typecheck, lint, all Jest projects, `pack:verify`) | **Pass: 42 suites, 488 tests, 0 failed.** Package OK: 7 entry points, public API matches (127 values, 170 types at the root; 118 and 155 in `/core`), `./core` loads in Node with `require` and `import`, deep imports blocked. CanvasKit prints the intentional `unknown identifier 'nope'` |
| `npx jest src/engine/playback.test.ts --selectProjects=core` before the fix | **Fail** (2 tests: the endless tween and keyframes never ended, 5 s timeout), reproducing the leak |
| same, and `npx jest src/react-native/lifecycle.test.tsx --selectProjects=react-native`, after the fix | Pass (34 and 11 tests) |
| `npm pack --dry-run` | 508 files, 423 KiB packed, 2613 KiB unpacked: `lib/module`, `lib/commonjs`, `lib/typescript` (144 files each), `src/` (73 files, no tests), README, CHANGELOG, package.json |
| `npm pack` | `react-native-graphics-0.1.0-rc.0.tgz`, SHA-256 `9801440b6e1e97cc88a8495fe3c63fadb252a478da3658eb0a595e2ad9f69932` (copy in the project files under `phase5/`) |
| `npm run consumer:install -- <temp folder>` (fresh folder, as CI does), then in it `npm run typecheck`, `npm run check:imports`, `npm run export:android`, `export:ios`, `export:web`, `npm run test:web` | **All pass.** 17 files scanned, 20 SDK imports, only public entry points, tarball install. Android bundle: Hermes bytecode, 1524 modules. Web smoke: **23 of 23 checks**, including navigation ×10 (PASS after 2.1 s) and provider remount ×20 (20 engines disposed cleanly), no page errors. Screenshots: [docs/evidence/phase5/consumer-web-smoke.png](evidence/phase5/consumer-web-smoke.png) |
| First web smoke run, before the fix | 21 of 23: the navigation self-test and one benchmark clean-up check failed; this is how the leak was found |
| `npm run example:install`, then `cd example`, `npx tsc --noEmit` | First run: **fail** (TS2769 in `GraphicsDemo.tsx`: a union of effect names no longer fit the stricter overloads). Fixed with distributive parameter types and a type test; then pass |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform android` / `ios` / `web` | Pass (1282, 1284 and 968 modules) |
| `node scripts/capture-effects-showcase.js <folder> 1` against the showcase's web build | Pass, 68 screenshots, no page errors (Phase 4.5 visuals spot-checked, unchanged) |
| `npm run visual` | Pass |
| `npm run bench` | Pass; numbers in [PERFORMANCE.md](PERFORMANCE.md#phase-5-release-benchmark-scenarios) (Node, not a device) |
| `npm audit` (root, example, consumer) and `npm audit --omit=dev` (root) | Runtime: **0 advisories** (the SDK has no dependencies). Tooling: picomatch ReDoS (GHSA-fc5q-39xc-vjpf, high), minimatch DoS (GHSA-g3hv-75wg-m249) and glob (GHSA-3g3m-2fjr-6pw4), moderate, all in build and test tools (Metro, Expo CLI, Jest, ESLint, React Native's codegen); they process the developer's own files, not user input. `npm audit fix` would move Reanimated and Worklets off the versions Expo SDK 58 pins, so it was not applied |
| License review of the consumer's installed tree | MIT 486, ISC 32, BSD 12, Apache-2.0 6, BlueOak 3, others single; MPL-2.0 only in `lightningcss` (Expo CLI build tool, not bundled into apps); `node-forge` dual BSD/GPL (Expo CLI). Peers: Skia, Reanimated, Worklets, React, React Native are MIT. Demo sprite: generated by `scripts/generate-demo-sprites.py` |
| Secrets, `.env` files, network APIs, install scripts | None found. The only network use is Skia loading an image from a URL that the app itself registers |
| GitHub Actions on PR #5 (run 44160173850, commit 533712b) | **All three jobs pass:** `check` (typecheck, lint, tests, `pack:verify`), `example` (showcase type check and bundles) and `consumer` (install from a fresh tarball outside the repository, import check, Android/iOS/web bundles, Playwright web smoke test) |
| GitHub Actions, second run (44161270119, commit b63c24f) | `consumer` **failed**, 22 of 23: "E: sequence reaches the reward stage" saw `Done`. Cause: the reward stage is on screen for 150 ms and the test polled its text every 150 ms plus a browser round trip, so it could miss it. Reproduced with a probe that plays the sequence 25 times: the old check missed it 2 and 4 times in two runs. Fix: screen E records the path of stages (`sequence-path`) and the check reads it; the probe then found the path in order 25 of 25, and `npm run test:web` passed 23 of 23 |
| Owner's Windows PC, `npm run consumer:install` (2026-11-19) | **Failed:** `"C:\Program" is not recognized`. Cause: `scripts/sdk-pack.mjs` ran every command with `shell: true` on Windows, and `cmd.exe` split `C:\Program Files\nodejs\node.exe` at the space (`example:install` and `pack:verify` were affected too). Reproduced by a new `windows` CI job with Node, the repository and the consumer in folders with spaces (run 44504292992, commit 3df1625: same error). Fix (commit a297427): Node and tar start without a shell, npm runs through `npm_execpath` with the same Node (or `cmd.exe` with quoted arguments outside `npm run`), and `pack:verify` extracts the tarball by file name. Then the `windows` job passed (run 44504591590: `pack:verify`, `consumer:install`, import check, type check), as did the Linux jobs, and on Linux `pack:verify` with Node in a folder with a space and `consumer:install` into a folder with spaces |
| Owner's Android emulator, consumer app in Expo Go (2026-11-19) | **Crashed at start:** `Cannot convert undefined value to object` in Reanimated's `PropsRegistryGarbageCollector.ts` (`unprocessSettledUpdate`). Cause: the consumer declared `"react-native-reanimated": "~4.7.1"` and npm installed 4.7.2, while Expo Go for SDK 58 contains native Reanimated 4.7.1 (`expo/bundledNativeModules.json` pins `4.7.1`). 4.7.2's JavaScript reads `keysLastWrittenByAnimatedStyle` from `getSettledUpdates`, which the 4.7.1 native module does not return. The showcase's lockfile had 4.7.1, which is why it ran. `npx expo install --check` on the old consumer: exit 1, "react-native-reanimated@4.7.2 - expected version: 4.7.1". Fix: both apps pin `4.7.1`; CI runs `npx expo install --check` for both. A fresh `consumer:install` then installed 4.7.1 and passed the check, type check, Android bundle, web bundle and web smoke test (23 of 23). No SDK code changed. Not yet re-run on the emulator |

### Not verified

- The consumer app on Android (Expo Go on the owner's emulator) and on iOS.
- Device performance: no FPS, frame-time, memory or CPU numbers from a phone or emulator. This container has no Android emulator (no KVM, no Android SDK).
- Bare React Native, development builds, release builds, other package managers.

### Release blockers (for publishing, not for reviewing the candidate)

1. Owner decisions: package name (`react-native-graphics` was used and unpublished on npm in 2022), license, registry.
2. Android run of the consumer app and device benchmark numbers.
3. iOS run, or release notes that say iOS is unverified.
4. The three visual issues from the Phase 4.5 device check (soft fire halo, washed-out card at impact, particles leaving the demo boxes) are open by the owner's choice.

### Next action

The owner runs the consumer app on the Android emulator (steps in [TESTING.md](TESTING.md#device-checks) and [PERFORMANCE.md](PERFORMANCE.md#device-procedure-owner-windows-powershell-one-line-at-a-time)) and reviews the pull request.

## Burn-away effect (2026-11-17)

### Status

**Implemented and tested in the container; not run on the Android emulator, a phone or iOS.** The owner asked for "a new effect: a card disappearing by burning" and nothing else, so the three issues seen on the device run of Phase 4.5 (soft fire halo, washed-out card at impact, particles leaving the demo boxes) are recorded but not changed.

### What was built

- **`burn-away`** (`fx.play('burn-away', { target, from, duration, roughness, color, ... })`): on iOS and Android the target takes a picture of its view, the view is hidden, and the engine burns the picture: a ragged edge (seeded wave noise plus fine fibres) moves across the card from a side, a corner, the centre or a random point; the paper browns, chars to a dark band and glows at the rim; flames, embers, smoke and ash are emitted along the edge. When everything has burned, the view stays hidden through its motion (`motion.opacity = 0`; `motion.reset()` or a tween to opacity 1 shows it again) and the picture is freed. Cancel or stop at any moment shows the view at once. Without a picture (web, a failed or late capture) the view itself chars and fades. Scene nodes can burn too (their own image, or a char overlay). Quality `low` and reduced motion drop the smoke and ash.
- **Engine support** (additive, existing behaviour unchanged): optional effect services `snapshotTarget` and `concealTarget`; `TargetRegistry` `setSnapshotter`, `canSnapshot`, `snapshot`, `conceal`, `concealOpacity` and a `conceal` event; shader fills with image children (`defineShader({ children })`, `{ type: 'shader', children: { image: { type: 'image', image } } }`); three shaders (`burnPaperShader`, `burnGlowShader`, `burnCharShader`).
- **`<GameFXTarget>`**: installs the snapshotter on iOS/Android (`makeImageFromView`, local effects layer hidden for the two frames of the capture) and multiplies its opacity by the concealment.
- **Showcase I · Burn away** (`example/BurnDemo.tsx`, right under A in the Effects tab): Burn, Cancel, Restore, origin, color, duration, roughness, "fire first" (fire border for 900 ms of engine time, then the burn), "move while burning" (the card drifts and turns while it burns), and a hand of three cards burned one after another on a timeline.

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run check` (typecheck, lint, all tests, build) | **Pass: 39 suites, 470 tests, 0 failed** (441 before, 29 new: 16 effect tests, 5 Skia render tests, 3 React Native target tests, 5 registry and shader tests). The first run failed one entry-point test that lists the built-in effect names; the new name was added to it. CanvasKit prints the intentional `unknown identifier 'nope'` |
| `BURN_FRAMES_DIR=<folder> npx jest src/renderer/skia/burnAway.render.test.ts --selectProjects=renderer` | Pass; frames of a corner burn (200–1700 ms) and a bottom burn written as PNG. Sheet: [docs/evidence/burn-away/burn-away-sheet.png](evidence/burn-away/burn-away-sheet.png) |
| `npm run example:install`, then `cd example` and `npx tsc --noEmit` | Pass |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform android` / `--platform ios` | Pass (Hermes bundles, 1282 and 1284 modules) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir dist-web`, served locally, then `node scripts/capture-effects-showcase.js <folder> 2` | Pass, no page errors, 68 screenshots (8 new of section I: the web fallback burning and burned, restore, fire first in blue, cancel, the staggered hand). Sheet: [docs/evidence/burn-away/web-section-I.png](evidence/burn-away/web-section-I.png). The script's Cancel click in B is now scoped to B's card, because I also has a Cancel button |

**Not verified:** the view capture (`makeImageFromView`) in Expo Go on Android or iOS, whether the picture lines up exactly with the view on a device (pixel density, transforms, a list scrolled without `fx.remeasure()`), device frame times, and visual acceptance by the owner. The web shows only the fallback.

### Changed files

- New: `src/effects/burnAway.ts`, `src/effects/burnAway.test.ts`, `src/react-native/viewSnapshot.ts`, `src/react-native/burnAway.test.tsx`, `src/renderer/skia/burnAway.render.test.ts`, `example/BurnDemo.tsx`, `docs/evidence/burn-away/*.png`
- Changed: `src/effects/index.ts`, `src/engine/engine.ts`, `src/graphics/{shader,shaderLib,paint,index}.ts`, `src/renderer/skia/SkiaEffectsRenderer.ts`, `src/runtime/{effect,index}.ts`, `src/scene/{targets,index}.ts`, `src/react-native/GameFXTarget.tsx`, tests (`src/index.test.ts`, `src/scene/targets.test.ts`, `src/graphics/graphics.test.ts`), `example/EffectsDemo.tsx`, `example/package-lock.json` (tarball hash), `scripts/capture-effects-showcase.js`, `README.md`, `docs/{EFFECTS,API,ARCHITECTURE,PROGRESS}.md`

### Next step

The owner opens the Effects tab on the Android emulator, presses Burn in section I and checks that the burning picture sits exactly on the card and looks right. If the capture fails on the device, the card chars and fades instead (the fallback), which tells us the capture is the problem.

## Phase 4.5: Visual fidelity, rendering quality and performance (2026-11-17)

### Status

**Implemented and tested in the container; the owner's visual acceptance is pending.** The full write-up (root causes, improvements, before/after, performance, limitations) is [PHASE_4_5_VISUAL_QUALITY_REPORT.md](PHASE_4_5_VISUAL_QUALITY_REPORT.md). Nothing of Phase 4.5 has run on the Android emulator, a phone or iOS, and no device frame time was measured. Phase 4A and the c56d06f fire-lag fix are still waiting for the owner's emulator check as well.

### What was done

- **Audit first** (at c8a478b): every effect rendered with real Skia at fixed times, then the code behind each image. Root causes: the fire shader had no "up" (a symmetric band pointing out of every edge), its glow was a blur layer over the card, `low` replaced it with soft particle "bokeh", particle flames piled up while a card scaled (emitters rebuilt on every size change), the explosion was dominated by two flat white rings and a grey disc with no fireball and confetti-like debris, it started over the card's centre, and the default profile was the most expensive one. Resolution handling was correct (no double scaling; now tested).
- **Fire border:** new flame shader (rising tongues and licks, tall on top, leaning sides, rotation-aware, halo inside the shader), lite shader on `low`, finer sparks, emitters reconfigured in place, new live parameters `speed`, `glowStrength`, `sparkDensity`, `coreColor`, `tipColor`.
- **Throw & Explode:** depth cue (`throw.scale`, default 1.08 here), impact punch (`punch` 0.06), optional `trail`, explosion at the contact point (`explodeAt`), per-sequence `quality`. Cancel/replay behaviour unchanged and still tested.
- **Explosion:** bloom, fireball, flash, thin decelerating shockwave, white-hot sparks (halo on `high`), embers, warm-to-charcoal debris, darker rising smoke; same timing on every profile; new `glow` parameter.
- **Presets polished:** shockwave, confetti, golden sparks, smoke (new `opacity`), glow pulse, victory. No new presets.
- **Particles:** emitter `glow` (halo pass for sparks and circles). Batching of soft particles was tried and measured slower; not adopted.
- **Quality:** `shaderDetail` (`lite`/`full`) in profiles; engine default `medium` instead of `high`.
- **Tools:** `npm run visual` (deterministic scenes to PNG with real Skia, `scripts/visual/`), `npm run bench:render` (CanvasKit recording and raster cost), new engine bench scenarios (repeated throws, rapid cancel/replay, long emitters, `medium`).
- **Showcase H** (`example/QualityLab.tsx`): profiles side by side, the fire border and Throw & Explode with every visual parameter at a chosen profile, replay and cancel, a combined finale. Public API only.

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run check` (typecheck, lint, all tests, build) | **Pass: 36 suites, 441 tests, 0 failed** (428 before, 13 new; tests whose intended behaviour changed were updated, none skipped). CanvasKit prints one `RuntimeEffect error ... unknown identifier 'nope'`: the intentional broken-shader test |
| `npm run example:install`, then `cd example` and `npx tsc --noEmit` | Pass (section H included) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform android` | Pass (Hermes bundle, 1279 modules) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform ios` | Pass (Hermes bundle, 1281 modules) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir dist-web`, served locally, then `node scripts/capture-effects-showcase.js <folder> 2` | Pass, no page errors. 60 screenshots at 412 × 915 @2×, 18 of section H (profiles side by side, fire per profile and rotated, throw impact and aftermath on `high` and `low`, cancel, combined finale), in `phase4.5/screenshots/web/`. Active effects back to 0 at the end; the Emitter lab's counters as in 4A (the script's lab steps now stay inside the lab's card, because section H also has "Cancel" and "Violet" labels) |
| `npm run visual`, and the same scenes rendered from the c8a478b source | 62 PNGs per version plus manifests, 12 comparison sheets; a second render is byte-identical. Project files `phase4.5/screenshots/` |
| `npm run bench`, both versions, twice each (Node, not a device) | Fire borders unchanged within noise on `high`/`medium`, about 15× less JS on `low`; explosions about 1.3–1.8× more JS (more layers); new scenarios (repeated throws, cancel/replay, long emitters) all far below a frame and idle afterwards. Tables in PERFORMANCE.md |
| `npm run bench:render`, both versions (CanvasKit CPU, not a GPU) | Fire shader about 1.5–1.8× the old per-pixel CPU cost; high explosions 5.1 s → 0.9 s CPU playback (no blur layers); soft-particle batching measured slower and not adopted. Tables in PERFORMANCE.md |

**Not verified:** anything on the Android emulator, a phone or iOS; device frame times, GPU cost of the new fire shader, memory; visual acceptance by the owner.

### Changed files

- New: `example/QualityLab.tsx`, `src/renderer/skia/density.render.test.ts`, `scripts/visual/{scenes.ts,render.visual.ts,particles.renderbench.ts}`, `jest.visual.config.js`, `docs/PHASE_4_5_VISUAL_QUALITY_REPORT.md`, `docs/evidence/phase4.5/*.png` (4 comparison sheets)
- Changed: `src/effects/{fireBorder,presets,primitives}.ts`, `src/graphics/{shaderLib,index}.ts`, `src/engine/{engine,sequences}.ts`, `src/motion/throw.ts`, `src/particles/{emitter,burst}.ts`, `src/renderer/skia/SkiaEffectsRenderer.ts`, `src/runtime/quality.ts`, their tests, `example/{EffectsDemo,ui}.tsx`, `example/package-lock.json` (tarball hash), `scripts/{effects.bench.ts,capture-effects-showcase.js}`, `package.json` (scripts), `.gitignore`, `README.md`, `docs/{EFFECTS,API,TESTING,ARCHITECTURE,PERFORMANCE,PROGRESS}.md`

### Behaviour changes

Listed in section 9 of the report. The ones an app notices first: default quality `medium`; `low` fire is a lite shader; Throw & Explode explodes at the contact point and adds depth and punch by default (`{ throw: { scale: 1 }, punch: 0, explodeAt: 'center' }` restores the Phase 4 behaviour); new explosion layers.

### Next step

1. The owner checks section H on the Android 17 emulator (steps in section 11 of the report) and gives the visual verdict on the fire border and Throw & Explode.
2. The same session can cover the still-open 4A check (demo G) and the c56d06f re-check.
3. Phase 5 starts only with the owner's approval.

## Phase 4A: Effects runtime and advanced particle engine (2026-11-17)

### Status

**Implemented and tested in the container; not run on a device.** Automated tests, Android and iOS bundles and web screenshots (Skia through CanvasKit/WebGL in headless Chromium) back every item below. Nothing of Phase 4A has run on the Android emulator, a phone or iOS. The Phase 4 fire-lag fix (commit c56d06f, local effects layers) is also still waiting for the owner's emulator re-check.

### Step 1: what was really there (audit, before any change)

Baseline at c56d06f: `npm run check` passed, **34 suites, 413 tests**. The code, demos and tests were checked against each 4A requirement instead of trusting the docs:

| 4A requirement | Before 4A | Tests that cover it | 4A change |
| --- | --- | --- | --- |
| Reusable effect definitions and instances | `defineEffect`, `defineComposite`, the `EffectInstance` contract | `runtime.test.ts`, `presets.test.ts` | None |
| Effect registry | `engine.register`, `hasEffect`, the provider's `effects` prop, `builtInEffects` | `runtime.test.ts`, `index.test.ts` | None |
| Start, pause, resume, cancel, dispose | `play`/`attach`, `EffectHandle` `pause`/`resume`/`stop`/`cancel`, `engine.dispose` | `runtime.test.ts`, `stress.test.ts` | None (new scenario tests) |
| Sequential and parallel composition | `sequence`, `parallel`, `stagger`, timelines | `timeline.test.ts`, `sequences.test.ts` | None |
| Integration with timelines | `fx.cue` items at exact timeline times | `sequences.test.ts` | None |
| Attachment to scene nodes and RN targets | `target` + `follow` on every placed effect, `attach`, `GameFXTarget`, local effects layers | `targets.test.ts`, `localLayers.test.ts`, `phase4.test.tsx` | None |
| Configurable emitters and particle properties | Every property at start; **a running emitter could only change `intensity` and `rate`** | `emitter.test.ts` | **Gap closed: live emitter changes** |
| Point, line, circle, rect emission | All four, plus `path` | `emitter.test.ts` | None |
| Local and world space | Both | `emitter.test.ts`, `localLayers.test.ts` | None |
| Deterministic simulation | Seeded, closed-form motion, frame-rate independent | `emitter.test.ts` | Extended to runtime changes |
| Pooling and resource management | `ParticlePool` (capacity buckets), `sharedParticlePool.stats` | `emitter.test.ts`, `stress.test.ts` | None |
| Quality levels | Particle scale per level, adaptive quality | `runtime.test.ts` | **Defect fixed** (live `rate` ignored the quality scale) |
| Showcase | Demos A to F; none showed several emitters changed while running, per-emitter pause/resume/cancel, emitters on moving scene objects, or cleanup with visible counters | – | **Gap closed: demo G, Emitter lab** |

No regressions were found in the baseline. Two defects were found in the `particles` effect's `update`: a new `rate` skipped the quality and reduced-motion scale (on `low` it emitted almost 3× too much), and a later `setIntensity` went back to the rate the effect started with. Both are fixed and tested.

### What was built

- **Live emitter changes:** `ParticleEmitter.configure(patch)` and `handle.update(patch)` on the `particles` effect accept `EmitterUpdate`: `rate`, `shape`, `lifetime`, `speed`, `direction`, `spread`, `directionMode`, `size`, `rotation`, `angularVelocity`, `inheritVelocity`, `gravity`, `drag`, `colors`, `colorOverLife`, `opacity`, `scale`. Birth properties apply to new particles; `gravity` and `drag` act on live particles from their current position and velocity (each particle stores the time its motion restarted, `t0`, so the closed-form motion stays exact and frame-rate independent); colors and curves apply to live particles at once. The whole patch is validated before anything changes. Fixed for an emitter's life: `space`, `maxParticles`, `bursts`, `duration`, `look`, `aspect`, `stretch`, `blendMode`. Presets keep `intensity` and `rate`.
- **Public types:** `EmitterUpdate`, `EMITTER_UPDATE_KEYS`, `ParticlesUpdate` (exported from both entry points).
- **Showcase G, Emitter lab** (`example/EmitterLab.tsx`): a trail (point, world space) and a halo (circle, local space) on an orb that orbits a hub, a fountain (line, world space, gravity) and snow (rect, world space) from a sliding box. Per emitter: start, pause/resume, stop, cancel. Live steppers for rate, speed, spread, gravity, size and palette, sent through `handle.update`. Pause all, resume all, stop all, cancel all. Remove orb (destroys the scene node; its two emitters stop and end) and add orb. Counters twice a second: each emitter's status, live particles, engine effects, and the particle pool (allocated, reused, idle). Public `react-native-graphics` imports only; no animation code of its own.

### The SDK for the brief's scenarios (step 3)

Developers use the SDK without Skia or Reanimated. These already existed from Phase 4 and are unchanged; 4A adds live emitter control:

```tsx
<GameFXTarget id="card"><Card /></GameFXTarget>             // any React Native view

const fire = fx.attach('card', { effect: 'fire-border', intensity: 0.8 });   // fire around a component
const seq = fx.throwAndExplode('card', { throw: { height: 170, duration: 1000 }, explosion: { particles: 150 } });   // launch + impact explosion, one handle
const glow = fx.attach('card', 'glow-pulse', {});                            // several effects on one target
const sparks = fx.play('particles', { target: 'card', rate: 40, space: 'local' });
sparks.update({ gravity: 200, colors: ['#FFD54A'] });                        // 4A: change it while it runs
seq.playback.cancel();                                                       // cancels the sequence and its explosion
```

Nothing in the engine knows about cards or games: "card" is any target id.

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run check` (typecheck, lint, all tests, build) | **Pass: 35 suites, 428 tests, 0 failed** (413 before, 15 new). CanvasKit prints one `RuntimeEffect error ... unknown identifier 'nope'`: the intentional broken-shader test |
| `npm run example:install`, then `cd example` and `npx tsc --noEmit` | Pass (the showcase type-checks against the packed SDK's public types) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform android` | Pass (Hermes bundle, 1278 modules) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform ios` | Pass (Hermes bundle, 1280 modules) |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir dist-web`, served locally, then `node scripts/capture-effects-showcase.js <folder> 2` | Pass, no page errors. 42 screenshots at 412 × 915 @2×, 9 of them of demo G (four emitters; fountain after live rate, spread and palette changes; trail and snow changed; all paused; fountain cancelled; orb removed; its emitters ended; orb added; lab ended). The lab's own counters, logged by the script: pool idle buffers 17 → 18 after cancelling the fountain → 20 after removing the orb (trail and halo ended); reused 36 → 38 after adding the orb; earlier demos still back to 0 active effects |
| `npm run bench` (Node, not a device) | Pass. Same particle counts and pool numbers as Phase 4 for every scenario (the change does not alter results); per-frame engine times within run-to-run noise of the Phase 4 table (for example 5 explosions 0.50 ms average vs 0.61 ms, 10 fire borders on high 0.34 ms vs 0.23 ms) |

New tests:
- `src/particles/emitter.test.ts`, "live configuration" (8 tests): birth properties only for new particles; gravity and drag changes continuous in position and velocity, with the closed-form values checked; spin still counted from birth; colors and curves applied to live particles, also with a shorter palette; rate re-timed and quality-scaled; switching a `rate: 0` emitter on later; fixed and unknown keys and invalid values rejected with nothing changed (compared with an untouched twin emitter); identical particles with changes at 10 ms and 25 ms frames; dispose.
- `src/engine/emitterLab.test.ts` (7 tests): the Emitter lab through the engine API, with the same calls as the demo. Four emitters at once on a rotating node and fixed positions; one emitter changed without touching the others; reversed gravity applied to every live particle from its current velocity; invalid updates leave results identical to a twin engine; presets reject emitter keys; per-handle pause and resume (frozen, no catch-up births) and cancel (storage back to the pool); removing the target (emitters stop, complete, storage back, a new orb reuses it); quality scaling of live rate changes; determinism and full release on dispose.
- `src/engine/runtime.test.ts`: one assertion changed on purpose. It expected `speed` to be rejected by `particles`' `update`; it is now accepted, and a fixed key (`maxParticles`) is rejected.

The two key mechanisms were also checked by mutation: without the motion restart on a force change, 2 tests fail; without the palette wrap-around, 1 test fails.

Screenshots (real CanvasKit/WebGL rendering in headless Chromium, **not** a device) are in the project files under `phase4a/screenshots/`, with the script's log.

**Not verified:** Phase 4A on the Android emulator, a phone or iOS; device frame times with the lab running.

### Changed files

- New: `example/EmitterLab.tsx`, `src/engine/emitterLab.test.ts`
- Changed: `src/particles/{emitter,pool,index}.ts`, `src/particles/emitter.test.ts`, `src/effects/{primitives,index}.ts`, `src/engine/runtime.test.ts`, `example/EffectsDemo.tsx`, `example/package-lock.json` (tarball hash), `scripts/capture-effects-showcase.js`, `README.md`, `docs/{EFFECTS,API,TESTING,PROGRESS}.md`

### Limitations

- `space`, `maxParticles`, `bursts`, `duration`, `look`, `aspect`, `stretch` and `blendMode` cannot change while an emitter runs; start a new one (a replacement `key` swaps it in one call).
- A change applies from the last frame before it, so changes between two frames all take effect at that frame's time.
- An emitter started with no `rate` and no `duration` is a burst emitter and ends after its bursts; start with `rate: 0, duration: Infinity` to switch emission on later.
- The overlay is not clipped by scroll containers: lab particles and scene shapes scrolled under the showcase's fixed header are drawn over it (visible in the web screenshots).
- Emitter positions can only follow a target or a scene node; moving a fixed `position` at runtime means animating a node and following it, as the lab does.

### Remaining Phase 4 milestones (not started)

4B, 4C and 4D, as the owner defines them, and Phase 5. None was started.

### Next step

1. The owner checks demo G on the Android 17 emulator (Expo Go): Start lab; change the fountain's rate, spread and palette; Pause all and Resume all; cancel one emitter; Remove orb and watch the pool's idle count rise; Add orb and watch reused rise; End lab. The same session can re-check the c56d06f fix (B with "Fire on card", E with "Fire on all" then "Spin all" and "Flip all", scrolling with fire on).
2. 4B and later start only after the owner's review.

## Phase 4: Advanced visual effects, particle systems and composable game FX (2026-11-13)

### Status

**Implemented and tested in the container; not yet verified on a device.** Each acceptance criterion below is backed by automated tests that were run, by Android and iOS bundles that built, and by genuine screenshots of the web build (Skia through CanvasKit/WebGL in headless Chromium). **No Phase 4 code has run on an Android emulator, a physical device or iOS yet**, and no device performance numbers exist. The owner's Android 17 emulator check (Effects tab, demos A to F) is the remaining step, as for Phases 1 to 3.

Baseline (step 1): CLAUDE.md, PROGRESS.md and the architecture docs were read; Phase 3 was intact (21 suites, 246 tests passing); versions unchanged (Expo SDK 58, React Native 0.88.1, Skia 2.14.0, Reanimated 4.7.1, Worklets 0.13). Reused without redesign: clock and `LocalTimer`, playbacks, timelines and markers, scene graph and display list, attachments, targets, graphics model, renderer, assets, sprites. Gaps closed: no continuous emitters (only one-shot bursts), no runtime parameter updates or graceful stop on handles, no way to start effects from timelines, no way to move a real React Native view, no quality or reduced-motion handling, no camera.

| # | Acceptance criterion | Evidence |
| --- | --- | --- |
| 1 | Reusable, composable effects system | Effect contract with `stop`/`setParams`, handles with `stop`, `update`, `setIntensity`, `onEnd`, `zIndex`, `key`; primitives, presets, `defineComposite`, cues on timelines (`src/runtime/effect.ts`, `src/engine/engine.ts`, `src/effects/*`, `src/engine/cue.ts`). `runtime.test.ts`, `presets.test.ts` (composites), `sequences.test.ts` |
| 2 | Configurable emitters with lifecycle | `ParticleEmitter` (`src/particles/emitter.ts`): point, line, circle, rect and path shapes, all particle properties of the brief, curves over life, world and local space, rate and bursts, `maxParticles`, pooled buffers, seeded. 25 tests in `emitter.test.ts`; pixel tests for every look |
| 3 | Shader infrastructure implemented and demonstrated | `SHADER_CHUNKS` + `composeShader` (noise, fbm, warp, distance functions, ramps), `flameBorderShader`, `displacementShader`, `distort` node effect, central compile cache, uniform validation, capability fallback. `shaderLib.test.ts`; CanvasKit pixel tests (fire pixels, animation, one compile for many nodes, distortion); demo A |
| 4 | Fire border on an existing React Native target | `fire-border` (`src/effects/fireBorder.ts`) attached to a plain `View` in `GameFXTarget`: `phase4.test.tsx` (attach spec on an ordinary view), demo A screenshots |
| 5 | Fire aligned during supported transformations | Explicit transform binding (`TargetMotion`, `GameFXTarget` as `Animated.View`): the same numbers move the view and the proxy node. `targets.test.ts`, `phase4.test.tsx` (view style and proxy node checked together), `fireBorder.test.ts` (position, rotation, scale), screenshots a3 to a5 (rotated, scaled, moved) and at 360 × 740 @3× and 1024 × 768 @1× |
| 6 | Explosion composed from reusable primitives | `explosion` = `defineComposite` of `flash`, `shockwave`, `particles` (sparks, embers, smoke, debris) and `screen-shake`; quality drops secondary layers. `presets.test.ts`, pixel test, demo D |
| 7 | Throw & Explode as a synchronized sequence | `ThrowMotion` (analytical ballistic, markers) + cues at the impact time on one timeline (`src/engine/sequences.ts`); no JavaScript timers. `throw.test.ts`, `sequences.test.ts` (impact point, cancel at every stage, replay after cancel, unmount), `stress.test.ts`, `phase4.test.tsx` (on a real view), screenshots b1 to b10 |
| 8 | Cancellation and cleanup | `cancel`, `stop`, keys, owner cancellation, target unmount, dispose; stress tests end idle with no attachments, playbacks or camera offset left |
| 9 | Multiple simultaneous effects | Rules in EFFECTS.md §6; `runtime.test.ts` (order, keys, limit), stress tests (100 explosions, 1000 effects, 200 in one frame, 12 emitters for a minute), demo E |
| 10 | Showcase demonstrates the real SDK | **Effects** tab (`example/EffectsDemo.tsx`, `example/PerfDemo.tsx`), public imports only, demos A to E as specified plus F (performance scenarios). Type-checks against the installed tarball; bundles for Android, iOS and web; 31 screenshots |
| 11 | Automated tests pass | **32 suites, 399 tests, 0 failures** |
| 12 | TypeScript and relevant builds pass | Table below |
| 13 | Earlier phases still work | All 246 Phase 1 to 3 tests still pass (two adjusted for the renamed fire outline, see API changes); Particles, Motion and Graphics tabs unchanged and bundled |
| 14 | Documentation reflects the implementation | New `docs/EFFECTS.md` (effects API, particles, shaders, composition, RN targets, quality) and `docs/TESTING.md`; `API.md`, `ARCHITECTURE.md`, `PERFORMANCE.md`, `README.md`, this file updated |

### What was built

- **Effects runtime:** graceful `stop()` (no new content, completes when what is on screen is done), validated runtime `update()`/`setIntensity()`, `onEnd`, `zIndex` (negative draws below the scene), replacement `key`s, per-instance `quality`, error isolation (reason `error`), cancellation reasons `replaced` and `owner`.
- **Particles:** `ParticleEmitter` with emitter shapes, direction modes (`fixed`, `normal`, `radial`), gravity vectors, drag, angular velocity, velocity alignment, curves, palettes and colors over life, looks (`circle`, `square`, `spark`, `ring`, `soft`, sprite-sheet `image` particles drawn with `drawAtlas`), world/local space with interpolated births and inherited velocity, a capacity-keyed buffer pool.
- **Shaders:** chunk library and composer; flame border and displacement shaders; `distort` node effect; uniform value-count validation; renderer capabilities passed to effects.
- **Effects (15 built in):** `fire-border` (new), `explosion`, `confetti`, `golden-sparks`, `smoke`, `trail`, `glow-pulse`, `shockwave`, `flash`, `screen-shake`, `victory`, `particles`; earlier `particle-burst`, `glow-border`, `energy-border`.
- **Composition:** `EffectCue`, `fx.timeline`, `fx.cue`, `fx.throw` (`ThrowMotion`), `throwAndExplode` / `fx.throwAndExplode`, `fx.animate`, `fx.getTarget`, target handles accepted wherever a target is.
- **React Native:** transform binding of real views (`GameFXTarget` is an `Animated.View`), deferred measurement while transformed, camera shake applied by the overlay, provider props `quality`, `adaptiveQuality`, `reducedMotion` (system setting by default), renderer capabilities reported by the overlay.
- **Showcase:** Effects tab with A (fire border: on/off, intensity, flame height, color, move, rotate, scale), B (Throw & Explode, replay, cancel, return/vanish), C (particle playground: count, speed, gravity, lifetime, direction, size, palette, look, burst or fountain), D (gallery of all presets), E (combined effects on three targets: fire on all, glow + sparks, explosions in sequence, spin, victory, clear), F (the seven benchmark scenarios with a live frame meter). A quality chip bar and an active-effect counter on top.
- **Tooling:** `scripts/effects.bench.ts` (seven scenarios in Node), `scripts/capture-effects-showcase.js` (reproducible web screenshots).

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (boundary rule now also covers `src/motion`) |
| `npm test -- --ci` | **Pass: 32 suites, 399 tests, 0 failed** (246 from earlier phases, 153 new). CanvasKit prints one `RuntimeEffect error ... unknown identifier 'nope'`: the intentional broken-shader test |
| `npx jest --coverage --ci` | All files: 92.7 % statements, 84.4 % branches, 93.9 % functions, 95.4 % lines |
| `npm run build` | Pass |
| `npm run bench` | Pass; results in `PERFORMANCE.md` (Node, not a device) |
| `npm run example:install` | Pass |
| `cd example && npx tsc --noEmit` | Pass |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform android` | Pass (Hermes bundle) |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform ios` | Pass (Hermes bundle) |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform web`, served locally, `node scripts/capture-effects-showcase.js` (Playwright, Chromium) | Pass, no page errors, active-effect counter back to 0 at the end. 27 screenshots of demos A to E at 412 × 915 @2×, 4 at other sizes and densities; section F exercised (all scenarios start, report and clean up) |

Screenshots (real CanvasKit/WebGL rendering in headless Chromium, **not** a device) are in the project files under `phase4/screenshots/`.

Defect found and fixed during visual checks: pressing Replay right after Cancel in `vanish` mode left the card half transparent, because the cancelled sequence restored opacity in a promise callback, after the new sequence had captured the faded value. The restore is now synchronous; a regression test cancels and replays in every phase.

**Not verified:** any Phase 4 behaviour on an Android emulator or device or on iOS; release builds; device frame times, memory and GPU load (the procedure is in `PERFORMANCE.md`); how the shader flames look on a phone GPU (web WebGL and CanvasKit CPU raster only); `reducedMotion: 'system'` with a real OS setting (tested with a mocked `AccessibilityInfo`).

### Changed files

New:
- `src/particles/{emitter,shapes,curves,pool}.ts` (+ `emitter.test.ts`)
- `src/effects/{primitives,presets,composite,placement,fireBorder}.ts` (+ `presets.test.ts`, `fireBorder.test.ts`)
- `src/graphics/{shaderLib,color}.ts` (+ `shaderLib.test.ts`)
- `src/motion/{throw,index}.ts` (+ `throw.test.ts`)
- `src/engine/{cue,sequences}.ts` (+ `runtime.test.ts`, `sequences.test.ts`, `stress.test.ts`)
- `src/runtime/quality.ts`, `src/scene/targets.test.ts`, `src/renderer/skia/effects.render.test.ts`, `src/react-native/phase4.test.tsx`
- `example/{EffectsDemo,PerfDemo,ui}.tsx`
- `scripts/{effects.bench.ts,capture-effects-showcase.js}`, `docs/{EFFECTS,TESTING}.md`

Changed:
- `src/runtime/{effect,index}.ts`, `src/animation/{playable,playback,timeline}.ts` (end-of-playback notification for cues and throws)
- `src/scene/{targets,index}.ts`, `src/graphics/{paint,path,effects,index}.ts`, `src/particles/{burst,index}.ts`
- `src/effects/{border,index}.ts` (+ `border.test.ts`), `src/engine/{engine,index}.ts`, `src/core.ts`, `src/index.ts` (+ `index.test.ts`)
- `src/renderer/skia/SkiaEffectsRenderer.ts`
- `src/react-native/{GameFXOverlay,GameFXProvider,GameFXTarget}.tsx`, `src/react-native/{useGameFX,index}.ts`
- `example/{App.tsx,package-lock.json}`, `jest.config.js`, `jest.setup.rn.js`, `eslint.config.mjs`, `package.json`
- `README.md`, `docs/{API,ARCHITECTURE,PROGRESS,PERFORMANCE}.md`

### API changes from Phase 3

Additive except where noted.
- **Breaking:** `fire-border` is now the Phase 4 flame effect (`FireBorderParams`: `intensity`, `flameHeight`, `color`, `glow`, `sparks`, `shape`, `mode`…). The Phase 3 shader outline is `energy-border` with `shader: 'fire'`.
- **Behaviour change:** `<GameFXTarget>` renders a Reanimated `Animated.View` (so the engine can move it). Its layout and touches are unchanged; Reanimated was already a peer dependency.
- `EffectHandle`: `stop`, `update`, `setIntensity`, `updatable`, `onEnd`, `zIndex`, `key`; new cancellation reasons `replaced`, `owner`, `error`. `PlayOptions`: `zIndex`, `key`, `quality` (React Native's own `PlayOptions` type is now the engine's).
- `attach(target, { effect, ...params })` spec form; `TargetRef` (id, handle or node) everywhere a target is accepted.
- Hook: `getTarget`, `animate`, `timeline`, `cue`, `throw`, `throwAndExplode`, `quality`, `setQuality`, `reducedMotion`. Provider: `quality`, `adaptiveQuality`, `reducedMotion`.
- Engine: `cue`, `motion.throw`, `getTarget`, `resolveTarget`, `quality`, `reducedMotion`, `camera`, `setRendererCapabilities`; option `adaptiveQuality`. `FrameEvent.camera`. Frame drawables are ordered by `zIndex`.
- Exports: emitter, shapes, curves, pool, primitives, presets, composites, `Placement`, shader library, colors, `ThrowMotion`, `throwAndExplode`, `EffectCue`, `TargetMotion`, `isTargetHandle`, quality types.

### Known limitations

- **Device coverage:** not run on Android or iOS yet; no device performance data. See "Not verified".
- **Views are not textures:** effects are drawn around React Native views, not into their pixels (no dissolve or distortion of a view).
- **Transform binding is explicit:** only transforms made through `motion` (or `fx.animate`, timelines, throws) are followed; transforms the app applies by other means are not.
- **JS thread:** simulation and picture recording run on the JavaScript thread. A busy JS thread delays effect frames (the app UI stays responsive).
- **Draw calls:** vector particles are drawn one Skia call per particle; up to ~1100 per frame in the five-explosion scenario. Unmeasured on devices; batching is the first optimization if needed.
- **Low quality fire:** replaces the shader with CPU particles; cheaper for the GPU, about 6× more JS time in Node. Needs a device measurement to decide.
- **Reduced motion** does not change motions the app starts itself (throws, tweens); `fx.reducedMotion` lets the app decide.
- **Optional presets** of the brief (lightning, energy aura, magic particles, fire trails, ice, dissolve) were not built; heat distortion exists as the `heatHaze` option and `distort` node effect.

### Remaining defects

None known. One defect was found and fixed during the visual checks (Replay after Cancel, see above).

### Follow-up: effects trailing moving cards (2026-11-16)

**Owner's check (Android 17 emulator, Expo Go, 2026-11-16):** "The graphics are good and the functions as well", but in demos other than the first, animations did not follow the card on time; for example the fire lagged behind a moving card.

**Cause.** Every effect was drawn by the overlay, one canvas above the app, positioned from measurements and the transform binding on the JavaScript thread. The platform moves native views on its own schedule: binding transforms are applied on the UI thread, scrolling is native and only reported back to JavaScript (then re-measured asynchronously), and a Skia surface is composited about a frame after it is drawn. The card and its fire could therefore be on different frames. Demo A (slow moves, no scrolling needed) hid it; the later demos need scrolling, and demo E spins cards at up to about 22° per frame, where one frame of difference is roughly 24 pt at a card's corner. This was not measured on the device; it is the explanation that fits the report and the pipeline.

**Fix (SDK, not demo-only): local effects layers.** Drawables that move rigidly with a target carry `anchor` (fire flames, glow and energy borders, glow pulses, local-space particles that follow a target). `<GameFXTarget>` draws them in a Skia canvas inside its own view, in the view's untransformed coordinates, so the platform moves the card and its fire together in the same frame, including while scrolling and when parents are animated. The overlay leaves them out; world-space particles (sparks, trails, smoke, explosions) stay in the overlay. `effectsLayer="overlay"` keeps the old behaviour per target. Details: [ARCHITECTURE.md](ARCHITECTURE.md) (thread model), [EFFECTS.md §7](EFFECTS.md#7-react-native-targets-and-the-transform-binding).

**Showcase:** B gets a "Fire on card" toggle, so fire rides along the throw; E gets "Flip all" (fast staggered hops with a full turn). All Skia drawing of one engine now shares one renderer (one shader cache).

**Verification (container):** `npm run check` passes with 34 suites and 413 tests (14 new: `src/engine/localLayers.test.ts`, `src/react-native/localLayer.test.tsx`, a CanvasKit pixel test in `effects.render.test.ts` showing identical layer pixels after moving and rotating the view). The showcase type-checks against the packed SDK and bundles for Android, iOS and web. Web screenshots (`scripts/capture-effects-showcase.js`): fire stays on the card throughout the throw and the flips, and a scroll made with engine time frozen moves the fire with the card (no engine frame involved). **Not verified:** the fix on the Android emulator, iOS, and any timing measurement of the remaining lag of world-space particles.

**Files:** `src/engine/localLayers.ts` (new), `src/react-native/sharedRenderer.ts` (new), `src/react-native/GameFXTarget.tsx`, `src/react-native/GameFXOverlay.tsx`, `src/scene/targets.ts`, `src/runtime/effect.ts`, `src/renderer/skia/SkiaEffectsRenderer.ts` (`record` takes a transform), `src/effects/{placement,fireBorder,border,presets,primitives}.ts`, `src/particles/emitter.ts`, tests, `example/EffectsDemo.tsx`, `scripts/capture-effects-showcase.js`, docs.

### Next step

1. The owner re-checks the Effects tab on the Android 17 emulator, especially B with "Fire on card", E ("Fire on all", then "Spin all" and "Flip all") and scrolling with fire on, plus section F for the first device numbers.
2. Phase 5 starts only after the owner approves it.

## Phase 3: Graphics engine, sprites, assets and React Native anchoring (2026-11-12)

### Status

**Done on Android.** Verified by the owner on the Android 17 emulator in Expo Go on 2026-11-13 (all Graphics tab demos). iOS not verified. At implementation time every acceptance criterion below was backed by automated tests that were run, by Android and iOS bundles that built, and by genuine screenshots of the web build (Skia through CanvasKit in Chromium).

Step 1 (baseline): CLAUDE.md and PROGRESS.md were read, Phase 2 was intact (160 tests passing), installed versions are unchanged (Expo SDK 58, RN 0.88.1, Skia 2.14.0, Reanimated 4.7.1, Worklets 0.13). Phase 2 gaps that Phase 3 needed and closed: no images or paths in the scene, no group compositing (opacity per shape only), no built-in attachment effect, no view measurement. No working component was replaced; the Skia renderer was rewritten internally because it only knew rects and circles, and its public surface (`createSkiaEffectsRenderer`, capabilities) was kept.

| # | Acceptance criterion | Evidence |
| --- | --- | --- |
| 1 | Reusable 2D rendering backend | Engine-owned display list (`draw` / `begin-group` / `end-group` commands) built from the scene graph in `src/scene/scene.ts`, renderer-independent graphics types in `src/graphics`, Skia adapter maps them. `displayList.test.ts` checks the commands in Node; 11 new renderer tests rasterize them with real Skia (CanvasKit) and check pixels |
| 2 | Sprites created, rendered, transformed, animated | `Sprite` is a `SceneNode` (`src/sprites/sprite.ts`). `sprites.test.ts` covers creation, removal, frames, parent/child transforms, moving/rotating/scaling while animating; renderer test draws sprite frames with nearest and linear sampling |
| 3 | Sprite sheet animations | `SpriteSheet` with grid or explicit frames, per-frame durations, fps, loop, forward/reverse/alternate, frame events. Tests for frame progression, speed, loop, pause/resume, completion, reverse, events, timelines, 100 concurrent sprites |
| 4 | Asset loading and cleanup | `AssetManager` (`src/assets/assets.ts`): register, load, preload, dedupe, state, errors, retain/release, LRU budget, dispose. 16 tests including 200 load/unload cycles with a leak counter |
| 5 | Renderer integrates with the runtime | Sprite animations are ordinary `Playable`s run by `engine.run` (one clock, `Playback` with `speed`); shader time is engine time; the engine keeps frames coming only while shaders are visible (`engine/graphics.test.ts`) |
| 6 | Scene graph controls graphical objects | Layers, zIndex, hierarchy, opacity groups, clipping, masks, blend modes and effects are node properties (`displayList.test.ts`, `scene.test.ts`, renderer pixel tests) |
| 7 | At least two demonstrable effects | Implemented: glow, blur, drop shadow, color matrix (`grayscale`, `brightness` helpers), two built-in runtime shaders (`energyShader`, `fireShader`) plus `defineShader` with typed uniforms, linear and radial gradients, blend modes, clipping and masks. Built-in attachment effects: `glow-border`, `energy-border`, `fire-border`. Pixel tests for each kind; screenshots in Demo D and E |
| 8 | Showcase demonstrates the systems | New **Graphics** tab (`example/GraphicsDemo.tsx`) with Demos A to E, public API only. Type-checks, bundles for Android and iOS, runs on web (screenshots) |
| 9 | Anchoring to RN components demonstrated | `GameFXTarget` + `engine.targets` + `fx.attach`. Demo E: a normal `Pressable` gets a glow, energy or fire border that follows it when it moves. The Motion tab now anchors its stage the same way. `GameFXTarget.test.tsx` covers mount, measure, remeasure, unmount, 50 mount/unmount cycles |
| 10 | Automated tests pass | **21 suites, 246 tests, 0 failures** |
| 11 | TypeScript and build checks pass | typecheck, lint, build, pack, example tsc, Android and iOS exports, web export: all pass (table below) |
| 12 | Documentation matches the implementation | `ARCHITECTURE.md`, `API.md`, this file, `README.md`, `PERFORMANCE.md` updated |
| 13 | Unverified behaviour identified | See "Not verified" and "Known limitations" |

### What was built

**Graphics model** (`src/graphics`, `src/scene/shape.ts`, renderer-independent):
- Shapes: `rect` (rounded corners), `circle`, `ellipse`, `path` and `image`, each with optional fill and stroke.
- Paths: an engine `PathData` builder (`moveTo`, `lineTo`, `quadTo`, `cubicTo`, `close`, plus `rect`, `ellipse` and `polygon` helpers, where `innerRadius` makes a star) with `getBounds()` and `toSvg()`. Skia types never appear in it.
- Paints: solid colors, linear and radial gradients with stops, and shader fills (`ShaderDefinition`: SkSL source, typed uniforms, fallback color). Strokes with width, cap and join.
- Built-in shaders: `energyShader` and `fireShader` (implemented, pixel-tested); `defineShader` for custom ones. The engine supplies `time` and the node size automatically.
- Node effects (rendered through an offscreen layer): `glow`, `blur`, `drop-shadow`, `color-matrix` (helpers `grayscale`, `brightness`).
- Blend modes: `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `plus`, and `src-in` / `dst-in` / `dst-out` for masks.
- Node compositing: `group: true` composites a subtree in its own layer (so opacity applies once and a child with `dst-in` masks the group), and `clipChildren` clips descendants to the node's shape (rect, rounded rect, circle, ellipse or path, under any rotation).
- Capabilities reported by the renderer: shape kinds, runtime shaders, node effects, blend modes, gradients, clipping. Unsupported features fall back (shader to its fallback color) and raise a one-time `onWarning`.

**Display list** (`scene.drawable(time)`): one traversal per frame builds `draw` items with world matrices and world opacity, and wraps a node in `begin-group` / `end-group` only when it needs a layer (effects, blend mode, group opacity) or a clip. Layer buckets keep the Phase 2 layer order.

**Skia adapter** (`src/renderer/skia/SkiaEffectsRenderer.ts`): renders the display list into an `SkPicture` per frame; caches compiled runtime effects, gradients and paths; `saveLayer` with image filters for effects; `drawImageRect` with linear or nearest sampling for sprite frames; skips images that are not loaded yet.

**Assets** (`src/assets`): `AssetManager` with an injected `ImageLoader` (the React Native one decodes with Skia; tests use a fake loader with no algorithm mocked). Stable string ids, `register`, `load` / `preload` returning a typed map, concurrent loads deduplicated, states `registered | loading | loaded | failed | disposed`, `AssetLoadError` with the cause, retain/release reference counts, LRU eviction of unreferenced images above `maxBytes` (default 64 MiB), `unload`, `dispose`. Nodes retain their image while they show it and release it when their shape changes or they are destroyed.

**Sprites** (`src/sprites`): `SpriteSheet` (grid with margin, spacing and count, or explicit frames; default anchor; named animations with `frames`, `fps` or per-frame `durations`, `loop`, `direction`, frame `events`), `Sprite` (a scene node: transform, anchor, size, smoothing, draw order, children), `sprite.play(name, { speed, repeat, delay })` returning a `Playback`, `sprite.animation(...)` for timelines, `stopAnimation`, frame events as markers. Frame shapes are cached per frame so playing an animation allocates nothing.

**React Native anchoring** (`src/scene/targets.ts`, `src/react-native/GameFXTarget.tsx`):
- `engine.targets` stores each target's window rect and the overlay's window origin, and keeps one proxy scene node per target at the view's centre with its size, rotation and scale. Effects and nodes parented to the proxy follow the view.
- `<GameFXTarget id>` wraps any view without changing its layout or touches, registers on mount, measures with `measureInWindow` on layout, on `fx.remeasure()` and optionally every frame (`trackEveryFrame`), and unregisters on unmount, which ends attached effects with reason `targetDestroyed`.
- `fx.attach(id | node, effect, params)` attaches an effect that follows the target; `fx.fromWindow(point)` converts touch coordinates to overlay space.
- The overlay measures its own window origin, so it no longer has to start at the window origin.
- What is **not** possible and not attempted: rendering a React Native view inside Skia as a texture (no snapshot). Effects are drawn around views, not into them.

**Showcase** (`example/`): a third **Graphics** tab with five demos (all public API):
- **A · Sprite animation:** an 8-frame coin sheet; start, pause, resume, stop, and speed buttons that change `playback.speed` while it plays.
- **B · Transformations:** a vector star (path with a radial gradient) that moves, rotates, scales and fades, carrying an animated slime sprite, which carries a spinning coin (two levels of children).
- **C · Many sprites:** 100 animated sprites per tap from two shared images, reverse z-order, clear, and an "unload" button that shows the asset is kept while sprites use it.
- **D · Graphical effects:** a pulsing card with a glow, an animated energy shader and a fire shader, a sprite sliding through an elliptical clip window, and grayscale and blur toggles on the whole group.
- **E · Anchored to a React Native view:** a normal `Pressable` that can get a glow, energy or fire border; "Move button" shows the border following the new layout.
- Procedural demo sprite sheets generated by `scripts/generate-demo-sprites.py` (synthetic, no third-party art).
- The overlay now sits inside a flex `View` below the tabs, so effects no longer draw over the header.

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (boundary rule now also covers `src/graphics` and `src/assets`) |
| `npm test -- --ci` | **Pass: 21 suites, 246 tests, 0 failed** (160 from Phase 2, 86 new). CanvasKit prints one `RuntimeEffect error ... unknown identifier 'nope'`: that is the intentional broken-shader fallback test |
| `npx jest --coverage --ci` | All files: 91.9 % statements, 84.8 % branches, 93.6 % functions, 94.6 % lines |
| `npm run build` | Pass |
| `npm run example:install` | Pass |
| `cd example && npx tsc --noEmit` | Pass |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform android` | Pass: Hermes bundle, 1256 modules, both sprite PNGs included as assets |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform ios` | Pass: Hermes bundle, 1258 modules |
| `cd example && npx expo export --platform web`, served locally, driven with Playwright (Chromium) | Pass, no page errors. Screenshots of all five demos and the Particles and Motion tabs |
| `npm run bench` | Engine frame cost in Node, see `PERFORMANCE.md` (not a device measurement) |

New tests by area:
- **Rendering (display list and real Skia pixels):** layer groups with same-layer children, clip groups, blend modes, hidden and fully transparent subtrees, multiplied opacity, animated-content detection, bounds for every shape, image retain/release (Phase 2 tests still cover layer and zIndex order and transforms); pixels for sprite frames (nearest and linear), unloaded image skipped, linear and radial gradients, path and ellipse, rotated clip, `dst-in` mask, blend mode, glow, grayscale, drop shadow, shader `uv` and time uniforms, broken shader fallback, all built-in shaders, glow border following a moving target.
- **Graphics model:** path builder and validation, paint validation, shader uniforms, color-matrix helpers.
- **Sprites:** sheet grid/explicit frames and validation; creation, removal, destroyed sprites; frame progression at exact timestamps; playback speed; loop and repeat; pause/resume; completion; reverse and alternate; frame events, even when a frame lands late; stop and play replacing play; parent/child transforms while animating; timeline composition; engine disposal and shared asset managers; **100 concurrent animated sprites**; **repeated creation/destruction** (asset references return to zero).
- **Assets:** registration, typed load map, duplicate-load prevention, concurrent loads, failures and retry, retain/release, eviction under budget, unload and force-unload while in use, late loads after unload, dispose, **200 load/unload cycles** without live images left, 50 assets reused across repeated scenes with one decode each.
- **Engine:** `LocalTimer` rate, `Playback.speed` on tweens and timelines including marker timing, frames kept alive by visible shaders, `attach` by id or node.
- **Targets and border effects:** window to overlay conversion, transforms, invalid measurements, unregister ends attachments, remeasure broadcast; border effects follow, end on target destroy and after `duration`.
- **React Native:** `GameFXTarget` mount, measurement, remeasure, unmount, **50 mount/unmount cycles**, provider-level asset loading through `useGameFXAssets`, overlay `pointerEvents="none"`, engine shutdown on provider unmount.

Screenshots from the web build (real CanvasKit rendering in Chromium, **not** a device) are in the project files (`phase3/screenshots/`).

**Not verified at implementation time:** any Phase 3 behaviour on an Android emulator or device (the owner has since verified the Graphics tab on the Android 17 emulator, 2026-11-13), any iOS run, release builds, image decoding on device (`createSkiaImageLoader` is only type-checked and bundled; the web build exercises the same Skia `MakeImageFromEncoded` path), real frame times, memory and CPU.

### Changed files

New:
- `src/graphics/{paint,path,shader,effects,index}.ts` (+ `graphics.test.ts`)
- `src/assets/{assets,index}.ts` (+ `assets.test.ts`, `__tests__/fakeLoader.ts`)
- `src/sprites/{sheet,sprite,index}.ts` (+ `sprites.test.ts`)
- `src/scene/{shape,targets}.ts` (+ `displayList.test.ts`)
- `src/effects/border.ts` (+ `border.test.ts`)
- `src/engine/graphics.test.ts`
- `src/react-native/{GameFXTarget.tsx,useGameFXAssets.ts,skiaImageLoader.ts}` (+ `GameFXTarget.test.tsx`)
- `example/GraphicsDemo.tsx`, `example/assets/{coin,slime}-sheet.png`
- `scripts/generate-demo-sprites.py`, `scripts/engine.bench.ts`, `jest.setup.canvaskit.js`

Changed:
- `src/scene/{node,scene,attachment,index}.ts`, `src/runtime/timer.ts`, `src/animation/playback.ts`
- `src/engine/engine.ts`, `src/effects/index.ts`, `src/core.ts`, `src/index.ts` (+ `index.test.ts`)
- `src/renderer/skia/SkiaEffectsRenderer.ts` (+ test)
- `src/react-native/{GameFXOverlay.tsx,GameFXProvider.tsx,useGameFX.ts,index.ts}`
- `example/{App.tsx,MotionDemo.tsx,package-lock.json}`
- `jest.config.js`, `eslint.config.mjs`, `tsconfig.json`, `package.json`
- `README.md`, `docs/{API,ARCHITECTURE,PROGRESS,PERFORMANCE}.md`

### API changes from Phase 2

All additive except where noted.
- Node options and properties: `shape` accepts `ellipse`, `path` and `image` and fill/stroke paints; new `blendMode`, `effects`, `group`, `clipChildren`, `size`.
- `Playback.speed` (rate, `>= 0`).
- Engine: `assets`, `targets`, `createSpriteSheet`, `createSprite`, `attach`; option `assets`.
- Built-in effects: `glow-border`, `energy-border`, `fire-border` (attachments) next to `particle-burst`.
- `FrameEvent.drawables`: the `scene` drawable now carries `commands` (the display list) and `time`. `items` stays for compatibility.
- Provider: `assets`, `assetBudget`, `assetManager`, `imageLoader` props. Hook: `attach`, `remeasure`, `fromWindow`, `assets`. New `GameFXTarget`, `useGameFXAssets`, `createSkiaImageLoader`.
- **Behaviour change:** the overlay converts from window coordinates using its own measured origin. Apps that passed `pageX/pageY` straight to `fx.play` and whose overlay does not start at the window origin should use `fx.fromWindow`.

### Known limitations

- **Thread model unchanged:** the scene, sprites and display list are built on the JS thread; Skia draws the recorded picture on the UI thread. A busy JS thread delays frames.
- **Target measurement:** `measureInWindow` is asynchronous, so a target that moves every frame lags by up to one frame even with `trackEveryFrame`; positions animated by Reanimated on the UI thread are not read. Rotation and scale of a target are only known if passed as props.
- **No view snapshots:** effects can be drawn around a React Native view, not applied to its pixels (no distortion or dissolve of the view itself).
- **Groups and layers:** a group composites only the descendants on the same layer; a child on another layer escapes its parent's group, clip and effects.
- **Masks:** Skia blends only inside the drawn geometry, so a `dst-in` mask must cover the whole group area to hide everything outside it (documented in `API.md`).
- **Shaders:** uniforms are re-uploaded and one shader object is created per shader node per frame. Fine for a few nodes; not measured with many.
- **Sprite sheets:** one image per sheet; no texture-packer import (JSON atlases) yet, no trimmed frames.
- **Asset budget:** sizes are estimated as `width × height × 4`; the real GPU or native memory is not measured.
- **Same-time markers and endless-loop jumps:** unchanged from Phase 2.
- **Device coverage:** Phase 3 has run on the Android 17 emulator (Expo Go, debug) only; not on iOS, physical devices or release builds.

### Phase 4 direction (as planned at the end of Phase 3; Phase 4 is now implemented, see above)

Phase 4 per CLAUDE.md is the general-purpose FX library. Recommended order, building on what exists:
1. Emitters that follow nodes and targets (continuous particles as attachments), with texture particles drawn from sprite sheets. This gives trails, smoke and sparks.
2. Presets on the registry with parameter validation: explosion (burst + flash + shake), confetti, glow pulse, floating score, motion trail, card or image movement, and a shake effect on scene nodes.
3. Quality modes and reduced motion (particle caps, disabling shaders), surfaced through capabilities.
4. A first device baseline in `PERFORMANCE.md` (Android emulator plus one physical device), before optimizing shader allocation or pooling.

### Next step

1. The owner runs the Graphics tab on the Android 17 emulator (steps in the final report and `README.md`).
2. Phase 4 starts only after the owner approves it.

## Phase 2: Runtime, scene graph and animation orchestration (2026-11-12)

### Status

**Done for Android.** Every Phase 2 completion requirement below is backed by an automated test that was run. The extended showcase type-checks, bundles for Android and iOS, and runs in the web build (genuine Chromium screenshots of Skia/CanvasKit rendering).

**Android, verified 2026-11-12 by the project owner** (Android 17 emulator, Expo Go SDK 58, debug bundle from `npx expo start`): on the Motion & timelines tab, Throw card, Cancel throw and Pause all worked as expected. In the first build, Rewind throw and Skip to end ended in the same place (both left the card upright where it started), so they could not be told apart. The demo was changed so the card crosses the stage (commit `c04b663`), and the owner then reported that both worked as expected. No screenshots were taken of this run. **iOS was skipped at the owner's request.**

Step 1 (project state): the latest CLAUDE.md defines Phase 2 as "clock/scheduler, stateful handles, lifecycle, timelines, interpolation, nodes/layers, deterministic composition", which matches the owner's Phase 2 brief. No discrepancy. Phase 1 code was kept; the engine moved from `src/runtime/` to `src/engine/` because it now composes the animation and scene modules, and `runtime` stays the lowest layer. All 60 Phase 1 tests still pass unchanged (only import paths moved).

| Completion requirement | Evidence |
| --- | --- |
| Runtime works independently of any React Native app | `src/index.test.ts` runs a scene + timeline + impact marker through `react-native-graphics/core` in plain Node. ESLint forbids React/RN/Skia imports in `runtime`, `animation`, `scene`, `engine` |
| Scene graph transformations are correct | `src/scene/scene.test.ts`: parent/child composition, cache invalidation, local/world/node conversions, inverse, bounds, draw order, layers. `SkiaEffectsRenderer.test.ts` rasterizes a rotated child with real Skia and checks pixels |
| Timeline execution is deterministic | Pure `render(t)` tests (forwards, backwards, loops, yoyo); frame-rate independence (16 ms vs 7 ms frames give identical values); repeated runs give identical results |
| Multiple animations can be composed | Sequence, parallel, stagger, nested timelines, keyframes, simultaneous playbacks, interruption |
| Cancellation and cleanup | cancel/stop/finish/reset/cancelAll/dispose, cancelling from a marker listener, provider unmount (playbacks cancelled, nodes destroyed, clock unsubscribed) |
| Phase 1 still works | All Phase 1 tests pass; the web build shows a burst on the Effects tab after using the Motion tab |

### What was built

- **Runtime** (`src/runtime`): `LocalTimer` (pausable, seekable local time without accumulated deltas). Clocks, RNG, emitter, errors and the effect contract are unchanged.
- **Animation** (`src/animation`): easings (`linear`, quad, cubic, sine, back, bounce families, aliases, `cubicBezier`); `AnimationTarget` and `objectTarget`; `Playable` base (delay, repeat incl. `Infinity`, yoyo, pure `render(t)`, marker collection over time intervals with iteration mapping); `Tween` (captured or explicit start values, easing, overwrite, never writes destroyed targets); `KeyframeAnimation` (per-property tracks, per-segment easing); `Timeline` (positions `>`, `<`, `+=`, `-=`, ms, marker-relative; `mark`, `call`; exact backward seeking; nesting; locking); `sequence`, `parallel`, `stagger`, `wait`; `Playback` (pause, resume, cancel, stop, finish, seek; events `start`, `pause`, `resume`, `marker`, `loop`, `interrupted`, `end`; `onMarker`; `finished` never rejects).
- **Scene** (`src/scene`): 2D affine matrices; `Scene` and `SceneNode` (transform, opacity, visibility, zIndex, layers, built-in rect/circle shapes, hierarchy with cycle checks, recursive destroy, cached world matrices, coordinate conversions, bounds, traversal); flat draw list; `Attachment` interface with per-frame world state and exactly-once `onDetach`; `HostViewBinding` contract and `syncNodeToLayout` for future React Native view anchoring.
- **Engine** (`src/engine`): owns the scene, playbacks and effects; `animate`, `keyframes`, `timeline`, `sequence`, `parallel`, `stagger`, `wait`, `run`; engine `pause`/`resume`/`reset`; per-effect `pause`/`resume`; `overwrite: 'auto'` interruption; frame order playbacks → effects → attachments → publish; clock subscription only while needed; `playbackStart`/`playbackEnd` events.
- **Renderer**: `SkiaEffectsRenderer` also draws `scene` drawables (rect, rounded rect, circle under each node's world matrix, with world opacity).
- **React Native**: `useGameFX().engine`; `GameFXProvider` `layers` prop; unmount also cancels playbacks and destroys the scene.
- **Showcase**: new **Motion & timelines** tab (`example/MotionDemo.tsx`), public API only: a sun with an orbiting planet and moon (hierarchical transforms, endless loops), five staggered keyframe loops (several objects at once), a card throw timeline (rise + spin, fall, `impact` marker, squash keyframes) whose impact plays a particle burst at the contact point, buttons for cancel, rewind (`stop`: back to the side the throw started from), skip (`finish`: jump to the landing side; impact delivered as skipped so no burst; the throw crosses the stage so the two are visibly different) and engine pause/resume, and an event log fed by playback events (no per-frame React state).

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (boundary rule now also covers `src/engine`) |
| `npm test -- --ci` | **Pass: 14 suites, 160 tests** (60 from Phase 1, 100 new) |
| `npx jest --coverage --ci` | All files: 92.8 % statements, 85.8 % branches, 95.3 % lines |
| `npm run build` | Pass |
| `npm run example:install` | Pass (packed tarball installed by path; `example/package-lock.json` integrity updated) |
| `cd example && npx tsc --noEmit` | Pass |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform android` | Pass: Hermes bundle, 1236 modules |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform ios` | Pass: Hermes bundle, 1238 modules |
| `cd example && npx expo export --platform web`, served locally, driven with Playwright (Chromium, 412×915) | Pass, no page errors. Orbit and staggered loops animate; the throw logs `impact at 1080 ms` and the burst appears at the floor contact; cancel leaves the card mid-air (`cancelled (user)`); skip completes with `impact at 1080 ms (skipped)` and no burst; the Effects tab still plays bursts afterwards |

New tests by area:
- **Easing and tweens:** values at exact timestamps; delay; repeat and yoyo; endless loops; zero duration; 10 invalid-option cases; destroyed targets; killed properties; keyframes.
- **Timelines:** positions; locking; sequence, parallel and stagger; backward seek; repeat and yoyo; nesting; markers, callbacks and nested markers; same-time ordering; the iteration cap.
- **Scene and attachments:** hierarchy; destroy; validation; transforms and coordinates; cache invalidation; opacity, visibility and bounds; scale-0 inverse; host binding; draw order and layers; dirty tracking; attachments (offset under rotation, hidden, left the scene, error isolation, detach reasons).
- **Engine and playbacks:**
  - lifecycle and idle clock
  - frame-rate independence
  - simultaneous playbacks
  - invalid input without side effects
  - zero duration
  - double-run protection
  - pause and resume
  - cancel versus stop
  - seek forwards, backwards and while paused
  - finish with skipped markers
  - finishing an endless loop
  - loop events
  - exact impact timing between frames
  - full event ordering across two iterations in one large frame
  - pause or cancel from a marker listener
  - error isolation
  - motion → impact → particle burst at the node's world position
  - interruption (auto, scale overlap, none)
  - node removal and destruction during animation
  - hierarchical animation
  - attachments after animations
  - scene below effects
  - engine pause and resume
  - effect pause
  - reset, cancelAll, dispose
  - determinism
- **Renderer:** scene shapes with real Skia pixels (rotated child, opacity, rounded corner).
- **React Native:** layers prop, scene animation through the hook, cleanup on unmount.

Screenshots from the web build (real CanvasKit rendering in Chromium, **not** a device) are in the project files (`phase2/screenshots/`).

**Not run by me:** devices, emulators or simulators (the owner ran the Android emulator, see Status); release builds; frame-time, memory or CPU measurements.

### Changed files

New: `src/animation/{easing,target,playable,tween,timeline,playback,index}.ts` (+ `easing`, `tween`, `timeline` tests), `src/scene/{matrix,node,scene,attachment,host,index}.ts` (+ `scene.test.ts`), `src/engine/{engine,index}.ts` (+ `playback.test.ts`), `src/runtime/timer.ts`, `example/MotionDemo.tsx`.
Moved: `src/runtime/engine.ts` → `src/engine/engine.ts` (extended), `src/runtime/engine.test.ts` → `src/engine/engine.test.ts` (imports only).
Changed: `src/core.ts`, `src/runtime/index.ts`, `src/effects/{index,particleBurst}.ts` (`Point` now comes from `scene`), `src/renderer/skia/SkiaEffectsRenderer.ts` (+ test), `src/react-native/{GameFXProvider.tsx,useGameFX.ts,context.ts}` (+ test), `src/index.test.ts`, `jest.config.js`, `eslint.config.mjs`, `example/App.tsx` (tabs), `example/package-lock.json`, `README.md`, `docs/{API,ARCHITECTURE,PROGRESS}.md`.

### API changes from Phase 1

- `EffectHandle` gains `pause()` and `resume()`, `status` can be `paused`, and `reason` can be `reset`.
- `cancelAll()` now also cancels animation playbacks.
- `Engine.state` can be `paused`.
- `FrameEvent.drawables` starts with a `scene` drawable when the scene has visible shapes.
- `FrameEvent.time` is engine time: clock time minus paused time, starting at 0 when the engine was created.
- `Point` is exported from the scene module (same shape as before).

### Known limitations

- **Thread model unchanged:** animations run on the JS thread. A busy JS thread delays frames but not the timing of values or markers.
- **Opacity:** it is multiplied per shape. There is no group compositing yet, so overlapping children of a semi-transparent parent show through each other.
- **Built-in shapes only:** scene nodes draw rects and circles. Images and sprites come in Phase 3.
- **Attachments:** they are an interface with tests, but no built-in effect follows a node yet (Phase 3).
- **React Native views:** binding is a documented contract. There is no hook that measures views yet, and scrolling is not followed: the demo stage must not scroll.
- **Same-time markers:** if a listener pauses at a marker, other markers at exactly the same time are skipped. Markers at the end of a yoyo iteration fire on both passes.
- **Large jumps in endless loops:** at most the last 1000 iterations are scanned for markers.
- **Device coverage:** Phase 2 has been verified only on an Android 17 emulator. It has not run on iOS, physical devices or release builds, and nothing is measured.

### Next step

1. **Phase 3** (particle and sprite systems, assets) starts after the owner approves it. It builds on attachments, so emitters can follow nodes.

## Phase 1: Working engine prototype (2026-11-12)

### Status

**Done for Android.** All Phase 1 completion criteria are met, and the showcase has run on Android.

**Android, verified 2026-11-12 by the project owner:** Android 17 emulator, Expo Go (SDK 58), development (debug) JS bundle from `npx expo start`. The showcase was installed from the packed SDK tarball via `npm run example:install`. Genuine emulator screenshots are in [`docs/evidence/`](evidence/):
- `phase1-android17-emulator-idle.png`: the app loads with the overlay mounted and 0 active effects.
- `phase1-android17-emulator-burst-early.png` and `-late.png`: a burst rendered by Skia at the tap point in the tap area, at two moments (particles spread and fall). The tap counter increased (34, then 36 taps), so touches pass through the overlay. "Active effects: 1" is shown while the burst runs.

The owner reported that the effects tested successfully. The screenshots directly show the tap-area burst. The other buttons ("5 bursts at once", "Cancel all", the mount switch, landscape) were reported as working but are not shown in a screenshot.

**Not verified:** iOS (no device or simulator available), release builds, physical Android hardware, and any performance measurement. **Expo Go works for this slice on Android SDK 58.** This is now verified for Android only, not iOS.

| Completion criterion | Evidence |
| --- | --- |
| 1. Functioning engine prototype | `src/runtime/engine.ts`: lifecycle, play/cancel/cancelAll/dispose, events, limits. 16 engine tests |
| 2. Particles executed by the runtime | `particle-burst` is an `EffectDefinition` run by `Engine` and driven by the engine clock |
| 3. Reusable rendering backend | `SkiaEffectsRenderer` draws any `particles` drawable. 6 tests rasterize with real Skia (CanvasKit) and read pixels back |
| 4. Independent showcase uses the public API | `example/` (Expo SDK 58) installs the `npm pack` tarball and imports only `react-native-graphics`. It type-checks and bundles for Android, iOS and web |
| 5. Multiple simultaneous effects | Engine, RN integration and web screenshot (7 effects at once) |
| 6. Automated tests pass | 60 of 60 (below) |
| 7. TypeScript and build checks pass | Below |
| 8. Implementation and limitations documented | README, API.md, ARCHITECTURE.md, this file |

### What was built

- **Runtime** (`src/runtime`): `Engine` and `createEngine`; `VirtualClock` (deterministic) and `FrameClock` (`requestAnimationFrame`, injected); seeded RNG (mulberry32); typed `Emitter` that isolates listener errors; `EffectDefinition`/`EffectInstance` contract; `EffectHandle` with a `finished` promise that never rejects; `maxActiveEffects` limit; `DisposedError` and `InvalidOptionError`. The engine subscribes to the clock only while effects run.
- **Particles** (`src/particles`): `ParticleBurst`, a closed-form ballistic simulation. Particles spawn at the origin with a random direction, speed and lifetime, have gravity, and fade and scale linearly over their lifetime. State lives in typed arrays allocated once. Expired particles are excluded from drawing, and the effect completes when all have expired. At most 2000 particles per burst.
- **Effects** (`src/effects`): `particle-burst` with validated parameters and defaults; `builtInEffects`; `BuiltInEffects` type map for typed `play`.
- **Renderer** (`src/renderer/skia`): `SkiaEffectsRenderer` (one reusable paint, color cache, capability list, skips and reports unsupported kinds, records `SkPicture`s).
- **React Native integration** (`src/react-native`): `GameFXProvider`, `GameFXOverlay` (`pointerEvents="none"`, no React re-render per frame), `useGameFX`, `useGameFXEngine`, `createDefaultClock`.
- **Entry points**: `react-native-graphics` and `react-native-graphics/core` (no React Native imports). Peer dependencies declared.
- **Showcase** (`example/`): palette bursts at the touch point, "5 bursts at once", "Cancel all", a tap area that shows touches pass through the overlay, a live active-effect counter (updated only on start/end events), and a switch that unmounts and remounts the provider to show cleanup. Orientation unlocked for landscape.
- **CI**: new `example` job that packs the SDK, installs it into the showcase, type-checks it and bundles it for Android and iOS.

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (includes the engine-module boundary rule) |
| `npm test` | **Pass: 9 suites, 60 tests** in 3 Jest projects: `core` (Node: clocks, RNG, emitter, particle simulation, engine, params, entry points), `renderer` (real Skia via CanvasKit, pixel read-back), `react-native` (RN Jest preset + Testing Library: provider, overlay, hook, StrictMode, unmount cleanup) |
| `npm run build` | Pass (`lib/` ESM + `.d.ts`) |
| `npm run example:install` (pack, then install the tarball by path in `example/`) | Pass, SDK installed from the tarball |
| `cd example && npx tsc --noEmit` | Pass against the tarball's `.d.ts` |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform android` | Pass: Hermes bundle, 1221 modules |
| `cd example && CI=1 EXPO_OFFLINE=1 npx expo export --platform ios` | Pass: Hermes bundle |
| `cd example && npm run export:web`, served locally, driven with Playwright (Chromium) | Pass. 3 bursts + "5 at once" showed `Active effects: 7`, then `0` after 1.5 s (all completed and cleaned up). Tapping the play area under the overlay counted the tap, so touches pass through. Landscape (844×390) burst centered at the tap point. Switching the provider off and on disposed and recreated the engine, and a new burst played afterwards. No page errors |

Tests cover: engine init and dispose (idempotent, no clock subscription when idle or after dispose), particle creation, motion at exact timestamps, expiration and completion, frame-rate independence, seed determinism, multiple simultaneous effects, invalid configuration (11 cases plus engine and hook), cancellation (single, all, limit, dispose, throwing effect), listener errors, resource cleanup (dispose called once, clock unsubscribed), and public hook behavior. Particle algorithms are not mocked. Only React Native host components and Reanimated shared values use their official Jest mocks, and Skia is real CanvasKit.

Screenshots from the web build (real Skia/CanvasKit rendering in Chromium, **not** a device) are attached to the PR conversation and stored in the project files (`phase1-engine/screenshots/`).

**Not run:** Android or iOS app builds, emulators, simulators, devices, Expo Go, frame-rate or memory measurements. `npm audit` still reports dev-only advisories (see Phase 0); the example app adds Expo's own advisories, which were not changed.

### Changed files

New: `src/runtime/{clock,emitter,errors,rng,effect,engine,index}.ts` (+ tests), `src/particles/{burst,index}.ts` (+ test), `src/effects/{particleBurst,index}.ts` (+ test), `src/renderer/skia/SkiaEffectsRenderer.ts` (+ test), `src/react-native/{context,defaultClock,useGameFX,index}.ts`, `src/react-native/{GameFXProvider,GameFXOverlay}.tsx` (+ test), `src/core.ts`, `src/version.ts`, `src/globals.d.ts`, `jest.setup.rn.js`, `example/` (Expo app).
Changed: `package.json` (exports, peer and dev dependencies, scripts), `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `babel.config.js` (React Native preset for Jest), `jest.config.js` (3 projects), `eslint.config.mjs`, `.github/workflows/ci.yml`, `src/index.ts`, `src/index.test.ts`, `README.md`, `docs/{API,ARCHITECTURE,PROGRESS}.md`.

### Deviations from the Phase 0 plan

- **Thread model:** simulation runs on the JS thread and frames reach Skia as recorded pictures through a shared value. This is the documented fallback, not the UI-thread worklet proposal (reasons in ARCHITECTURE.md).
- **Names:** the overlay is `GameFXOverlay`, matching the Phase 1 brief.
- **Handle API:** only `cancel`, `status` and `finished` exist. Pause, resume, seek and finish belong to Phase 2.
- **Rendering:** particles are drawn as circles with `drawCircle`, one call per particle. `Atlas`-based batching is a Phase 3 optimization, once it can be measured on a device.

### Known limitations

- Verified natively only on an Android 17 emulator in Expo Go (debug). Not verified on iOS, physical devices or release builds.
- Positions are overlay-relative only. There is no conversion from other views and no safe-area handling yet.
- One built-in effect. No reduced-motion or quality settings yet.
- `lib/` is extensionless ESM: fine for Metro, Jest and bundlers, but not for plain Node `import`.
- `SkPicture` objects from previous frames are left to garbage collection instead of being disposed explicitly, to avoid freeing a picture the UI thread may still be drawing. This needs a memory check on a device.
- The web build needs `canvaskit.wasm` served from the site root (`npm run web:prepare` copies it).

### Pending decisions

1. **iOS run.** Still open. It needs a Mac with the iOS Simulator or an iPhone with Expo Go. On Windows PowerShell 5, run the commands one per line (`npm ci`, `npm run example:install`, `cd example`, `npx expo start`), because `&&` is not supported there.
2. Package name (still `react-native-graphics`), formatter (Prettier) and license (`UNLICENSED`), carried over from Phase 0.

### Next phase

Phase 2 (runtime and scene composition) was approved on 2026-11-12 and is recorded above. Standing rule: every new effect also gets a demo in a small standalone example app like `example/`, so it can be tried on a device.

## Phase 0: Repository audit and migration (2026-11-11)

### Starting state

| Item | Finding |
| --- | --- |
| `main` | One commit: the **former** CLAUDE.md (card-animation SDK). |
| Open PR #1 (`claude/project-thread-5mm4qx`) | Toolchain and docs from the former "Phase 1" (see the record further down). CI green, not merged. |
| Revised CLAUDE.md | Present only in the owner's local folder (`C:\Users\benna\Documents\GitHub\react-native-graphics`), uncommitted. Committed unchanged in this phase. |
| Source code | `src/index.ts` (exports `SDK_VERSION`) and one test. No engine, renderer or card code was ever written, so **there is nothing card-specific to refactor or remove**. |
| Belote Tunisienne | Not in this repository. Under the revised plan it is not needed until Phase 6. |

### Audit of existing work against the framework-first mission

| Existing piece | Verdict | Action |
| --- | --- | --- |
| npm, TypeScript 5.9 strict, Jest 30 + babel-jest, ESLint 10 + typescript-eslint strict, `.nvmrc`, `private: true` | Reusable as-is | Kept |
| GitHub Actions CI (typecheck, lint, test, build) | Reusable | Kept. Phase 1 adds an example-app job |
| ESLint boundary rule protecting `src/core` | Reusable idea, wrong module names | **Migrated** to the six engine modules (`runtime`, `animation`, `scene`, `particles`, `sprites`, `effects`) |
| `src/index.ts`, smoke test | Reusable | Kept |
| ARCHITECTURE.md (card SDK) | Concepts reusable, module plan outdated | **Rewritten** for the engine. Reusable concepts are listed at the end of ARCHITECTURE.md |
| Card presets, layout anchors, event reconciliation (planned only, never coded) | No longer core | Card motion becomes a generic image/node movement preset (Phase 4). Reconciliation moves to the optional Belote adapter (Phase 6) |
| Reanimated view transforms as primary renderer (planned only) | Replaced | Skia is the primary renderer. Reanimated/Worklets drive UI-thread scheduling |
| Package name `react-native-graphics` | Open | Pending decision 2 |

Gaps against the MVP: no peer dependencies, no renderer, no runtime or scene model, no example consumer app, no device verification path. All of these are planned for Phases 1 to 3.

Out of scope and not present: physics, networking, game rules, editors. Nothing needed removing.

### Finished tasks

1. Audited the git state, PR #1, the local folder, code, tests and docs (tables above).
2. Committed the revised CLAUDE.md.
3. Migrated the ESLint architecture boundary to the new engine modules and verified it (below).
4. Rewrote `docs/ARCHITECTURE.md`: module boundaries, proposed thread model, runtime and handle semantics, scene model, coordinate spaces, host integration, registry, packaging and consumer contract.
5. Added `docs/API.md` and `docs/PERFORMANCE.md` as honest placeholders (no API, no measurements yet). Updated `README.md`.
6. Checked current upstream versions. Expo SDK 58 (latest, 58.0.24) bundles React Native 0.88.1, React 19.3.0, Reanimated 4.7.1, Worklets 0.13.0, Skia 2.14.0 and safe-area-context ~5.11.1. This is the proposed version baseline.

### Verification (commands run in the Linux cloud container, Node 22.23.4, npm 10.9.9)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | Pass: 1 suite, 1 test |
| `npm run build` | Pass |
| Boundary probe: a temporary file in each of `src/{runtime,animation,scene,particles,sprites,effects}` importing `@shopify/react-native-skia` and `../renderer/skia/x`, plus files in `src/renderer/skia` and `src/react-native` importing `react-native` | 12 `no-restricted-imports` errors, exactly 2 per engine module and none in renderer or host modules, as intended. Probe files deleted afterwards |
| CI on PR #1 (previous commit) | Green |

Not run: any Android or iOS build. Nothing renders yet, and this container has no Android SDK, Xcode, emulator or device.

### Changed files

`CLAUDE.md` (revised by the owner), `eslint.config.mjs`, `README.md`, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`, `docs/API.md` (new), `docs/PERFORMANCE.md` (new).

### Assumptions

- The SDK stays at the repository root and the example app goes in `example/`, the usual layout for React Native libraries. This keeps history and existing configs intact. The alternative (moving the SDK to `packages/`) is possible but brings no current benefit.
- The New Architecture is acceptable, because Reanimated 4 requires it.

### Known failures

None.

### Pending decisions

1. **Device for verification (blocks Phase 1 acceptance).** The cloud container cannot run Android or iOS. Phase 1 must be verified on a real device or emulator. Options: an Android emulator or phone on your Windows PC (I can drive builds there through Remote Control if Android Studio is installed), or a Mac for iOS. Which do you have?
2. **Package name.** Keep `react-native-graphics`, or use a scoped name such as `@react-native-gamefx/core` as in CLAUDE.md? This only matters before the first release, but it is cheaper to decide before the example app imports it.
3. **Example app runtime.** Proposal: Expo SDK 58 with a **development build**. Skia and Reanimated are also in Expo Go for SDK 58, but CLAUDE.md asks not to promise Expo Go support until it is verified, so I would try it and report the result rather than depend on it.
4. **Formatter.** Still none. Recommend adding Prettier with Phase 1, since the example app adds many files.
5. **License.** Still `UNLICENSED`.

### Next phase: Phase 1 plan as proposed in Phase 0 (implemented on 2026-11-12, see above)

Goal: from a separate consumer app, mount a transparent FX canvas and trigger a particle burst by tapping, using only the SDK's public exports.

Steps:

1. Add peer dependencies (React, React Native, Skia, Reanimated, Worklets) at the Expo 58 versions, also as dev dependencies for testing. Add Jest support for React Native and the Skia/Reanimated test setup.
2. `src/runtime`: minimal clock interface, `VirtualClock`, seeded RNG, effect handle with `cancel()`, `finished` and dispose. Unit tests.
3. `src/particles`: a pure, worklet-compatible burst simulation (positions, velocity, gravity, fade, bounded lifetime) evaluated from elapsed time. Unit tests at exact timestamps, with large deltas, zero count and invalid input.
4. `src/effects`: a typed registry with one preset, `burst`.
5. `src/renderer/skia`: a layer that draws active bursts with one Skia `Atlas`, driven by `useFrameCallback`, with no React re-renders per frame.
6. `src/react-native`: `GameFXProvider`, `GameFXCanvas` (absolute fill, `pointerEvents="none"`), `useGameFX().play('burst', { position, count, duration })` returning a handle. Cleanup on unmount.
7. `example/`: an ordinary Expo app with normal buttons and a scroll view under the overlay. Tapping triggers a burst at the tap point, and a button cancels all effects. The app depends on the SDK only through the packed tarball or the workspace link to the built `lib/`.
8. CI: add `npm pack` plus a type-check of the example against the tarball.

Acceptance criteria:

- Unit tests for the simulation and handle pass under the virtual clock.
- Integration tests: the provider mounts and unmounts without leaks, the canvas has `pointerEvents="none"`, and `cancel()` resolves `finished` with `cancelled`.
- The example builds and runs on at least one real Android or iOS target. The burst appears at the tap point in portrait and in landscape, and buttons under the overlay remain tappable. This is recorded with a genuine screenshot or video and the device and build mode.
- The UI-thread thread model is either confirmed on device or replaced by the documented fallback.
- A first frame-time baseline is measured and recorded in `PERFORMANCE.md`, or explicitly marked as not measured.

---

## Superseded: former "Phase 1" under the card-animation-SDK CLAUDE.md (2026-11-11)

Done earlier the same day, before the vision changed. It produced the toolchain above, which Phase 0 kept. Verification at that time: `npm run typecheck`, `lint`, `test` and `build` all passed. The `src/core` boundary rule was probed successfully. `npm audit --omit=dev` found 0 vulnerabilities. `npm audit` found 28 dev-only advisories (1 low, 27 moderate), all transitive through Jest 30 (`deepmerge`, `glob`), where the only automatic fix is a downgrade to Jest 25, so they were left as they are. CI on PR #1 passed.

TypeScript 7.0 was not used because `ts-jest` requires a version below 7 and `typescript-eslint` requires a version below 6.1. TypeScript 5.9 is used instead.
