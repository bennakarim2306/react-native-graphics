# Testing

How the SDK is tested, what each layer proves, and how to run it. Commands are for the repository root unless stated. On Windows PowerShell, run them one per line.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, lint, all tests, then `pack:verify` (which builds). Run before every commit |
| `npm test` | All Jest projects (488 tests in 42 files, about 50 s) |
| `npm run pack:verify` | Builds, packs and validates the package (section "Package validation") |
| `npm run consumer:install [folder]` | Creates the consumer test app outside the repository (default `../gamefx-consumer-test`) with a fresh tarball (section "Consumer app") |
| `npx jest --selectProjects core` | Engine only (Node, no React Native) |
| `npx jest --selectProjects renderer` | Skia renderer against real CanvasKit |
| `npx jest --selectProjects react-native` | React Native components and hooks |
| `npx jest src/engine/sequences.test.ts -t "replay"` | One file, one test name |
| `npx jest --coverage` | Coverage report in `coverage/` |
| `npm run bench` | Node benchmarks (`scripts/*.bench.ts`); see [PERFORMANCE.md](PERFORMANCE.md) |
| `npm run bench:render` | Phase 4.5: picture recording and CPU raster cost with real Skia (CanvasKit) per particle look and per quality profile (`scripts/visual/particles.renderbench.ts`) |
| `npm run visual` | Phase 4.5: renders the deterministic visual scenes to PNG with real Skia (`scripts/visual/`); `VISUAL_OUT=<folder>` sets the output (default `visual-out/`), `VISUAL_ONLY=fire,throw` picks scenes by name |
| `npm run example:install`, then `cd example` and `npx tsc --noEmit` | Builds and packs the SDK, installs the tarball in the showcase, type-checks the showcase against the public API only |
| `cd example`, then `npx expo export --platform android` (or `ios`, `web`) | Bundles the showcase for each platform |

## Test projects

| Project | Environment | Covers |
| --- | --- | --- |
| `core` | Plain Node | `runtime`, `animation`, `scene`, `engine`, `particles`, `effects`, `graphics`, `assets`, `sprites`, `motion`, public exports |
| `renderer` | React Native preset + Skia's Jest environment (CanvasKit, CPU raster) | `SkiaEffectsRenderer`: real pixels read back from real Skia surfaces |
| `react-native` | React Native preset, Reanimated's Jest mock, CanvasKit | Provider, overlay, `GameFXTarget`, hooks, transform binding |

## Principles

- **Deterministic time.** Every test drives the engine with a `VirtualClock` (`clock.advance(ms, { frameMs })`). There are no real timers or sleeps, so results do not depend on machine speed, and frame-rate independence is tested by advancing the same time with different frame sizes.
- **Seeded randomness.** Effects take a seed (`PlayOptions.seed` or the engine seed); tests compare runs with equal and different seeds.
- **No mocked algorithms.** Particle simulation, emitter shapes, curves, timelines, the throw trajectory, composition and the renderer's drawing are the real code. What is replaced: the clock (virtual), image decoding (`FakeLoader`, synthetic images), and platform pieces the React Native Jest preset mocks (`measureInWindow` is configured per test to report given rectangles; `AccessibilityInfo`; Reanimated's mock, whose `useSharedValue` `jest.setup.rn.js` makes stable across renders like the real hook).
- **Real pixels.** Renderer tests draw into CanvasKit surfaces and read pixels back (colors at points, coverage, differences between frames). `jest.setup.canvaskit.js` copies arrays into CanvasKit's realm so gradients work under Jest.
- **No disabled tests.** Failures are fixed at the root; nothing is skipped to get green.

## Release tests (Phase 5)

| File | Area |
| --- | --- |
| `src/react-native/lifecycle.test.tsx` | The ten release lifecycle scenarios, with real `GameFXProvider`, `GameFXOverlay` and `GameFXTarget` components and a virtual clock; each ends by checking `engine.stats` (no effects, playbacks, targets, scene nodes or frame loop left) and that nothing was logged with `console.error`: (1) provider mounted and unmounted 25 times with effects running; (2) 20 navigations between screens with targets while effects run; (3) cancel during execution restores motion and concealment; (4) 50 cancel-and-replay cycles of Throw & Explode; (5) targets removed while effects, a sequence and an endless animation run on them; (6) four effects on one target ending independently; (7) quality changed while running; (8) background and foreground through `AppState` (paused, then resumes where it was); (9) 200 engines created and disposed; (10) invalid parameters and a failing custom effect (error reported, others continue), plus `NotReadyError` during the first render |
| `src/index.test.ts`, `src/react-native/publicApi.test.tsx` | The exported names of `react-native-graphics/core` and `react-native-graphics` equal `scripts/public-api.json`; internals are not exported |
| `src/react-native/apiTypes.test.tsx` | Type-level contract checked by `tsc`: misspelled or wrongly typed parameters of built-in effects, attach specs and cues must stay compile errors (`@ts-expect-error`), valid calls (custom effect names, unions of names) must compile |
| `src/engine/playback.test.ts` ("destroyed") | Tweens and keyframes of a destroyed node end with `targetDestroyed` and the frame loop stops; a timeline keeps running |

