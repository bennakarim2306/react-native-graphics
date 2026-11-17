# Performance

**No device measurements exist yet.** Phases 1 to 4.5 have run in Node (Jest), real Skia through CanvasKit (Jest), Chromium (web build) and, for Phases 1 to 3, an Android 17 emulator in Expo Go without timing. None of this says anything about frame times on Android or iOS, so no device FPS, memory or GPU numbers are reported. Phase 4 adds the tools to take them: the same benchmark scenarios as buttons in the showcase with a live frame meter (procedure below).

## Phase 4.5: before and after, engine side and drawing side (Node, not a device)

Phase 4.5 changed how effects look (new fire shader, layered explosion, throw trail and punch, glow passes on `high`) and the default profile (`medium`). Two benchmarks compare it with Phase 4A (commit c8a478b, rendered from its own source with the same scenario files). Both run in Node on the same machine; neither says what a phone's CPU or GPU will do.

Environment: Node 22.23.4, Linux x64 cloud container, 2026-11-17.

### Engine work per frame (`npm run bench`)

Same method as the Phase 4 table below (JavaScript work per 60 FPS frame before Skia records, `performance.now()` around each frame). Each version was run twice; the table gives both averages to show the run-to-run noise. The repeated-throw and cancel/replay rows ran on 4A without the trail, punch and depth cue (options 4A does not have).

| Scenario | 4A average (run 1 / run 2) | 4.5 average (run 1 / run 2) | 4.5 p95 (run 1) | 4.5 peak particles | Reading |
| --- | --- | --- | --- | --- | --- |
| 1 fire border (high) | 0.041 / 0.052 ms | 0.087 / 0.047 ms | 0.112 ms | 9 | same within noise |
| 10 fire borders (high) | 0.188 / 0.304 ms | 0.391 / 0.293 ms | 0.741 ms | 78 | same within noise (sparks emitter reconfigured in place) |
| 10 fire borders (medium) | 0.159 / 0.212 ms | 0.320 / 0.213 ms | 0.449 ms | 55 | same within noise |
| 10 fire borders (low) | 1.727 / 1.604 ms | 0.110 / 0.105 ms | 0.149 ms | 0 | **about 15× less**: lite shader instead of 513 CPU flame particles |
| 1 explosion of 150 particles (high) | 0.226 / 0.267 ms | 0.340 / 0.351 ms | 1.262 ms | 246 | more layers (fireball, embers, bloom) |
| 5 explosions of 150 particles (high) | 0.554 / 0.711 ms | 1.002 / 1.068 ms | 3.523 ms | 1230 | about 1.5–1.8× more |
| 5 explosions of 150 particles (medium) | 0.411 / 0.499 ms | 0.605 / 0.592 ms | 1.877 ms | 800 | |
| 5 explosions of 150 particles (low) | 0.090 / 0.133 ms | 0.212 / 0.200 ms | 0.797 ms | 335 | |
| 50 sprites, 10 trails, 10 glow pulses | 1.167 / 1.056 ms | 0.940 / 1.081 ms | 1.160 ms | 283 | unchanged |
| 500 create/destroy cycles (3 frames each) | 0.948 / 1.226 ms | 1.032 / 0.884 ms | 1.685 ms | 0 | idle afterwards; 19 buffers allocated, 981 reused |
| continuous, minutes 1 / 2 / 3 (run 1) | 0.393 / 0.395 / 0.380 ms | 0.436 / 0.522 / 0.501 ms | 0.823 / 1.160 / 1.200 ms | 372 | stable over 3 minutes; heap not growing |
| repeated throw & explode, 3 cards, 30 s (high) | 0.918 / 1.056 ms | 1.193 / 1.300 ms | 2.050 ms | 552 | new scenario; idle afterwards |
| repeated throw & explode, 3 cards, 30 s (low) | 0.192 / 0.140 ms | 0.347 / 0.363 ms | 0.631 ms | 148 | idle afterwards |
| rapid cancel/replay every 5 frames (high) | 0.052 / 0.053 ms | 0.109 / 0.178 ms | 0.336 ms | 221 | 60 replays; view restored; idle afterwards |
| long emitters, 120 s (high) | 0.165 / 0.150 ms | 0.176 / 0.171 ms | 0.276 ms | 92 | smoke, sparks stream, trail on an orbiting node |
| long emitters, 120 s (low) | 0.066 / 0.066 ms | 0.077 / 0.072 ms | 0.122 ms | 34 | |

