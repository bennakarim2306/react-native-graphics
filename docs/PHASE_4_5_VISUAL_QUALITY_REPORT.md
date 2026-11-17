# Phase 4.5: visual fidelity, rendering quality and performance

Date: 2026-11-17. Branch `claude/project-thread-5mm4qx` (PR #3), on top of Phase 4A (commit c8a478b).

**Status: implemented and verified by automated tests, by real Skia renders (CanvasKit CPU raster in Node) and by the web build (CanvasKit/WebGL in headless Chromium). Not run on Android or iOS. The owner's visual acceptance is pending, and no device performance has been measured.** Phase 4A and the Phase 4 fire-lag fix (c56d06f) are also still waiting for the owner's emulator check.

| Area | Implemented | Automated tests | Visually checked (real Skia, Node and web) | Device (Android emulator / phone / iOS) |
| --- | --- | --- | --- | --- |
| Fire border (shader, lite shader, sparks, rotation, scaling) | Yes | Yes | Yes | Not run |
| Throw & Explode (depth, punch, trail, contact explosion, quality) | Yes | Yes | Yes | Not run |
| Explosion layers, shockwave, smoke, confetti, sparks, glow pulse, victory | Yes | Yes | Yes | Not run |
| Quality profiles (same timing, default `medium`) | Yes | Yes | Yes | Not run |
| Sharpness at 1×, 2×, 3× density | No change needed (correct before) | Yes (new) | Yes (crops) | Not run |
| Showcase section H | Yes | Type-checked against the packed SDK | Yes (web screenshots) | Not run |
| Performance | Node engine and CanvasKit render benchmarks | – | – | **Not measured** |

Nothing was published and nothing was deployed. Phase 5 was not started. `CLAUDE.md` was not changed: no architectural rule changed (the default-quality and visual-regression notes are in ARCHITECTURE.md).

## 1. Scope

Done: an audit before any change; a visual regression harness; a new fire border; a reworked Throw & Explode and explosion; polish of the existing presets (confetti, golden sparks, smoke, glow pulse, trail, shockwave, shake, victory); quality profiles with identical timing; sharpness tests; a showcase section for comparing profiles; benchmarks; this report.

Not done, on purpose:
- No new presets (no ice, lightning or dissolve).
- No rewrite of the runtime, scene graph, timelines, targets or local effects layers. Changes are inside effects, the renderer's particle drawing, the quality profiles, the throw motion and the Throw & Explode sequence.
- No batched drawing of soft particles: it was tried and measured slower (section 7), so the existing per-particle drawing stays.

## 2. Original problems and root causes (audit at c8a478b)

The audit rendered every effect with real Skia at fixed times (the harness in section 5) before changing anything, and read the code behind each image.

| Problem seen | Root cause |
| --- | --- |
| The fire looked like a glowing orange band, the same on all four sides, with flames pointing straight out of every edge | The flame shader measured only the distance to the outline. It had no notion of "up": no buoyancy, no taller flames on top, no leaning sides, and when the card turned the flames turned with it |
| A yellow haze washed over the card | The fire's glow was a node effect (blur image filter) on the whole flame layer, which also spread light over the card's face |
| `low` fire looked like bokeh dots | `low` turned shaders off and replaced the flames with about 50 soft CPU particles per border |
| While a card scaled, particle flames piled up into bright blobs | The particle flames rebuilt their emitters whenever the target's size changed; the old emitter's particles were kept and new ones were born on top every frame of the scale animation. A test now reproduces this (it fails on the old code) |
| The explosion read as two flat white rings and a grey disc | Two wide, glowing, near-white shockwave rings dominated; sparks were small and dull; debris were flat squares in the explosion palette that read as confetti; there was no fireball; the smoke was one large grey disc |
| The explosion covered the thrown card | The explosion started at the card's centre and was drawn over it |
| The throw felt weightless | No depth cue, no reaction at the impact, nothing during the flight |
| Expensive mode by default | The engine's default profile was `high` (glow passes, all details) on every device |

What was checked and found correct (no change needed):
- **Resolution and density.** React Native Skia draws in points on a canvas scaled to the device density. The renderer records a resolution-independent picture in points, so vector shapes, paths and shaders are rasterized at the device's own resolution. Shaders receive local coordinates in points and run once per device pixel. There is no double scaling and no low-resolution offscreen layer for effects. This was confirmed with crops at 1×, 2× and 3× and is now covered by tests (section 3).
- **Image sampling.** Image shapes use linear filtering with linear mipmaps (`nearest` on request for pixel art); `drawAtlas` for image particles uses the same sampling.
- **Clock and synchronisation.** The impact effects start from timeline cues at the exact `impact` marker (no JavaScript timers), and cancel/replay restored state correctly. Both were kept.

## 3. Sharpness (DPR)

New tests in `src/renderer/skia/density.render.test.ts` draw recorded pictures the way the overlay does and read real pixels back:
- A vector disc keeps an anti-aliasing ramp of at most two device pixels per edge, and the same size in points, at 1×, 2× and 3×. A control (the disc drawn at 1× and scaled up 3×) fails the same check, so the test would catch double scaling or a low-resolution layer.
- The fire shader covers the same share of the canvas at every density (within 2 %), matches the 1× image when the 2× and 3× images are averaged back down (mean alpha difference below 4 of 255), and shades every device pixel on its own (colour varies inside each 2 × 2 or 3 × 3 block; an upscaled 1× image has none).
- Images request linear filtering with linear mipmaps, `nearest` images request nearest without mipmaps, and image particles use linear mipmapped sampling. Linear filtering visibly smooths a downscaled checkerboard compared with `nearest`. The mipmapped result itself cannot be shown in Node: CanvasKit only samples mipmaps from images given them with `makeCopyWithDefaultMipmaps`, which React Native Skia's API does not offer. On the GPU backends, Skia creates mipmapped textures when a draw asks for mipmaps; this is expected but **not verified on a device**.
- The same seed and time give identical pixels; one frame later changes a little, half a second later a lot (continuous motion).

Comparison sheet: `04-fire-density-crops-1x-2x-3x.png` (the same 60 × 60 pt corner at each density, magnified without smoothing).

## 4. Improvements

### Fire border (highest priority)

- **New flame shader** (`flameBorderShader`). Per pixel it uses the distance to the outline and the screen's "up" direction expressed in the target's own coordinates, updated from the target's rotation. Flames are tall above the target, short below it and lean on the sides; when the target turns, they keep rising on screen. Tongues are fractal noise stretched along the outline and scrolled outward; a faster noise adds licks; a slow noise varies the height along the border; a breathing term varies the whole fire. Colours run from transparent dark-red tips through the body colour to a near-white base.
- **Glow inside the shader.** The halo is computed in the same pass, outside the flames only, and never over the target. The blur node effect is gone, which also removes one offscreen layer per border.
- **`low` uses a lite shader** (`flameBorderLiteShader`: two noise octaves, no halo) instead of CPU particle flames. The particle flames remain for renderers without runtime shaders, and now rise on screen and use the same palette.
- **Sparks:** finer, white-hot to red, their number set by `sparkDensity`; they fly off the flames in world space and stay behind when the card moves.
- **Pile-up fixed:** emitters are created once and reconfigured in place when the size, rotation or settings change.
- **New parameters**, all changeable while running: `speed` (0.1–4), `glowStrength` (0–2), `sparkDensity` (0–3), `coreColor`, `tipColor`. Existing ones (`intensity`, `flameHeight`, `color`, `glow`, `sparks`) are unchanged.
- **Attachment** is unchanged: the fire is drawn in the target's local effects layer (c56d06f), so it follows moves, rotations and scales in the same frame. The flame direction follows rotations made through the target's `motion` binding; rotations a host app applies to a view by other means move the fire with the view (it is inside the view) but do not change which side the flames rise from.

Sheets: `01-fire-border.png`, `02-fire-rotation-scaling.png`, `03-fire-quality-profiles.png`.

### Throw & Explode (highest priority)

- **Flight:** an optional depth cue, `throw.scale` (default 1.08 in Throw & Explode, 1 for `fx.throw`): the object grows slightly towards the peak and is back to its scale at the landing. The landing point is unchanged and exact; nothing random affects the motion.
- **Impact weight:** `punch` (default 0.06) squashes the object to 94 % at the impact and springs it back within 220 ms.
- **Trail:** `trail: true` (or trail parameters) runs a trail during the flight; it stops emitting at the `impact` marker and its particles fade.
- **Explosion placement:** `explodeAt: 'contact'` (default) starts the explosion at the lowest point of the object at the impact, where it meets the table, instead of its centre, so the blast does not cover the card. `'center'` keeps the old placement.
- **Quality:** `quality` sets the profile of the explosion, shake and trail for one sequence; the flight and the impact moment are identical on every profile (tested).
- **Unchanged guarantees:** effects start on timeline cues at the `impact` marker; cancel at any moment restores position, rotation, scale and opacity synchronously and cancels the explosion, shake and trail; a replay right after cancel starts from the resting state; `finish()` skips the explosion; unmount mid-flight cancels the sequence. The existing regression tests still pass unchanged, and new ones cover scale and trail on cancel.

### Explosion (layered)

In draw order: smoke (dark, rising, spreading, from 120 ms; detail quality), bloom (a wide soft light, scaled by the new `glow` parameter), fireball (soft additive puffs that expand, cool from white through yellow and orange to dark red and break up), flash (short, small), shockwave (one thin decelerating ring over a faint band), sparks (white-hot streaks, gravity, drag; with a halo on `high`), embers (slow glowing dots that drift up; detail quality), debris (warm-to-charcoal chips with gravity), and the screen shake. All layers start from the same timeline moment and the total duration is the same on every profile.

Sheets: `08-explosion-progression.png` (17 ms to 1.6 s), `06-throw-impact.png`, `07-throw-settle.png`, `10-throw-quality-profiles.png`.

### Presets

- `shockwave`: a thin bright edge over a faint wide band, decelerating (quartic ease-out) and thinning; no blur layer.
- `confetti`: faster launch with stronger drag (a pop, then flutter), narrower strips that tumble and flip, a short fade at the end.
- `golden-sparks`: finer sparks with a halo on `high`.
- `smoke`: neutral greys, puffs that grow from 0.4× to 2.3× while rising and thinning, peak opacity 0.32 (new `opacity` parameter), rate 16.
- `glow-pulse`: the ring grows with an ease-out and fades smoothly instead of linearly.
- `victory`: a soft bloom behind the bursts; thinner ring.
- `trail`, `screen-shake`: unchanged (checked in the renders).

Sheets: `09-smoke.png`, `11-presets.png`, `12-combined.png`.

### Particle rendering

- `glow` (0–1) on emitters: a wide faint pass under `spark` and `circle` particles plus a whiter core. It roughly quintuples the CPU raster cost of sparks in the render benchmark, so presets use it on `high` only.
- Colour arrays are filled once per frame for both colour paths.
- No batching (see section 7).

### Quality profiles

| Level | Particle scale | Shader detail | Glow (halos, bloom) | Details (embers, smoke, second rings) |
| --- | --- | --- | --- | --- |
| `low` | 0.35 | `lite` | off | off |
| `medium` (new default) | 0.65 | `full` | off | on |
| `high` | 1 | `full` | on | on |

The fire border's in-shader halo is drawn on `medium` and `high`; "Glow" in the table means blur passes, spark halos and blooms. Timing is identical on every profile (tested for the explosion and for Throw & Explode). Reduced motion stays independent of quality. The engine's default changed from `high` to `medium`, so the most expensive profile is opt-in (`<GameFXProvider quality="high">`, `fx.setQuality('high')` or per effect).

### Showcase: section H, "Visual quality comparison" (`example/QualityLab.tsx`)

Public API only (`react-native-graphics`), no duplicate implementation:
- **Side by side:** the same fire border on three cards at `low`, `medium` and `high`, with Rotate, Scale and "Explode all" (the same explosion on each card at its profile).
- **Profile selector** for the two demos below it (per-effect `quality` option; the engine's own profile, set by the bar at the top, is not changed).
- **Fire border:** on/off, intensity, flame height, speed, glow strength, spark density and colour, all live, with Move, Rotate and Scale.
- **Throw & Explode:** Throw, Replay, Cancel; explosion intensity, particle density and glow; trail and fire-on-card toggles.
- **Combined finale:** fire on the card, the throw with a trail, and at the `impact` marker the explosion plus golden sparks, confetti and a victory burst; cancelling stops them all.

The showcase app as a whole now starts on the engine default, `medium`; the chips at the top switch every demo.

## 5. Before and after evidence

How it was produced: `npm run visual` (`scripts/visual/`) renders 19 deterministic scenes (seed 7, virtual clock in 60 FPS steps) through the real renderer to 62 PNGs at 2× (the fire border also at 1× and 3×), with the camera offset applied as the overlay does, plus a manifest with drawn primitives, changed-pixel share and mean luminance. The **before** set was rendered from the Phase 4A source (`git archive c8a478b`) with the same scene files; the **after** set from this branch. Re-rendering gives byte-identical PNGs. These are CanvasKit CPU renders, **not device screenshots**; blur and anti-aliasing can differ slightly on the GPU.

Where:
- Project files: `phase4.5/screenshots/before/` and `after/` (62 PNGs and `manifest.json` each), `comparisons/` (12 side-by-side sheets), `web/` (showcase screenshots, section 6).
- Repository: `docs/evidence/phase4.5/` holds four of the sheets (fire border, density crops, throw impact, explosion progression).

| Sheet | What to look at |
| --- | --- |
| `01-fire-border.png` | Rising tongues and a clean card face vs a symmetric band and a hazed card |
| `02-fire-rotation-scaling.png` | Flames still rise while the card is turned 30°, turning to 90°, scaled 1.35× and scaling |
| `03-fire-quality-profiles.png` | `low` lite shader vs the old particle "bokeh"; `medium` and `high` |
| `04-fire-density-crops-1x-2x-3x.png` | Same layout at every density, finer detail at higher density |
| `05-throw-flight.png` | Flight with the depth cue |
| `06-throw-impact.png` | Impact frames at 33, 67 and 117 ms after the impact: blast at the contact point |
| `07-throw-settle.png` | Aftermath and return |
| `08-explosion-progression.png` | Flash → fireball with sparks → breaking fireball → embers and smoke, vs rings and a grey disc |
| `09-smoke.png` | Rising, spreading plume vs a disc |
| `10-throw-quality-profiles.png` | `low`, `medium`, `high` at the same impact moments |
| `11-presets.png` | Confetti, golden sparks, glow pulse, trail, victory |
| `12-combined.png` | Fire, explosion, golden sparks and confetti together |

Manifest figures (after vs before): the fire covers about the same area (23 % of the frame vs 24.5 %) with the same mean brightness; `low` fire draws 2 primitives instead of 89; the explosion at 350 ms covers 19 % of the frame instead of 37 % (the rings are gone) while the fireball makes it brighter; at 1 s the remaining smoke and embers cover 8 % instead of a 20 % grey disc.

## 6. Showcase screenshots (web build)

`cd example`, `CI=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir dist-web`, served locally, then `node scripts/capture-effects-showcase.js <folder> 2` (Playwright, Chromium, 412 × 915 at 2×). Pass, no page errors: 60 screenshots, 18 of them of section H, in the project files under `phase4.5/screenshots/web/` with the script's log (`capture-log.json`).

Section H screenshots: the three profiles side by side with fire (`h1`), rotated (`h2`) and exploding at 140 and 640 ms (`h3`, `h4`); the fire border on `high` (`h5`), with glow strength 1.5 and spark density 2 (`h6`), on `medium` and `low` (`h7`, `h8`), and rotated (`h9`); the throw's impact, 200 ms and 800 ms later on `high` (`h10` to `h12`) and on `low` (`h13`, `h14`); a replay cancelled mid-flight with the card back in place (`h15`); and the combined finale at the impact, 400 ms and 1.3 s (`h16` to `h18`). The log shows 1 active effect after the finale (the fire left on the card, as intended) and 0 after turning it off.

The first run of the updated script found that two labels of section H ("Cancel" and "Violet") were also matched by the Emitter lab's steps, which looked for the last such label on the page. The script now looks only inside the lab's card; with that, the lab's counters are as in Phase 4A (fountain cancelled, pool idle buffers 16 → 17 → 19, reused 33 → 35 after adding the orb back). Earlier demos still end at 0 active effects.

These screenshots show the public API driving the effects in a real Skia renderer (WebGL in software). They do not show Android or iOS rendering or speed.

## 7. Performance

Full tables and method: [PERFORMANCE.md](PERFORMANCE.md), section "Phase 4.5". Both benchmarks were run on Phase 4A (commit c8a478b, its own source) and on Phase 4.5 with the same scenario files, in Node 22.23.4 on the cloud container. **None of this is a device measurement**; Node is not a phone CPU and CanvasKit's CPU rasterizer is not a GPU.

Engine work per frame (`npm run bench`, JavaScript before Skia records; two runs per version):
- Fire borders on `high` and `medium`: unchanged within run-to-run noise (10 borders 0.19–0.30 ms before, 0.29–0.39 ms after).
- Fire borders on `low`: about 15× less (10 borders 1.6–1.7 ms → 0.11 ms), because the lite shader replaces 513 simulated flame particles.
- Explosions: more work for the new layers (5 explosions on `high` 0.55–0.71 ms → 1.00–1.07 ms; on `low` 0.09–0.13 → 0.20–0.21 ms).
- New scenarios: repeated Throw & Explode on 3 cards for 30 s (1.19–1.30 ms on `high`, 0.35–0.36 ms on `low`, idle afterwards), cancel and replay every 5 frames (0.11–0.18 ms, 60 replays, view restored, idle afterwards), long emitters for 2 minutes (0.17–0.18 ms on `high`, stable). Continuous 3-minute run stable (0.44–0.52 ms), heap not growing.
- Every scenario stays far below a 16.7 ms frame here.

Drawing (`npm run bench:render`, recording with the real renderer plus CanvasKit CPU playback):
- **Fire shader per-pixel cost went up** about 1.5–1.8× on the CPU (more noise per pixel), while one blur layer per border was removed on `high`. `low` now draws the lite shader (about 0.6× the full shader) instead of cheap-to-draw particles, which moves work from the JS thread to the GPU. **This is the main performance risk to measure on a device** (showcase section F, `10 fire borders` on each profile).
- **High explosions are much cheaper to draw**: no more blur layers on the shockwave rings (CPU playback of 5 explosions 5.1 s → 0.9 s at 1080 × 1920). On `medium` and `low` the new fireball's soft particles cost more than before (369 → 629 ms, 232 → 543 ms).
- Recording time (the JS-thread part) changed by at most 0.25 ms for the fire and went down for the explosions.
- The spark halo costs about 5× a plain spark, so presets use it only on `high`.
- **Batching soft particles into one `drawAtlas` call was implemented, measured and reverted**: recording 3.4–4.6 ms vs 2.0–2.2 ms per 1000 particles and CPU playback 428–1279 ms vs 294 ms. The existing per-particle drawing is kept, as the brief asks for systems that are correct and not shown to be slow.

Device status: no FPS, frame time, GPU or memory figure exists for Phase 4.5. The procedure is in PERFORMANCE.md ("Measuring on a device or emulator").

## 8. Tests

| Command | Result |
| --- | --- |
| `npm run check` (typecheck, lint, all tests, build) | **Pass: 36 suites, 441 tests, 0 failed** (428 at Phase 4A). CanvasKit prints one `RuntimeEffect error ... unknown identifier 'nope'`: the intentional broken-shader test |
| `npm run example:install`, then `cd example` and `npx tsc --noEmit` | Pass: the showcase, including section H, type-checks against the packed SDK's public types |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform android` / `ios` | Pass: Hermes bundles, 1279 and 1281 modules |
| `cd example`, then `CI=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir dist-web`, served locally, then `node scripts/capture-effects-showcase.js <folder> 2` | See section 6 |
| `npm run visual` (after) and the same scenes on the c8a478b source (before) | 62 PNGs each plus manifests; a second render of the same scenes is byte-identical |
| `npm run bench` and `npm run bench:render` on both versions | Section 7 |

New tests (13):
- `src/renderer/skia/density.render.test.ts` (5): vector edges and size at 1×, 2×, 3× with a double-scaling control; fire shader layout identical across densities and shaded per device pixel, with an upscaling control; image sampling requests (linear with mipmaps, nearest for pixel art) and the pixel difference between them; image particles' atlas sampling; identical pixels for the same seed and time, small change after one frame, large after 500 ms.
- `src/effects/fireBorder.test.ts` (2): the lite shader without halo on `low` and the full one on `medium`/`high`; emitters reconfigured in place while the target scales, so particles never pile up. The pile-up test fails on the Phase 4A code.
- `src/engine/sequences.test.ts` (2): depth cue, impact punch and trail without changing the landing point, and everything restored on cancel; impact effects at the requested quality with the same impact time on every profile and the engine's own profile untouched.
- `src/motion/throw.test.ts` (1): depth scale peaks at mid-flight and is back at the impact.
- `src/effects/presets.test.ts` (2): spark halos only on `high`; explosion layers with the same timing on every profile.
- `src/engine/runtime.test.ts` (1): the engine defaults to `medium`.

Tests changed on purpose because the intended behaviour changed (none was weakened or skipped):
- Fire border: the shader's uniforms and margin, the draw-only layer (no glow node effect), the rotated `up` vector, particle flames that rise on screen (renamed test, now checked at 0° and 180°), the local layer's reach, and in the renderer test flames that reach further above than below and, rotated 90°, further to one side.
- Shockwave: rewritten for the band-and-edge drawing (4 drawables on `high`, 2 on `low`, no offscreen layers).
- Six test setups that relied on the old default now set `quality: 'high'` explicitly; a new test covers the new default.
- Throw & Explode: the contact placement (explosion at y 660, the card's bottom, instead of its centre 600, with a separate check of `explodeAt: 'center'`), scale back to 1 after the punch.
- Confetti strip aspect 0.55, shader library uniform count and the lite variant.

## 9. Behaviour changes

Visible or API-relevant changes an app may notice:
- The engine's default quality is `medium` (was `high`).
- `low` draws the fire border with the lite shader (was CPU particle flames); `shaders: false` or `mode: 'particles'` still gives particle flames.
- The fire border's glow is part of its shader; the border no longer adds a `glow` node effect (one offscreen layer less per border). Its local effects layer reaches about as far as before (59 pt instead of 60 pt beyond the view for a 20 pt flame height at intensity 0.8, the case in the layer test), because the shader's margin now holds the halo.
- Particle flames rise on screen instead of outward along each edge's normal.
- `throwAndExplode` defaults: `throw.scale` 1.08, `punch` 0.06, `explodeAt: 'contact'`. Pass `{ throw: { scale: 1 }, punch: 0, explodeAt: 'center' }` for the Phase 4 behaviour. It returns a new `trail` field (null unless `trail` is set).
- The explosion adds bloom, fireball, embers and darker smoke layers; debris colours changed; it accepts `glow`.
- `shockwave` no longer uses a blur layer; its look changed. `smoke` defaults changed (rate 16, `opacity` 0.32, neutral greys). Confetti strips are narrower.
- The shader noise `hash21` wraps its input (`mod 289`), which changes the exact noise pattern of every shader that uses the shared chunks.
- New public items: `flameBorderLiteShader`, `fbm2` chunk, `QualityProfile.shaderDetail`, `EmitterConfig.glow`, `ThrowOptions.scale`, `ThrowAndExplodeOptions.{trail, punch, explodeAt, quality}`, fire-border `speed`, `glowStrength`, `sparkDensity`, `coreColor`, `tipColor`, explosion `glow`, smoke `opacity`, `firePalette`.

## 10. Limitations and open points

- **Visual acceptance is the owner's.** The images are real engine output, but whether the fire and explosion look professional on a phone has to be judged there.
- **No device data.** All timings are Node and CanvasKit CPU. GPU cost of the fire shader (per pixel, including the halo) and of soft particles is unknown on devices; the lite shader on `low` is a guess at the right trade-off until measured.
- Mipmapped sampling is requested but could not be observed in Node (section 3).
- The flame direction follows rotations made through the engine; a rotation applied to a host view by other means moves the fire with the view but does not change which side the flames rise from.
- The additive explosion over a light card still brightens the card's lower part for about 100 ms; the contact placement limits this.
- The smoke is soft blurred puffs; it is a plume, not volumetric smoke.
- Web screenshots run in software WebGL in headless Chromium; they show correct composition and timing, not device rendering.

## 11. How to check it on the Android emulator (Windows PowerShell, one command per line)

1. `git pull`
2. `npm install`
3. `npm run example:install`
4. `cd example`
5. `npx expo start --clear`, then press `a` (Expo Go).
6. Effects tab, scroll to **H · Quality side by side**: Fire on, compare the three cards; Rotate; Scale; Explode all.
7. Pick `high` in "Profile for the two demos below". **H · Fire border**: Fire on; change intensity, flame height, speed, glow strength, spark density and colour; Move, Rotate, Scale. Switch the profile to `low` and `medium` while it burns.
8. **H · Throw & Explode**: Throw; Replay; Cancel mid-flight (the card must snap back); change explosion, particles and glow; toggle trail and fire on card; Combined finale.
9. Optional: section F with the top bar on `low`, `medium` and `high` (10 fire borders, 5 explosions) and note the meter lines, as described in `docs/PERFORMANCE.md`.
10. Earlier checks still open: demo G (Phase 4A) and the c56d06f re-check (B with fire on card, E with fire on all, scrolling with fire on).