These run in Jest with mocked platform pieces (`AppState`, `measureInWindow`, Reanimated). The same scenarios also run in a real app (the consumer's navigation and remount self-tests below), on the web automatically and on Android by hand.

## Package validation

`npm run pack:verify` (`scripts/verify-package.mjs`, also in CI) builds the SDK, runs `npm pack` and checks the archive:

- nothing that should not ship: tests, `__tests__`, fixtures, images, screenshots, `.env` files, `tsbuildinfo`, repository folders (`example/`, `consumer/`, `docs/`, `scripts/`), key material;
- `private: true` is still set;
- every entry point in `main`, `module`, `types`, `react-native` and `exports` exists, and each ES module has its CommonJS twin, declaration and source map;
- every import in the shipped JavaScript resolves inside the package or to a peer dependency;
- the declarations export exactly the names in `scripts/public-api.json`;
- installed into an empty npm project, `require('react-native-graphics/core')` and `import` work, deep imports are blocked, `SDK_VERSION` matches and a particle burst runs to completion.

`--report <file>` writes the findings as JSON (CI uploads it); `--keep` keeps the temporary folder.

## Consumer app

`consumer/` holds an ordinary Expo SDK 58 app (`gamefx-consumer-test`) that uses the SDK like a third-party app. `npm run consumer:install` copies it **outside** the repository (default `../gamefx-consumer-test`; a folder inside the repository is refused), packs the SDK into its `vendor/` folder and installs that tarball, so nothing can resolve into the SDK's sources or `node_modules`.

Screens: A an ordinary rewards page with effects on claim, B fire border (start, stop, cancel, intensity, color, move, rotate, scale, a button inside the burning view), C Throw & Explode (throw, replay, cancel, after-impact modes, stage status), D particles (touch bursts, five at once, presets on views), E composition (a multi-stage timeline with cues, skip and cancel; three effects stacked on one view), F navigation and lifecycle (live `engine.stats`, a busy screen to leave at any time, an automated open-and-leave ×10 self-test, a provider remount ×20 self-test, background log), G quality and reduced motion through provider props, H performance scenarios (see [PERFORMANCE.md](PERFORMANCE.md)).

In the installed folder:

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | The app compiles against the installed package's declarations |
| `npm run check:imports` | Only `react-native-graphics` and `react-native-graphics/core` are imported; no relative import leaves the app; no TypeScript paths, Metro or Babel aliases point outside; `node_modules/react-native-graphics` is a real folder installed from `file:vendor/*.tgz` |
| `npm run export:android`, `export:ios`, `export:web` | Metro bundles for each platform |
| `npm run test:web` | `scripts/web-smoke.mjs`: serves `dist-web`, drives every screen in headless Chromium, asserts that effects start, end and leave the engine counters at their idle values, that the navigation and remount self-tests print PASS, that one benchmark scenario reports clean, and that the page logs no errors; screenshots and `report.json` in `web-smoke-out/`. Needs Playwright with Chromium |
| `npx expo start` | Run it in Expo Go (manual device check) |

The web smoke test proves the packaged SDK works end to end in a separate app on React Native Web. It says nothing about Android or iOS rendering or speed.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `main`, with npm caching per lockfile:

| Job | Steps |
| --- | --- |
| `check` | `npm ci`, typecheck, lint, all Jest projects (unit, integration, API contract, lifecycle), `pack:verify` (build, pack, content and API validation, install test); uploads the package report |
| `example` | Installs the packed SDK into the showcase, type-checks it and bundles it for Android and iOS |
| `consumer` | Creates the consumer app in the runner's temp folder from a fresh tarball, then typecheck, import isolation, Android, iOS and web bundles and the headless web smoke test; uploads the smoke screenshots |

## What the Phase 4 tests cover

| File | Area |
| --- | --- |
| `src/particles/emitter.test.ts` | Spawning, bursts and continuous rate at exact intervals, lifetimes and slot reuse, `maxParticles`, `stop`, `setRate`, huge time jumps, ballistic motion with gravity, drag, curves (opacity, scale, color over life), angular velocity and velocity alignment, identical results at 60 fps, 144 fps and one big step, seeds, every emitter shape (point, line, circle, rect, path; area or edge; outward normals), world vs local space (with interpolated births and inherited velocity), pool reuse, quality scale, validation |
| `src/particles/emitter.test.ts` (Phase 4A, "live configuration") | `configure` on a running emitter: birth properties only for new particles, gravity and drag changes continuous in position and velocity (closed-form values checked), spin still counted from birth, colors and curves applied to live particles (also with a shorter palette), rate re-timed and quality-scaled, switching a `rate: 0` emitter on later, fixed and unknown keys and invalid values rejected with no change (compared with an untouched twin emitter), determinism with changes at 10 ms and 25 ms frames, dispose |
| `src/engine/emitterLab.test.ts` (Phase 4A) | The Emitter lab scenario through the engine API: point, circle, line and rect emitters at once on a rotating scene node and fixed positions (local halo moves with the orb, world trail stays behind), `handle.update` on one emitter without touching the others, reversed gravity applied to every live particle from its current velocity, invalid updates rejected with identical results to a twin engine, presets keeping `intensity`/`rate` only, per-handle pause/resume (frozen, no catch-up) and cancel (storage back to the pool), removing the target (emitters stop, complete, storage back, new orb reuses it), quality scaling of live rate changes, determinism and full release on dispose |
| `src/effects/presets.test.ts` | Every preset starts, completes and cleans up; rate presets stop gracefully; parameter validation; behaviours (confetti tumbling, trail staying behind, glow pulses); composites (explosion layers by quality, victory); determinism |
| `src/effects/fireBorder.test.ts` | Shader vs particle flames by quality and capability; flames surround the target and follow its position, rotation and scaled size; continuous animation from engine time; glow, sparks and heat haze options; particle flames born on the outline and rising along its normals; path outlines; size changes; intensity, height and color updates (other keys rejected); graceful stop; target destroyed, hidden, `duration`; validation; ten borders at once |
| `src/graphics/shaderLib.test.ts` | Shader composition from chunks in dependency order, unknown chunks, equal compositions give equal source (one compilation), built-in flame and displacement shaders and their fallbacks, uniform value-count validation, color parsing and mixing |
| `src/engine/runtime.test.ts` | Handle lifecycle: stop and drain, `update`/`setIntensity`, `onEnd`, `zIndex` order, replacement keys, error isolation, attach forms, quality levels, adaptive quality, reduced motion, camera shake, target shake, overlapping shakes, the effect limit with composites |
| `src/motion/throw.test.ts` | Ballistic path (peak height, landing point), gravity form, `launch`/`peak`/`impact` markers at exact positions, frame independence, restore on cancel, validation, host targets |
| `src/engine/sequences.test.ts` | Cues: exact timing, ownership, skip, hold. Throw & Explode: explosion at the impact point, cancel mid-flight and after impact, **replay right after cancel in every phase** (regression test), finish, unmount mid-flight, scene nodes, validation |
| `src/engine/stress.test.ts` | 100 explosions in a row (all complete, pool reuse), 1000 effects of every kind, 200 effects in one frame against the limit, 12 continuous emitters for a simulated minute, 200 target mount/unmount cycles with effects attached, cancelling a complex sequence at every stage, dispose during heavy load |
| `src/scene/targets.test.ts` | Transform binding: proxy node placement, view transform events, combination with measured rotation/scale, tweening the binding, offsets, unregistering, target handles accepted everywhere |
| `src/renderer/skia/density.render.test.ts` (Phase 4.5) | Sharpness at device density: a vector disc keeps 1–2 px anti-aliased edges and the same size at 1×, 2× and 3× (a control drawn at 1× and scaled up fails the check); the fire shader covers the same area at every density, matches the 1× image when averaged back down, and shades each device pixel on its own (an upscaled 1× image has no detail inside a block); images and image particles request linear filtering with mipmaps (`nearest` for pixel art); the same seed and time give identical pixels, one frame later changes a little, half a second a lot |
| `src/renderer/skia/effects.render.test.ts` | CanvasKit pixels: particle looks, colors over life, additive blending, local space, `drawAtlas` image particles, fire-border shader pixels, animation over time and with intensity, shader compiled once for many nodes, distortion, explosion, camera offset when recording, fire recorded into a target's local layer (flames on the view's edges; identical pixels after moving and rotating the view; correct when scaled) |
| `src/engine/localLayers.test.ts` | Local effects layers: which drawables are anchored (fire flames, borders, glow pulses, local particles; not sparks or fixed placements), anchors dropped when the target goes, the overlay leaving out exactly the drawables of targets with a layer, the layer matrix mapping the view's box the same way whatever the motion, rotation and scale, and how far effects reach beyond the view |
| `src/react-native/localLayer.test.tsx` | `GameFXTarget`'s layer: mounted when fire is attached and sized from its reach, overlay keeps drawing until the layer is laid out, then anchored drawables go only to the layer (sparks stay in the overlay), local geometry unchanged while the view moves, rotates and scales, `effectsLayer="overlay"`, removal after idle frames and return on a new effect, cleanup on unmount |
| `src/react-native/phase4.test.tsx` | Transform binding applied to a real view's style (with the view's own transform and opacity kept), deferred measurement while transformed, Throw & Explode on a view (and its button still works afterwards), unmount mid-sequence, target-scoped shake, `attach` spec on an ordinary view, timeline/cue/throw through the hook, the composition example (`getTarget`, `attach`, `animate`, explosion, `stop`), quality prop, reduced motion (system and forced), renderer capabilities |

