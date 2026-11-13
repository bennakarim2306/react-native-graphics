# Testing

How the SDK is tested, what each layer proves, and how to run it. Commands are for the repository root unless stated. On Windows PowerShell, run them one per line.

## Commands

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, lint, all tests, build. Run before every commit |
| `npm test` | All Jest projects (about 400 tests, 30 s) |
| `npx jest --selectProjects core` | Engine only (Node, no React Native) |
| `npx jest --selectProjects renderer` | Skia renderer against real CanvasKit |
| `npx jest --selectProjects react-native` | React Native components and hooks |
| `npx jest src/engine/sequences.test.ts -t "replay"` | One file, one test name |
| `npx jest --coverage` | Coverage report in `coverage/` |
| `npm run bench` | Node benchmarks (`scripts/*.bench.ts`); see [PERFORMANCE.md](PERFORMANCE.md) |
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

## What the Phase 4 tests cover

| File | Area |
| --- | --- |
| `src/particles/emitter.test.ts` | Spawning, bursts and continuous rate at exact intervals, lifetimes and slot reuse, `maxParticles`, `stop`, `setRate`, huge time jumps, ballistic motion with gravity, drag, curves (opacity, scale, color over life), angular velocity and velocity alignment, identical results at 60 fps, 144 fps and one big step, seeds, every emitter shape (point, line, circle, rect, path; area or edge; outward normals), world vs local space (with interpolated births and inherited velocity), pool reuse, quality scale, validation |
| `src/effects/presets.test.ts` | Every preset starts, completes and cleans up; rate presets stop gracefully; parameter validation; behaviours (confetti tumbling, trail staying behind, glow pulses); composites (explosion layers by quality, victory); determinism |
| `src/effects/fireBorder.test.ts` | Shader vs particle flames by quality and capability; flames surround the target and follow its position, rotation and scaled size; continuous animation from engine time; glow, sparks and heat haze options; particle flames born on the outline and rising along its normals; path outlines; size changes; intensity, height and color updates (other keys rejected); graceful stop; target destroyed, hidden, `duration`; validation; ten borders at once |
| `src/graphics/shaderLib.test.ts` | Shader composition from chunks in dependency order, unknown chunks, equal compositions give equal source (one compilation), built-in flame and displacement shaders and their fallbacks, uniform value-count validation, color parsing and mixing |
| `src/engine/runtime.test.ts` | Handle lifecycle: stop and drain, `update`/`setIntensity`, `onEnd`, `zIndex` order, replacement keys, error isolation, attach forms, quality levels, adaptive quality, reduced motion, camera shake, target shake, overlapping shakes, the effect limit with composites |
| `src/motion/throw.test.ts` | Ballistic path (peak height, landing point), gravity form, `launch`/`peak`/`impact` markers at exact positions, frame independence, restore on cancel, validation, host targets |
| `src/engine/sequences.test.ts` | Cues: exact timing, ownership, skip, hold. Throw & Explode: explosion at the impact point, cancel mid-flight and after impact, **replay right after cancel in every phase** (regression test), finish, unmount mid-flight, scene nodes, validation |
| `src/engine/stress.test.ts` | 100 explosions in a row (all complete, pool reuse), 1000 effects of every kind, 200 effects in one frame against the limit, 12 continuous emitters for a simulated minute, 200 target mount/unmount cycles with effects attached, cancelling a complex sequence at every stage, dispose during heavy load |
| `src/scene/targets.test.ts` | Transform binding: proxy node placement, view transform events, combination with measured rotation/scale, tweening the binding, offsets, unregistering, target handles accepted everywhere |
| `src/renderer/skia/effects.render.test.ts` | CanvasKit pixels: particle looks, colors over life, additive blending, local space, `drawAtlas` image particles, fire-border shader pixels, animation over time and with intensity, shader compiled once for many nodes, distortion, explosion, camera offset when recording |
| `src/react-native/phase4.test.tsx` | Transform binding applied to a real view's style (with the view's own transform and opacity kept), deferred measurement while transformed, Throw & Explode on a view (and its button still works afterwards), unmount mid-sequence, target-scoped shake, `attach` spec on an ordinary view, timeline/cue/throw through the hook, the composition example (`getTarget`, `attach`, `animate`, explosion, `stop`), quality prop, reduced motion (system and forced), renderer capabilities |

Earlier phases' tests (runtime, animation, scene, graphics, assets, sprites, provider, overlay pointer passthrough, unmount cleanup) still run unchanged.

## Visual checks (web build)

Unit tests cannot judge whether flames look like flames. The showcase is therefore also checked visually in a browser, where React Native Web and CanvasKit (WebGL) render the same Skia calls:

1. `cd example`
2. `npx expo export --platform web --output-dir dist-web`
3. Serve `dist-web` on port 8099 (for example `python -m http.server 8099 --directory dist-web`).
4. From the repository root: `node scripts/capture-effects-showcase.js <output-folder> 2` (needs Playwright with Chromium; `SHOWCASE_URL` overrides the address).

The script presses the showcase's buttons and saves screenshots of demos A to E. Headless Chromium renders WebGL in software and needs over a second per screenshot, so the script slows page time to 0.25× and freezes it while each screenshot is taken. The app is unchanged; only `performance.now()` in the page is controlled.

What this proves: the public API drives the effects, and the rendering, positions and timing are right in a real Skia renderer. What it does not prove: anything about Android or iOS rendering or speed.

## Device checks

Android (the owner's Android 17 emulator, Expo Go), Windows PowerShell:
1. `npm run example:install`
2. `cd example`
3. `npx expo start --clear`, then press `a`.
4. Effects tab: go through demos A to F (checklist in the Phase 4 report). Particles, Motion and Graphics tabs: earlier phases still work.

iOS is not verified (deferred by the owner).