Reading: every scenario stays far below a 16.7 ms frame in Node. The explosion and throw cost more JavaScript time because they now simulate more layers; `low` fire borders cost far less. Single slow frames (maxima in the raw output, up to 13 ms) come from JIT warm-up and garbage collection and appear in both versions.

### Drawing cost (`npm run bench:render`)

`scripts/visual/particles.renderbench.ts` records the frame with the real renderer (JavaScript plus CanvasKit calls: the work the overlay does on the JS thread every frame) and plays the picture back with CanvasKit's **CPU** rasterizer. On a phone, recording crosses JSI instead of WebAssembly and playback runs on the GPU, which runs shaders in parallel; so the playback column compares versions and profiles under identical conditions and says nothing about device frame times.

**Whole frames per profile** (5 timed iterations after 1 warm-up, medians; the fire frame is small because CanvasKit evaluates the shader on the CPU at about a second per frame):

| Frame | Profile | 4A primitives | 4A record | 4A CPU raster | 4.5 primitives | 4.5 record | 4.5 CPU raster |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 fire border, 1 s (360×640, 1×) | high | 7 | 0.905 ms | 577 ms | 8 | 0.655 ms | 880 ms |
| 1 fire border, 1 s (360×640, 1×) | medium | 5 | 0.430 ms | 515 ms | 5 | 0.580 ms | 946 ms |
| 1 fire border, 1 s (360×640, 1×) | low | 46 | 0.400 ms | 2.1 ms | 1 | 0.369 ms | 561 ms |
| 5 explosions, 120 ms (1080×1920, 3×) | high | 1170 | 6.260 ms | 5129 ms | 1195 | 5.770 ms | 924 ms |
| 5 explosions, 120 ms (1080×1920, 3×) | medium | 765 | 3.337 ms | 369 ms | 785 | 2.956 ms | 629 ms |
| 5 explosions, 120 ms (1080×1920, 3×) | low | 300 | 2.104 ms | 232 ms | 355 | 1.881 ms | 543 ms |

