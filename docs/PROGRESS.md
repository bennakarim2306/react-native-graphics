# Progress

| Phase | Status |
| --- | --- |
| 0. Repository audit and migration | **Done** (2026-11-11), see below |
| 1. End-to-end vertical slice | Not started. Plan below, waiting for review |
| 2 to 6 | Not started |

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

### Next phase: concrete Phase 1 plan (end-to-end vertical slice)

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