Earlier phases' tests (runtime, animation, scene, graphics, assets, sprites, provider, overlay pointer passthrough, unmount cleanup) still run unchanged.

## Visual regression scenes (Phase 4.5)

`npm run visual` renders 19 deterministic scenes (fire border per profile, rotated, rotating, scaled, scaling, colors; the throw with its impact frames per profile; the explosion from 17 ms to 2.2 s; smoke; confetti; golden sparks; glow pulse; trail; victory; a combined scene) to 62 PNGs plus `manifest.json` (parameters, primitives drawn, share of changed pixels, mean luminance). Each scene starts the engine at time 0 with seed 7 and steps a virtual clock in 60 FPS frames to each capture time; the frame is recorded with the renderer (with the camera offset, as the overlay does) and drawn on a surface of width × density by height × density pixels with the canvas scaled by the density, as React Native Skia does. Running it twice gives identical files.

To compare two versions, render each with its own source and the same `scripts/visual/` folder (the Phase 4.5 report did this for commit c8a478b). The images are CanvasKit's CPU rasterizer, not a device screenshot; blur and anti-aliasing can differ slightly from the GPU backends.

## Visual checks (web build)

Unit tests cannot judge whether flames look like flames. The showcase is therefore also checked visually in a browser, where React Native Web and CanvasKit (WebGL) render the same Skia calls:

