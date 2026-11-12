# Progress

| Phase | Status |
| --- | --- |
| 0. Repository audit and migration | **Done** (2026-11-11, merged in PR #1) |
| 1. Working engine prototype (particle burst) | **Done on Android** (2026-11-12, Android 17 emulator, Expo Go). iOS not yet verified. See below |
| 2. Runtime, scene graph and animation orchestration | **Done in code and tests** (2026-11-12). Demo checked in the web build; not yet run on a device. See below |
| 3 to 6 | Not started |

## Phase 2: Runtime, scene graph and animation orchestration (2026-11-12)

### Status

**Done for code, tests and bundles.** Every Phase 2 completion requirement below is backed by an automated test that was run. The extended showcase type-checks, bundles for Android and iOS, and runs in the web build (genuine Chromium screenshots of Skia/CanvasKit rendering). **It has not run on a device or emulator yet.** The owner asked to skip iOS for now; the Android emulator run of the new tab is the next verification step.

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
- **Showcase**: new **Motion & timelines** tab (`example/MotionDemo.tsx`), public API only: a sun with an orbiting planet and moon (hierarchical transforms, endless loops), five staggered keyframe loops (several objects at once), a card throw timeline (rise + spin, fall, `impact` marker, squash keyframes) whose impact plays a particle burst at the contact point, buttons for cancel, rewind (`stop`), skip (`finish`, impact delivered as skipped so no burst) and engine pause/resume, and an event log fed by playback events (no per-frame React state).

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

**Not run:** Android or iOS devices, emulators or simulators for the Phase 2 tab; release builds; frame-time, memory or CPU measurements.

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
- **No device verification yet:** Phase 2 has not run on a device or emulator, and nothing is measured.

### Next step

1. **Owner:** run the **Motion & timelines** tab on the Android 17 emulator in Expo Go. Run `git pull`, then `npm ci`, `npm run example:install`, `cd example`, `npx expo start`, one command per line in PowerShell.
2. **Phase 3** (particle and sprite systems, assets) starts after the owner approves it. It builds on attachments, so emitters can follow nodes.

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