Reading:
- **Fire shader cost per pixel went up.** The new flame shader evaluates more noise per pixel (fractal tongues plus licks, height and breathing noise); on the CPU it takes about 1.5–1.8× the old shader's time. Its halo replaced the old blur layer (one offscreen layer less per border on `high`), and `medium` and `high` run the same shader (they differ in sparks). Whether this matters on a phone's GPU is **the main open performance question of Phase 4.5**; section F's `10 fire borders` on each profile answers it.
- **`low` fire moved work from the JS thread to the GPU.** It used to simulate about 50 particles per border (1.6–1.7 ms of JS for 10 borders, table above) and draw them cheaply; it now draws the lite shader (about 0.6× the full shader's CPU raster time) and does almost no JS work.
- **High explosions no longer use blur layers.** The old shockwave rings drew through offscreen blur filters at full screen size; CPU playback of 5 explosions on `high` dropped from 5.1 s to 0.9 s. On `medium` and `low` the new fireball (soft, blurred particles) costs more than before (369 → 629 ms, 232 → 543 ms on the CPU).
- Recording (the JS-thread part) changed by at most a quarter of a millisecond for the fire (down on `high`, up on `medium`) and went down for the explosions.
- A possible optimization, not done: the breathing term of the flame is the same for every pixel and could be computed once per frame on the CPU.

**Particle looks** (per-particle cost by look, 35 timed iterations after 5 warm-up, 1080×1920 at 3×):

| Look | Particles | Record (median) | CPU raster playback (median) |
| --- | --- | --- | --- |
| circle | 200 | 0.356 ms | 23.1 ms |
| soft | 200 | 0.676 ms | 56.4 ms |
| spark | 200 | 0.388 ms | 13.8 ms |
| spark + glow 1 (new) | 200 | 0.722 ms | 73.9 ms |
| square | 200 | 0.696 ms | 16.4 ms |
| circle | 1000 | 0.967 ms | 108.6 ms |
| soft | 1000 | 2.036 ms | 279.4 ms |
| spark | 1000 | 1.138 ms | 64.3 ms |
| spark + glow 1 (new) | 1000 | 2.123 ms | 346.9 ms |
| square | 1000 | 2.571 ms | 74.1 ms |

The spark halo costs about 5× a plain spark in CPU raster, which is why presets turn it on only on `high`.

**Batching experiment (not adopted).** Soft particles are drawn one blurred circle each. Drawing them instead as one `drawAtlas` call per emitter from a pre-rendered soft-dot texture was implemented and measured with the same benchmark: for 1000 soft particles, recording took 3.4–4.6 ms instead of 2.0–2.2 ms (building the transform and colour arrays costs more than the calls it saves), and CPU playback took 428 ms without mipmaps and 1279 ms with them instead of 294 ms. Batching was therefore reverted; the per-particle drawing stays until a device shows picture recording as the bottleneck.

## Phase 4 effect scenarios: engine-side cost in Node (not a device)

What it measures: the JavaScript work per frame before Skia draws, for the seven scenarios of the Phase 4 brief. That is playbacks, effect updates (particle simulation, shader uniforms), attachments and the display list. It does **not** include recording the Skia picture, GPU rasterization or shader execution, and a phone CPU is slower than this server CPU by an amount not measured here.

Method: `npm run bench` (`scripts/effects.bench.ts`). A `VirtualClock` advances 60 FPS frames (16.7 ms) and each frame is timed with `performance.now()`. The first 30 frames are excluded as warm-up except in the explosion rows (measured from the trigger). Targets are 60 × 90 point cards; quality `high` unless stated. Seed 7.

Environment: Node 22.23.4, Linux x64 cloud container, 4 vCPU Intel Xeon @ 2.10 GHz, 2026-11-13.

| Scenario | Frames | Average | p95 | Max | Peak live particles | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 fire border (high) | 600 | 0.035 ms | 0.051 ms | 0.230 ms | 8 | shader flames; particles are sparks only |
| 10 fire borders (high) | 600 | 0.233 ms | 0.373 ms | 2.441 ms | 67 | |
| 10 fire borders (low) | 600 | 1.476 ms | 2.105 ms | 2.891 ms | 513 | no shader: particle flames |
| 1 explosion of 150 particles (high) | 150 | 0.180 ms | 0.623 ms | 1.472 ms | 231 | all layers ended within 2.5 s |
| 5 explosions of 150 particles (high) | 150 | 0.612 ms | 1.809 ms | 2.358 ms | 1155 | all ended within 2.5 s |
| 5 explosions of 150 particles (low) | 150 | 0.109 ms | 0.391 ms | 0.468 ms | 290 | |
| 50 sprites, 10 trails, 10 glow pulses | 600 | 1.090 ms | 1.273 ms | 3.258 ms | 283 | every sprite animates frames and rotation |
| 500 create/destroy cycles (3 frames each, per frame) | 1500 | 0.872 ms | 1.109 ms | 3.062 ms | 0 | engine idle afterwards; particle buffers allocated 18, reused 982 |
| Continuous, minute 1 | 3600 | 0.371 ms | 0.681 ms | 2.757 ms | 346 | 3 fire borders, smoke, an explosion every 2 s, confetti every 5 s; process heap 66 MiB |
| Continuous, minute 2 | 3600 | 0.427 ms | 0.869 ms | 2.146 ms | 344 | heap 55 MiB |
| Continuous, minute 3 | 3600 | 0.398 ms | 0.804 ms | 2.644 ms | 345 | heap 60 MiB |

Reading:
- Engine work stays far below a 16.7 ms frame in every scenario on this CPU. The likely costs on a phone are elsewhere and unmeasured: recording the picture (one Skia call per particle, see below), GPU fill of shaders and blurred glows, and saveLayer passes for node effects.
- The continuous run shows no growth over three simulated minutes (stable frame cost, stable particle count, heap not growing; heap includes Jest and is not GC-forced, so it is a trend only). The create/destroy run ends idle with pooled buffers reused.
- **Open question for devices (Phase 4; since Phase 4.5 `low` draws a lite shader instead, see above):** `low` quality turned the fire-border shader into about 50 CPU particles per border. That costs roughly 6× more JavaScript time than `high` (1.5 ms vs 0.23 ms for 10 borders here) but removes per-pixel shader work. Which is cheaper on a low-end phone must be measured there (section F of the showcase, `10 fire borders` on `low` vs `high`).
- Particles are drawn one Skia primitive per particle (image particles use one `drawAtlas` per emitter). 1155 particles mean about 1155 draw calls recorded per frame in the 5-explosion scenario. If devices show picture recording as the bottleneck, batching vector particles (atlas of pre-rendered dots) is the first optimization to try.

## Measuring on a device or emulator (procedure)

The showcase's **Effects** tab, section **F · Performance scenarios**, has one button per scenario above (`1 fire border`, `10 fire borders`, `1 explosion (150)`, `5 explosions`, `50 sprites + effects`, `create/destroy ×100`, `continuous 2 min`) and a meter that updates twice a second:
- **Frames, interval avg / p95 / worst, ≈ FPS**: time between engine frames on the JavaScript thread (the effects loop). Gaps after a frame with nothing running are counted separately as idle gaps, not as slow frames.
- **JS work per frame (engine + picture)**: time from the start of an engine frame until the meter's listener runs, which includes the overlay recording the Skia picture.
- **Particles** now and peak; active effects; current quality.

Steps (Windows PowerShell, one command per line):
1. `npm run example:install`
2. `cd example`
3. `npx expo start --clear`, then press `a` to open the Android emulator in Expo Go.
4. Open the **Effects** tab, scroll to **F**, pick the quality chip at the top, press a scenario, wait 10 s (or the full 2 min for `continuous`), and write down the three meter lines. Press **Stop** between scenarios.
5. For the UI/render thread (where Skia draws): `adb shell dumpsys gfxinfo host.exp.exponent reset`, run the scenario for 10 s, then `adb shell dumpsys gfxinfo host.exp.exponent` and record "Janky frames" and the 50th/90th/95th/99th percentiles. On Android you can also enable the in-app Perf Monitor from the Expo developer menu.
6. For memory: Android Studio's profiler, or `adb shell dumpsys meminfo host.exp.exponent` before and after `continuous 2 min`.

Record: device or emulator model, OS version, Expo Go or development build, debug or release, quality level, and the numbers above. `npx expo start` serves development JavaScript (extra checks, slower); `npx expo start --no-dev --minify` serves production JavaScript to Expo Go and gives more representative JS numbers. A release development build is the reference.

## Engine-side frame cost in Node (Phase 3 sprites, not a device)

What it measures: the JavaScript work the engine does per frame before Skia draws. That is advancing playbacks (sprite frame animations and tweens), updating attachments (one `glow-border`) and building the scene display list. It does **not** include recording the Skia picture, native drawing, image decoding, and a phone CPU is slower than this server CPU by an amount not measured here.

Method: `npm run bench` (`scripts/engine.bench.ts`). A virtual clock advances 600 frames of 16.7 ms. Each sprite plays an 8-frame animation at a different speed and z-index; every tenth sprite also rotates with an endless tween. Timings are `performance.now()` around each `clock.advance`.

Environment: Node 22.23.4, Linux x64 cloud container, 4-core Intel Xeon @ 2.30 GHz, 2026-11-12.

| Sprites | Average | p95 | Max |
| --- | --- | --- | --- |
| 10 | 0.070 ms | 0.107 ms | 7.873 ms (first frames, JIT warm-up) |
| 100 | 0.223 ms | 0.314 ms | 1.974 ms |
| 500 | 1.101 ms | 1.682 ms | 2.905 ms |

Reading: the engine side grows roughly linearly with sprite count and stays far below a 16.7 ms frame in Node. Whether 100 sprites run at 60 FPS on a mid-range phone is **unknown** until it is measured on one.

## Design choices that should help (unmeasured)

- No React re-render per frame. Frames are recorded into an `SkPicture` and handed to Skia through a shared value.
- Sprite frame shapes are cached per frame, so playing an animation allocates no new shapes. Sprites of one sheet share one decoded image.
- Gradients, paths and compiled runtime effects are cached by the renderer. Layer groups (`saveLayer`) are only emitted for nodes that need them.
- Images are decoded once per asset id and deduplicated across concurrent loads; unreferenced images are evicted above a byte budget.
- Particle state uses typed arrays allocated once per burst.
- The engine does no frame work while idle; visible shader fills keep frames coming, hidden ones do not.
- Bounded load: at most 2000 particles per burst and 32 concurrent effects by default.
- Phase 4: emitter buffers come from a shared pool keyed by capacity (reused across effects, see the create/destroy row), `maxParticles` caps each emitter (default 500), quality profiles scale counts, and compiled shaders are cached by source.

Known costs not yet measured: one shader object per shader node per frame, one picture per frame, and `measureInWindow` per frame for targets with `trackEveryFrame`.

## Recording a device measurement

Record: device or simulator, OS version, build mode (debug or release), scene (for example "Effects tab, F, 10 fire borders, high"), method (the section F meter, `dumpsys gfxinfo`, or the Perf Monitor), and average and p95 frame time or FPS. The first device baseline is still open: it needs the owner's Android 17 emulator run (section F) and, later, one physical device in a release build.