1. `cd example`
2. `npx expo export --platform web --output-dir dist-web`
3. Serve `dist-web` on port 8099 (for example `python -m http.server 8099 --directory dist-web`).
4. From the repository root: `node scripts/capture-effects-showcase.js <output-folder> 2` (needs Playwright with Chromium; `SHOWCASE_URL` overrides the address).

The script presses the showcase's buttons and saves screenshots of demos A to E, G and H (H: the three profiles side by side with fire, rotated and exploding; the fire border at each profile and with more glow and sparks; the throw's impact and aftermath on `high` and `low`; cancel; the combined finale; and G: the Emitter lab: four emitters, live changes, pause all, cancel, removing and adding the orb, with the lab's pool counters written to the log), including fire riding on the thrown card (B), the flipping cards (E) and a scroll made while the engine is frozen (A): fire drawn in the card's own layer must move with the card although no engine frame runs. Headless Chromium renders WebGL in software and needs over a second per screenshot, so the script slows page time to 0.25× and freezes it while each screenshot is taken. The app is unchanged; only `performance.now()` in the page is controlled.

What this proves: the public API drives the effects, and the rendering, positions and timing are right in a real Skia renderer. What it does not prove: anything about Android or iOS rendering or speed.

## Device checks

Consumer app (Phase 5), Windows PowerShell, one line at a time, from the repository:
1. `npm ci`
2. `npm run consumer:install`
3. `cd ..\gamefx-consumer-test`
4. `npx expo start --clear`, then press `a`.
5. Go through screens A to H. On F, run "Automated: open and leave ×10" and "Remount ×20" (both must print PASS). On H, run "Run 1–7" and the other two scenarios and copy the `[gamefx-bench]` lines from the terminal.

Showcase, Android (the owner's Android 17 emulator, Expo Go), Windows PowerShell:
1. `npm run example:install`
2. `cd example`
3. `npx expo start --clear`, then press `a`.
4. Effects tab: go through demos A to H (checklists in the Phase 4, 4A and 4.5 reports). Particles, Motion and Graphics tabs: earlier phases still work.

iOS is not verified (deferred by the owner).
